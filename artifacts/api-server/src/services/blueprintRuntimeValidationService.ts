import type {
  BlueprintExecutionContract,
  BlueprintSection,
} from "./workBlueprintService.js";
import type { EvidencePack } from "./knowledgeResolutionService.js";
import {
  validateClaimBatch,
  type RawClaim,
} from "./claimValidationService.js";
import {
  parseDeliverableContract,
  parseEvidenceContract,
} from "./blueprintContractService.js";

export type BlueprintRuntimeGateState =
  | "validation"
  | "awaiting_clarification"
  | "artifact_generation"
  | "artifact_generation_failed"
  | "completed";

export interface BlueprintRuntimeGateFailure {
  gate:
    | "required_section"
    | "section_evidence"
    | "missing_evidence"
    | "claim_integrity"
    | "prohibited_deliverable"
    | "template_required"
    | "artifact_required"
    | "approval_required";
  state: BlueprintRuntimeGateState;
  message: string;
  details?: string[];
}

export interface BlueprintRuntimeValidationInput {
  contract: BlueprintExecutionContract | null;
  contentMarkdown: string;
  rawClaims: RawClaim[];
  evidencePack?: EvidencePack | null;
  artifactId?: string | null;
  approvalStates?: Record<string, boolean> | null;
  deferApprovalGate?: boolean;
}

export interface BlueprintRuntimeValidationResult {
  passed: boolean;
  failures: BlueprintRuntimeGateFailure[];
}

export function validateBlueprintRuntimeCompletion(
  input: BlueprintRuntimeValidationInput,
): BlueprintRuntimeValidationResult {
  const { contract } = input;
  if (!contract?.blueprint) return { passed: true, failures: [] };

  const failures: BlueprintRuntimeGateFailure[] = [];
  const { blueprint } = contract;
  const evidenceContract = parseEvidenceContract(blueprint.evidenceContract as Record<string, unknown> | null);
  const deliverableContract = parseDeliverableContract(blueprint.deliverableContract as Record<string, unknown> | null);

  failures.push(...validateSections(contract.sections, input.contentMarkdown, input.evidencePack));

  if (deliverableContract) {
    const prohibited = deliverableContract.prohibitedDeliverables ?? [];
    const prohibitedFound = prohibited.filter((deliverable) =>
      containsDeliverableHeading(input.contentMarkdown, deliverable),
    );
    if (prohibitedFound.length > 0) {
      failures.push({
        gate: "prohibited_deliverable",
        state: "validation",
        message: "Blueprint prohibits one or more standalone deliverables produced by the draft.",
        details: prohibitedFound,
      });
    }

    const templateRequired = blueprint.templateRequired || deliverableContract.templateRequired === true;
    if (templateRequired && !contract.template) {
      failures.push({
        gate: "template_required",
        state: "awaiting_clarification",
        message: "Blueprint requires a template, but no applicable platform or organisation template was resolved.",
      });
    }

    if (deliverableContract.artifactRequired === true && !input.artifactId) {
      failures.push({
        gate: "artifact_required",
        state: "artifact_generation",
        message: "Blueprint requires an artifact. Text-only completion is blocked until an artifact is generated and linked.",
      });
    }
  }

  if (input.deferApprovalGate !== true) {
    const requiredApprovals = Object.keys(blueprint.requiredApprovals ?? {});
    const missingApprovals = requiredApprovals.filter((approval) =>
      input.approvalStates?.[approval] !== true,
    );
    if (missingApprovals.length > 0) {
      failures.push({
        gate: "approval_required",
        state: "awaiting_clarification",
        message: "Blueprint requires approval before completion.",
        details: missingApprovals,
      });
    }
  }

  if (evidenceContract) {
    const minimumEvidenceCount = evidenceContract.minimumEvidenceCount ?? 0;
    const evidenceCount = countEvidenceItems(input.evidencePack);
    if (minimumEvidenceCount > 0 && evidenceCount < minimumEvidenceCount) {
      failures.push({
        gate: "missing_evidence",
        state: evidenceContract.missingEvidenceBehaviour === "clarification_required"
          ? "awaiting_clarification"
          : "validation",
        message: `Blueprint requires at least ${minimumEvidenceCount} evidence item(s); ${evidenceCount} available.`,
        details: evidenceContract.requiredEvidenceCategories ?? [],
      });
    }

    const requiredCategories = evidenceContract.requiredEvidenceCategories ?? [];
    const missingCategories = requiredCategories.filter((category) =>
      !hasEvidenceCategory(input.evidencePack, category),
    );
    if (missingCategories.length > 0) {
      const behaviour = evidenceContract.missingEvidenceBehaviour ?? "continue_with_flagged_gaps";
      if (behaviour === "block_completion" || behaviour === "clarification_required") {
        failures.push({
          gate: "missing_evidence",
          state: behaviour === "clarification_required" ? "awaiting_clarification" : "validation",
          message: "Blueprint required evidence categories are missing.",
          details: missingCategories,
        });
      }
    }

    if (evidenceContract.claimIntegrityRequired === true && input.rawClaims.length > 0) {
      if (!input.evidencePack) {
        failures.push({
          gate: "claim_integrity",
          state: "validation",
          message: "Blueprint requires claim integrity, but no evidence pack is available for claim validation.",
        });
      } else {
        const validation = validateClaimBatch(input.rawClaims, input.evidencePack);
        const unsupported = validation.claims.filter((claim) =>
          claim.provenanceStatus !== "grounded",
        );
        if (unsupported.length > 0 || validation.bindingsRejected > 0) {
          failures.push({
            gate: "claim_integrity",
            state: "validation",
            message: "Blueprint requires evidence-backed claims; unsupported or invalid claims block completion.",
            details: unsupported.map((claim) => `${claim.clientClaimId}: ${claim.provenanceStatus}`),
          });
        }
      }
    }
  }

  return { passed: failures.length === 0, failures };
}

function validateSections(
  sections: BlueprintSection[],
  contentMarkdown: string,
  evidencePack?: EvidencePack | null,
): BlueprintRuntimeGateFailure[] {
  const failures: BlueprintRuntimeGateFailure[] = [];
  for (const section of sections.filter((s) => s.required)) {
    const content = extractSectionContent(contentMarkdown, section);
    if (!content) {
      failures.push({
        gate: "required_section",
        state: "validation",
        message: `Required blueprint section is missing: ${section.sectionCode}`,
      });
      continue;
    }

    if (!isMateriallyPopulated(content, section)) {
      failures.push({
        gate: "required_section",
        state: "validation",
        message: `Required blueprint section is materially incomplete: ${section.sectionCode}`,
      });
    }

    const requirements = section.evidenceRequirements ?? {};
    const minimumEvidenceCount = Number(requirements.minimumEvidenceCount ?? 0);
    if (minimumEvidenceCount > 0 && countEvidenceItems(evidencePack) < minimumEvidenceCount) {
      failures.push({
        gate: "section_evidence",
        state: "validation",
        message: `Section ${section.sectionCode} requires ${minimumEvidenceCount} evidence item(s).`,
      });
    }

    const requiredCategories = Array.isArray(requirements.requiredEvidenceCategories)
      ? requirements.requiredEvidenceCategories.map(String)
      : [];
    const missing = requiredCategories.filter((category) => !hasEvidenceCategory(evidencePack, category));
    if (missing.length > 0) {
      failures.push({
        gate: "section_evidence",
        state: "validation",
        message: `Section ${section.sectionCode} required evidence categories are missing.`,
        details: missing,
      });
    }
  }
  return failures;
}

function extractSectionContent(contentMarkdown: string, section: BlueprintSection): string | null {
  const markers = [section.sectionCode, section.title].filter(Boolean);
  for (const marker of markers) {
    const escaped = escapeRegExp(marker);
    const match = contentMarkdown.match(
      new RegExp(`(?:^|\\n)#{1,6}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s+|$)`, "i"),
    );
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function isMateriallyPopulated(content: string, section: BlueprintSection): boolean {
  const text = content.replace(/\[[^\]]*INCOMPLETE[^\]]*\]/gi, "").trim();
  const minLengthRule = section.validationRules.find((rule) => /^min_length_\d+$/i.test(rule.rule));
  const minLength = minLengthRule ? Number(minLengthRule.rule.match(/\d+$/)?.[0] ?? 20) : 20;
  return text.length >= minLength;
}

function countEvidenceItems(evidencePack?: EvidencePack | null): number {
  return evidencePack?.totalChunks ?? evidencePack?.chunks?.length ?? 0;
}

function hasEvidenceCategory(evidencePack: EvidencePack | null | undefined, category: string): boolean {
  if (!evidencePack) return false;
  const lower = category.toLowerCase();
  return evidencePack.chunks.some((chunk) => {
    const sourceType = chunk.sourceType?.toLowerCase?.() ?? "";
    const sourceTitle = chunk.sourceTitle?.toLowerCase?.() ?? "";
    return sourceType === lower || sourceType.includes(lower) || sourceTitle.includes(lower);
  });
}

function containsDeliverableHeading(contentMarkdown: string, deliverable: string): boolean {
  const label = deliverable.replace(/[_-]+/g, " ").trim();
  if (!label) return false;
  const escaped = escapeRegExp(label);
  return new RegExp(`(?:^|\\n)#{1,3}\\s*(?:standalone\\s+)?${escaped}\\b`, "i").test(contentMarkdown);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
