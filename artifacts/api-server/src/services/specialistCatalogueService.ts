/**
 * Specialist Catalogue Service — Task #40
 *
 * Manages the DB-backed specialist catalogue table. Commercial and display
 * metadata lives here; runtime behaviour (DNA, Employee Files, prompt logic)
 * remains in source control.
 *
 * Key behaviours:
 *   - seedCatalogueFromRegistry() upserts all SPECIALISTS on startup (idempotent)
 *   - updateCatalogueEntry() only allows commercial fields (not runtime fields)
 *   - archiveCatalogueEntry() blocks if the specialist is actively dispatching work
 *     (executionStatus === "available" in the registry = code-defined safety net)
 *   - All mutations are audited to the platform audit log
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { specialistCatalogueTable } from "@workspace/db";
import { eq, asc, desc, and, or, like, sql } from "drizzle-orm";
import { SPECIALISTS, WORKFORCE_PACKS } from "../lib/workforceRegistry.js";
import type { SpecialistCatalogueRow } from "@workspace/db";
import { logger } from "../lib/logger.js";

// ─── Platform audit helper ────────────────────────────────────────────────────

async function logPlatformCatalogueEvent(
  eventType: string,
  specialistCode: string,
  actorUserId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { db: platformDb, platformAuditLogTable } = await import("@workspace/db");
    await platformDb.insert(platformAuditLogTable).values({
      id: randomUUID(),
      actorUserId: actorUserId ?? "system",
      actorType: actorUserId ? "platform_staff" : "system",
      eventType,
      resourceType: "specialist_catalogue",
      resourceId: specialistCode,
      metadata: { specialistCode, ...metadata },
      occurredAt: new Date(),
    });
  } catch {
    // Audit write must never block operations
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CatalogueListOptions {
  includeArchived?: boolean;
  includeDeprecated?: boolean;
  packCode?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface UpdateCatalogueInput {
  displayName?: string;
  description?: string;
  comingSoon?: boolean;
  availability?: string;
  displayOrder?: number;
  planVisibility?: string[] | null;
  iconMetadata?: { icon: string; colour: string };
}

export type CatalogueEntry = SpecialistCatalogueRow;

// ─── Seeding ──────────────────────────────────────────────────────────────────

/**
 * Upserts all SPECIALISTS from workforceRegistry into specialist_catalogue.
 * Safe to call on every startup — uses ON CONFLICT DO UPDATE for idempotency.
 * Only seeds fields that aren't editable by platform owners (structural defaults).
 * Never overwrites display_name, description, coming_soon, plan_visibility, or
 * display_order for rows that already exist and have been changed by a human.
 *
 * Strategy:
 *   - New rows: insert with all registry defaults
 *   - Existing rows: update only category, pack_membership, version_metadata,
 *     execution_status (structural) — preserve all commercially-edited fields
 */
export async function seedCatalogueFromRegistry(): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const specialist of SPECIALISTS) {
    const versionMetadata = {
      catalogueVersion: specialist.catalogueVersion,
      dnaStatus: specialist.dnaStatus,
      departmentCode: specialist.departmentCode,
      registryVersion: specialist.version,
    };

    const iconMetadata = {
      icon: specialist.icon,
      colour: specialist.colour,
    };

    const [existing] = await db
      .select({ id: specialistCatalogueTable.id })
      .from(specialistCatalogueTable)
      .where(eq(specialistCatalogueTable.specialistCode, specialist.code))
      .limit(1);

    if (existing) {
      // Existing row — update only structural fields; preserve commercial edits
      await db
        .update(specialistCatalogueTable)
        .set({
          category:        specialist.departmentCode,
          packMembership:  specialist.packCode,
          versionMetadata: versionMetadata,
          executionStatus: specialist.executionStatus,
          updatedAt:       new Date(),
        })
        .where(eq(specialistCatalogueTable.specialistCode, specialist.code));
      updated++;
    } else {
      // New row — insert with full defaults from registry
      await db.insert(specialistCatalogueTable).values({
        id:              `cat_${specialist.code}`,
        specialistCode:  specialist.code,
        displayName:     specialist.displayName,
        description:     specialist.description,
        executionStatus: specialist.executionStatus,
        availability:    specialist.executionStatus === "available" ? "available"
                       : specialist.executionStatus === "coming_soon" ? "coming_soon"
                       : specialist.executionStatus === "deprecated" ? "unavailable"
                       : specialist.executionStatus === "archived" ? "unavailable"
                       : "coming_soon",
        category:        specialist.departmentCode,
        iconMetadata:    iconMetadata,
        packMembership:  specialist.packCode,
        planVisibility:  null,
        comingSoon:      specialist.executionStatus === "coming_soon" || specialist.executionStatus === "dna_pending",
        displayOrder:    specialist.displayOrder,
        versionMetadata: versionMetadata,
        isActive:        specialist.executionStatus !== "deprecated" && specialist.executionStatus !== "archived",
        isArchived:      specialist.executionStatus === "archived",
        versionCounter:  1,
        changedBy:       null,
        createdAt:       new Date(),
        updatedAt:       new Date(),
      });
      inserted++;
    }
  }

  // Detect codes in DB that have no registry match (log warning only)
  const allDbCodes = await db
    .select({ code: specialistCatalogueTable.specialistCode })
    .from(specialistCatalogueTable);
  const registryCodes = new Set(SPECIALISTS.map(s => s.code));
  for (const { code } of allDbCodes) {
    if (!registryCodes.has(code)) {
      logger.warn(
        { specialistCode: code },
        "[catalogue] Specialist in DB catalogue has no matching runtime specialist in registry",
      );
    }
  }

  logger.info(`[catalogue] Seed complete: ${inserted} inserted, ${updated} updated`);
  return { inserted, updated };
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listCatalogue(options: CatalogueListOptions = {}): Promise<{
  entries: CatalogueEntry[];
  total: number;
  page: number;
  limit: number;
}> {
  const {
    includeArchived = false,
    includeDeprecated = false,
    packCode,
    search,
    page = 1,
    limit = 50,
  } = options;

  const conditions = [];

  if (!includeArchived) {
    conditions.push(eq(specialistCatalogueTable.isArchived, false));
  }
  if (!includeDeprecated) {
    // Deprecated specialists show in the list but with a deprecated badge
    // They are not hidden by default — platform owners should see them
  }
  if (packCode) {
    conditions.push(eq(specialistCatalogueTable.packMembership, packCode));
  }
  if (search) {
    conditions.push(
      or(
        like(specialistCatalogueTable.displayName, `%${search}%`),
        like(specialistCatalogueTable.specialistCode, `%${search}%`),
        like(specialistCatalogueTable.description, `%${search}%`),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [entries, [countRow]] = await Promise.all([
    db
      .select()
      .from(specialistCatalogueTable)
      .where(where)
      .orderBy(asc(specialistCatalogueTable.displayOrder), asc(specialistCatalogueTable.specialistCode))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(specialistCatalogueTable)
      .where(where),
  ]);

  return { entries, total: countRow?.n ?? 0, page, limit };
}

// ─── Get by code ──────────────────────────────────────────────────────────────

export async function getCatalogueEntry(specialistCode: string): Promise<CatalogueEntry | null> {
  const [entry] = await db
    .select()
    .from(specialistCatalogueTable)
    .where(eq(specialistCatalogueTable.specialistCode, specialistCode))
    .limit(1);
  return entry ?? null;
}

// ─── Update commercial fields ─────────────────────────────────────────────────

export async function updateCatalogueEntry(
  specialistCode: string,
  input: UpdateCatalogueInput,
  changedBy: string,
): Promise<CatalogueEntry> {
  const existing = await getCatalogueEntry(specialistCode);
  if (!existing) {
    throw Object.assign(new Error("Specialist not found in catalogue"), { statusCode: 404 });
  }
  if (existing.isArchived) {
    throw Object.assign(new Error("Cannot update an archived specialist"), { statusCode: 409 });
  }

  const [updated] = await db
    .update(specialistCatalogueTable)
    .set({
      ...( input.displayName  !== undefined && { displayName:  input.displayName  }),
      ...( input.description  !== undefined && { description:  input.description  }),
      ...( input.comingSoon   !== undefined && { comingSoon:   input.comingSoon   }),
      ...( input.availability !== undefined && { availability: input.availability }),
      ...( input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
      ...( input.planVisibility !== undefined && { planVisibility: input.planVisibility }),
      ...( input.iconMetadata !== undefined && { iconMetadata:  input.iconMetadata  }),
      versionCounter: existing.versionCounter + 1,
      changedBy,
      updatedAt: new Date(),
    })
    .where(eq(specialistCatalogueTable.specialistCode, specialistCode))
    .returning();

  if (!updated) throw Object.assign(new Error("Update failed"), { statusCode: 500 });

  void logPlatformCatalogueEvent("catalogue.specialist_updated", specialistCode, changedBy, {
    changes: Object.keys(input),
    newVersion: updated.versionCounter,
  });

  return updated;
}

// ─── Archive ──────────────────────────────────────────────────────────────────

/**
 * Archives a specialist from the catalogue.
 *
 * Guard: blocks if the specialist's registry executionStatus is "available",
 * since that means the runtime is actively dispatching to this specialist.
 * Archiving an active specialist would break production execution.
 *
 * For deprecated or dna_pending specialists, archival is always permitted.
 */
export async function archiveCatalogueEntry(
  specialistCode: string,
  changedBy: string,
): Promise<CatalogueEntry> {
  const existing = await getCatalogueEntry(specialistCode);
  if (!existing) {
    throw Object.assign(new Error("Specialist not found in catalogue"), { statusCode: 404 });
  }
  if (existing.isArchived) {
    throw Object.assign(new Error("Specialist is already archived"), { statusCode: 409 });
  }

  // Guard: block if specialist is actively dispatching work
  const registrySpecialist = SPECIALISTS.find(s => s.code === specialistCode);
  if (registrySpecialist?.executionStatus === "available") {
    throw Object.assign(
      new Error(
        `Cannot archive specialist "${specialistCode}" — it has executionStatus "available" in the runtime registry. ` +
        "Update the registry code first to change its status before archiving the catalogue entry.",
      ),
      { statusCode: 409, code: "SPECIALIST_ACTIVE_IN_RUNTIME" },
    );
  }

  const [updated] = await db
    .update(specialistCatalogueTable)
    .set({
      isArchived:     true,
      isActive:       false,
      versionCounter: existing.versionCounter + 1,
      changedBy,
      updatedAt:      new Date(),
    })
    .where(eq(specialistCatalogueTable.specialistCode, specialistCode))
    .returning();

  if (!updated) throw Object.assign(new Error("Archive failed"), { statusCode: 500 });

  void logPlatformCatalogueEvent("catalogue.specialist_archived", specialistCode, changedBy, {
    previousStatus: existing.executionStatus,
    newVersion: updated.versionCounter,
  });

  return updated;
}

// ─── Unarchive ────────────────────────────────────────────────────────────────

export async function unarchiveCatalogueEntry(
  specialistCode: string,
  changedBy: string,
): Promise<CatalogueEntry> {
  const existing = await getCatalogueEntry(specialistCode);
  if (!existing) {
    throw Object.assign(new Error("Specialist not found in catalogue"), { statusCode: 404 });
  }
  if (!existing.isArchived) {
    throw Object.assign(new Error("Specialist is not archived"), { statusCode: 409 });
  }

  const [updated] = await db
    .update(specialistCatalogueTable)
    .set({
      isArchived:     false,
      isActive:       true,
      versionCounter: existing.versionCounter + 1,
      changedBy,
      updatedAt:      new Date(),
    })
    .where(eq(specialistCatalogueTable.specialistCode, specialistCode))
    .returning();

  if (!updated) throw Object.assign(new Error("Unarchive failed"), { statusCode: 500 });

  void logPlatformCatalogueEvent("catalogue.specialist_unarchived", specialistCode, changedBy, {
    newVersion: updated.versionCounter,
  });

  return updated;
}

// ─── Assign to pack ───────────────────────────────────────────────────────────

export async function assignToPack(
  specialistCode: string,
  packCode: string,
  changedBy: string,
): Promise<CatalogueEntry> {
  const existing = await getCatalogueEntry(specialistCode);
  if (!existing) {
    throw Object.assign(new Error("Specialist not found in catalogue"), { statusCode: 404 });
  }

  // Validate pack code exists
  const packExists = WORKFORCE_PACKS.some(p => p.code === packCode);
  if (!packExists) {
    throw Object.assign(
      new Error(`Pack "${packCode}" does not exist in the workforce registry`),
      { statusCode: 400 },
    );
  }

  const [updated] = await db
    .update(specialistCatalogueTable)
    .set({
      packMembership: packCode,
      versionCounter: existing.versionCounter + 1,
      changedBy,
      updatedAt:      new Date(),
    })
    .where(eq(specialistCatalogueTable.specialistCode, specialistCode))
    .returning();

  if (!updated) throw Object.assign(new Error("Pack assignment failed"), { statusCode: 500 });

  void logPlatformCatalogueEvent("catalogue.specialist_pack_assigned", specialistCode, changedBy, {
    fromPack: existing.packMembership,
    toPack: packCode,
    newVersion: updated.versionCounter,
  });

  return updated;
}

// ─── Mark coming soon ─────────────────────────────────────────────────────────

export async function markComingSoon(
  specialistCode: string,
  comingSoon: boolean,
  changedBy: string,
): Promise<CatalogueEntry> {
  const existing = await getCatalogueEntry(specialistCode);
  if (!existing) {
    throw Object.assign(new Error("Specialist not found in catalogue"), { statusCode: 404 });
  }
  if (existing.isArchived) {
    throw Object.assign(new Error("Cannot update an archived specialist"), { statusCode: 409 });
  }

  const [updated] = await db
    .update(specialistCatalogueTable)
    .set({
      comingSoon:     comingSoon,
      availability:   comingSoon ? "coming_soon" : "available",
      versionCounter: existing.versionCounter + 1,
      changedBy,
      updatedAt:      new Date(),
    })
    .where(eq(specialistCatalogueTable.specialistCode, specialistCode))
    .returning();

  if (!updated) throw Object.assign(new Error("Update failed"), { statusCode: 500 });

  void logPlatformCatalogueEvent(
    comingSoon ? "catalogue.specialist_marked_coming_soon" : "catalogue.specialist_published",
    specialistCode,
    changedBy,
    { comingSoon, newVersion: updated.versionCounter },
  );

  return updated;
}

// ─── Merge registry + catalogue ───────────────────────────────────────────────

/**
 * Returns a specialist's merged view: catalogue DB fields take precedence for
 * commercial data; registry fields provide runtime/code-defined data.
 * Used by the workforce browser endpoint to serve enriched specialist data.
 */
export async function getMergedSpecialist(specialistCode: string): Promise<Record<string, unknown> | null> {
  const registryEntry = SPECIALISTS.find(s => s.code === specialistCode);
  if (!registryEntry) return null;

  const catalogueEntry = await getCatalogueEntry(specialistCode);

  if (!catalogueEntry) {
    // No DB entry yet (pre-seed) — fall back to registry only.
    // Explicit isArchived:false so callers can always read this field safely.
    return { ...registryEntry, isArchived: false, _source: "registry_only" };
  }

  return {
    // Runtime fields from registry (immutable from DB perspective)
    code:                  registryEntry.code,
    id:                    registryEntry.id,
    capabilities:          registryEntry.capabilities,
    requiredPermissions:   registryEntry.requiredPermissions,
    requiredEntitlements:  registryEntry.requiredEntitlements,
    approvalRequirements:  registryEntry.approvalRequirements,
    workerProfileCodes:    registryEntry.workerProfileCodes,
    replacementType:       registryEntry.replacementType,
    replacementRoleCode:   registryEntry.replacementRoleCode ?? null,
    deprecatedAt:          registryEntry.deprecatedAt ?? null,
    deprecationReason:     registryEntry.deprecationReason ?? null,
    // Commercial fields from catalogue DB (owner-editable)
    displayName:           catalogueEntry.displayName,
    description:           catalogueEntry.description,
    executionStatus:       catalogueEntry.executionStatus,
    availability:          catalogueEntry.availability,
    departmentCode:        catalogueEntry.category,
    icon:                  catalogueEntry.iconMetadata.icon,
    colour:                catalogueEntry.iconMetadata.colour,
    packCode:              catalogueEntry.packMembership,
    planVisibility:        catalogueEntry.planVisibility,
    comingSoon:            catalogueEntry.comingSoon,
    displayOrder:          catalogueEntry.displayOrder,
    isActive:              catalogueEntry.isActive,
    isArchived:            catalogueEntry.isArchived,
    catalogueVersion:      catalogueEntry.versionMetadata.catalogueVersion,
    dnaStatus:             catalogueEntry.versionMetadata.dnaStatus,
    catalogueUpdatedAt:    catalogueEntry.updatedAt,
    catalogueVersionNum:   catalogueEntry.versionCounter,
    _source: "catalogue",
  };
}
