/**
 * Conversation Workforce Context Service — Sprint 28.3
 *
 * Provides a live, organisation-aware specialist availability context for the
 * Chief of Staff conversation path.
 *
 * Combines:
 *   - DB-backed catalogue metadata (isArchived, comingSoon, executionStatus overrides)
 *   - Registry state (capabilities, dnaStatus, packCode, department)
 *   - Organisation entitlement (pack access via tenantCanUseSpecialist)
 *   - Runtime activation state (RUNTIME_READY set)
 *
 * ─── Dispatchability rules (ALL must be true) ────────────────────────────────
 *   1. Exists in catalogue/registry as a current v2 specialist (not deprecated)
 *   2. Not archived
 *   3. Not comingSoon
 *   4. Not suspended (executionStatus !== "suspended")
 *   5. executionStatus === "available" || "beta"
 *   6. dnaStatus === "approved"
 *   7. Organisation is entitled (pack access granted)
 *   8. Runtime is ready (in RUNTIME_READY activation set)
 *
 * ─── Availability for conversation ──────────────────────────────────────────
 *   Any registered non-deprecated specialist may be mentioned and discussed.
 *   The CoS must disclose the unavailability reason when not dispatchable.
 *
 * ─── Cache ──────────────────────────────────────────────────────────────────
 *   30-second org-scoped in-process cache. Invalidated implicitly on next read
 *   when TTL expires. Separate orgs never share cache entries.
 */

import { SPECIALISTS } from "../lib/workforceRegistry.js";
import { listCatalogue } from "./specialistCatalogueService.js";
import { tenantCanUseSpecialist } from "./entitlementService.js";
import type { WorkforcePackCode } from "@workspace/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationWorkforceEntry {
  code: string;
  displayName: string;
  department: string;
  executionStatus: string;
  dnaStatus: string;
  catalogueStatus: {
    isArchived: boolean;
    comingSoon: boolean;
    suspended: boolean;
  };
  entitled: boolean;
  entitlementReason?: string;
  runtimeReady: boolean;
  /** executionStatus === "available" (not comingSoon, not archived) */
  active: boolean;
  /** CoS may mention and explain this role — true for all non-deprecated specialists */
  availableForConversation: boolean;
  /** CoS may assign or recommend this specialist for immediate work */
  availableForDispatch: boolean;
  /** Customer-facing reason why not dispatchable (undefined when dispatchable) */
  unavailableReason?: string;
  capabilities: string[];
}

export interface ConversationWorkforceContext {
  organisationId: string;
  specialists: ConversationWorkforceEntry[];
  summary: {
    /** Specialists available for conversation (all non-deprecated) */
    availableCount: number;
    /** Specialists available for dispatch right now */
    dispatchableCount: number;
    /** Specialists not available for dispatch */
    unavailableCount: number;
  };
}

// ─── Runtime activation set ───────────────────────────────────────────────────
// Reflects the ACTIVE_SPECIALISTS set in specialistEligibilityService.
// chief_of_staff is always runtime-ready (it IS the conversation manager).
// Only add a specialist here when it has approved canonical WorkforceDNA,
// a mapped WorkerProfile, and has been activated for live execution.

const RUNTIME_READY = new Set([
  "authorised_program_officer",
  "chief_of_staff",
  "compliance_quality_manager",
  "executive_assistant",
  "incident_safeguarding_specialist",
  "operations_manager",
]);

// ─── Customer-facing status labels ────────────────────────────────────────────
// Internal codes (dna_pending, archived, etc.) must never reach customers.

function toUnavailableReason(entry: {
  isArchived: boolean;
  comingSoon: boolean;
  suspended: boolean;
  executionStatus: string;
  dnaStatus: string;
  entitled: boolean;
  entitlementReason?: string;
  runtimeReady: boolean;
}): string {
  if (entry.isArchived)   return "Archived";
  if (entry.comingSoon)   return "Not yet released";
  if (entry.suspended)    return "Temporarily unavailable";
  if (
    entry.executionStatus === "dna_pending" ||
    entry.dnaStatus === "pending_design"
  ) return "Professional design pending";
  if (
    entry.executionStatus === "dna_draft" ||
    entry.dnaStatus === "draft"
  ) return "Professional profile in progress";
  if (!entry.entitled)   return entry.entitlementReason ?? "Not available in your plan";
  if (!entry.runtimeReady) return "Platform setup incomplete";
  return "Unavailable";
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;
const workforceCache = new Map<string, { result: ConversationWorkforceContext; expiresAt: number }>();

/** Clear the in-process cache — use in tests to avoid cross-test contamination. */
export function _clearWorkforceCache(): void {
  workforceCache.clear();
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Returns the live specialist availability for the given organisation.
 * Results are cached 30 seconds per organisation.
 *
 * Returns an empty specialist list (rather than throwing) if the catalogue
 * is unavailable — the caller must handle a zero-dispatchable result gracefully.
 */
export async function getConversationWorkforceContext(
  organisationId: string,
): Promise<ConversationWorkforceContext> {
  if (!organisationId) {
    return { organisationId, specialists: [], summary: { availableCount: 0, dispatchableCount: 0, unavailableCount: 0 } };
  }

  const hit = workforceCache.get(organisationId);
  if (hit && hit.expiresAt > Date.now()) return hit.result;

  // ── Catalogue merge ────────────────────────────────────────────────────────
  // Catalogue fields override registry seed values for commercial state:
  // isArchived, comingSoon, executionStatus, displayName, description.
  const { entries } = await listCatalogue({ includeArchived: true, includeDeprecated: true, limit: 500 })
    .catch(() => ({ entries: [] as any[] }));
  const catMap = new Map(entries.map((e: any) => [e.specialistCode, e]));

  // Only current v2 catalogue specialists — deprecated v1 legacy codes are excluded.
  const candidates = SPECIALISTS.filter(s => s.executionStatus !== "deprecated");

  // ── Entitlement checks (async, batched) ───────────────────────────────────
  // Only run for potentially-dispatchable specialists to avoid unnecessary DB
  // calls. A specialist with dna_pending or comingSoon cannot be dispatched
  // regardless of entitlement.
  const entitlementResults = new Map<string, { entitled: boolean; reason?: string }>();

  const entitlementCandidates = candidates.filter(s => {
    const cat = catMap.get(s.code) as any;
    const execStatus = (cat?.executionStatus ?? s.executionStatus) as string;
    const isArchived  = (cat?.isArchived  ?? false) as boolean;
    const comingSoon  = (cat?.comingSoon  ?? false) as boolean;
    return (
      !isArchived &&
      !comingSoon &&
      execStatus !== "suspended" &&
      (execStatus === "available" || execStatus === "beta") &&
      s.dnaStatus === "approved"
    );
  });

  await Promise.allSettled(
    entitlementCandidates.map(async s => {
      try {
        const r = await tenantCanUseSpecialist(
          organisationId,
          s.code,
          s.packCode as WorkforcePackCode,
        );
        entitlementResults.set(s.code, { entitled: r.allowed, reason: r.allowed ? undefined : r.reason });
      } catch {
        entitlementResults.set(s.code, { entitled: false, reason: "Entitlement check unavailable" });
      }
    }),
  );

  // ── Build specialist entries ───────────────────────────────────────────────
  const specialists: ConversationWorkforceEntry[] = [];

  for (const s of candidates) {
    const cat            = catMap.get(s.code) as any;
    const executionStatus = ((cat?.executionStatus ?? s.executionStatus) as string);
    const isArchived      = (cat?.isArchived  ?? false) as boolean;
    const comingSoon      = (cat?.comingSoon   ?? false) as boolean;
    const suspended       = executionStatus === "suspended";
    const displayName     = (cat?.displayName  ?? s.displayName)  as string;

    const entCheck          = entitlementResults.get(s.code);
    const entitled          = entCheck?.entitled ?? false;
    const entitlementReason = entCheck?.reason;
    const runtimeReady      = RUNTIME_READY.has(s.code);

    const availableForDispatch =
      !isArchived &&
      !comingSoon &&
      !suspended &&
      (executionStatus === "available" || executionStatus === "beta") &&
      s.dnaStatus === "approved" &&
      entitled &&
      runtimeReady;

    const unavailableReason = availableForDispatch
      ? undefined
      : toUnavailableReason({ isArchived, comingSoon, suspended, executionStatus, dnaStatus: s.dnaStatus, entitled, entitlementReason, runtimeReady });

    specialists.push({
      code:               s.code,
      displayName,
      department:         (s as any).departmentCode ?? "unknown",
      executionStatus,
      dnaStatus:          s.dnaStatus,
      catalogueStatus:    { isArchived, comingSoon, suspended },
      entitled,
      entitlementReason,
      runtimeReady,
      active:             executionStatus === "available" && !isArchived && !comingSoon,
      availableForConversation: true,  // all non-deprecated roles may be discussed
      availableForDispatch,
      unavailableReason,
      capabilities:       s.capabilities ?? [],
    });
  }

  const result: ConversationWorkforceContext = {
    organisationId,
    specialists,
    summary: {
      availableCount:    specialists.filter(s => s.availableForConversation).length,
      dispatchableCount: specialists.filter(s => s.availableForDispatch).length,
      unavailableCount:  specialists.filter(s => !s.availableForDispatch).length,
    },
  };

  workforceCache.set(organisationId, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

// ─── Context section builder ──────────────────────────────────────────────────

/**
 * Formats a ConversationWorkforceContext as the === AVAILABLE AI WORKFORCE ===
 * context block that is injected into the Chief of Staff user message.
 *
 * Dispatchable specialists appear in the top section.
 * Unavailable specialists appear as a disclosure-only section below.
 * Deprecated specialists do not appear at all.
 */
export function buildWorkforceSection(ctx: ConversationWorkforceContext): string {
  const lines: string[] = ["=== AVAILABLE AI WORKFORCE ==="];

  const dispatchable = ctx.specialists.filter(s => s.availableForDispatch);
  const discussable  = ctx.specialists.filter(s => s.availableForConversation && !s.availableForDispatch);

  if (dispatchable.length === 0) {
    lines.push("\nDispatchable now: none");
  } else {
    lines.push("\nDispatchable now:\n");
    for (const s of dispatchable) {
      lines.push(`- ${s.displayName}`);
      lines.push(`  Code: ${s.code}`);
      if (s.capabilities.length > 0) {
        lines.push("  Capabilities:");
        for (const cap of s.capabilities.slice(0, 6)) {
          lines.push(`  - ${cap.replace(/_/g, " ")}`);
        }
      }
    }
  }

  if (discussable.length > 0) {
    lines.push("\nAvailable for discussion but not dispatch:\n");
    for (const s of discussable) {
      lines.push(`- ${s.displayName}`);
      if (s.unavailableReason) {
        lines.push(`  Status: ${s.unavailableReason}`);
      }
    }
  }

  lines.push(
    "\nIMPORTANT: Only specialists listed under 'Dispatchable now' may be assigned or recommended for immediate work.",
  );

  return lines.join("\n");
}
