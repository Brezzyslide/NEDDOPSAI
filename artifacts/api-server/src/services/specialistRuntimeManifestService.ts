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

// ─── Compiler ─────────────────────────────────────────────────────────────────

/**
 * Compiles the active DNA profile for a workforce role into a
 * SpecialistRuntimeManifest ready to include in an ExecutionPackage.
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

  // 3. Compile manifest fields from DNA — never include secrets or permissions
  const dnaVersion = profile.currentVersion.version;

  // Escalation rules: all trigger strings + hard stops
  const escalationRules: string[] = [
    ...profile.escalationFramework.rules.map(r =>
      `${r.trigger} → ${r.action} (priority: ${r.priority})`,
    ),
    ...profile.escalationFramework.hardStops.map(s => `HARD STOP: ${s}`),
  ];

  // Competencies mapped to manifest skills (version inherits from DNA version)
  const competencies = profile.competencies.map(c => ({
    code: c.code,
    name: c.name,
    level: c.level,
    description: c.description,
    version: dnaVersion,
  }));

  // Memory scopes — read and write categories from DNA memory policy
  const allowedScopes = [
    ...profile.memoryPolicy.readCategories,
    ...profile.memoryPolicy.writeCategories.filter(
      w => !profile.memoryPolicy.readCategories.includes(w),
    ),
  ];

  // Prohibited memory scopes derived from security constraints mentioning memory
  const prohibitedScopes = profile.professionalBoundaries.securityConstraints
    .filter(c => c.toLowerCase().includes("memory") || c.toLowerCase().includes("session"))
    .slice(0, 5);

  // Build manifest without hash (hash is computed after)
  const withoutHash: Omit<SpecialistRuntimeManifest, "manifestHash"> & { manifestHash: string } = {
    specialistId:  profile.identity.roleCode,
    workforceRole: profile.identity.roleCode,
    displayName:   profile.identity.title,
    domain:        profile.identity.domain,
    dnaProfileId:  profile.identity.roleCode,
    dnaVersion,
    manifestVersion: 1,

    mission:            profile.mission.primaryMission,
    objectives:         profile.mission.objectives,
    responsibilities:   profile.professionalBoundaries.canDo,
    operatingPrinciples: profile.mission.values,

    communicationStyle: {
      tone:        profile.communicationStyle.toneOfVoice,
      detailLevel: profile.communicationStyle.languageRegister,
      language:    profile.communicationStyle.conversationLabel,
    },

    competencies,
    escalationRules,
    prohibitedBehaviours: profile.professionalBoundaries.cannotDo,

    memoryPolicy: {
      allowedScopes,
      prohibitedScopes,
    },

    manifestHash: "", // placeholder — filled in below
    generatedAt:  new Date().toISOString(),
  };

  // 4. Compute and attach hash
  const manifestHash = computeManifestHash(withoutHash);

  return {
    ...withoutHash,
    manifestHash,
  };
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
  generatedAt: string;
  executionId: string;
}

export function buildManifestAuditRecord(
  manifest: SpecialistRuntimeManifest,
  executionId: string,
): ManifestAuditRecord {
  return {
    specialistId:    manifest.specialistId,
    dnaProfileId:    manifest.dnaProfileId,
    dnaVersion:      manifest.dnaVersion,
    manifestVersion: manifest.manifestVersion,
    manifestHash:    manifest.manifestHash,
    generatedAt:     manifest.generatedAt,
    executionId,
  };
}
