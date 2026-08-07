/**
 * Sprint 29H.3 — Entitlement state probe for mhr-holdings-2
 * Read-only. Captures live capability_decisions and entitlement records.
 */
import { describe, it } from "vitest";
import { db } from "@workspace/db";
import {
  capabilityDecisionsTable,
  tenantEntitlementsTable,
  tenantWorkforcePacksTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";

const ORG_ID  = "98b132ec-958c-4ff4-8e80-c5fc7fccd1e2";
const CONV_ID = "96b7bcfe-946b-4aa5-bf6b-635afaa950f5";

describe("Sprint 29H.3 — Entitlement and capability decision probe (mhr-holdings-2)", () => {
  it("capability_decisions for this conversation (most recent 20)", async () => {
    const rows = await db
      .select({
        id: capabilityDecisionsTable.id,
        requestedCapabilityCode: capabilityDecisionsTable.requestedCapabilityCode,
        requestedLevel: capabilityDecisionsTable.requestedLevel,
        decision: capabilityDecisionsTable.decision,
        reasonCode: capabilityDecisionsTable.reasonCode,
        source: capabilityDecisionsTable.source,
        requiredWorkforcePack: capabilityDecisionsTable.requiredWorkforcePack,
        evaluatedAt: capabilityDecisionsTable.evaluatedAt,
      })
      .from(capabilityDecisionsTable)
      .where(
        and(
          eq(capabilityDecisionsTable.organizationId, ORG_ID),
          eq(capabilityDecisionsTable.conversationId, CONV_ID),
        )
      )
      .orderBy(desc(capabilityDecisionsTable.evaluatedAt))
      .limit(20);

    console.log("\n=== CAPABILITY DECISIONS FOR THIS CONVERSATION (latest 20) ===");
    for (const r of rows) {
      console.log(JSON.stringify({
        code: r.requestedCapabilityCode,
        level: r.requestedLevel,
        decision: r.decision,
        reason: r.reasonCode,
        pack: r.requiredWorkforcePack,
        at: r.evaluatedAt,
      }));
    }
    console.log("Total shown:", rows.length);

    // Highlight policy.review decisions
    const policyRows = rows.filter(r => r.requestedCapabilityCode === "policy.review");
    console.log("\n=== policy.review decisions ===");
    if (policyRows.length === 0) {
      console.log("NONE found — policy.review was not evaluated in this conversation");
    } else {
      for (const r of policyRows) console.log(JSON.stringify(r, null, 2));
    }
  });

  it("org-level entitlements for mhr-holdings-2", async () => {
    const rows = await db
      .select()
      .from(tenantEntitlementsTable)
      .where(eq(tenantEntitlementsTable.organizationId, ORG_ID));

    console.log("\n=== TENANT ENTITLEMENTS (mhr-holdings-2) ===");
    for (const r of rows) {
      console.log(JSON.stringify({
        featureCode: (r as any).featureCode ?? (r as any).feature_code ?? r,
        status: (r as any).status,
        source: (r as any).source,
        expiresAt: (r as any).expiresAt,
      }));
    }
    console.log("Total:", rows.length);
  });

  it("workforce pack entitlements for mhr-holdings-2", async () => {
    const rows = await db
      .select()
      .from(tenantWorkforcePacksTable)
      .where(eq(tenantWorkforcePacksTable.organizationId, ORG_ID));

    console.log("\n=== TENANT WORKFORCE PACKS (mhr-holdings-2) ===");
    for (const r of rows) {
      console.log(JSON.stringify(r));
    }
    console.log("Total packs:", rows.length);
    if (rows.length === 0) {
      console.log("NO pack subscriptions — org relies on tenantEntitlements and/or plan-level packs");
    }
  });

  it("policy.review access decision via live decideCapabilityAccess", async () => {
    const { decideCapabilityAccess } = await import("../services/capabilityAccessDecisionService.js");
    const decision = await decideCapabilityAccess(
      ORG_ID,
      "probe-user",
      "policy.review",
      "professional_analysis",
      { conversationId: CONV_ID, correlationId: "sprint29h3-probe" }
    );
    console.log("\n=== LIVE decideCapabilityAccess(policy.review) ===");
    console.log(JSON.stringify({
      capabilityCode: decision.capabilityCode,
      requestedLevel: decision.requestedLevel,
      allowed: decision.allowed,
      partiallyAllowed: decision.partiallyAllowed,
      allowedLevel: decision.allowedLevel,
      reasonCode: decision.reasonCode,
      source: decision.source,
      requiredWorkforcePack: decision.requiredWorkforcePack,
    }, null, 2));
  });

  it("incident.review access decision via live decideCapabilityAccess", async () => {
    const { decideCapabilityAccess } = await import("../services/capabilityAccessDecisionService.js");
    const decision = await decideCapabilityAccess(
      ORG_ID,
      "probe-user",
      "incident.review",
      "professional_analysis",
      { conversationId: CONV_ID, correlationId: "sprint29h3-probe" }
    );
    console.log("\n=== LIVE decideCapabilityAccess(incident.review) ===");
    console.log(JSON.stringify({
      capabilityCode: decision.capabilityCode,
      allowed: decision.allowed,
      partiallyAllowed: decision.partiallyAllowed,
      allowedLevel: decision.allowedLevel,
      reasonCode: decision.reasonCode,
      requiredWorkforcePack: decision.requiredWorkforcePack,
    }, null, 2));
  });

  it("compliance.gap_analysis and compliance.evidence_review access decisions", async () => {
    const { decideCapabilityAccess } = await import("../services/capabilityAccessDecisionService.js");
    const [gapDecision, evidenceDecision] = await Promise.all([
      decideCapabilityAccess(ORG_ID, "probe-user", "compliance.gap_analysis", "professional_analysis", { correlationId: "sprint29h3-probe-gap" }),
      decideCapabilityAccess(ORG_ID, "probe-user", "compliance.evidence_review", "professional_analysis", { correlationId: "sprint29h3-probe-evidence" }),
    ]);
    console.log("\n=== compliance.gap_analysis ===");
    console.log(JSON.stringify({ allowed: gapDecision.allowed, reason: gapDecision.reasonCode, pack: gapDecision.requiredWorkforcePack }));
    console.log("\n=== compliance.evidence_review ===");
    console.log(JSON.stringify({ allowed: evidenceDecision.allowed, reason: evidenceDecision.reasonCode, pack: evidenceDecision.requiredWorkforcePack }));
  });
});
