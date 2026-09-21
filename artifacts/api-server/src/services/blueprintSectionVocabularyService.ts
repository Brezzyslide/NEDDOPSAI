import { createHash } from "crypto";

import type { BlueprintSection, BlueprintSectionRetrievalVocabulary } from "./workBlueprintService.js";

export const RETRIEVAL_VOCABULARY_KEY = "retrievalVocabulary";

export function getSectionRetrievalVocabulary(
  section: Pick<BlueprintSection, "evidenceRequirements">,
): BlueprintSectionRetrievalVocabulary {
  const raw = section.evidenceRequirements?.[RETRIEVAL_VOCABULARY_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as BlueprintSectionRetrievalVocabulary;
  return {
    instrumentTerms: cleanStringArray(value.instrumentTerms),
    sourceSynonyms: cleanStringArray(value.sourceSynonyms),
    accountableFields: cleanStringArray(value.accountableFields),
    controlledMappings: Array.isArray(value.controlledMappings)
      ? value.controlledMappings.map((mapping) => ({
          sourceValues: cleanStringArray(mapping.sourceValues),
          outputValue: typeof mapping.outputValue === "string" ? mapping.outputValue : "",
          rule: typeof mapping.rule === "string" ? mapping.rule : undefined,
          terms: cleanStringArray(mapping.terms),
        })).filter((mapping) => mapping.sourceValues.length > 0 || mapping.outputValue.trim().length > 0)
      : [],
    nonApplicabilityTerms: cleanStringArray(value.nonApplicabilityTerms),
  };
}

export function buildSectionRetrievalQuery(
  section: Pick<BlueprintSection, "sectionCode" | "title" | "description" | "instructions" | "evidenceRequirements">,
  extraCategories: string[] = [],
): string {
  return [
    section.sectionCode,
    section.title,
    section.description ?? "",
    section.instructions ?? "",
    ...requiredEvidenceCategories(section),
    ...extraCategories,
    ...sectionRetrievalVocabularyPhrases(section),
  ].filter(Boolean).join("\n");
}

export function sectionRetrievalVocabularyPhrases(
  section: Pick<BlueprintSection, "evidenceRequirements">,
): string[] {
  const vocabulary = getSectionRetrievalVocabulary(section);
  const mappingPhrases = (vocabulary.controlledMappings ?? []).flatMap((mapping) => [
    ...mapping.sourceValues,
    mapping.outputValue,
    mapping.rule ?? "",
    ...(mapping.terms ?? []),
  ]);
  return [
    ...(vocabulary.instrumentTerms ?? []),
    ...(vocabulary.sourceSynonyms ?? []),
    ...(vocabulary.accountableFields ?? []),
    ...mappingPhrases,
    ...(vocabulary.nonApplicabilityTerms ?? []),
  ].filter((value) => value.trim().length > 0);
}

export function buildSectionRetrievalTerms(
  section: Pick<BlueprintSection, "sectionCode" | "title" | "description" | "instructions" | "evidenceRequirements">,
  extraCategories: string[] = [],
): string[] {
  const query = buildSectionRetrievalQuery(section, extraCategories);
  return Array.from(new Set(query
    .split(/[^a-zA-Z0-9]+/)
    .map(normaliseRetrievalTerm)
    .filter((term) => term.length >= 4 && !SECTION_RETRIEVAL_STOP_WORDS.has(term))));
}

export function buildSectionVocabularyHash(
  section: Pick<BlueprintSection, "sectionCode" | "title" | "description" | "instructions" | "evidenceRequirements">,
  extraCategories: string[] = [],
): string {
  return createHash("sha256")
    .update(buildSectionRetrievalQuery(section, extraCategories))
    .digest("hex")
    .slice(0, 16);
}

export function requiredEvidenceCategories(
  section: Pick<BlueprintSection, "evidenceRequirements">,
): string[] {
  const raw = section.evidenceRequirements?.requiredEvidenceCategories;
  return cleanStringArray(Array.isArray(raw) ? raw : []);
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normaliseRetrievalTerm(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

const SECTION_RETRIEVAL_STOP_WORDS = new Set([
  "section",
  "strategy",
  "required",
  "where",
  "participant",
  "support",
  "supports",
  "complete",
  "record",
  "recorded",
  "evidence",
  "source",
  "sources",
  "document",
  "documents",
  "retrieved",
  "field",
  "fields",
  "table",
  "with",
  "from",
  "that",
  "this",
  "must",
  "mustn",
  "into",
  "participant",
]);
