/**
 * Sprint 27.5 — Evidence-Aware Validation: Unit Tests
 *
 * Tests cover normalisation utilities and validateWorkPackage directly
 * (no pipeline-level mocking here — that is in sprint275-pipeline-ordering.test.ts).
 *
 * Areas:
 *   Source-type normalisation — aliases, display labels, trusted provider classification
 *   Evidence validation — coverage rules, confidence thresholds, task uploads
 *   Metadata-only fallback — when no evidence pack provided (legacy path)
 *   Missing item deduplication — named rule takes priority over generic category
 *   Warnings do not block — only required:true items are blockers
 *   Legislation is trusted provider — not an org blocker
 *   Raw type codes never appear in user-facing output
 *   Clarification message quality
 *   Regression scenario — Medication Management Policy review
 *   Inspector alignment — missingEvidenceItems shape
 */

import { describe, it, expect } from "vitest";
import {
  validateWorkPackage,
  buildClarificationMessage,
  type MissingEvidenceItem,
} from "../services/workValidationService.js";
import {
  canonicaliseSourceType,
  sourceTypeDisplayLabel,
  isTrustedProviderSource,
} from "../utils/sourceTypeNormalisation.js";
import type { EvidencePack, EvidenceChunk } from "../services/knowledgeResolutionService.js";
import type { WorkBlueprint } from "../services/workBlueprintService.js";
import type { WorkPackageManifest } from "../services/workPackageService.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = "org-test-1";

function makeManifest(overrides: Partial<WorkPackageManifest> = {}): WorkPackageManifest {
  return {
    id:                         "manifest-1",
    organizationId:             ORG_ID,
    executionId:                "exec-1",
    completedWorkId:            null,
    blueprintId:                "bp-1",
    blueprintVersion:           "1.0.0",
    primarySpecialist:          "operations_manager",
    supportingSpecialists:      [],
    organisationLibrarySources: [],
    cosMemories:                [],
    specialistMemories:         [],
    taskUploads:                [],
    entityKnowledge:            {},
    modelVersion:               null,
    promptVersion:              "1",
    assembledAt:                new Date(),
    requesterId:                "user-1",
    createdAt:                  new Date(),
    ...overrides,
  };
}

function makeBlueprint(overrides: Partial<WorkBlueprint> = {}): WorkBlueprint {
  return {
    id:                       "bp-1",
    organizationId:           null,
    code:                     "policy_review",
    title:                    "Policy Review",
    objective:                "Review a policy document.",
    primarySpecialist:        "operations_manager",
    supportingSpecialists:    [],
    requiredLibraryKnowledge: ["policy"],
    requiredMemories:         [],
    validationRules: [
      { rule: "policy_present", required: true, description: "An organisation policy must be retrieved for review." },
    ],
    qualityRules:      [],
    successCriteria:   [],
    outputTypes:       ["policy_review"],
    escalationRules:   [],
    mandatoryCitations:["policy"],
    version:           "1.0.0",
    status:            "active",
    createdAt:         new Date(),
    updatedAt:         new Date(),
    ...overrides,
  };
}

function makeChunk(overrides: Partial<EvidenceChunk> = {}): EvidenceChunk {
  return {
    chunkId:        "chunk-1",
    sourceId:       "src-1",
    sourceTitle:    "Medication Management Policy",
    versionLabel:   "v3",
    sourceType:     "policy",
    authorityLevel: "primary",
    sectionTitle:   "Section 2",
    pageNumber:     4,
    text:           "Staff must document all medication administrations.",
    confidence:     0.85,
    citation:       "Medication Management Policy, v3, Section 2",
    selectionReason:"organisation_library",
    ...overrides,
  };
}

function makeEvidencePack(chunks: EvidenceChunk[]): EvidencePack {
  const citationsByType: Record<string, EvidenceChunk[]> = {};
  for (const c of chunks) {
    if (!citationsByType[c.sourceType]) citationsByType[c.sourceType] = [];
    citationsByType[c.sourceType]!.push(c);
  }
  return {
    executionId:      "exec-1",
    organisationId:   ORG_ID,
    resolvedAt:       new Date(),
    chunks,
    sourceIds:        [...new Set(chunks.map(c => c.sourceId))],
    citationsByType,
    totalChunks:      chunks.length,
    avgConfidence:    chunks.length > 0 ? chunks.reduce((s, c) => s + c.confidence, 0) / chunks.length : 0,
    retrievalMetrics: {
      queryCount: 1, totalCandidates: chunks.length, selectedChunks: chunks.length,
      cacheHit: false, retrievalMs: 120,
    },
  };
}

// ─── Source-type normalisation ────────────────────────────────────────────────

describe("canonicaliseSourceType", () => {
  it("passes through well-known canonical types unchanged", () => {
    expect(canonicaliseSourceType("policy")).toBe("policy");
    expect(canonicaliseSourceType("legislation")).toBe("legislation");
    expect(canonicaliseSourceType("standards")).toBe("standards");
    expect(canonicaliseSourceType("risk_assessment")).toBe("risk_assessment");
    expect(canonicaliseSourceType("procedure")).toBe("procedure");
    expect(canonicaliseSourceType("template")).toBe("template");
    expect(canonicaliseSourceType("task_upload")).toBe("task_upload");
  });

  it("normalises policy aliases to 'policy'", () => {
    expect(canonicaliseSourceType("risk_policy")).toBe("policy");
    expect(canonicaliseSourceType("risk_management_policy")).toBe("policy");
    expect(canonicaliseSourceType("organisation_policy")).toBe("policy");
    expect(canonicaliseSourceType("related_policy")).toBe("policy");
  });

  it("normalises legislation_reference to 'legislation'", () => {
    expect(canonicaliseSourceType("legislation_reference")).toBe("legislation");
  });

  it("normalises ndis_standards to ndis_practice_standards", () => {
    expect(canonicaliseSourceType("ndis_standards")).toBe("ndis_practice_standards");
  });

  it("normalises participant document aliases", () => {
    expect(canonicaliseSourceType("support_plan")).toBe("participant_document");
    expect(canonicaliseSourceType("participant_care_plan")).toBe("participant_document");
  });

  it("returns 'reference' for null/empty input", () => {
    expect(canonicaliseSourceType(null)).toBe("reference");
    expect(canonicaliseSourceType(undefined)).toBe("reference");
    expect(canonicaliseSourceType("")).toBe("reference");
  });

  it("lowercases input before matching", () => {
    expect(canonicaliseSourceType("POLICY")).toBe("policy");
    expect(canonicaliseSourceType("Risk_Management_Policy")).toBe("policy");
  });
});

describe("sourceTypeDisplayLabel", () => {
  it("returns human-readable label for known types", () => {
    expect(sourceTypeDisplayLabel("policy")).toBe("Organisation Policy");
    expect(sourceTypeDisplayLabel("legislation")).toBe("Legislation");
    expect(sourceTypeDisplayLabel("standards")).toBe("Standards & Guidelines");
    expect(sourceTypeDisplayLabel("risk_assessment")).toBe("Risk Assessment");
    expect(sourceTypeDisplayLabel("template")).toBe("Organisation Template");
    expect(sourceTypeDisplayLabel("task_upload")).toBe("Uploaded Document");
  });

  it("produces readable title-case fallback for unknown types", () => {
    const label = sourceTypeDisplayLabel("custom_document_type");
    expect(label).not.toContain("_");
    expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
  });

  it("never returns an empty string", () => {
    expect(sourceTypeDisplayLabel("policy").length).toBeGreaterThan(0);
    expect(sourceTypeDisplayLabel("unknown_xyz").length).toBeGreaterThan(0);
  });
});

describe("isTrustedProviderSource", () => {
  it("marks canonical legislation as trusted provider", () => {
    expect(isTrustedProviderSource("legislation")).toBe(true);
  });

  it("returns false for raw alias (must normalise first)", () => {
    // legislation_reference is an alias; caller should normalise to "legislation" first
    expect(isTrustedProviderSource("legislation_reference")).toBe(false);
    // The correct usage:
    expect(isTrustedProviderSource(canonicaliseSourceType("legislation_reference"))).toBe(true);
  });

  it("marks ndis_practice_standards as trusted provider", () => {
    expect(isTrustedProviderSource("ndis_practice_standards")).toBe(true);
    // Normalised alias also works when passed through canonicalise
    expect(isTrustedProviderSource(canonicaliseSourceType("ndis_standards"))).toBe(true);
  });

  it("marks commission_guidance and fair_work as trusted", () => {
    expect(isTrustedProviderSource("commission_guidance")).toBe(true);
    expect(isTrustedProviderSource("fair_work")).toBe(true);
  });

  it("does NOT mark org-provided types as trusted", () => {
    expect(isTrustedProviderSource("policy")).toBe(false);
    expect(isTrustedProviderSource("risk_assessment")).toBe(false);
    expect(isTrustedProviderSource("procedure")).toBe(false);
    expect(isTrustedProviderSource("template")).toBe(false);
    expect(isTrustedProviderSource("standards")).toBe(false); // generic org standards
  });
});

// ─── Evidence-aware validation ────────────────────────────────────────────────

describe("validateWorkPackage — no blueprint (ad-hoc)", () => {
  it("passes immediately with no issues", () => {
    const result = validateWorkPackage(makeManifest(), null);
    expect(result.passed).toBe(true);
    expect(result.missingEvidenceItems).toHaveLength(0);
    expect(result.clarificationMessage).toBe("");
  });

  it("evidenceSearched is false when no evidence pack provided", () => {
    const result = validateWorkPackage(makeManifest(), null, undefined);
    expect(result.evidenceSearched).toBe(false);
  });
});

describe("validateWorkPackage — approved policy evidence satisfies requirement", () => {
  it("passes when high-confidence policy chunk is in evidence pack", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([
      makeChunk({ sourceType: "policy", confidence: 0.85 }),
    ]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(true);
    expect(result.missingItems).toHaveLength(0);
    expect(result.evidenceSearched).toBe(true);
  });

  it("passes when policy chunk uses a normalised alias type", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest();
    // "risk_management_policy" canonicalises to "policy"
    const evidencePack = makeEvidencePack([
      makeChunk({ sourceType: "risk_management_policy", confidence: 0.72 }),
    ]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(true);
  });

  it("passes when task-upload satisfies participant_context requirement", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "participant_context_present", required: true, description: "Participant information required" },
      ],
      requiredLibraryKnowledge: [],
      mandatoryCitations: [],
    });
    const manifest = makeManifest({
      taskUploads: [{ sourceId: "tu-1", title: "Care Plan", sourceType: "task_upload" }],
    });
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(true);
  });
});

describe("validateWorkPackage — metadata-only does NOT satisfy evidence requirement", () => {
  it("fails when manifest has policy source row but evidence pack has no policy chunks", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest({
      // Source exists in library (metadata row), but no chunks were retrieved
      organisationLibrarySources: [
        { sourceId: "src-1", title: "Medication Policy", sourceType: "policy" },
      ],
    });
    // Evidence pack is empty — retrieval found nothing
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(false);
    expect(result.missingEvidenceItems.some(m => m.canonicalType === "policy")).toBe(true);
  });

  it("fallback: passes using manifest metadata when no evidence pack provided (legacy path)", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest({
      organisationLibrarySources: [
        { sourceId: "src-1", title: "Medication Policy", sourceType: "policy" },
      ],
    });
    // No evidence pack — legacy path uses manifest source-type metadata
    const result = validateWorkPackage(manifest, bp, undefined);
    expect(result.passed).toBe(true);
    expect(result.evidenceSearched).toBe(false);
  });
});

describe("validateWorkPackage — low-confidence evidence", () => {
  it("fails when only evidence is below confidence threshold (0.25)", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([
      makeChunk({ sourceType: "policy", confidence: 0.10 }), // too low
    ]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(false);
    expect(result.missingEvidenceItems.some(m => m.canonicalType === "policy")).toBe(true);
  });

  it("passes when at least one policy chunk meets the confidence threshold", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([
      makeChunk({ chunkId: "c1", sourceType: "policy", confidence: 0.10 }), // below
      makeChunk({ chunkId: "c2", sourceType: "policy", confidence: 0.45 }), // above
    ]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(true);
  });

  it("evidence retrieved below threshold — searched=true in missingEvidenceItem", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([
      makeChunk({ chunkId: "c1", sourceType: "policy", confidence: 0.05 }),
    ]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    const policyItem = result.missingEvidenceItems.find(m => m.canonicalType === "policy");
    expect(policyItem?.searched).toBe(true);
    expect(policyItem?.searchOutcome).toBe("not_found");
  });
});

describe("validateWorkPackage — unrelated chunks do not satisfy requirement", () => {
  it("fails when evidence pack has only procedure chunks but policy is required", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([
      makeChunk({ chunkId: "c1", sourceType: "procedure", confidence: 0.9 }),
      makeChunk({ chunkId: "c2", sourceType: "standards",  confidence: 0.8 }),
    ]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(false);
    const policyItem = result.missingEvidenceItems.find(m => m.canonicalType === "policy");
    expect(policyItem).toBeDefined();
    expect(policyItem!.required).toBe(true);
  });
});

describe("validateWorkPackage — deduplication of missing items", () => {
  it("deduplicates policy across validationRules and requiredLibraryKnowledge", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "policy_present", required: true, description: "Organisation policy must be retrieved" },
      ],
      requiredLibraryKnowledge: ["policy"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);

    const policyItems = result.missingEvidenceItems.filter(m => m.canonicalType === "policy");
    expect(policyItems).toHaveLength(1);
    // Named rule takes priority
    expect(policyItems[0]!.required).toBe(true);
  });

  it("named validationRule takes priority over generic requiredLibraryKnowledge reason", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "risk_policy_present", required: true, description: "Risk Management Policy must be available" },
      ],
      requiredLibraryKnowledge: ["policy", "risk_assessment"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);

    const policyItems = result.missingEvidenceItems.filter(m => m.canonicalType === "policy");
    expect(policyItems).toHaveLength(1);
    // Named rule's reason should appear (not the generic category message)
    expect(policyItems[0]!.reason).toContain("Risk Management Policy");
  });
});

describe("validateWorkPackage — warnings do not block", () => {
  it("passes when only optional validationRules fail", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "template_present", required: false, description: "A template is preferred" },
      ],
      requiredLibraryKnowledge: [],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(true);
    const templateItem = result.missingEvidenceItems.find(m => m.canonicalType === "template");
    expect(templateItem).toBeDefined();
    expect(templateItem!.required).toBe(false);
  });

  it("passes when requiredLibraryKnowledge items are missing (advisory only)", () => {
    const bp = makeBlueprint({
      validationRules: [],
      requiredLibraryKnowledge: ["standards", "procedure"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(true);
    expect(result.missingEvidenceItems.every(m => !m.required)).toBe(true);
  });
});

describe("validateWorkPackage — legislation is trusted provider, not org blocker", () => {
  it("does not block execution when legislation is missing", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "legislation_present", required: true, description: "Relevant legislation must be identified" },
      ],
      requiredLibraryKnowledge: ["legislation"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    // Legislation is trusted-provider — must not block even if rule says required:true
    expect(result.passed).toBe(true);
    const legItem = result.missingEvidenceItems.find(m => m.canonicalType === "legislation");
    expect(legItem).toBeDefined();
    expect(legItem!.required).toBe(false);
    expect(legItem!.suggestedAction).toBe("platform_limitation");
  });

  it("marks legislation searchOutcome as trusted_source_unavailable", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "legislation_present", required: true, description: "Legislation required" },
      ],
      requiredLibraryKnowledge: ["legislation"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    const legItem = result.missingEvidenceItems.find(m => m.canonicalType === "legislation");
    expect(legItem?.searchOutcome).toBe("trusted_source_unavailable");
  });

  it("does not ask users to upload NDIS Practice Standards", () => {
    const bp = makeBlueprint({
      validationRules: [],
      requiredLibraryKnowledge: ["ndis_practice_standards"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    const item = result.missingEvidenceItems.find(m => m.canonicalType === "ndis_practice_standards");
    expect(item?.suggestedAction).toBe("platform_limitation");
  });
});

describe("validateWorkPackage — raw source codes never in user messages", () => {
  const RAW_CODES = ["policy", "legislation", "risk_assessment", "standards", "procedure"];

  it("missingItems contains display labels, not raw type codes", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "policy_present", required: true, description: "Organisation policy required" },
      ],
      requiredLibraryKnowledge: ["policy", "risk_assessment"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);

    for (const item of result.missingItems) {
      for (const code of RAW_CODES) {
        expect(item).not.toBe(code);
        // No bare snake_case codes
        expect(item).not.toMatch(/^[a-z_]+$/);
      }
    }
  });

  it("missingEvidenceItems displayLabel is human-readable", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "policy_present", required: true, description: "Policy required" },
      ],
      requiredLibraryKnowledge: [],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);
    const result = validateWorkPackage(manifest, bp, evidencePack);

    const item = result.missingEvidenceItems.find(m => m.canonicalType === "policy");
    expect(item?.displayLabel).toBe("Organisation Policy");
    expect(item?.displayLabel).not.toBe("policy");
  });
});

describe("validateWorkPackage — evidenceSearched flag", () => {
  it("evidenceSearched=true when evidence pack is provided", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest();
    const result = validateWorkPackage(manifest, bp, makeEvidencePack([]));
    expect(result.evidenceSearched).toBe(true);
  });

  it("evidenceSearched=false when no evidence pack provided (legacy path)", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest({
      organisationLibrarySources: [{ sourceId: "src-1", title: "Policy", sourceType: "policy" }],
    });
    const result = validateWorkPackage(manifest, bp, undefined);
    expect(result.evidenceSearched).toBe(false);
  });

  it("searchOutcome=not_searched when evidence was not searched", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest();
    const result = validateWorkPackage(manifest, bp, undefined);
    const policyItem = result.missingEvidenceItems.find(m => m.canonicalType === "policy");
    expect(policyItem?.searchOutcome).toBe("not_searched");
  });

  it("searchOutcome=not_found when evidence was searched but empty", () => {
    const bp = makeBlueprint();
    const manifest = makeManifest();
    const result = validateWorkPackage(manifest, bp, makeEvidencePack([]));
    const policyItem = result.missingEvidenceItems.find(m => m.canonicalType === "policy");
    expect(policyItem?.searchOutcome).toBe("not_found");
    expect(policyItem?.searched).toBe(true);
  });
});

// ─── Clarification message quality ────────────────────────────────────────────

describe("buildClarificationMessage", () => {
  it("returns empty string when no items provided", () => {
    expect(buildClarificationMessage([], false)).toBe("");
  });

  it("returns empty string when no required blockers (only warnings)", () => {
    const warnings: MissingEvidenceItem[] = [{
      canonicalType: "template",
      displayLabel: "Organisation Template",
      required: false,
      reason: "Template preferred",
      searched: true,
      searchOutcome: "not_found",
      suggestedAction: "approve_existing",
    }];
    expect(buildClarificationMessage(warnings, true)).toBe("");
  });

  it("uses evidence-aware language when evidence was searched — single item", () => {
    const items: MissingEvidenceItem[] = [{
      canonicalType: "policy",
      displayLabel: "Risk Management Policy",
      required: true,
      reason: "Risk management policy must be available",
      searched: true,
      searchOutcome: "not_found",
      suggestedAction: "upload_document",
    }];
    const msg = buildClarificationMessage(items, true);
    expect(msg).toContain("searched your approved Organisation Library");
    expect(msg).toContain("Risk Management Policy");
    expect(msg).not.toContain("risk_management_policy");
    expect(msg).not.toMatch(/\bpolicy\b/); // no bare type code
    expect(msg).toContain("upload or approve");
  });

  it("uses non-search language when evidence was not searched", () => {
    const items: MissingEvidenceItem[] = [{
      canonicalType: "policy",
      displayLabel: "Organisation Policy",
      required: true,
      reason: "Policy required",
      searched: false,
      searchOutcome: "not_searched",
      suggestedAction: "upload_document",
    }];
    const msg = buildClarificationMessage(items, false);
    expect(msg).not.toContain("searched");
    expect(msg).toContain("Organisation Policy");
    expect(msg).toContain("upload or approve");
  });

  it("explains platform limitation for trusted provider sources without asking for upload", () => {
    const items: MissingEvidenceItem[] = [
      {
        canonicalType: "policy",
        displayLabel: "Risk Management Policy",
        required: true,
        reason: "Policy required",
        searched: true,
        searchOutcome: "not_found",
        suggestedAction: "upload_document",
      },
      {
        canonicalType: "legislation",
        displayLabel: "Legislation",
        required: false, // trusted provider sources are downgraded to non-required
        reason: "Legislation recommended",
        searched: true,
        searchOutcome: "trusted_source_unavailable",
        suggestedAction: "platform_limitation",
      },
    ];
    const msg = buildClarificationMessage(items, true);
    // Policy section is present (it's a real blocker)
    expect(msg).toContain("Risk Management Policy");
    // Platform limitation note is included
    expect(msg).toContain("platform");
    // Legislation section must NOT instruct the user to upload legislation
    const lines = msg.split("\n");
    const legLine = lines.find(l => l.toLowerCase().includes("legislation"));
    expect(legLine).toBeDefined();
    if (legLine) {
      expect(legLine.toLowerCase()).not.toContain("please upload");
    }
  });

  it("lists multiple missing blockers with bullet points", () => {
    const items: MissingEvidenceItem[] = [
      {
        canonicalType: "policy",
        displayLabel: "Risk Management Policy",
        required: true,
        reason: "Policy required",
        searched: true,
        searchOutcome: "not_found",
        suggestedAction: "upload_document",
      },
      {
        canonicalType: "risk_assessment",
        displayLabel: "Risk Assessment",
        required: true,
        reason: "Risk assessment required",
        searched: true,
        searchOutcome: "not_found",
        suggestedAction: "upload_document",
      },
    ];
    const msg = buildClarificationMessage(items, true);
    expect(msg).toContain("Risk Management Policy");
    expect(msg).toContain("Risk Assessment");
    expect(msg).toContain("•");
  });

  it("produces no message for a list containing only legislation (trusted provider)", () => {
    const items: MissingEvidenceItem[] = [
      {
        canonicalType: "legislation",
        displayLabel: "Legislation",
        required: false, // trusted providers are always non-required
        reason: "Legislation recommended",
        searched: true,
        searchOutcome: "trusted_source_unavailable",
        suggestedAction: "platform_limitation",
      },
    ];
    // No required org-provided blockers — no clarification message needed
    expect(buildClarificationMessage(items, true)).toBe("");
  });
});

// ─── Regression scenario — Medication Management Policy review ────────────────

describe("Regression: Medication Management Policy review", () => {
  it("passes when org has approved medication policy chunks", () => {
    const bp = makeBlueprint({
      code: "policy_review",
      primarySpecialist: "operations_manager",
      validationRules: [
        { rule: "policy_present", required: true, description: "An organisation policy must be retrieved." },
      ],
      requiredLibraryKnowledge: ["policy"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest({
      primarySpecialist: "operations_manager",
      organisationLibrarySources: [
        { sourceId: "src-med", title: "Medication Management Policy", sourceType: "policy" },
      ],
    });
    const evidencePack = makeEvidencePack([
      makeChunk({
        sourceId:    "src-med",
        sourceTitle: "Medication Management Policy",
        sourceType:  "policy",
        confidence:  0.92,
      }),
    ]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(true);
    expect(result.missingItems).toHaveLength(0);
  });

  it("does not produce raw type codes in missingItems when policy is retrieved", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "policy_present",     required: true,  description: "Policy required" },
        { rule: "legislation_present",required: true,  description: "Legislation recommended" },
      ],
      requiredLibraryKnowledge: ["policy", "legislation", "standards"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([
      makeChunk({ sourceType: "policy", confidence: 0.88 }),
    ]);
    const result = validateWorkPackage(manifest, bp, evidencePack);
    // Policy satisfied; legislation downgraded (trusted); standards is a warning only
    expect(result.passed).toBe(true);
    for (const item of result.missingItems) {
      // Must be a display label, not a raw code
      expect(item).not.toMatch(/^[a-z_]+$/);
    }
  });

  it("only genuinely missing mandatory org evidence is requested", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "policy_present", required: true, description: "Policy required" },
      ],
      requiredLibraryKnowledge: ["policy", "standards"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]); // nothing found

    const result = validateWorkPackage(manifest, bp, evidencePack);
    const required = result.missingEvidenceItems.filter(m => m.required);
    // Only the policy rule is a required blocker
    expect(required).toHaveLength(1);
    expect(required[0]!.canonicalType).toBe("policy");
    // Standards is advisory only
    const standardsItem = result.missingEvidenceItems.find(m => m.canonicalType === "standards");
    expect(standardsItem?.required).toBe(false);
  });
});

// ─── Inspector alignment ──────────────────────────────────────────────────────

describe("Evidence Pack and Inspector alignment", () => {
  it("validation result reflects what evidence pack contains", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "policy_present", required: true, description: "Policy required" },
      ],
      requiredLibraryKnowledge: ["policy", "risk_assessment"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([
      makeChunk({ chunkId: "c1", sourceType: "policy",          confidence: 0.80 }),
      makeChunk({ chunkId: "c2", sourceType: "risk_assessment", confidence: 0.60 }),
    ]);

    const result = validateWorkPackage(manifest, bp, evidencePack);
    expect(result.passed).toBe(true);
    // Inspector: no blocking missing items
    expect(result.missingEvidenceItems.filter(m => m.required)).toHaveLength(0);
  });

  it("correctly classifies blockers and warnings", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "policy_present",   required: true,  description: "Policy required" },
        { rule: "template_present", required: false, description: "Template preferred" },
      ],
      requiredLibraryKnowledge: ["policy", "template", "standards"],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);

    const result = validateWorkPackage(manifest, bp, evidencePack);
    const blockers = result.missingEvidenceItems.filter(m => m.required);
    const warnings = result.missingEvidenceItems.filter(m => !m.required);

    expect(blockers.length).toBeGreaterThanOrEqual(1);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.passed).toBe(false);
  });

  it("shows search outcome in missing evidence when evidence was searched", () => {
    const bp = makeBlueprint({
      validationRules: [
        { rule: "policy_present", required: true, description: "Policy required" },
      ],
      requiredLibraryKnowledge: [],
      mandatoryCitations: [],
    });
    const manifest = makeManifest();
    const evidencePack = makeEvidencePack([]);

    const result = validateWorkPackage(manifest, bp, evidencePack);
    const policyItem = result.missingEvidenceItems.find(m => m.canonicalType === "policy");
    expect(policyItem?.searched).toBe(true);
    expect(policyItem?.searchOutcome).toBe("not_found");
  });
});
