import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assembleDeliverableMarkdownFromSections,
  applyParticipantCarePlanClaimGuard,
  collectParticipantCarePlanSuppressionRecords,
} from "../services/claimValidationService.js";
import {
  type PerRequirementDeliverableSection,
  deriveDeliverableRequirementCoverageProfile,
  evaluateDeliverableRequirementCoverage,
} from "../services/deliverableRequirementCoverageService.js";
import { getRegistryEntry } from "../services/blueprintRegistry.js";
import {
  type BlueprintRuntimeGateFailure,
  validateBlueprintRuntimeCompletion,
} from "../services/blueprintRuntimeValidationService.js";
import {
  compileProfessionalExecutionContext,
} from "../services/professionalExecutionContextService.js";
import type { EvidencePack } from "../services/knowledgeResolutionService.js";
import type { BlueprintExecutionContract } from "../services/workBlueprintService.js";
import type { WorkPackageManifest } from "../services/workPackageService.js";

type Mode = "gate-replay" | "synthesis-replay";

interface CapturedEvidencePackChunk {
  chunkId: string;
  sourceId: string;
  sourceVersionId?: string | null;
  text: string;
  sourceTitle?: string | null;
  sourceType?: string | null;
  documentCategory?: string | null;
}

interface CapturedBatchEvidencePackRef {
  batchId: string;
  batchName?: string | null;
  requirementIds: string[];
  chunkIds: string[];
}

interface CapturedSynthesisReplayInput {
  model?: {
    provider?: string | null;
    model?: string | null;
    promptVersion?: string | null;
  } | null;
  evidencePack?: {
    chunks: CapturedEvidencePackChunk[];
  } | null;
  batchEvidencePacks?: CapturedBatchEvidencePackRef[];
  sectionEvidenceRouting?: unknown;
  participantContext?: unknown;
  blueprintResolution?: unknown;
}

interface CapturedEvent {
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

interface ReplayFixture {
  schemaVersion: 1;
  capturedAt: string;
  tenantSlug: string;
  organizationId: string;
  taskId: string;
  participant: string;
  participantId?: string | null;
  blueprintCode: string;
  userRequest: string;
  events: CapturedEvent[];
  evidencePack?: {
    retentionDays?: number;
    chunks: CapturedEvidencePackChunk[];
  };
  batchEvidencePacks?: CapturedBatchEvidencePackRef[];
  synthesisReplayInput?: CapturedSynthesisReplayInput;
}

interface ReplayOptions {
  mode: Mode;
  fixturePath: string;
  outputDir: string;
}

const EXPECTED_2026_10_05_FAILURES = [
  "mandatory_deliverable_coverage",
  "care_plan_review_date_later_than_plan_date",
  "care_plan_history_not_clinical_case_history",
  "contradictory repeated facts",
  "targeted_repair_skipped",
];

function parseArgs(argv: string[]): ReplayOptions {
  const [modeArg, ...rest] = argv;
  const mode = modeArg === "fixture" ? "gate-replay" : modeArg;
  if (mode !== "gate-replay" && mode !== "synthesis-replay") {
    throw new Error("Usage: replay-participant-deliverable.ts <gate-replay|synthesis-replay> --fixture path --output-dir dir");
  }
  const opts: Partial<ReplayOptions> = {
    mode,
    outputDir: "artifacts/replay/participant-deliverable/latest",
  };
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith("--")) continue;
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    i += 1;
    switch (key) {
      case "--fixture": opts.fixturePath = value; break;
      case "--output-dir": opts.outputDir = value; break;
      default: throw new Error(`Unknown argument ${key}`);
    }
  }
  if (!opts.fixturePath) throw new Error("fixture mode requires --fixture");
  return opts as ReplayOptions;
}

function loadFixture(path: string): ReplayFixture {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayFixture;
}

function estimateJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function evidencePackCaptureStorageEstimate(fixture: ReplayFixture) {
  const chunks = fixture.evidencePack?.chunks ?? fixture.synthesisReplayInput?.evidencePack?.chunks ?? [];
  const batchRefs = fixture.batchEvidencePacks ?? fixture.synthesisReplayInput?.batchEvidencePacks ?? [];
  const fullPackBytes = chunks.length > 0 ? estimateJsonBytes({ chunks }) : null;
  const batchRefBytes = batchRefs.length > 0 ? estimateJsonBytes(batchRefs) : null;
  return {
    configuredRetentionDays: fixture.evidencePack?.retentionDays ?? 30,
    fullPackChunkCount: chunks.length,
    fullPackBytes,
    batchPackCount: batchRefs.length,
    batchPackReferenceBytes: batchRefBytes,
    strategy: "Store the full converged EvidencePack.chunks[] once; store per-batch narrowed packs as chunkId references only.",
    isolation: "Participant evidence; fixture retention must follow tenant isolation and delete with task lifecycle after 30 days unless explicitly promoted as a regression fixture.",
  };
}

function professionalEvents(fixture: ReplayFixture): CapturedEvent[] {
  return fixture.events.filter((event) => event.eventType.startsWith("professional."));
}

function latestByStage(fixture: ReplayFixture, stage: string): CapturedEvent | null {
  return professionalEvents(fixture)
    .filter((event) => event.eventType === `professional.${stage}`)
    .at(-1) ?? null;
}

function latestDraftEvent(fixture: ReplayFixture): CapturedEvent {
  const event = latestByStage(fixture, "gate_failure")
    ?? latestByStage(fixture, "final_validated")
    ?? latestByStage(fixture, "self_review_selected")
    ?? latestByStage(fixture, "deterministic_gap_replacement")
    ?? latestByStage(fixture, "final_synthesis_candidate")
    ?? latestByStage(fixture, "primary_draft");
  if (!event) throw new Error("Fixture contains no professional draft snapshot events.");
  return event;
}

function extractSections(payload: Record<string, unknown>): PerRequirementDeliverableSection[] {
  const structured = payload.structuredOutput as Record<string, unknown> | null | undefined;
  const sections = structured?.deliverableSections;
  return Array.isArray(sections) ? sections as PerRequirementDeliverableSection[] : [];
}

function extractDraft(payload: Record<string, unknown>, sections: PerRequirementDeliverableSection[]): string {
  const content = payload.contentMarkdown ?? payload.acceptedContentMarkdown;
  if (typeof content === "string" && content.trim()) return content;
  if (sections.length > 0) {
    return assembleDeliverableMarkdownFromSections(sections, sections.map((section) => section.requirementId));
  }
  throw new Error("Selected snapshot does not contain contentMarkdown or deliverableSections.");
}

function makeContract(blueprintCode: string): BlueprintExecutionContract {
  const blueprint = getRegistryEntry(blueprintCode);
  if (!blueprint) throw new Error(`Blueprint registry entry not found: ${blueprintCode}`);
  return {
    blueprint,
    sections: blueprint.sections ?? [],
    template: null,
    mode: "create",
  } as unknown as BlueprintExecutionContract;
}

function makeManifest(fixture: ReplayFixture, payload: Record<string, unknown>): WorkPackageManifest {
  return {
    id: String(payload.manifestId ?? `replay-${fixture.taskId}`),
    organizationId: fixture.organizationId,
    completedWorkId: null,
    executionId: String(payload.executionId ?? `replay-execution-${fixture.taskId}`),
    taskId: fixture.taskId,
    blueprintId: fixture.blueprintCode,
    blueprintVersion: "replay",
    canonicalIntent: `${fixture.blueprintCode}.create`,
    blueprintFamily: fixture.blueprintCode,
    blueprintMode: "create",
    primarySpecialist: String(payload.primarySpecialist ?? "service_delivery_coordinator"),
    supportingSpecialists: [],
    organisationLibrarySources: [],
    cosMemories: [],
    specialistMemories: [],
    taskUploads: [],
    entityKnowledge: {},
    exclusions: [],
    warnings: [],
    retrievalSummary: {
      requestedKnowledge: [],
      providedSources: 0,
      providedMemories: 0,
      providedUploads: 0,
      providedEntityKnowledge: 0,
      excludedSources: 0,
    },
    selectionMetadata: {
      deliverableStandardisation: "participant_specific",
      requestedDeliverableType: "PARTICIPANT_NDIS_CARE_PLAN",
    },
    observability: {},
    createdAt: new Date(fixture.capturedAt),
    updatedAt: new Date(fixture.capturedAt),
  };
}

function normaliseVerdictId(failure: BlueprintRuntimeGateFailure): string {
  const text = `${failure.gate} ${failure.message} ${(failure.details ?? []).join(" ")}`;
  if (failure.gate === "mandatory_deliverable_coverage") return failure.gate;
  if (failure.gate === "targeted_repair_skipped") return failure.gate;
  if (/care_plan_review_date_later_than_plan_date/.test(text)) return "care_plan_review_date_later_than_plan_date";
  if (/care_plan_history_not_clinical_case_history/.test(text)) return "care_plan_history_not_clinical_case_history";
  if (/contradictory repeated facts/i.test(text)) return "contradictory repeated facts";
  return failure.gate;
}

function summariseFailures(failures: BlueprintRuntimeGateFailure[], source: "stored" | "recomputed") {
  return failures.map((failure) => ({
    verdictId: normaliseVerdictId(failure),
    gate: failure.gate,
    state: failure.state,
    source,
    message: failure.message,
    failingContent: failure.details ?? [],
  }));
}

function mergeVerdicts(stored: ReturnType<typeof summariseFailures>, recomputed: ReturnType<typeof summariseFailures>) {
  const byKey = new Map<string, ReturnType<typeof summariseFailures>[number] & { sources: string[] }>();
  for (const verdict of [...stored, ...recomputed]) {
    const existing = byKey.get(verdict.verdictId);
    if (!existing) {
      byKey.set(verdict.verdictId, { ...verdict, sources: [verdict.source] });
    } else {
      existing.sources = Array.from(new Set([...existing.sources, verdict.source]));
      existing.failingContent = Array.from(new Set([...(existing.failingContent ?? []), ...(verdict.failingContent ?? [])]));
      if (!existing.message.includes(verdict.message)) existing.message = `${existing.message} | ${verdict.message}`;
    }
  }
  return [...byKey.values()];
}

function extractCapturedEvidencePack(fixture: ReplayFixture): EvidencePack | null {
  const evidencePack = (fixture as unknown as { evidencePack?: unknown }).evidencePack;
  if (!evidencePack || typeof evidencePack !== "object") return null;
  const chunks = (evidencePack as { chunks?: unknown }).chunks;
  if (!Array.isArray(chunks)) return null;
  return evidencePack as EvidencePack;
}

function extractSectionCitations(section: PerRequirementDeliverableSection) {
  const cited = new Map<string, { chunkId: string; source: string; passage?: string | null }>();
  for (const source of section.evidenceSources ?? []) {
    if (!source.chunkId) continue;
    cited.set(source.chunkId, {
      chunkId: source.chunkId,
      source: "evidenceSources",
      passage: source.passage ?? null,
    });
  }
  const content = [
    section.content,
    JSON.stringify(section.structuredRows ?? []),
  ].join("\n");
  const chunkIdPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  for (const match of content.matchAll(chunkIdPattern)) {
    const chunkId = match[0];
    if (!cited.has(chunkId)) cited.set(chunkId, { chunkId, source: "rendered_content", passage: null });
  }
  return Array.from(cited.values()).sort((left, right) => left.chunkId.localeCompare(right.chunkId));
}

function sectionCitationRoutingComparison(
  sections: PerRequirementDeliverableSection[],
  routing: unknown,
) {
  const rows = Array.isArray(routing) ? routing as Array<Record<string, unknown>> : [];
  const routedByRequirement = new Map<string, Set<string>>();
  const routedByTitle = new Map<string, Set<string>>();
  for (const row of rows) {
    const selected = Array.isArray(row.selected) ? row.selected as Array<Record<string, unknown>> : [];
    const ids = new Set(selected.map((item) => String(item.chunkId ?? "")).filter(Boolean));
    const title = typeof row.sectionTitle === "string" ? row.sectionTitle : null;
    const code = typeof row.sectionCode === "string" ? row.sectionCode : null;
    if (title) routedByTitle.set(title, ids);
    if (code) routedByRequirement.set(code, ids);
  }

  return sections.map((section) => {
    const sectionTitle = (section as unknown as { heading?: string; title?: string }).heading
      ?? (section as unknown as { title?: string }).title
      ?? section.requirementId;
    const citations = extractSectionCitations(section);
    const routed = routedByRequirement.get(section.requirementId) ?? routedByTitle.get(sectionTitle) ?? new Set<string>();
    const citedChunkIds = citations.map((citation) => citation.chunkId);
    const routedChunkIds = Array.from(routed).sort();
    return {
      requirementId: section.requirementId,
      title: sectionTitle,
      routedChunkIds,
      citedChunkIds,
      citations,
      citedOutsideRoutedSet: citedChunkIds.filter((chunkId) => !routed.has(chunkId)).sort(),
      routedButNotCited: routedChunkIds.filter((chunkId) => !citedChunkIds.includes(chunkId)).sort(),
    };
  });
}

function synthesisReplayReadiness(fixture: ReplayFixture) {
  const input = fixture.synthesisReplayInput;
  const missing: string[] = [];
  if (!input) missing.push("synthesisReplayInput");
  if (!input?.evidencePack?.chunks?.length) missing.push("synthesisReplayInput.evidencePack.chunks[]");
  if (!input?.batchEvidencePacks?.length) missing.push("synthesisReplayInput.batchEvidencePacks[]");
  if (!input?.blueprintResolution) missing.push("synthesisReplayInput.blueprintResolution");
  if (!input?.participantContext) missing.push("synthesisReplayInput.participantContext");
  return {
    ready: missing.length === 0,
    missing,
    model: input?.model ?? null,
    acceptance: "Run synthesis twice from the same captured inputs and compare gate verdict set plus coverage counts; do not assert byte-identical draft text.",
  };
}

function evidencePackUnevaluableGates(evidencePack: EvidencePack | null) {
  if (evidencePack) return [];
  return [{
    gate: "mandatory_deliverable_coverage",
    state: "NOT_EVALUABLE",
    reason: "Gate replay fixture does not contain the runtime EvidencePack; citation-dependent coverage cannot be evaluated.",
    requiredInput: "EvidencePack.chunks[]",
  }];
}

type ReplayCarePlanSection = Parameters<typeof applyParticipantCarePlanClaimGuard>[0];

interface ReplaySectionContentProvenance {
  requirementId: string;
  heading: string;
  contentProvenance: "generated_current_run" | "replayed_stored_fixture_content";
  source: "current_code_guard" | "current_code_normalisation" | "current_code_structured_renderer" | "stored_fixture";
  canEvidenceRenderingChange: boolean;
  storedContentHash: string;
  replayContentHash: string;
  contentChangedFromStored: boolean;
  note: string;
}

function applyHistoricalReplayServerDerivedCarePlanFields(section: ReplayCarePlanSection): ReplayCarePlanSection {
  if (section.requirementId === "care-plan-support-plan-meeting") {
    return {
      ...section,
      content: section.content
        .replace(/(\*\*Plan Date:\*\*\s*)\d{4}-\d{2}-\d{2}/i, `$1${carePlanSystemPlanDate()}`)
        .replace(/(\*\*Date for Review:\*\*\s*)(?:To be confirmed by approver|\d{4}-\d{2}-\d{2})/i, `$1${carePlanSystemReviewDate()}`),
    };
  }
  if (section.requirementId === "care-plan-document-control") {
    return {
      ...section,
      content: [
        "Uncontrolled when printed. The current version of this document is held in the provider's document management system.",
        "",
        "Form ID: NeedsOps AI+ Care Plan",
        "Version: 1.0",
        `Date: ${carePlanSystemPlanDate()}`,
        `Next review date: ${carePlanSystemReviewDate()}`,
        "",
        "Metadata source: system-generated document metadata.",
      ].join("\n"),
      evidenceSources: [],
    };
  }
  return section;
}

function replaySectionContentProvenance(
  rawSection: ReplayCarePlanSection,
  replaySection: ReplayCarePlanSection,
): ReplaySectionContentProvenance {
  const storedMarkdown = renderReplaySection(rawSection);
  const replayMarkdown = renderReplaySection(replaySection);
  const storedContentHash = sha256(storedMarkdown);
  const replayContentHash = sha256(replayMarkdown);
  const contentChangedFromStored = storedContentHash !== replayContentHash;
  const currentCodeRenderedStructuredRows = rawSection.requirementId === "care-plan-undertaking-adl";
  const currentCodeNormalised = rawSection.requirementId === "care-plan-support-plan-meeting" ||
    rawSection.requirementId === "care-plan-document-control";
  const currentCodeGuarded = (replaySection.suppressedClaims ?? []).length > 0 ||
    rawSection.requirementId === "care-plan-client-endorsement" ||
    rawSection.requirementId === "care-plan-support-delivery-client-safety";
  const generated = contentChangedFromStored || currentCodeRenderedStructuredRows || currentCodeNormalised || currentCodeGuarded;
  let source: ReplaySectionContentProvenance["source"] = "stored_fixture";
  if (currentCodeGuarded) source = "current_code_guard";
  else if (currentCodeNormalised) source = "current_code_normalisation";
  else if (currentCodeRenderedStructuredRows) source = "current_code_structured_renderer";

  return {
    requirementId: replaySection.requirementId,
    heading: replaySection.heading,
    contentProvenance: generated ? "generated_current_run" : "replayed_stored_fixture_content",
    source,
    canEvidenceRenderingChange: generated,
    storedContentHash,
    replayContentHash,
    contentChangedFromStored,
    note: generated
      ? "This section content was produced or changed by current replay code in this run."
      : "This section content was replayed from stored fixture content; it cannot evidence a current rendering change.",
  };
}

function renderReplaySection(section: ReplayCarePlanSection): string {
  return assembleDeliverableMarkdownFromSections([section], [section.requirementId]);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function carePlanSystemPlanDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function carePlanSystemReviewDate(now = new Date()): string {
  return addMonthsToIsoDate(carePlanSystemPlanDate(now), 12);
}

function addMonthsToIsoDate(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map((value) => Number.parseInt(value, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function removeUnevaluableVerdicts<T extends { verdictId: string }>(verdicts: T[], unevaluable: Array<{ gate: string }>): T[] {
  const blocked = new Set(unevaluable.map((item) => item.gate));
  return verdicts.filter((verdict) => !blocked.has(verdict.verdictId));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function mandatoryRequirementStates(
  contract: BlueprintExecutionContract,
  coverage: ReturnType<typeof evaluateDeliverableRequirementCoverage>,
) {
  const missingIds = new Set(coverage.missing.map((failure) => failure.requirementId));
  return ((contract.blueprint.deliverableContract?.requirementPlan ?? []) as Array<{
    id?: string;
    sectionCode?: string;
    mandatory?: boolean;
  }>)
    .filter((requirement) => requirement.id && requirement.mandatory !== false)
    .map((requirement) => ({
      requirementId: requirement.id,
      sectionCode: requirement.sectionCode ?? null,
      state: missingIds.has(requirement.id ?? "") ? "uncovered" : "covered",
    }));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outputDir = resolve(process.cwd(), opts.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const fixture = loadFixture(resolve(process.cwd(), opts.fixturePath));
  const synthesisReadiness = synthesisReplayReadiness(fixture);
  if (opts.mode === "synthesis-replay" && !synthesisReadiness.ready) {
    const reportPath = resolve(outputDir, "report.json");
    writeJson(reportPath, {
      schemaVersion: 1,
      mode: opts.mode,
      generatedAt: new Date().toISOString(),
      tenantSlug: fixture.tenantSlug,
      organizationId: fixture.organizationId,
      taskId: fixture.taskId,
      participant: fixture.participant,
      blueprintCode: fixture.blueprintCode,
      status: "NOT_EVALUABLE",
      reason: "Fixture does not contain captured synthesis inputs. Synthesis replay intentionally does not fall back to persisted draft replay.",
      synthesisReplay: synthesisReadiness,
      fixtureCapture: {
        evidencePackStorage: evidencePackCaptureStorageEstimate(fixture),
      },
    });
    console.log(JSON.stringify({ reportPath, status: "NOT_EVALUABLE", missing: synthesisReadiness.missing }, null, 2));
    process.exitCode = 2;
    return;
  }
  const snapshot = latestDraftEvent(fixture);
  const contract = makeContract(fixture.blueprintCode);
  const evidencePack = extractCapturedEvidencePack(fixture);
  const rawSections = extractSections(snapshot.payload);
  const sections = rawSections.map((section) => {
    const rawSection = section as Parameters<typeof applyParticipantCarePlanClaimGuard>[0];
    return applyParticipantCarePlanClaimGuard(
      applyHistoricalReplayServerDerivedCarePlanFields(rawSection),
      evidencePack,
    );
  }) as PerRequirementDeliverableSection[];
  const sectionContentProvenance = rawSections.map((section, index) =>
    replaySectionContentProvenance(
      section as Parameters<typeof applyParticipantCarePlanClaimGuard>[0],
      sections[index] as Parameters<typeof applyParticipantCarePlanClaimGuard>[0],
    ),
  );
  const draft = sections.length > 0
    ? assembleDeliverableMarkdownFromSections(sections, sections.map((section) => section.requirementId))
    : extractDraft(snapshot.payload, sections);
  const suppressionRecords = collectParticipantCarePlanSuppressionRecords(
    sections as Parameters<typeof collectParticipantCarePlanSuppressionRecords>[0],
  );
  const unevaluableGates = evidencePackUnevaluableGates(evidencePack);
  const draftPath = resolve(outputDir, "draft.md");
  writeFileSync(draftPath, `${draft.replace(/[ \t]+$/gm, "")}\n`);

  const manifest = makeManifest(fixture, snapshot.payload);
  const professionalContext = compileProfessionalExecutionContext({
    userRequest: fixture.userRequest,
    subjectParticipantIds: [fixture.participantId ?? fixture.participant].filter(Boolean) as string[],
    manifest,
    blueprint: contract.blueprint,
    blueprintContract: contract,
  });
  const coverageProfile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract);
  const coverage = evidencePack
    ? evaluateDeliverableRequirementCoverage(draft, coverageProfile, { deliverableSections: sections, evidencePack })
    : null;
  const runtime = validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: draft,
    deliverableSections: sections,
    evidencePack,
    artifactId: contract.blueprint.deliverableContract?.artifactRequired ? "__artifact_generation_pending__" : null,
    deferApprovalGate: true,
    professionalContext,
  });

  const storedGate = (snapshot.payload.gateSnapshot as { failures?: BlueprintRuntimeGateFailure[] } | undefined)?.failures ?? [];
  const storedVerdicts = summariseFailures(storedGate, "stored");
  const recomputedVerdicts = summariseFailures(runtime.failures, "recomputed");
  const verdicts = removeUnevaluableVerdicts(mergeVerdicts(storedVerdicts, recomputedVerdicts), unevaluableGates);
  const verdictIds = verdicts.map((verdict) => verdict.verdictId);
  const sectionEvidenceRouting = (snapshot.payload.coverageSnapshot as Record<string, unknown> | undefined)?.sectionEvidenceRouting ?? null;

  const expected = fixture.taskId === "0bef8bce-aaf2-4f6b-9888-c2f136f9818d"
    ? EXPECTED_2026_10_05_FAILURES
    : [];
  const unevaluableGateIds = new Set(unevaluableGates.map((gate) => gate.gate));
  const reproduction = expected.length > 0
    ? {
        expected,
        unevaluable: expected.filter((id) => unevaluableGateIds.has(id)),
        missing: expected.filter((id) => !verdictIds.includes(id) && !unevaluableGateIds.has(id)),
        unexpected: verdictIds.filter((id) => !expected.includes(id)),
        matched: expected.every((id) => verdictIds.includes(id) || unevaluableGateIds.has(id)),
      }
    : null;

  const report = {
    schemaVersion: 1,
    mode: opts.mode,
    generatedAt: new Date().toISOString(),
    tenantSlug: fixture.tenantSlug,
    organizationId: fixture.organizationId,
    taskId: fixture.taskId,
    participant: fixture.participant,
    blueprintCode: fixture.blueprintCode,
    snapshot: {
      eventType: snapshot.eventType,
      occurredAt: snapshot.occurredAt,
      contentHash: createHash("sha256").update(draft).digest("hex"),
    },
    fixtureCapture: {
      evidencePackStorage: evidencePackCaptureStorageEstimate(fixture),
      synthesisReplay: synthesisReadiness,
      participantClaimSuppression: suppressionRecords,
      sectionContentProvenance,
      sectionCitationRoutingComparison: sectionCitationRoutingComparison(sections, sectionEvidenceRouting),
    },
    stages: {
      blueprintResolution: { blueprintCode: contract.blueprint.code, sectionCount: contract.sections.length },
      evidenceRetrieval: {
        source: "captured_snapshot",
        sectionEvidenceRouting,
        batchEvidencePacks: fixture.batchEvidencePacks ?? fixture.synthesisReplayInput?.batchEvidencePacks ?? [],
      },
      synthesis: { draftPath, wordCount: draft.split(/\s+/).filter(Boolean).length, sectionCount: sections.length },
      qualityReview: snapshot.payload.reviewSnapshot ?? null,
      requirementValidation: {
        status: coverage ? "EVALUATED" : "NOT_EVALUABLE",
        unevaluableReason: coverage ? null : "Fixture does not contain EvidencePack.chunks[]; mandatory coverage includes citation-dependent predicates.",
        mandatoryRequirementCount: coverage?.mandatoryRequirementCount ?? null,
        satisfiedCount: coverage?.satisfiedCount ?? null,
        missingCount: coverage?.missing.length ?? null,
        syntheticMissingCount: coverage?.missing.filter((failure) => failure.requirementId.startsWith("__")).length ?? null,
        mandatoryRequirementStates: coverage ? mandatoryRequirementStates(contract, coverage) : [],
        missing: coverage?.missing ?? [],
      },
      completionGates: {
        storedPassed: storedGate.length === 0,
        recomputedPassed: runtime.passed,
        verdicts,
        unevaluableGates,
      },
      targetedRepair: {
        skipped: verdictIds.includes("targeted_repair_skipped"),
        source: verdictIds.includes("targeted_repair_skipped") ? "stored_gate_snapshot" : "not_reported",
      },
    },
    reproduction,
  };

  const reportPath = resolve(outputDir, "report.json");
  writeJson(reportPath, report);
  console.log(JSON.stringify({ reportPath, draftPath, reproduction }, null, 2));
  if (reproduction && !reproduction.matched) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
