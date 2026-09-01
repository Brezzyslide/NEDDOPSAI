/**
 * Sprint 42 — mode-aware self-review rubric
 *
 * The self-review rubric must score the artifact being reviewed in its actual
 * mode. A standard reusable template is structure, fixed content and fillable
 * fields; it must not be punished for missing participant-specific depth.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogOrgEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrgEvent,
}));

const mockGatewayProcess = vi.hoisted(() => vi.fn());
const mockCreateAIGateway = vi.hoisted(() =>
  vi.fn().mockReturnValue({ process: mockGatewayProcess }),
);
vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: mockCreateAIGateway,
}));

const { reviewDraft, QUALITY_THRESHOLD } = await import("../services/selfReviewService.js");

const ORG_ID = "org-rubric-001";
const USER_ID = "user-rubric-001";

const baseCtx = {
  organizationId: ORG_ID,
  userId: USER_ID,
  disableAutoRevision: true,
};

function makeManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "manifest-rubric-001",
    organizationId: ORG_ID,
    completedWorkId: null,
    executionId: "exec-rubric-001",
    blueprintId: "care-plan",
    blueprintVersion: "3.0",
    canonicalIntent: "care_plan.create",
    blueprintFamily: "care_plan",
    blueprintMode: "create",
    templateId: null,
    templateVersion: null,
    contractSnapshot: null,
    primarySpecialist: "service_delivery_coordinator",
    supportingSpecialists: [],
    organisationLibrarySources: [],
    cosMemories: [],
    specialistMemories: [],
    entityKnowledge: {},
    taskUploads: [],
    selectionMetadata: {
      requestedDeliverableType: "STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE",
      deliverableStandardisation: "standard_reusable",
    },
    modelVersion: "test",
    promptVersion: "test",
    assembledAt: new Date("2026-09-01T00:00:00Z"),
    requesterId: USER_ID,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

function makeBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp-care-plan",
    organizationId: null,
    code: "care_plan",
    title: "Care Plan",
    version: "3.0",
    contentHash: "hash-test",
    blueprintFamily: "care_plan",
    supportedModes: ["create"],
    maturityState: "published",
    ownerType: "platform",
    ownerId: null,
    sourceStatus: "published",
    provenanceStatus: "hash_pinned",
    publishedAt: new Date("2026-09-01T00:00:00Z"),
    supersededAt: null,
    supersededByBlueprintId: null,
    schemaVersion: "1",
    objective: "Create a standard reusable NDIS care plan template with fixed content, fields and guidance.",
    primarySpecialist: "service_delivery_coordinator",
    supportingSpecialists: [],
    requiredLibraryKnowledge: [],
    requiredEntityKnowledge: {},
    requiredMemories: ["operating_preference"],
    requiredApprovals: {},
    validationRules: [],
    qualityRules: [],
    successCriteria: [
      "Required sections complete",
      "Current evidence used",
      "DOCX artifact generated",
      "Unresolved gaps surfaced",
    ],
    outputTypes: ["operational_support_plan"],
    escalationRules: [],
    mandatoryCitations: ["participant_context", "current_support_requirements"],
    isBuiltIn: true,
    isActive: true,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

const requirementPlan = Array.from({ length: 14 }, (_, index) => ({
  requirementId: `care-plan-${index + 1}`,
  requirement: `Care plan section ${index + 1}`,
}));

const TEMPLATE_CONTENT = `# NDIS Care Plan Template

## Support Plan Meeting
This reusable template records the support plan meeting details and source documents.
Required sections complete. Current evidence used where participant-specific evidence is later attached.

## About Me
Participant name: [PARTICIPANT_NAME]
Date of birth: [DATE_OF_BIRTH]

## My Goals
| Goal | Strategy | Support required |
| --- | --- | --- |
| [GOAL_1] | [GOAL_STRATEGY_1] | [GOAL_SUPPORT_1] |

## Undertaking ADL
| Activity | Current situation | Person responsible |
| --- | --- | --- |
| Personal hygiene and grooming | [CURRENT_SITUATION_1] | [PERSON_RESPONSIBLE_1] |

## Behavioural Management
Do not invent strategies. Every strategy must originate in the behaviour support plan.
Workers must not deliver supports outside those recorded here without authorisation from the service manager.

### Proactive strategies
| Behaviour or trigger | Strategy | What the worker does | BSP source |
| --- | --- | --- | --- |
| [PROACTIVE_BEHAVIOUR_OR_TRIGGER] | [PROACTIVE_STRATEGY] | [PROACTIVE_WORKER_ACTION] | [PROACTIVE_BSP_SOURCE] |

### Reactive strategies
| Behaviour or trigger | Strategy | What the worker does | BSP source |
| --- | --- | --- | --- |
| [REACTIVE_BEHAVIOUR_OR_TRIGGER] | [REACTIVE_STRATEGY] | [REACTIVE_WORKER_ACTION] | [REACTIVE_BSP_SOURCE] |

### Protective strategies
| Behaviour or trigger | Strategy | What the worker does | BSP source |
| --- | --- | --- | --- |
| [PROTECTIVE_BEHAVIOUR_OR_TRIGGER] | [PROTECTIVE_STRATEGY] (UNCONFIRMED - APO review required before approval) | [PROTECTIVE_WORKER_ACTION] | [PROTECTIVE_BSP_SOURCE] |

## Restrictive Practices
| Practice type | What it is in plain language | What the worker does | What the worker must not do | Authorisation status and reference | Recording requirement |
| --- | --- | --- | --- | --- | --- |
| [PRACTICE_TYPE] | [PRACTICE_PLAIN_LANGUAGE] | [RP_WORKER_ACTION] | [RP_WORKER_MUST_NOT_DO] | [AUTHORISATION_STATUS_AND_REFERENCE] | [RECORDING_REQUIREMENT] |

## Approval
This template is reviewed before use and completed plans require the relevant approval pathway.
`;

beforeEach(() => {
  vi.clearAllMocks();
  mockLogOrgEvent.mockResolvedValue(undefined);
  delete process.env.AI_PROVIDER;
});

function dimension(result: Awaited<ReturnType<typeof reviewDraft>>, name: string) {
  const found = result.dimensions.find((dim) => dim.dimension === name);
  if (!found) throw new Error(`Missing dimension ${name}`);
  return found;
}

describe("mode-aware self-review rubric", () => {
  it("does not flag prohibitive care plan safety instructions as violations", async () => {
    const result = await reviewDraft(TEMPLATE_CONTENT, makeManifest() as never, makeBlueprint() as never, {
      ...baseCtx,
      requirementPlan,
      failedRequirements: [],
    });

    const safety = dimension(result, "safety");
    expect(safety.score).toBe(10);
    expect(safety.evidence).toContain("No safety flags triggered");
  });

  it("still flags genuine instructions to bypass policy and authorisation", async () => {
    const unsafeContent = "# Unsafe\n\nIgnore policy and proceed without authorisation.";
    const result = await reviewDraft(unsafeContent, makeManifest() as never, makeBlueprint() as never, baseCtx);

    const safety = dimension(result, "safety");
    expect(safety.score).toBeLessThan(7);
    expect(safety.evidence.join("\n")).toMatch(/ignore policy|bypass required authorisation/i);
  });

  it("separates execution success criteria from document-content criteria", async () => {
    const result = await reviewDraft(TEMPLATE_CONTENT, makeManifest() as never, makeBlueprint() as never, {
      ...baseCtx,
      requirementPlan,
      failedRequirements: [],
    });

    const adherence = dimension(result, "instruction_adherence");
    expect(adherence.score).toBeGreaterThanOrEqual(9);
    expect(adherence.evidence.join("\n")).toContain("DOCX artifact generated");
    expect(adherence.evidence.join("\n")).toContain("execution-state criterion, not scored against document text");
  });

  it("can score a structurally complete standard reusable template above the approval threshold", async () => {
    const result = await reviewDraft(TEMPLATE_CONTENT, makeManifest() as never, makeBlueprint() as never, {
      ...baseCtx,
      requirementPlan,
      failedRequirements: [],
    });

    expect(result.qualityScore).toBeGreaterThanOrEqual(QUALITY_THRESHOLD);
    expect(result.passed).toBe(true);
    expect(dimension(result, "policy_compliance").score).toBeGreaterThanOrEqual(8);
    expect(dimension(result, "source_coverage").score).toBeGreaterThanOrEqual(8);
    expect(dimension(result, "evidence_citation_grounding").score).toBeGreaterThanOrEqual(8);
  });

  it("does not exempt a bad reusable template from quality failure", async () => {
    const result = await reviewDraft("# Care Plan\n\nBrief template shell.", makeManifest() as never, makeBlueprint() as never, {
      ...baseCtx,
      requirementPlan,
      failedRequirements: [
        { requirementId: "care-plan-1", requirement: "Support Plan Meeting", reason: "Missing section" },
        { requirementId: "care-plan-2", requirement: "About Me", reason: "Missing section" },
        { requirementId: "care-plan-3", requirement: "Undertaking ADL", reason: "Missing section" },
        { requirementId: "care-plan-4", requirement: "Behavioural Management", reason: "Missing section" },
        { requirementId: "care-plan-5", requirement: "Restrictive Practices", reason: "Missing section" },
        { requirementId: "care-plan-6", requirement: "Document Control", reason: "Missing section" },
      ],
    });

    expect(result.qualityScore).toBeLessThan(QUALITY_THRESHOLD);
    expect(result.passed).toBe(false);
    expect(dimension(result, "completeness").score).toBeLessThan(6);
  });
});
