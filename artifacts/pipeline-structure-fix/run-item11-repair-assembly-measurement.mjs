import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const sourceDir = resolve(repoRoot, "artifacts/pipeline-structure-fix/item11-live-care-plan");
const outputDir = resolve(repoRoot, "artifacts/pipeline-structure-fix/item11-live-care-plan-repair-assembly");
mkdirSync(outputDir, { recursive: true });

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required");

const inputRatePerMillion = 0.15;
const outputRatePerMillion = 0.60;
const cachedInputRatePerMillion = 0.075;

const requirements = [
  ["mandatory-1", "Participant identity and factual placeholder framework", "User-facing representation of Participant identity and factual placeholder framework"],
  ["mandatory-2", "Participant goals, preferences and communication needs", "User-facing representation of Participant goals, preferences and communication needs"],
  ["mandatory-3", "Support domains and daily living support structure", "User-facing representation of Support domains and daily living support structure"],
  ["mandatory-4", "Provider and worker responsibilities", "Responsibilities clauses"],
  ["mandatory-5", "Participant, representative and support-network responsibilities", "Responsibilities clauses"],
  ["mandatory-6", "Health, medication, behaviour support and restrictive-practice boundaries", "User-facing representation of Health, medication, behaviour support and restrictive-practice boundaries"],
  ["mandatory-7", "Risk, safety, incident and escalation arrangements", "User-facing representation of Risk, safety, incident and escalation arrangements"],
  ["mandatory-8", "Community participation and service-delivery coordination", "User-facing representation of Community participation and service-delivery coordination"],
  ["mandatory-9", "Review, updates, consent and sign-off provisions", "Supervision, check-in and sign-off checklist section"],
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function removeAssembledMarkdownSchema(payload) {
  const next = clone(payload);
  const deliverable = next.response_format?.json_schema?.schema?.properties?.deliverable;
  if (deliverable?.properties) delete deliverable.properties.assembledMarkdown;
  if (Array.isArray(deliverable?.required)) {
    deliverable.required = deliverable.required.filter((key) => key !== "assembledMarkdown");
  }
  for (const message of next.messages ?? []) {
    if (typeof message.content !== "string") continue;
    message.content = message.content
      .replace(/,\n\s*"assembledMarkdown":\s*"[^"]*"/g, "")
      .replace(/"assembledMarkdown":\s*"[^"]*",\n/g, "")
      .replace(/deliverable\.content/g, "deliverable.sections[].content")
      .replace(/Return the full deliverable with accepted content preserved\./g, "Return only changed deliverable.sections[] entries for the listed missing requirement IDs; the server merges those deltas into the existing deliverable.");
  }
  return next;
}

async function callOpenAI(payload) {
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return { ...body, latencyMs: Date.now() - started };
}

function parseAssistantJson(response) {
  const content = response.choices?.[0]?.message?.content ?? "";
  return JSON.parse(content);
}

function sectionsFrom(parsed) {
  return Array.isArray(parsed?.deliverable?.sections) ? parsed.deliverable.sections : [];
}

function wordCount(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function normaliseContent(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9$%./ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(content) {
  return String(content ?? "")
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isSelfDescriptionSentence(sentence) {
  const normalised = normaliseContent(sentence);
  const words = normalised.split(/\s+/).filter(Boolean);
  if (/^(all|every|each)\b.*\b(covered|addressed|included|represented|compliant)\b/.test(normalised)) return true;
  if (/^(?:this|the)\s+(?:section|plan|document|template|agreement|care plan)\b.*\b(?:outlines?|describes?|details?|serves\s+to|is\s+designed\s+to|covers?|includes?|provides?|sets\s+out|summari[sz]es)\b/.test(normalised) && words.length <= 24) return true;
  if (/^the following\b.*\b(?:outlines?|describes?|details?|covers?|includes?|sets\s+out|summari[sz]es)\b/.test(normalised) && words.length <= 24) return true;
  if (/\b(this agreement|this document|the template)\b.*\b(covers|addresses|includes|is compliant|is complete)\b/.test(normalised) && words.length <= 14) return true;
  if (/\b(privacy|complaints?|pricing|responsibilities|termination|variation|cancellation)\b.*\b(is|are)\b.*\b(addressed|covered|included|represented)\b/.test(normalised) && words.length <= 12) return true;
  return false;
}

function stripSelfDescription(content) {
  const stripped = [];
  const counted = [];
  for (const sentence of splitSentences(content)) {
    if (isSelfDescriptionSentence(sentence)) {
      stripped.push(sentence);
    } else {
      counted.push(sentence);
    }
  }
  return {
    stripped,
    countedContent: counted.join(" "),
  };
}

function classificationLeakage(content) {
  return [...new Set([...String(content ?? "").matchAll(/\b(?:FACTUAL_FIELD|MUST_BE_REPRESENTED|CONDITIONAL)\b|\bmandatory-\d+\b|\bblueprint-[a-z0-9-]+\b/g)].map((match) => match[0]))];
}

function assemble(sections) {
  const order = new Map(requirements.map(([id], index) => [id, index]));
  return [...sections]
    .filter((section) => section?.requirementId && section?.heading && String(section?.content ?? "").trim())
    .sort((left, right) => (order.get(left.requirementId) ?? 9999) - (order.get(right.requirementId) ?? 9999))
    .map((section) => {
      const content = String(section.content)
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .join("\n")
        .trim();
      return `## ${section.heading}\n\n${content}`;
    })
    .join("\n\n");
}

function validate(sections) {
  const byId = new Map(sections.map((section) => [section.requirementId, section]));
  return requirements.map(([id, text, target]) => {
    const section = byId.get(id);
    const stripped = stripSelfDescription(section?.content ?? "");
    const leakage = classificationLeakage(section?.content ?? "");
    const words = section ? wordCount(stripped.countedContent) : 0;
    return {
      id,
      text,
      target,
      present: Boolean(section),
      heading: section?.heading ?? null,
      strippedSelfDescription: stripped.stripped,
      countedContent: stripped.countedContent,
      wordCount: words,
      classificationLeakage: leakage,
      mode: "FALLBACK_HEURISTIC",
      pass: Boolean(section) && words >= 18 && leakage.length === 0,
    };
  });
}

function mergeDeltas(currentSections, repairSections, allowedIds) {
  if (repairSections.length === 0) {
    throw new Error("Targeted repair returned no deliverable.sections[] deltas.");
  }
  const currentIds = new Set(currentSections.map((section) => section.requirementId));
  const allowed = new Set(allowedIds);
  const replacements = new Map();
  for (const section of repairSections) {
    if (!currentIds.has(section.requirementId)) {
      throw new Error(`Targeted repair returned unknown requirementId "${section.requirementId}".`);
    }
    if (!allowed.has(section.requirementId)) {
      throw new Error(`Targeted repair returned non-deficient requirementId "${section.requirementId}".`);
    }
    if (replacements.has(section.requirementId)) {
      throw new Error(`Targeted repair returned duplicate requirementId "${section.requirementId}".`);
    }
    replacements.set(section.requirementId, section);
  }
  return currentSections.map((section) => replacements.get(section.requirementId) ?? section);
}

function buildRepairPayload(basePayload, currentSections, missingValidation) {
  const payload = removeAssembledMarkdownSchema(basePayload);
  const deficient = currentSections
    .filter((section) => missingValidation.some((item) => item.id === section.requirementId))
    .map((section) => [
      `requirementId: ${section.requirementId}`,
      `heading: ${section.heading}`,
      `content:\n${section.content}`,
    ].join("\n"))
    .join("\n\n");
  const missing = missingValidation.map((item) => ({
    requirement_id: item.id,
    requirement: item.text,
    classification: "MUST_BE_REPRESENTED",
    required_representation: item.target,
    target_location: item.target,
    adequacy_criteria: [],
    failure_reason: item.present
      ? "Relevant section is too thin to prove substantive professional coverage."
      : "deliverable.sections is missing an entry for this required requirementId.",
  }));

  payload.messages[1].content = [
    "## ORIGINAL REQUEST\nDevelop a comprehensive NDIS care plan template that covers all professionally relevant areas.\n\nRequested outcome: A standardised care plan template that meets NDIS requirements and can be used for participant support.",
    "## REPAIR GROUP\nRepair the listed logical section and return only changed deliverable.sections[] entries.",
    `## DEFICIENT DELIVERABLE SECTION(S)\n${deficient || "No matching section was present in the current deliverable."}`,
    `## EXACT REQUIREMENTS TO REPAIR\n${JSON.stringify(missing, null, 2)}`,
    "## RELEVANT AUTHORITATIVE EVIDENCE\n[NeedsOps standard template authority, retrieved 2026-08-28] (Reusable care plan template)\nA reusable care plan template may contain factual placeholders for participant name, goals, support needs, preferences, review dates and signatures while still drafting professional section content and responsibilities.",
    "## REPAIR INSTRUCTIONS\nRepair only the missing requirement IDs listed above.\nReturn deliverable.sections[] deltas only for those missing requirement IDs; do not return sections that already passed.\nFor FACTUAL_FIELD requirements, add the target field/column/placeholder where values are unknown.\nFor MUST_BE_REPRESENTED or CONDITIONAL requirements, replace heading-only or keyword-only text with substantive reusable clause wording that satisfies the listed minimum expectations.\nThe server merges your returned section deltas into the existing deliverable and assembles final markdown deterministically.\nDo not expose this repair matrix, requirement IDs, Blueprint section names or gate names in the final deliverable.",
  ].join("\n\n---\n\n");
  return payload;
}

function cost(usage) {
  const inputTokens = usage?.prompt_tokens ?? usage?.inputTokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? usage?.outputTokens ?? 0;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cachedInputTokens ?? 0;
  const uncached = Math.max(0, inputTokens - cachedTokens);
  return (uncached * inputRatePerMillion + cachedTokens * cachedInputRatePerMillion + outputTokens * outputRatePerMillion) / 1_000_000;
}

const stage1Payload = removeAssembledMarkdownSchema(readJson(resolve(sourceDir, "request.payload.json")));
writeJson(resolve(outputDir, "request.payload.json"), stage1Payload);
const stage1Response = await callOpenAI(stage1Payload);
writeJson(resolve(outputDir, "openai-response.json"), stage1Response);
const stage1Parsed = parseAssistantJson(stage1Response);
writeJson(resolve(outputDir, "parsed-response.json"), stage1Parsed);
const stage1Sections = sectionsFrom(stage1Parsed);
const stage1Document = assemble(stage1Sections);
writeFileSync(resolve(outputDir, "produced-document.md"), `${stage1Document}\n`);
const stage1Validation = validate(stage1Sections);
const missing = stage1Validation.filter((item) => !item.pass);

let finalSections = stage1Sections;
let repairPayload = null;
let repairResponse = null;
let repairParsed = null;
let repairFailure = null;
if (missing.length > 0) {
  repairPayload = buildRepairPayload(readJson(resolve(sourceDir, "repair-request.payload.json")), stage1Sections, missing);
  writeJson(resolve(outputDir, "repair-request.payload.json"), repairPayload);
  repairResponse = await callOpenAI(repairPayload);
  writeJson(resolve(outputDir, "repair-openai-response.json"), repairResponse);
  repairParsed = parseAssistantJson(repairResponse);
  writeJson(resolve(outputDir, "repair-parsed-response.json"), repairParsed);
  try {
    finalSections = mergeDeltas(stage1Sections, sectionsFrom(repairParsed), missing.map((item) => item.id));
  } catch (error) {
    repairFailure = error instanceof Error ? error.message : String(error);
  }
}

const finalDocument = assemble(finalSections);
writeFileSync(resolve(outputDir, "repaired-produced-document.md"), `${finalDocument}\n`);
const finalValidation = validate(finalSections);
const finalClassificationLeakage = [...new Set(finalValidation.flatMap((item) => item.classificationLeakage))];

const summary = {
  status: repairFailure ? "repair_failed" : finalValidation.every((item) => item.pass) ? "completed_revalidated" : "blocked_by_validation",
  stage1: {
    model: stage1Response.model,
    finishReason: stage1Response.choices?.[0]?.finish_reason ?? null,
    latencyMs: stage1Response.latencyMs,
    usage: {
      inputTokens: stage1Response.usage?.prompt_tokens ?? null,
      outputTokens: stage1Response.usage?.completion_tokens ?? null,
      totalTokens: stage1Response.usage?.total_tokens ?? null,
      cachedInputTokens: stage1Response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
    sectionCount: stage1Sections.length,
    documentWords: wordCount(stage1Document),
    missingOrThinRequirements: missing.map((item) => item.id),
  },
  repair: repairResponse ? {
    model: repairResponse.model,
    finishReason: repairResponse.choices?.[0]?.finish_reason ?? null,
    latencyMs: repairResponse.latencyMs,
    usage: {
      inputTokens: repairResponse.usage?.prompt_tokens ?? null,
      outputTokens: repairResponse.usage?.completion_tokens ?? null,
      totalTokens: repairResponse.usage?.total_tokens ?? null,
      cachedInputTokens: repairResponse.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
    returnedDeltaSectionCount: sectionsFrom(repairParsed).length,
    mergedSectionCount: finalSections.length,
    failureMessage: repairFailure,
  } : null,
  finalDeliverable: {
    sectionCount: finalSections.length,
    requiredRequirementCount: requirements.length,
    allRequirementIdsPresent: requirements.every(([id]) => finalSections.some((section) => section.requirementId === id)),
    assembledMarkdownChars: finalDocument.length,
    assembledMarkdownWords: wordCount(finalDocument),
  },
  gateResults: {
    structuredOutput: true,
    deliverableSectionsPopulatedPerRequirement: requirements.every(([id]) => finalSections.some((section) => section.requirementId === id)),
    fallbackHeuristicPassCount: finalValidation.filter((item) => item.pass).length,
    fallbackHeuristicFailCount: finalValidation.filter((item) => !item.pass).length,
    adequacyCriteriaValidatedCount: 0,
    fallbackHeuristicValidatedCount: requirements.length,
    missingOrThinRequirements: finalValidation.filter((item) => !item.pass).map((item) => item.id),
    classificationLeakage: finalClassificationLeakage,
    readyForCompletedWorkSelfReport: Boolean((repairParsed ?? stage1Parsed).completion?.readyForCompletedWork),
    methodologyLeakageSelfReport: Boolean((repairParsed ?? stage1Parsed).completion?.methodologyLeakage),
  },
  requirementValidation: finalValidation,
  cost: {
    stage1Actual: cost(stage1Response.usage),
    repairActual: repairResponse ? cost(repairResponse.usage) : 0,
    totalActual: cost(stage1Response.usage) + (repairResponse ? cost(repairResponse.usage) : 0),
    totalAtStage1CacheHitApprox: (
      ((Math.max(0, (stage1Response.usage?.prompt_tokens ?? 0) - (stage1Response.usage?.prompt_tokens_details?.cached_tokens ?? 0)) * inputRatePerMillion) +
      ((stage1Response.usage?.prompt_tokens_details?.cached_tokens ?? 0) * cachedInputRatePerMillion) +
      ((stage1Response.usage?.completion_tokens ?? 0) * outputRatePerMillion)) / 1_000_000
    ) + (repairResponse ? cost(repairResponse.usage) : 0),
  },
};

writeJson(resolve(outputDir, "measurement-summary.json"), summary);
console.log(JSON.stringify(summary, null, 2));
