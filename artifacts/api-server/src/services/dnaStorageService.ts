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

  // Check if this version already exists
  const existing = await db
    .select({ id: specialistDnaProfilesTable.id })
    .from(specialistDnaProfilesTable)
    .where(
      and(
        eq(specialistDnaProfilesTable.specialistId, roleCode),
        eq(specialistDnaProfilesTable.version, version),
      ),
    )
    .limit(1);

  if (existing.length > 0) return "already_exists";

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

  await db.insert(specialistDnaProfilesTable).values({
    id:           profileId,
    specialistId: roleCode,
    version:      dnaVersion,
    dnaId:        canonicalProfile.versioning.dnaId,
    versionHash:  canonicalProfile.versioning.versionHash,
    ownerType:    canonicalProfile.governance.ownerType,
    visibilityTier: canonicalProfile.governance.visibilityTier,
    professionalReviewRequired: canonicalProfile.governance.professionalReviewRequired,
    approvedBy:   canonicalProfile.governance.approvedBy,
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
    changeDescription: profile.currentVersion.changeDescription,
    publishedBy,
    publishedAt: new Date(),
  });

  // Insert competencies
  if (profile.competencies.length > 0) {
    await db.insert(specialistDnaCompetenciesTable).values(
      profile.competencies.map(c => ({
        dnaProfileId:   profileId,
        competencyCode: c.code,
        name:           c.name,
        level:          c.level,
        description:    c.description,
        version:        dnaVersion,
      })),
    );
  }

  return "created";
}
