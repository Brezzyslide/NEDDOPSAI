/**
 * Specialist Runtime Manifest Service — Sprint SRM
 *
 * Compiles a SpecialistRuntimeManifest from the active NeedsOps DNA profile
 * for a given workforce role. This is the only place that reads DNA and
 * produces the runtime identity for OpenClaw.
 *
 * Responsibilities:
 *   - Load the active DNA profile for the selected specialist
 *   - Verify the DNA profile is active
 *   - Compile the DNA into the runtime manifest
 *   - Generate a SHA-256 hash for audit and proof-of-identity
 *   - Never include secrets, credentials, or permissions
 *   - Never override WorkerProfileConstraints
 *   - Produce deterministic output for the same DNA version
 *
 * This service does NOT check organisation entitlement — that is done by
 * checkExecutionAccess in executionService.ts before this service is called.
 */

import { createHash } from "crypto";
import {
  getDNAProfile,
  hasActiveDNA,
} from "@workspace/workforce-dna";
import type { SpecialistRuntimeManifest } from "@workspace/agent-runtime";
import {
  loadDNAWithStaticFallback,
  loadOrgSpecialistConfig,
  type ResolvedDNA,
  type ResolvedOrgContext,
} from "./dnaStorageService.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class MissingDNAError extends Error {
  readonly code = "MISSING_DNA";
  constructor(roleCode: string) {
    super(
      `No DNA profile found for workforce role "${roleCode}". ` +
      `The specialist may not be activated in this NeedsOps instance.`,
    );
    this.name = "MissingDNAError";
  }
}

export class InactiveDNAError extends Error {
  readonly code = "INACTIVE_DNA";
  constructor(roleCode: string, version: string) {
    super(
      `DNA profile for "${roleCode}" (version ${version}) is not active. ` +
      `Only active DNA profiles may be compiled into runtime manifests.`,
    );
    this.name = "InactiveDNAError";
  }
}

// ─── Canonical hash ────────────────────────────────────────────────────────────

/**
 * Computes a SHA-256 hash of the manifest for audit purposes.
 *
 * The hash is computed over a canonical JSON serialisation with:
 *   - Keys sorted alphabetically at every level
 *   - `manifestHash` field set to "" (excluded from the hash input)
 *
 * This guarantees the same DNA version always produces the same hash.
 */
export function computeManifestHash(manifest: Omit<SpecialistRuntimeManifest, "manifestHash"> & { manifestHash: string }): string {
  // Build the canonical object with manifestHash set to "" so it is
  // structurally present but not a circular dependency
  const canonical = sortedKeys({ ...manifest, manifestHash: "" });
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

function sortedKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortedKeys);
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce((acc, key) => {
        (acc as Record<string, unknown>)[key] = sortedKeys((obj as Record<string, unknown>)[key]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return obj;
}

// ─── Compiler (from already-loaded ResolvedDNA) ───────────────────────────────

/**
 * Compiles a SpecialistRuntimeManifest from an already-loaded ResolvedDNA.
 * Pure function — no I/O. Used by both the synchronous and async paths.
 *
 * @param dna         - Pre-loaded DNA data (from DB or static registry)
 * @param orgContext  - Optional organisation-specific context (Phase 5)
 */
function compileFromResolvedDNA(
  dna: ResolvedDNA,
  orgContext?: ResolvedOrgContext,
): SpecialistRuntimeManifest {
  const withoutHash: Omit<SpecialistRuntimeManifest, "manifestHash"> & { manifestHash: string } = {
    specialistId:  dna.specialistId,
    workforceRole: dna.specialistId,
    displayName:   dna.communicationStyle.language || dna.specialistId,
    domain:        dna.domain ?? "Operations",  // set from DB profile or static registry
    dnaProfileId:  dna.specialistId,
    dnaVersion:    dna.version,
    manifestVersion: 1,

    mission:             dna.mission,
    objectives:          dna.objectives,
    responsibilities:    dna.responsibilities,
    operatingPrinciples: dna.operatingPrinciples,

    communicationStyle: {
      tone:        dna.communicationStyle.tone,
      detailLevel: dna.communicationStyle.detailLevel,
      language:    dna.communicationStyle.language,
    },

    competencies:         dna.competencies,
    escalationRules:      dna.escalationRules,
    prohibitedBehaviours: dna.prohibitedBehaviours,

    memoryPolicy: {
      allowedScopes:    dna.memoryPolicy.allowedScopes,
      prohibitedScopes: dna.memoryPolicy.prohibitedScopes,
    },

    // Phase 5: organisation context — included only when available
    // Must not contain credentials, tokens, passwords, or cross-tenant data.
    organisationContext: orgContext,

    manifestHash: "", // placeholder — filled in below
    generatedAt:  new Date().toISOString(),
  };

  const manifestHash = computeManifestHash(withoutHash);
  return { ...withoutHash, manifestHash };
}

// ─── Async resolver (production path — DB-first) ──────────────────────────────

/**
 * Resolves and compiles the active DNA profile for a workforce role.
 *
 * Resolution order:
 *   1. Load active published DNA from the database.
 *   2. If ALLOW_STATIC_DNA_FALLBACK=true, fall back to the static registry.
 *   3. Load organisation-specific context if organizationId is provided.
 *   4. Compile the Specialist Runtime Manifest.
 *
 * This is the function called by executionService.ts in production.
 *
 * @throws MissingDNAError  — if no active DNA exists (and fallback is disabled)
 * @throws InactiveDNAError — if the DNA profile exists but is marked inactive
 */
export async function resolveAndCompileManifest(
  roleCode: string,
  organizationId?: string,
): Promise<SpecialistRuntimeManifest & { dnaSource: "database" | "static_fallback" }> {
  const dna = await loadDNAWithStaticFallback(roleCode);
  if (!dna) {
    throw new MissingDNAError(roleCode);
  }

  // Load organisation context if an org ID was provided
  let orgContext: ResolvedOrgContext | undefined;
  if (organizationId) {
    try {
      orgContext = (await loadOrgSpecialistConfig(organizationId, roleCode)) ?? undefined;
    } catch {
      // Org context failure must never block execution — degrade gracefully
      orgContext = undefined;
    }
  }

  const manifest = compileFromResolvedDNA(dna, orgContext);
  return { ...manifest, dnaSource: dna.source };
}

// ─── Synchronous compiler (static registry — for tests and backward compat) ───

/**
 * Compiles the active DNA profile for a workforce role into a
 * SpecialistRuntimeManifest using the static in-process registry.
 *
 * @deprecated  Production code should use resolveAndCompileManifest() which
 *              resolves DNA from the central database. This function remains
 *              as a test fixture and development convenience.
 *
 * @throws MissingDNAError  — if no DNA profile exists for the role code
 * @throws InactiveDNAError — if the DNA profile exists but is not active
 */
export function compileSpecialistManifest(
  roleCode: string,
): SpecialistRuntimeManifest {
  // 1. Load profile from the static DNA registry
  const profile = getDNAProfile(roleCode);
  if (!profile) {
    throw new MissingDNAError(roleCode);
  }

  // 2. Verify the profile is currently active
  if (!profile.currentVersion.isActive) {
    throw new InactiveDNAError(roleCode, profile.currentVersion.version);
  }

  // 3. Build a ResolvedDNA from the static profile
  const dnaVersion = profile.currentVersion.version;
  const escalationRules: string[] = [
    ...profile.escalationFramework.rules.map(r =>
      `${r.trigger} → ${r.action} (priority: ${r.priority})`,
    ),
    ...profile.escalationFramework.hardStops.map(s => `HARD STOP: ${s}`),
  ];

  const allowedScopes = [
    ...profile.memoryPolicy.readCategories,
    ...profile.memoryPolicy.writeCategories.filter(
      w => !profile.memoryPolicy.readCategories.includes(w),
    ),
  ];
  const prohibitedScopes = profile.professionalBoundaries.securityConstraints
    .filter(c => c.toLowerCase().includes("memory") || c.toLowerCase().includes("session"))
    .slice(0, 5);

  const resolvedDNA: ResolvedDNA = {
    specialistId:     profile.identity.roleCode,
    version:          dnaVersion,
    source:           "static_fallback",
    domain:           profile.identity.domain,
    mission:          profile.mission.primaryMission,
    objectives:       profile.mission.objectives,
    responsibilities: profile.professionalBoundaries.canDo,
    operatingPrinciples: profile.mission.values,
    communicationStyle: {
      tone:        profile.communicationStyle.toneOfVoice,
      detailLevel: profile.communicationStyle.languageRegister,
      language:    profile.communicationStyle.conversationLabel,
    },
    competencies: profile.competencies.map(c => ({
      code: c.code, name: c.name, level: c.level,
      description: c.description, version: dnaVersion,
    })),
    escalationRules,
    prohibitedBehaviours: profile.professionalBoundaries.cannotDo,
    memoryPolicy: { allowedScopes, prohibitedScopes },
  };

  return compileFromResolvedDNA(resolvedDNA);
}

// ─── Audit record ─────────────────────────────────────────────────────────────

/**
 * Returns a compact audit record for persisting in execution session metadata.
 * Records what specialist identity was used for an execution — without storing
 * the full manifest (which is already in the executionPackage JSON).
 */
export interface ManifestAuditRecord {
  specialistId: string;
  dnaProfileId: string;
  dnaVersion: string;
  manifestVersion: number;
  manifestHash: string;
  /** SHA-256 hash of the assembled instruction string sent to OpenClaw */
  instructionHash?: string;
  /** Whether this manifest was compiled from the database or the static fallback */
  dnaSource?: "database" | "static_fallback";
  generatedAt: string;
  executionId: string;
}

export function buildManifestAuditRecord(
  manifest: SpecialistRuntimeManifest,
  executionId: string,
  options?: { instructionHash?: string; dnaSource?: "database" | "static_fallback" },
): ManifestAuditRecord {
  return {
    specialistId:    manifest.specialistId,
    dnaProfileId:    manifest.dnaProfileId,
    dnaVersion:      manifest.dnaVersion,
    manifestVersion: manifest.manifestVersion,
    manifestHash:    manifest.manifestHash,
    instructionHash: options?.instructionHash,
    dnaSource:       options?.dnaSource,
    generatedAt:     manifest.generatedAt,
    executionId,
  };
}
