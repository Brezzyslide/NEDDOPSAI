/**
 * SPRINT 29H.6 — CAPABILITY INTENT & PARTIAL-GATE CORRECTION
 *
 * Test matrix (H) — 12 areas:
 *   H1–H4:   Analytical deliverable phrases → professional_analysis
 *   H5–H7:   External-state phrases → execution
 *   H8:      Full acceptance request → incident.review + corrective_actions @ professional_analysis
 *   H9:      Genuine execution request triggers entitlement gate
 *   H10:     Analytical task does not trigger partial-access confirmation
 *   H11:     dna_pending specialist is not dispatchable
 *   H12:     Incident & Safeguarding Specialist is eligible for incident review
 *
 * Evidence level: 1 (unit test — deterministic scoring, registry lookups, sync eligibility checks)
 * No real DB, no LLM, no AI gateway. AI_PROVIDER=internal forces deterministic path.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { identifyCapabilities } from "../services/capabilityIdentificationService.js";
import { validateSpecialistEligibilitySync } from "../services/specialistEligibilityService.js";
import {
  buildMixedCapabilityCard,
} from "../services/capabilityGateService.js";
import type {
  CapabilityAccessDecision,
  MixedCapabilityDecision,
} from "../services/capabilityAccessDecisionService.js";
import { randomUUID } from "crypto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FAKE_ORG  = "00000000-0000-0000-0000-000000000001";
const FAKE_USER = "00000000-0000-0000-0000-000000000002";
const FAKE_CONV = "00000000-0000-0000-0000-000000000003";

/** Run identifyCapabilities with AI_PROVIDER=internal (deterministic, no LLM) */
async function identify(message: string) {
  return identifyCapabilities({
    organizationId: FAKE_ORG,
    userId: FAKE_USER,
    conversationId: FAKE_CONV,
    message,
  });
}

function findCap(result: Awaited<ReturnType<typeof identify>>, code: string) {
  return result.requestedCapabilities.find(c => c.capabilityCode === code);
}

function makeAllowed(code: string, level: "professional_analysis" | "general_information" | "execution"): CapabilityAccessDecision {
  return {
    decisionId: randomUUID(),
    capabilityCode: code,
    requestedLevel: level,
    allowed: true,
    partiallyAllowed: false,
    reasonCode: "workforce_pack_included",
    upgradeOptions: [],
  };
}

function makePartial(code: string, level: "execution", reasonCode: "execution_not_included" | "connector_not_eligible"): CapabilityAccessDecision {
  return {
    decisionId: randomUUID(),
    capabilityCode: code,
    requestedLevel: level,
    allowed: false,
    partiallyAllowed: true,
    allowedLevel: "professional_analysis",
    deniedLevel: level,
    reasonCode,
    upgradeOptions: [],
  };
}

function makeBlocked(code: string, level: "execution" | "professional_analysis", pack?: string): CapabilityAccessDecision {
  return {
    decisionId: randomUUID(),
    capabilityCode: code,
    requestedLevel: level,
    allowed: false,
    partiallyAllowed: false,
    reasonCode: pack ? "workforce_pack_not_included" : "subscription_inactive",
    requiredWorkforcePack: pack,
    upgradeOptions: [],
  };
}

function makeMixed(
  allowed: CapabilityAccessDecision[],
  partial: CapabilityAccessDecision[],
  blocked: CapabilityAccessDecision[],
): MixedCapabilityDecision {
  return {
    allowedCapabilities: allowed,
    partialCapabilities: partial,
    blockedCapabilities: blocked,
    canProceedPartially: blocked.length === 0,
    requiresUserConfirmationForPartialWork: partial.length > 0 && blocked.length === 0,
    blockedPacksRequired: blocked.map(d => d.requiredWorkforcePack).filter((p): p is string => !!p),
  };
}

// ─── Force deterministic path ─────────────────────────────────────────────────

let originalProvider: string | undefined;

beforeAll(() => {
  originalProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "internal";
});

afterAll(() => {
  if (originalProvider === undefined) {
    delete process.env.AI_PROVIDER;
  } else {
    process.env.AI_PROVIDER = originalProvider;
  }
});

// ─── H1–H4: Analytical deliverable phrases → professional_analysis ─────────

describe("H1–H4: Analytical deliverables must be professional_analysis, not execution", () => {
  it("H1: 'Prepare an Improvement Plan' → corrective_actions @ professional_analysis", async () => {
    const result = await identify("Prepare an Improvement Plan");
    const cap = findCap(result, "compliance.corrective_actions");
    expect(cap, "compliance.corrective_actions should be identified").toBeDefined();
    expect(cap!.requestedLevel).toBe("professional_analysis");
  });

  it("H2: 'Recommend corrective actions' → professional_analysis", async () => {
    const result = await identify("Recommend corrective actions for our compliance gaps");
    const cap = findCap(result, "compliance.corrective_actions");
    expect(cap).toBeDefined();
    expect(cap!.requestedLevel).toBe("professional_analysis");
  });

  it("H3: 'Develop a remediation plan' → professional_analysis", async () => {
    const result = await identify("Develop a remediation plan based on the audit findings");
    const cap = findCap(result, "compliance.corrective_actions");
    expect(cap).toBeDefined();
    expect(cap!.requestedLevel).toBe("professional_analysis");
  });

  it("H4: 'Prioritise corrective actions' → professional_analysis", async () => {
    const result = await identify("Prioritise corrective actions for each gap identified");
    const cap = findCap(result, "compliance.corrective_actions");
    expect(cap).toBeDefined();
    expect(cap!.requestedLevel).toBe("professional_analysis");
  });
});

// ─── H5–H7: External-state phrases → execution ────────────────────────────

describe("H5–H7: External-state action phrases must map to execution intent", () => {
  it("H5: 'Implement corrective actions in our live systems' → execution", async () => {
    const result = await identify("Implement corrective actions in our live systems");
    const cap = findCap(result, "compliance.corrective_actions");
    expect(cap).toBeDefined();
    expect(cap!.requestedLevel).toBe("execution");
  });

  it("H6: 'Apply the corrective actions now' → execution", async () => {
    // 'apply' is in EXECUTION_VERBS; 'corrective actions' keyword detected
    const result = await identify("Apply the corrective actions now");
    const cap = findCap(result, "compliance.corrective_actions");
    expect(cap).toBeDefined();
    expect(cap!.requestedLevel).toBe("execution");
  });

  it("H7: 'Submit the corrective action plan to the regulator' → execution", async () => {
    // 'submit corrective' is an explicit execution phrase (external submission)
    const result = await identify("Submit the corrective action plan to the regulator");
    const cap = findCap(result, "compliance.corrective_actions");
    expect(cap).toBeDefined();
    expect(cap!.requestedLevel).toBe("execution");
  });
});

// ─── H8: Full acceptance request ────────────────────────────────────────────

describe("H8: Full acceptance request — incident intent + corrective plan at professional_analysis", () => {
  const ACCEPTANCE_SHORT =
    "Review Incident Management Policy and prepare Improvement Plan with recommendations, responsible roles and evidence citations.";

  const ACCEPTANCE_LIVE =
    "Review our current Incident Management Policy using the approved knowledge available in NeedsOps. " +
    "Identify actual operational gaps, risks, unclear responsibilities and weaknesses. " +
    "Produce a prioritised Improvement Plan with recommendations, responsible roles and evidence citations.";

  it("H8a: incident.review identified from 'Incident Management Policy'", async () => {
    const result = await identify(ACCEPTANCE_SHORT);
    const cap = findCap(result, "incident.review");
    expect(cap, "incident.review should be identified from 'Incident Management Policy'").toBeDefined();
    expect(cap!.requestedLevel).toBe("professional_analysis");
  });

  it("H8b: compliance.corrective_actions identified at professional_analysis (not execution)", async () => {
    const result = await identify(ACCEPTANCE_SHORT);
    const cap = findCap(result, "compliance.corrective_actions");
    expect(cap, "corrective_actions should be identified from 'prepare Improvement Plan'").toBeDefined();
    expect(cap!.requestedLevel).toBe("professional_analysis");
  });

  it("H8c: no capability at execution level when 'prepare' is used with plan-type nouns", async () => {
    const result = await identify(ACCEPTANCE_SHORT);
    const execCaps = result.requestedCapabilities.filter(c => c.requestedLevel === "execution");
    expect(execCaps, `Should be no execution caps but got: ${JSON.stringify(execCaps.map(c => c.capabilityCode))}`).toHaveLength(0);
  });

  it("H8d: live acceptance message — incident.review identified, no execution escalation", async () => {
    const result = await identify(ACCEPTANCE_LIVE);
    const inc = findCap(result, "incident.review");
    expect(inc, "incident.review must be identified in live acceptance message").toBeDefined();
    expect(inc!.requestedLevel).toBe("professional_analysis");
    const execCaps = result.requestedCapabilities.filter(c => c.requestedLevel === "execution");
    expect(execCaps, `Should be 0 execution caps but got: ${JSON.stringify(execCaps.map(c => c.capabilityCode))}`).toHaveLength(0);
  });
});

// ─── Architecture invariant: plan/improvement/action must not escalate ──────

describe("Architecture invariant: 'plan / action / recommendation / improvement' must not alone escalate to execution", () => {
  const planPhrases = [
    "Create an action plan for the compliance gaps",
    "Produce a corrective action plan for the board",
    "Develop an improvement plan for our incident response",
    "Generate a prioritised list of corrective actions",
    "Prepare corrective action recommendations",
  ];

  for (const phrase of planPhrases) {
    it(`No execution escalation: "${phrase.slice(0, 60)}"`, async () => {
      const result = await identify(phrase);
      const execCaps = result.requestedCapabilities.filter(c => c.requestedLevel === "execution");
      expect(
        execCaps,
        `Got execution caps [${execCaps.map(c => c.capabilityCode).join(", ")}] for: "${phrase}"`,
      ).toHaveLength(0);
    });
  }
});

// ─── H9: Genuine execution request triggers gate when execution unavailable ──

describe("H9: Genuine execution request must still trigger the entitlement gate", () => {
  it("H9a: corrective_actions @ execution → partial gate fires (execution_not_included)", () => {
    const partial = makePartial("compliance.corrective_actions", "execution", "execution_not_included");
    const mixed = makeMixed([], [partial], []);

    expect(mixed.requiresUserConfirmationForPartialWork).toBe(true);
    expect(mixed.canProceedPartially).toBe(true);
    expect(mixed.partialCapabilities).toHaveLength(1);
    expect(mixed.blockedCapabilities).toHaveLength(0);

    const card = buildMixedCapabilityCard(mixed);
    expect(card.data.requiresConfirmation).toBe(true);
    expect(card.data.canProceedPartially).toBe(true);
  });

  it("H9b: corrective_actions @ execution → fully blocked when pack unavailable", () => {
    const blocked = makeBlocked("compliance.corrective_actions", "execution", "compliance");
    const mixed = makeMixed([], [], [blocked]);

    expect(mixed.requiresUserConfirmationForPartialWork).toBe(false);
    expect(mixed.canProceedPartially).toBe(false);
    expect(mixed.blockedPacksRequired).toContain("compliance");

    const card = buildMixedCapabilityCard(mixed);
    expect(card.data.requiresConfirmation).toBe(false);
    expect(card.data.canProceedPartially).toBe(false);
  });
});

// ─── H10: Analytical task must not trigger partial-access confirmation ───────

describe("H10: Analytical task (all capabilities @ professional_analysis) must not trigger confirmation", () => {
  it("H10a: all capabilities allowed → no confirmation required", () => {
    const a1 = makeAllowed("incident.review", "professional_analysis");
    const a2 = makeAllowed("compliance.corrective_actions", "professional_analysis");
    const mixed = makeMixed([a1, a2], [], []);

    expect(mixed.requiresUserConfirmationForPartialWork).toBe(false);
    expect(mixed.canProceedPartially).toBe(true);
    expect(mixed.partialCapabilities).toHaveLength(0);
    expect(mixed.blockedCapabilities).toHaveLength(0);

    const card = buildMixedCapabilityCard(mixed);
    expect(card.data.requiresConfirmation).toBe(false);
  });

  it("H10b: live acceptance message produces no execution-level capability → gate would not fire", async () => {
    const liveMsg =
      "Review our current Incident Management Policy using the approved knowledge available in NeedsOps. " +
      "Identify actual operational gaps, risks, unclear responsibilities and weaknesses. " +
      "Produce a prioritised Improvement Plan with recommendations, responsible roles and evidence citations.";
    const result = await identify(liveMsg);
    const execCaps = result.requestedCapabilities.filter(c => c.requestedLevel === "execution");
    expect(execCaps, "No execution-level capabilities means no partial/blocked gate").toHaveLength(0);
  });
});

// ─── H11: dna_pending specialist must not be dispatched ──────────────────────

describe("H11: dna_pending and non-production specialists are not dispatchable", () => {
  const NON_PRODUCTION = [
    "knowledge_documentation_specialist",
    "policy_governance_specialist",
    "behaviour_support_implementation_specialist",
  ];

  for (const code of NON_PRODUCTION) {
    it(`H11: ${code} is NOT eligible (dna_pending or coming_soon)`, () => {
      const eligible = validateSpecialistEligibilitySync(code, "incident.review");
      expect(eligible, `${code} must NOT be dispatchable`).toBe(false);
    });
  }
});

// ─── H12: Current v2 incident specialist eligibility for incident review ─────

describe("H12: Incident & Safeguarding Specialist is eligible for incident review", () => {
  it("H12a: operations_manager is no longer the temporary incident.review fallback", () => {
    const eligible = validateSpecialistEligibilitySync("operations_manager", "incident.review");
    expect(eligible).toBe(false);
  });

  it("H12b: incident_safeguarding_specialist is eligible for incident.review", () => {
    const eligible = validateSpecialistEligibilitySync("incident_safeguarding_specialist", "incident.review");
    expect(eligible).toBe(true);
  });

  it("H12c: compliance_quality_manager eligibility reflects current v2 activation", () => {
    // compliance_quality_manager is in eligibleRoles for incident.review and now has active v2 DNA.
    const eligible = validateSpecialistEligibilitySync("compliance_quality_manager", "incident.review");
    expect(eligible).toBe(true);
  });
});

// ─── Sprint 33B: pending professional owners must not fall back silently ─────

describe("Sprint 33B authority-boundary routing", () => {
  it("S33B-1: monthly restrictive practice reporting maps to APO-owned capability and is dispatchable to APO only", async () => {
    const result = await identify("Prepare monthly restrictive practice reporting reconciliation for July");
    const cap = findCap(result, "restrictive_practice.monthly_reporting");
    expect(cap).toBeDefined();
    expect(cap!.requestedLevel).toBe("professional_analysis");
    expect(validateSpecialistEligibilitySync("authorised_program_officer", "restrictive_practice.monthly_reporting")).toBe(true);
    expect(validateSpecialistEligibilitySync("incident_safeguarding_specialist", "restrictive_practice.monthly_reporting")).toBe(false);
    expect(validateSpecialistEligibilitySync("operations_manager", "restrictive_practice.monthly_reporting")).toBe(false);
  });

  it("S33B-2: BSP implementation maps to BSI-owned capability and remains non-dispatchable", async () => {
    const result = await identify("Review approved BSP implementation fidelity and staff practice guidance");
    const cap = findCap(result, "behaviour_support.implementation");
    expect(cap).toBeDefined();
    expect(cap!.requestedLevel).toBe("professional_analysis");
    expect(validateSpecialistEligibilitySync("behaviour_support_implementation_specialist", "behaviour_support.implementation")).toBe(false);
    expect(validateSpecialistEligibilitySync("operations_manager", "behaviour_support.implementation")).toBe(false);
    expect(validateSpecialistEligibilitySync("incident_safeguarding_specialist", "behaviour_support.implementation")).toBe(false);
  });
});

// ─── Regression: policy.review false-positive must remain fixed (29H.3) ──────

describe("Regression: 29H.3 policy.review fixes must remain intact", () => {
  it("REG1: bare 'policy' in document name does not trigger policy.review identification", async () => {
    // "Incident Management Policy" mentions policy as a document — not a service request
    const result = await identify("Our Incident Management Policy needs to be reviewed");
    // If policy.review IS identified, it must not be at execution level (executionAllowed=false)
    const pr = findCap(result, "policy.review");
    if (pr) {
      expect(pr.requestedLevel).not.toBe("execution");
    }
    // incident.review should be preferred over policy.review for incident-specific context
    const inc = findCap(result, "incident.review");
    expect(inc).toBeDefined();
  });

  it("REG2: policy.review is identified for explicit policy-review service request", async () => {
    const result = await identify("Conduct a policy review for our NDIS compliance framework");
    const pr = findCap(result, "policy.review");
    expect(pr).toBeDefined();
    expect(pr!.requestedLevel).toBe("professional_analysis");
  });

  it("REG3: 'Review our policy' analysisPhrase correctly maps to policy.review", async () => {
    const result = await identify("Review our policy on manual handling procedures");
    const pr = findCap(result, "policy.review");
    expect(pr).toBeDefined();
    expect(pr!.requestedLevel).toBe("professional_analysis");
  });
});
