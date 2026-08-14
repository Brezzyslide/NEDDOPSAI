/**
 * DNA Storage Service — Sprint SRM Hardening (Phase 3+4)
 *
 * Central resolution service for specialist DNA profiles.
 *
 * Resolution order (production):
 *   1. Load the active published DNA version from the database.
 *   2. Return null if not found in the database.
 *
 * Resolution order (development, ALLOW_STATIC_DNA_FALLBACK=true):
 *   1. Load from the database.
 *   2. If not in the database, fall back to the static in-process registry.
 *   3. Log fallback usage — must never be silent.
 *   4. Record source = "static_fallback" in audit metadata.
 *
 * Platform control rules:
 *   - Base DNA (mission, objectives, responsibilities, principles, escalation,
 *     prohibitions, memory policy) is platform-controlled.
 *   - Tenant configuration (organisation_specialist_configuration) may add
 *     goals, context, tone, escalation contacts — never override safety fields.
 *
 * This service does NOT check organisation entitlement.
 * That remains in executionService.ts → checkExecutionAccess.
 */

import { eq, and, desc } from "drizzle-orm";
import {
  db,
  specialistDnaProfilesTable,
  specialistDnaCompetenciesTable,
  organisationSpecialistConfigTable,
} from "@workspace/db";
import type { DNAProfile, WorkforceDNA, WorkforceDNARuntimeProjection } from "@workspace/workforce-dna";
import { getCurrentSpecialists } from "../lib/workforceRegistry.js";
import { getActiveWorkerProfilesForRole } from "../lib/workerProfileRegistry.js";

// ─── Static fallback (development only) ──────────────────────────────────────

/**
 * Whether the static DNA registry is permitted as a fallback source.
 *
 * Production: must be false (or unset).
 * Development: set ALLOW_STATIC_DNA_FALLBACK=true in .env.local.
 *
 * If true in production, executions are rejected rather than silently using
 * a static fallback that bypasses the central version store.
 */
function isStaticFallbackAllowed(): boolean {
  return process.env["ALLOW_STATIC_DNA_FALLBACK"] === "true";
}

// ─── Resolved DNA shape ───────────────────────────────────────────────────────

export interface ResolvedDNA {
  /** Stable canonical DNA ID. Defaults to specialistId for legacy records. */
  dnaId?: string;
  /** Workforce role code */
  specialistId: string;
  /** Semver DNA version */
  version: string;
  /** SHA-256 hash of the canonical DNA version, when available */
  versionHash?: string;
  /** Where this DNA came from */
  source: "database" | "static_fallback";
  /** Display domain — e.g. "Strategic Operations", "Operations" */
  domain?: string;
  mission: string;
  objectives: string[];
  responsibilities: string[];
  operatingPrinciples: string[];
  communicationStyle: {
    tone: string;
    detailLevel: string;
    language: string;
  };
  competencies: Array<{
    code: string;
    name: string;
    level: string;
    description: string;
    version: string;
  }>;
  escalationRules: string[];
  prohibitedBehaviours: string[];
  memoryPolicy: {
    allowedScopes: string[];
    prohibitedScopes: string[];
  };
  /** Full canonical structured Workforce DNA profile, when available */
  canonicalProfile?: WorkforceDNA;
  /** Runtime projection rules for this DNA version, when available */
  runtimeProjection?: WorkforceDNARuntimeProjection;
}

// ─── Resolved organisation context ────────────────────────────────────────────

export interface ResolvedOrgContext {
  organisationProfileVersion: string;
  businessType?: string;
  services?: string[];
  operatingHours?: string;
  timezone?: string;
  systems?: string[];
  firstWeekGoals?: string[];
  escalationContacts?: string[];
}

// ─── Publication reconciliation ──────────────────────────────────────────────

export type WorkforceDnaReconciliationStatus =
  | "NEW"
  | "UNCHANGED"
  | "UPDATED_NEW_VERSION_REQUIRED"
  | "INACTIVE"
  | "INVALID"
  | "NOT_PUBLICATION_ELIGIBLE"
  | "ERROR";

export interface WorkforceDnaPublicationInventoryEntry {
  roleCode: string;
  catalogueStatus: string;
  executionStatus: string;
  dnaStatus: string;
  dnaProfileExists: boolean;
  activeDnaRegistryEntry: boolean;
  getDNAProfileResolves: boolean;
  canonicalMappingWorks: boolean;
  workerProfileCodes: string[];
  workerProfileResolves: boolean;
  runtimeReady: boolean;
  specialistEligibilityReady: boolean;
  conversationWorkforceContextEligible: boolean;
  staticDbPublicationEligible: boolean;
  dbPublished: boolean;
  publishedVersion?: string;
  publishedVersionHash?: string;
  sourceVersion?: string;
  sourceVersionHash?: string;
  sourceVsDbMismatch?: string;
  status: WorkforceDnaReconciliationStatus;
  reasons: string[];
}

export interface WorkforceDnaReconciliationResult {
  applied: boolean;
  generatedAt: string;
  entries: WorkforceDnaPublicationInventoryEntry[];
  summary: Record<WorkforceDnaReconciliationStatus, number>;
}

export interface ReconcileWorkforceDnaPublicationOptions {
  /**
   * false = dry-run only.
   * true = publish NEW eligible source profiles through seedDNAFromStaticRegistry().
   * Changed profiles are reported as UPDATED_NEW_VERSION_REQUIRED and require an
   * explicit source version bump before publication.
   */
  apply?: boolean;
  publishedBy?: string;
  roleCodes?: string[];
}

function emptySummary(): Record<WorkforceDnaReconciliationStatus, number> {
  return {
    NEW: 0,
    UNCHANGED: 0,
    UPDATED_NEW_VERSION_REQUIRED: 0,
    INACTIVE: 0,
    INVALID: 0,
    NOT_PUBLICATION_ELIGIBLE: 0,
    ERROR: 0,
  };
}

function compareDnaVersions(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const parse = (value: string) => value.split(".").map(part => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const left = parse(a);
  const right = parse(b);
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function loadDnaRowsForRole(roleCode: string) {
  return db
    .select()
    .from(specialistDnaProfilesTable)
    .where(eq(specialistDnaProfilesTable.specialistId, roleCode))
    .orderBy(
      desc(specialistDnaProfilesTable.effectiveFrom),
      desc(specialistDnaProfilesTable.publishedAt),
      desc(specialistDnaProfilesTable.createdAt),
    );
}

/**
 * Builds a deterministic source/DB inventory for current-v2 specialists.
 *
 * This does not mutate the database. It is intentionally conservative: a role is
 * publication-eligible only when the current-v2 catalogue, active static DNA,
 * canonical projection and active WorkerProfile all resolve.
 */
export async function buildWorkforceDnaPublicationInventory(
  roleCodes?: string[],
): Promise<WorkforceDnaPublicationInventoryEntry[]> {
  const selectedRoleCodes = roleCodes ? new Set(roleCodes) : null;
  const { getDNAProfile, getCanonicalDNAProfile } = await import("@workspace/workforce-dna");

  const candidates = getCurrentSpecialists()
    .filter(s => !selectedRoleCodes || selectedRoleCodes.has(s.code))
    .sort((a, b) => a.code.localeCompare(b.code));

  const entries: WorkforceDnaPublicationInventoryEntry[] = [];

  for (const specialist of candidates) {
    const reasons: string[] = [];
    let status: WorkforceDnaReconciliationStatus = "NOT_PUBLICATION_ELIGIBLE";

    try {
      const sourceProfile = getDNAProfile(specialist.code);
      const canonicalProfile = getCanonicalDNAProfile(specialist.code);
      const activeWorkerProfiles = getActiveWorkerProfilesForRole(specialist.code);
      const publishedRows = await loadDnaRowsForRole(specialist.code);
      const activePublishedRows = publishedRows.filter(row => row.status === "published");
      const activePublished = activePublishedRows[0];

      const executionAvailable = specialist.executionStatus === "available" || specialist.executionStatus === "beta";
      const dnaApproved = specialist.dnaStatus === "approved";
      const sourceActive = !!sourceProfile?.currentVersion.isActive;
      const canonicalWorks = !!canonicalProfile;
      const workerProfileResolves = activeWorkerProfiles.length > 0;
      const staticDbPublicationEligible =
        specialist.catalogueVersion === "2" &&
        executionAvailable &&
        dnaApproved &&
        sourceActive &&
        canonicalWorks &&
        workerProfileResolves;

      const sourceVersion = sourceProfile?.currentVersion.version;
      const sourceVersionHash = canonicalProfile?.versioning.versionHash;
      const publishedVersion = activePublished?.version;
      const publishedVersionHash = activePublished?.versionHash ?? undefined;
      const dbPublished = !!activePublished;

      if (activePublishedRows.length > 1) {
        reasons.push("Multiple published DNA rows are active for this role; historical versions must be deactivated before execution.");
        status = "INVALID";
      } else if (!staticDbPublicationEligible) {
        if (specialist.executionStatus === "dna_pending" || specialist.dnaStatus !== "approved") {
          status = "NOT_PUBLICATION_ELIGIBLE";
          reasons.push("Role is current-v2 but DNA is not approved/available.");
        } else {
          status = "INVALID";
          if (!sourceActive) reasons.push("Active static DNA profile does not resolve.");
          if (!canonicalWorks) reasons.push("Canonical WorkforceDNA mapping does not resolve.");
          if (!workerProfileResolves) reasons.push("Mandatory active WorkerProfile does not resolve.");
        }
      } else if (!dbPublished) {
        status = "NEW";
        reasons.push("Eligible source profile has no active published DB version.");
      } else if (publishedVersion === sourceVersion && publishedVersionHash === sourceVersionHash) {
        status = "UNCHANGED";
        reasons.push("Active DB DNA version matches the canonical source version and hash.");
      } else if (publishedVersion === sourceVersion && publishedVersionHash !== sourceVersionHash) {
        status = "UPDATED_NEW_VERSION_REQUIRED";
        reasons.push("Source hash differs for the same version; create a new immutable DNA version before publication.");
      } else if (compareDnaVersions(sourceVersion, publishedVersion) > 0) {
        status = "NEW";
        reasons.push(
          `Eligible source DNA is a newer immutable version (${sourceVersion}) than the active DB publication (${publishedVersion}).`,
        );
      } else {
        status = "UPDATED_NEW_VERSION_REQUIRED";
        reasons.push(
          `Source version/hash differs from active DB publication (${publishedVersion ?? "none"}); manual version-history review is required.`,
        );
      }

      entries.push({
        roleCode: specialist.code,
        catalogueStatus: specialist.catalogueVersion,
        executionStatus: specialist.executionStatus,
        dnaStatus: specialist.dnaStatus,
        dnaProfileExists: !!sourceProfile,
        activeDnaRegistryEntry: sourceActive,
        getDNAProfileResolves: !!sourceProfile,
        canonicalMappingWorks: canonicalWorks,
        workerProfileCodes: activeWorkerProfiles.map(p => p.code),
        workerProfileResolves,
        runtimeReady: staticDbPublicationEligible,
        specialistEligibilityReady: staticDbPublicationEligible,
        conversationWorkforceContextEligible: staticDbPublicationEligible,
        staticDbPublicationEligible,
        dbPublished,
        publishedVersion,
        publishedVersionHash,
        sourceVersion,
        sourceVersionHash,
        sourceVsDbMismatch: status === "UNCHANGED" ? undefined : reasons.join(" "),
        status,
        reasons,
      });
    } catch (error) {
      entries.push({
        roleCode: specialist.code,
        catalogueStatus: specialist.catalogueVersion,
        executionStatus: specialist.executionStatus,
        dnaStatus: specialist.dnaStatus,
        dnaProfileExists: false,
        activeDnaRegistryEntry: false,
        getDNAProfileResolves: false,
        canonicalMappingWorks: false,
        workerProfileCodes: [],
        workerProfileResolves: false,
        runtimeReady: false,
        specialistEligibilityReady: false,
        conversationWorkforceContextEligible: false,
        staticDbPublicationEligible: false,
        dbPublished: false,
        status: "ERROR",
        reasons: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  return entries;
}

/**
 * Reconcile current-v2 WorkforceDNA publication state.
 *
 * Dry-run by default. With apply=true, only NEW eligible profiles are published.
 * Changed profiles are intentionally not auto-published unless the source DNA
 * version has been explicitly advanced and the normal seed path can preserve the
 * prior version as inactive historical evidence.
 */
export async function reconcileWorkforceDnaPublication(
  options: ReconcileWorkforceDnaPublicationOptions = {},
): Promise<WorkforceDnaReconciliationResult> {
  const apply = options.apply === true;
  const publishedBy = options.publishedBy ?? "workforce_dna_reconciliation";
  const entries = await buildWorkforceDnaPublicationInventory(options.roleCodes);

  if (apply) {
    for (const entry of entries) {
      if (entry.status !== "NEW" || !entry.staticDbPublicationEligible) continue;
      try {
        await seedDNAFromStaticRegistry(entry.roleCode, publishedBy);
        entry.dbPublished = true;
        entry.publishedVersion = entry.sourceVersion;
        entry.publishedVersionHash = entry.sourceVersionHash;
        entry.status = "UNCHANGED";
        entry.reasons = ["Published missing eligible DNA through the generic static registry seed path."];
        entry.sourceVsDbMismatch = undefined;
      } catch (error) {
        entry.status = "ERROR";
        entry.reasons = [error instanceof Error ? error.message : String(error)];
        entry.sourceVsDbMismatch = entry.reasons.join(" ");
      }
    }
  }

  const summary = emptySummary();
  for (const entry of entries) summary[entry.status] += 1;

  return {
    applied: apply,
    generatedAt: new Date().toISOString(),
    entries,
    summary,
  };
}

// ─── Database loader ──────────────────────────────────────────────────────────

/**
 * Load the active published DNA profile for a specialist from the database.
 * Returns null if no active published version exists.
 */
export async function loadDNAFromDatabase(roleCode: string): Promise<ResolvedDNA | null> {

  // Find the single active published version for this specialist
  const rows = await db
    .select()
    .from(specialistDnaProfilesTable)
    .where(
      and(
        eq(specialistDnaProfilesTable.specialistId, roleCode),
        eq(specialistDnaProfilesTable.status, "published"),
      ),
    )
    .orderBy(
      desc(specialistDnaProfilesTable.effectiveFrom),
      desc(specialistDnaProfilesTable.publishedAt),
      desc(specialistDnaProfilesTable.createdAt),
    )
    .limit(1);

  if (rows.length === 0) return null;
  const profile = rows[0]!;

  // Load competencies
  const competencies = await db
    .select()
    .from(specialistDnaCompetenciesTable)
    .where(eq(specialistDnaCompetenciesTable.dnaProfileId, profile.id));

  // Safely parse JSONB fields
  const parse = <T>(raw: unknown, fallback: T): T => {
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw === "string") {
      try { return JSON.parse(raw) as T; } catch { return fallback; }
    }
    return raw as T;
  };

  const commStyle = parse<{ tone?: string; detailLevel?: string; language?: string }>(
    profile.communicationStyle,
    {},
  );
  const memPolicy = parse<{ allowedScopes?: string[]; prohibitedScopes?: string[] }>(
    profile.memoryPolicy,
    {},
  );
  const canonicalProfile = parse<WorkforceDNA | null>(profile.canonicalProfile, null);
  const runtimeProjection = parse<WorkforceDNARuntimeProjection | null>(
    profile.runtimeProjection,
    null,
  );

  return {
    dnaId:            profile.dnaId ?? profile.specialistId,
    specialistId:     profile.specialistId,
    version:          profile.version,
    versionHash:      profile.versionHash ?? canonicalProfile?.versioning.versionHash,
    source:           "database" as const,
    mission:          profile.mission,
    objectives:       parse<string[]>(profile.objectives, []),
    responsibilities: parse<string[]>(profile.responsibilities, []),
    operatingPrinciples: parse<string[]>(profile.operatingPrinciples, []),
    communicationStyle: {
      tone:        commStyle.tone        ?? "",
      detailLevel: commStyle.detailLevel ?? "",
      language:    commStyle.language    ?? "",
    },
    competencies: competencies.map(c => ({
      code:        c.competencyCode,
      name:        c.name,
      level:       c.level,
      description: c.description,
      version:     c.version,
    })),
    escalationRules:      parse<string[]>(profile.escalationRules, []),
    prohibitedBehaviours: parse<string[]>(profile.prohibitedBehaviours, []),
    memoryPolicy: {
      allowedScopes:    memPolicy.allowedScopes    ?? [],
      prohibitedScopes: memPolicy.prohibitedScopes ?? [],
    },
    canonicalProfile: canonicalProfile ?? undefined,
    runtimeProjection: runtimeProjection ?? canonicalProfile?.runtimeProjection,
  };
}

/**
 * Load the active published DNA profile using the static registry as fallback.
 *
 * Only callable when ALLOW_STATIC_DNA_FALLBACK=true.
 * Logs a warning and records source = "static_fallback" in the result.
 *
 * @throws Error if static fallback is disabled
 */
export async function loadDNAWithStaticFallback(roleCode: string): Promise<ResolvedDNA | null> {
  // Try DB first
  const fromDb = await loadDNAFromDatabase(roleCode);
  if (fromDb) return fromDb;

  // Static fallback — only in development
  if (!isStaticFallbackAllowed()) {
    throw Object.assign(
      new Error(
        `No active published DNA found for "${roleCode}" in the database. ` +
        `ALLOW_STATIC_DNA_FALLBACK is not set — static fallback is disabled in production. ` +
        `Publish the DNA profile to the central store before executing this specialist.`,
      ),
      { code: "MISSING_ACTIVE_DNA" },
    );
  }

  // Dynamically load static registry (avoids hard dependency in production builds)
  let staticProfile: DNAProfile | null;

  try {
    const { getDNAProfile } = await import("@workspace/workforce-dna");
    staticProfile = getDNAProfile(roleCode);
  } catch {
    staticProfile = null;
  }

  if (!staticProfile || !staticProfile.currentVersion.isActive) {
    return null;
  }

  console.warn(
    `[DNA FALLBACK] Using static registry for "${roleCode}" v${staticProfile.currentVersion.version}. ` +
    `This is only permitted in development (ALLOW_STATIC_DNA_FALLBACK=true). ` +
    `Publish this DNA version to the database before going to production.`,
  );

  const dnaVersion = staticProfile.currentVersion.version;

  const escalationRules = [
    ...staticProfile.escalationFramework.rules.map(r =>
      `${r.trigger} → ${r.action} (priority: ${r.priority})`,
    ),
    ...staticProfile.escalationFramework.hardStops.map(s => `HARD STOP: ${s}`),
  ];

  const allowedScopes = [
    ...staticProfile.memoryPolicy.readCategories,
    ...staticProfile.memoryPolicy.writeCategories.filter(
      w => !staticProfile!.memoryPolicy.readCategories.includes(w),
    ),
  ];

  const prohibitedScopes = staticProfile.professionalBoundaries.securityConstraints
    .filter(c => c.toLowerCase().includes("memory") || c.toLowerCase().includes("session"))
    .slice(0, 5);

  const { mapLegacyDNAProfileToWorkforceDNA } = await import("@workspace/workforce-dna");
  const canonicalProfile = mapLegacyDNAProfileToWorkforceDNA(staticProfile);

  return {
    dnaId:            canonicalProfile.versioning.dnaId,
    specialistId:     staticProfile.identity.roleCode,
    version:          dnaVersion,
    versionHash:      canonicalProfile.versioning.versionHash,
    source:           "static_fallback" as const,
    mission:          staticProfile.mission.primaryMission,
    objectives:       staticProfile.mission.objectives,
    responsibilities: staticProfile.professionalBoundaries.canDo,
    operatingPrinciples: staticProfile.mission.values,
    communicationStyle: {
      tone:        staticProfile.communicationStyle.toneOfVoice,
      detailLevel: staticProfile.communicationStyle.languageRegister,
      language:    staticProfile.communicationStyle.conversationLabel,
    },
    competencies: staticProfile.competencies.map(c => ({
      code:        c.code,
      name:        c.name,
      level:       c.level,
      description: c.description,
      version:     dnaVersion,
    })),
    escalationRules,
    prohibitedBehaviours: staticProfile.professionalBoundaries.cannotDo,
    memoryPolicy: {
      allowedScopes,
      prohibitedScopes,
    },
    canonicalProfile,
    runtimeProjection: canonicalProfile.runtimeProjection,
  };
}

/**
 * Load organisation-specific specialist configuration from the database.
 * Returns null if no configuration exists for this org+specialist combination.
 */
export async function loadOrgSpecialistConfig(
  organizationId: string,
  specialistId: string,
): Promise<ResolvedOrgContext | null> {
  const rows = await db
    .select()
    .from(organisationSpecialistConfigTable)
    .where(
      and(
        eq(organisationSpecialistConfigTable.organizationId, organizationId),
        eq(organisationSpecialistConfigTable.specialistId, specialistId),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  const config = rows[0]!;

  const parse = <T>(raw: unknown, fallback: T): T => {
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw === "string") {
      try { return JSON.parse(raw) as T; } catch { return fallback; }
    }
    return raw as T;
  };

  const additionalContext = parse<{
    businessType?: string;
    services?: string[];
    operatingHours?: string;
    timezone?: string;
    systems?: string[];
  }>(config.additionalContext, {});

  const escalationContacts = parse<Array<{ name: string; role?: string }>>(
    config.escalationContacts,
    [],
  );

  const goals = parse<string[]>(config.goals, []);

  // Build a stable version hash from config update timestamp
  const profileVersion = createHash("sha256")
    .update(`${config.id}:${config.updatedAt?.toISOString() ?? ""}`)
    .digest("hex")
    .slice(0, 16);

  return {
    organisationProfileVersion: profileVersion,
    businessType: additionalContext.businessType,
    services:     additionalContext.services,
    operatingHours: additionalContext.operatingHours,
    timezone:     additionalContext.timezone,
    systems:      additionalContext.systems,
    firstWeekGoals: goals.length > 0 ? goals : undefined,
    escalationContacts: escalationContacts.length > 0
      ? escalationContacts.map(c => c.role ? `${c.name} (${c.role})` : c.name)
      : undefined,
  };
}

/**
 * Seed a specialist DNA profile from the static registry into the database.
 * Used during initial setup and CI. Does nothing if the version already exists.
 *
 * @returns "created" | "already_exists"
 */
export async function seedDNAFromStaticRegistry(
  roleCode: string,
  publishedBy: string = "seed_script",
): Promise<"created" | "already_exists"> {
  const { getDNAProfile, mapLegacyDNAProfileToWorkforceDNA } = await import("@workspace/workforce-dna");
  const profile = getDNAProfile(roleCode);
  if (!profile || !profile.currentVersion.isActive) {
    throw new Error(`No active static DNA profile found for "${roleCode}"`);
  }

  const version = profile.currentVersion.version;

  // Check if this version already exists. Keep the role query broad and filter
  // the immutable version explicitly so reconciliation tests and future
  // publication audits can reason about historical versions deterministically.
  const existingForRole = await db
    .select({
      id: specialistDnaProfilesTable.id,
      version: specialistDnaProfilesTable.version,
      status: specialistDnaProfilesTable.status,
    })
    .from(specialistDnaProfilesTable)
    .where(eq(specialistDnaProfilesTable.specialistId, roleCode));

  const existing = existingForRole.find(row => row.version === version);

  if (existing) {
    const existingProfileId = existing.id;
    const expectedCompetencyCodes = new Set(profile.competencies.map(c => c.code));
    const existingCompetencies = await db
      .select({ competencyCode: specialistDnaCompetenciesTable.competencyCode })
      .from(specialistDnaCompetenciesTable)
      .where(eq(specialistDnaCompetenciesTable.dnaProfileId, existingProfileId));
    const existingCompetencyCodes = new Set(existingCompetencies.map(c => c.competencyCode));
    const missingCompetencies = [...expectedCompetencyCodes]
      .filter(code => !existingCompetencyCodes.has(code));

    if (missingCompetencies.length > 0 || existingCompetencyCodes.size < expectedCompetencyCodes.size) {
      throw Object.assign(
        new Error(
          `Published DNA profile "${roleCode}" v${version} is incomplete: ` +
          `missing ${missingCompetencies.length} competency row(s). ` +
          `Manual reconciliation is required before reseeding.`,
        ),
        {
          code: "INCOMPLETE_DNA_PUBLICATION",
          specialistId: roleCode,
          version,
          profileId: existingProfileId,
          missingCompetencies,
        },
      );
    }

    return "already_exists";
  }

  const { randomUUID } = await import("crypto");
  const profileId = randomUUID();

  const escalationRules = [
    ...profile.escalationFramework.rules.map(r =>
      `${r.trigger} → ${r.action} (priority: ${r.priority})`,
    ),
    ...profile.escalationFramework.hardStops.map(s => `HARD STOP: ${s}`),
  ];

  const dnaVersion = profile.currentVersion.version;
  const canonicalProfile = mapLegacyDNAProfileToWorkforceDNA(profile);
  const allowedScopes = [
    ...profile.memoryPolicy.readCategories,
    ...profile.memoryPolicy.writeCategories.filter(
      w => !profile.memoryPolicy.readCategories.includes(w),
    ),
  ];
  const prohibitedScopes = profile.professionalBoundaries.securityConstraints
    .filter(c => c.toLowerCase().includes("memory") || c.toLowerCase().includes("session"))
    .slice(0, 5);

  await db.transaction(async (tx) => {
    const now = new Date();

    // Preserve historical versions and enforce the live table contract that
    // only one version per specialist remains status="published" at a time.
    // The original DB status check supports retired as the inactive historical
    // state; the new row carries supersedes/previousVersion provenance.
    await tx
      .update(specialistDnaProfilesTable)
      .set({ status: "retired", retiredAt: now })
      .where(
        and(
          eq(specialistDnaProfilesTable.specialistId, roleCode),
          eq(specialistDnaProfilesTable.status, "published"),
        ),
      );

    await tx.insert(specialistDnaProfilesTable).values({
      id:           profileId,
      specialistId: roleCode,
      version:      dnaVersion,
      dnaId:        canonicalProfile.versioning.dnaId,
      versionHash:  canonicalProfile.versioning.versionHash,
      ownerType:    canonicalProfile.governance.ownerType,
      visibilityTier: canonicalProfile.governance.visibilityTier,
      professionalReviewRequired: canonicalProfile.governance.professionalReviewRequired,
      approvedBy:   canonicalProfile.governance.approvedBy ?? publishedBy,
      changeReason: canonicalProfile.governance.changeReason,
      effectiveFrom: canonicalProfile.governance.effectiveFrom
        ? new Date(canonicalProfile.governance.effectiveFrom)
        : undefined,
      previousVersion: canonicalProfile.versioning.previousVersion,
      supersedes:   canonicalProfile.versioning.supersedes,
      migrationNotes: canonicalProfile.versioning.migrationNotes,
      canonicalProfile,
      runtimeProjection: canonicalProfile.runtimeProjection,
      immutablePublishedSnapshot: canonicalProfile.versioning.immutablePublishedSnapshot,
      status:       "published",
      mission:      profile.mission.primaryMission,
      objectives:   profile.mission.objectives,
      responsibilities: profile.professionalBoundaries.canDo,
      operatingPrinciples: profile.mission.values,
      communicationStyle: {
        tone:        profile.communicationStyle.toneOfVoice,
        detailLevel: profile.communicationStyle.languageRegister,
        language:    profile.communicationStyle.conversationLabel,
      },
      escalationRules,
      prohibitedBehaviours: profile.professionalBoundaries.cannotDo,
      memoryPolicy: { allowedScopes, prohibitedScopes },
      publishedAt: now,
    });

    // Insert competencies in the same transaction as the parent publication.
    if (profile.competencies.length > 0) {
      await tx.insert(specialistDnaCompetenciesTable).values(
        profile.competencies.map(c => ({
          id:             randomUUID(),
          dnaProfileId:   profileId,
          competencyCode: c.code,
          name:           c.name,
          level:          c.level,
          description:    c.description,
          version:        dnaVersion,
        })),
      );
    }
  });

  return "created";
}
