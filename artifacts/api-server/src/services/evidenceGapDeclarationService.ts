import type {
  DeliverableRequirement,
  PerRequirementDeliverableSection,
} from "./deliverableRequirementCoverageService.js";
import {
  deriveDeliverableRequirementCoverageProfile,
} from "./deliverableRequirementCoverageService.js";
import type { EvidencePack } from "./knowledgeResolutionService.js";
import type { ProfessionalExecutionContext } from "./professionalExecutionContextService.js";
import type { BlueprintExecutionContract, BlueprintSection } from "./workBlueprintService.js";

const DECLARATION_HEADING = "## Evidence gaps declared by NeedsOps";
const DECLARATION_PREAMBLE = "The platform added this section automatically after evidence retrieval. It was not authored by the model and cannot be omitted by the model.";

export interface DeterministicEvidenceGapDeclaration {
  markdown: string;
  missingCategories: Array<{
    category: string;
    label: string;
    statement: string;
    notAssessed: string[];
    uncategorisedParticipantDocumentsCited?: string[];
  }>;
}

interface GapTarget {
  label: string;
  sortKey: string;
}

const EVIDENCE_CATEGORY_LABELS: Record<string, string> = {
  allied_health_report: "allied health report",
  behaviour_support_plan: "behaviour support plan",
  business_continuity_plan: "business continuity plan",
  care_plan: "care plan",
  clinical_assessment: "clinical assessment or allied health report",
  clinical_determination: "clinical determination",
  clinical_mealtime_plan: "clinical mealtime plan",
  clinical_report: "clinical report or allied health report",
  community_access_risk_assessment: "community access risk assessment",
  credential_certification: "credential certification",
  current_authority: "current authority",
  disaster_management_risk_assessment: "disaster or emergency management risk assessment",
  emergency_management_plan: "emergency management plan",
  emergency_services_determination: "emergency services determination",
  external_regulatory_submission: "external regulatory submission",
  final_reportability_determination: "final reportability determination",
  fire_safety_certification: "fire safety certification",
  formal_authorisation: "formal authorisation",
  functional_behaviour_assessment: "functional behaviour assessment",
  health_support_plan: "health support plan",
  home_safety_checklist: "home safety checklist",
  incident_investigation_report: "incident investigation report",
  intake_form: "intake form",
  legal_determination: "legal determination",
  mealtime_management_risk_assessment: "mealtime management risk assessment",
  ndis_plan: "NDIS plan",
  ot_assessment: "occupational therapy assessment or allied health report",
  other_participant_document: "participant document categorised as other",
  participant_voice: "participant voice evidence from a strengths-based questionnaire or intake form",
  physiotherapy_assessment: "physiotherapy assessment or allied health report",
  restrictive_practice_authorisation: "restrictive practice authorisation",
  risk_assessment: "risk assessment",
  service_agreement: "service agreement",
  signing_process: "signed endorsement or consent record",
  speech_assessment: "speech pathology assessment or allied health report",
  strengths_based_questionnaire: "strengths-based questionnaire",
  task_upload: "task upload",
  whs_determination: "WHS determination",
};

export function evidenceGapDeclarationLabelCatalog(): Record<string, string> {
  return { ...EVIDENCE_CATEGORY_LABELS };
}

export function buildDeterministicEvidenceGapDeclaration(input: {
  contract?: BlueprintExecutionContract | null;
  professionalContext?: ProfessionalExecutionContext | null;
  evidencePack?: EvidencePack | null;
  deliverableSections?: PerRequirementDeliverableSection[] | null;
}): DeterministicEvidenceGapDeclaration | null {
  const contract = input.contract;
  if (!contract) return null;

  const presentCategories = categoriesPresentInEvidence(input.evidencePack);
  const citedChunks = citedEvidenceChunks(input.evidencePack, input.deliverableSections);
  const categories = new Map<string, { label: string; targets: Map<string, GapTarget> }>();

  const addCategory = (rawCategory: unknown, target?: GapTarget) => {
    if (typeof rawCategory !== "string" || !rawCategory.trim()) return;
    const category = normaliseEvidenceCategory(rawCategory);
    if (!category || presentCategories.has(category)) return;
    const existing = categories.get(category) ?? {
      label: evidenceCategoryLabel(category),
      targets: new Map<string, GapTarget>(),
    };
    if (target) existing.targets.set(target.sortKey, target);
    categories.set(category, existing);
  };

  for (const category of contract.blueprint.evidenceContract?.requiredEvidenceCategories ?? []) {
    addCategory(category, {
      label: `requirements that depend on ${evidenceCategoryLabel(category)}`,
      sortKey: `evidence-contract:${normaliseEvidenceCategory(category)}`,
    });
  }

  const sectionsByCode = new Map(contract.sections.map((section) => [section.sectionCode, section]));
  for (const section of contract.sections) {
    for (const category of requiredEvidenceCategoriesForSection(section)) {
      addCategory(category, sectionTarget(section));
    }
  }

  const profile = input.professionalContext
    ? deriveDeliverableRequirementCoverageProfile(input.professionalContext, contract)
    : null;
  for (const requirement of profile?.requirements ?? []) {
    const target = requirementTarget(requirement, sectionsByCode);
    for (const category of requirement.expectedEvidenceCategories ?? []) {
      addCategory(category, target);
    }
  }

  const missingCategories = Array.from(categories.entries())
    .filter(([category]) => !citedChunksSatisfyCategory(category, citedChunks))
    .map(([category, details]) => {
      const uncategorisedParticipantDocumentsCited = uncategorisedParticipantDocumentTitles(citedChunks);
      const notAssessed = Array.from(details.targets.values())
        .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
        .map((target) => target.label);
      return {
        category,
        label: details.label,
        statement: missingEvidenceStatement(details.label, category, uncategorisedParticipantDocumentsCited),
        notAssessed: notAssessed.length ? Array.from(new Set(notAssessed)) : [`Evidence-dependent findings that require ${details.label}`],
        ...(category !== "other_participant_document" && uncategorisedParticipantDocumentsCited.length > 0
          ? { uncategorisedParticipantDocumentsCited }
          : {}),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));

  if (missingCategories.length === 0) return null;

  return {
    missingCategories,
    markdown: renderDeclarationMarkdown(missingCategories),
  };
}

function renderDeclarationMarkdown(
  missingCategories: DeterministicEvidenceGapDeclaration["missingCategories"],
): string {
  const rows = missingCategories.map((item) => [
    escapeMarkdownTableCell(item.statement),
    escapeMarkdownTableCell(item.notAssessed.join("; ")),
  ]);
  return [
    DECLARATION_HEADING,
    "",
    DECLARATION_PREAMBLE,
    "",
    "| Missing required evidence | Requirements or sections not assessed |",
    "| --- | --- |",
    ...rows.map(([missing, notAssessed]) => `| ${missing} | ${notAssessed} |`),
  ].join("\n");
}

function categoriesPresentInEvidence(evidencePack?: EvidencePack | null): Set<string> {
  const present = new Set<string>();
  for (const chunk of evidencePack?.chunks ?? []) {
    for (const value of [chunk.documentCategory, chunk.sourceType]) {
      if (typeof value === "string" && value.trim()) {
        present.add(normaliseEvidenceCategory(value));
      }
    }
  }
  return present;
}

function citedEvidenceChunks(
  evidencePack?: EvidencePack | null,
  deliverableSections?: PerRequirementDeliverableSection[] | null,
): Array<{ chunk: EvidencePack["chunks"][number]; documentTitle: string }> {
  const chunksById = new Map((evidencePack?.chunks ?? []).map((chunk) => [chunk.chunkId, chunk]));
  const cited: Array<{ chunk: EvidencePack["chunks"][number]; documentTitle: string }> = [];
  const seen = new Set<string>();
  for (const section of deliverableSections ?? []) {
    for (const source of section.evidenceSources ?? []) {
      const chunk = chunksById.get(source.chunkId);
      if (!chunk || seen.has(chunk.chunkId)) continue;
      seen.add(chunk.chunkId);
      cited.push({ chunk, documentTitle: source.documentTitle });
    }
  }
  return cited;
}

function citedChunksSatisfyCategory(
  category: string,
  citedChunks: Array<{ chunk: EvidencePack["chunks"][number]; documentTitle: string }>,
): boolean {
  for (const cited of citedChunks) {
    const exactValues = [
      cited.chunk.documentCategory,
      cited.chunk.sourceType,
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(normaliseEvidenceCategory);
    if (exactValues.includes(category)) return true;
  }
  return false;
}

function uncategorisedParticipantDocumentTitles(
  citedChunks: Array<{ chunk: EvidencePack["chunks"][number]; documentTitle: string }>,
): string[] {
  const titles = new Set<string>();
  for (const cited of citedChunks) {
    const documentCategory = typeof cited.chunk.documentCategory === "string" && cited.chunk.documentCategory.trim().length > 0
      ? normaliseEvidenceCategory(cited.chunk.documentCategory)
      : null;
    const sourceType = typeof cited.chunk.sourceType === "string" && cited.chunk.sourceType.trim().length > 0
      ? normaliseEvidenceCategory(cited.chunk.sourceType)
      : null;
    const isUncategorisedParticipantDocument = documentCategory === "other_participant_document"
      || (sourceType === "participant_document" && !documentCategory);
    if (!isUncategorisedParticipantDocument) continue;
    const title = [
      cited.documentTitle,
      cited.chunk.sourceTitle,
    ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (title) titles.add(title.trim());
  }
  return Array.from(titles).sort((left, right) => left.localeCompare(right));
}

function requiredEvidenceCategoriesForSection(section: BlueprintSection): string[] {
  const raw = section.evidenceRequirements?.requiredEvidenceCategories;
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function sectionTarget(section: BlueprintSection): GapTarget {
  return {
    label: `${section.title} section`,
    sortKey: `section:${String(section.sortOrder).padStart(5, "0")}:${section.sectionCode}`,
  };
}

function requirementTarget(
  requirement: DeliverableRequirement,
  sectionsByCode: Map<string, BlueprintSection>,
): GapTarget {
  const section = requirement.sourceBlueprintSection
    ? sectionsByCode.get(requirement.sourceBlueprintSection)
    : undefined;
  return {
    label: section
      ? `${section.title} requirement`
      : `${requirement.requiredDeliverableRepresentation || requirement.description} requirement`,
    sortKey: requirement.sourceBlueprintSection
      ? `requirement:${requirement.sourceBlueprintSection}:${requirement.id}`
      : `requirement:${requirement.id}`,
  };
}

function missingEvidenceStatement(
  label: string,
  category: string,
  uncategorisedParticipantDocumentsCited: string[],
): string {
  const bare = providerActionableEvidenceLabel(label, category);
  const base = `No ${bare} was found in the retrieved organisation library or task evidence.`;
  if (category === "other_participant_document" || uncategorisedParticipantDocumentsCited.length === 0) {
    return base;
  }
  const noun = uncategorisedParticipantDocumentsCited.length === 1
    ? "Uncategorised participant document cited as evidence"
    : "Uncategorised participant documents cited as evidence";
  const action = uncategorisedParticipantDocumentsCited.length === 1
    ? "Review and recategorise this document if it satisfies the missing evidence requirement."
    : "Review and recategorise these documents if any satisfies the missing evidence requirement.";
  return `${base} ${noun}: ${uncategorisedParticipantDocumentsCited.join("; ")}. ${action}`;
}

function providerActionableEvidenceLabel(label: string, category: string): string {
  const normalised = normaliseEvidenceCategory(category);
  const mapped = EVIDENCE_CATEGORY_LABELS[normalised];
  if (mapped) return mapped.replace(/^(?:a|an|the)\s+/i, "");
  return label.replace(/^(?:a|an|the)\s+/i, "");
}

function evidenceCategoryLabel(category: string): string {
  const normalised = normaliseEvidenceCategory(category);
  return EVIDENCE_CATEGORY_LABELS[normalised] ?? `document or evidence satisfying the "${category}" requirement`;
}

function normaliseEvidenceCategory(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}
