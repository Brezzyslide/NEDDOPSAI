import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assembleDeliverableMarkdownFromSections,
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
import type { BlueprintExecutionContract } from "../services/workBlueprintService.js";
import type { WorkPackageManifest } from "../services/workPackageService.js";

type Mode = "fixture";

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
  if (modeArg !== "fixture") {
    throw new Error("Usage: replay-participant-deliverable.ts fixture --fixture path --output-dir dir");
  }
  const opts: Partial<ReplayOptions> = {
    mode: modeArg,
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

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outputDir = resolve(process.cwd(), opts.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const fixture = loadFixture(resolve(process.cwd(), opts.fixturePath));
  const snapshot = latestDraftEvent(fixture);
  const sections = extractSections(snapshot.payload);
  const draft = extractDraft(snapshot.payload, sections);
  const draftPath = resolve(outputDir, "draft.md");
  writeFileSync(draftPath, `${draft.replace(/[ \t]+$/gm, "")}\n`);

  const contract = makeContract(fixture.blueprintCode);
  const manifest = makeManifest(fixture, snapshot.payload);
  const professionalContext = compileProfessionalExecutionContext({
    userRequest: fixture.userRequest,
    subjectParticipantIds: [fixture.participantId ?? fixture.participant].filter(Boolean) as string[],
    manifest,
    blueprint: contract.blueprint,
    blueprintContract: contract,
  });
  const coverageProfile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract);
  const coverage = evaluateDeliverableRequirementCoverage(draft, coverageProfile, { deliverableSections: sections });
  const runtime = validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: draft,
    deliverableSections: sections,
    evidencePack: null,
    artifactId: contract.blueprint.deliverableContract?.artifactRequired ? "__artifact_generation_pending__" : null,
    deferApprovalGate: true,
    professionalContext,
  });

  const storedGate = (snapshot.payload.gateSnapshot as { failures?: BlueprintRuntimeGateFailure[] } | undefined)?.failures ?? [];
  const storedVerdicts = summariseFailures(storedGate, "stored");
  const recomputedVerdicts = summariseFailures(runtime.failures, "recomputed");
  const verdicts = mergeVerdicts(storedVerdicts, recomputedVerdicts);
  const verdictIds = verdicts.map((verdict) => verdict.verdictId);

  const expected = fixture.taskId === "0bef8bce-aaf2-4f6b-9888-c2f136f9818d"
    ? EXPECTED_2026_10_05_FAILURES
    : [];
  const reproduction = expected.length > 0
    ? {
        expected,
        missing: expected.filter((id) => !verdictIds.includes(id)),
        unexpected: verdictIds.filter((id) => !expected.includes(id)),
        matched: expected.every((id) => verdictIds.includes(id)),
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
    stages: {
      blueprintResolution: { blueprintCode: contract.blueprint.code, sectionCount: contract.sections.length },
      evidenceRetrieval: {
        source: "captured_snapshot",
        sectionEvidenceRouting: (snapshot.payload.coverageSnapshot as Record<string, unknown> | undefined)?.sectionEvidenceRouting ?? null,
      },
      synthesis: { draftPath, wordCount: draft.split(/\s+/).filter(Boolean).length, sectionCount: sections.length },
      qualityReview: snapshot.payload.reviewSnapshot ?? null,
      requirementValidation: {
        mandatoryRequirementCount: coverage.mandatoryRequirementCount,
        satisfiedCount: coverage.satisfiedCount,
        missingCount: coverage.missing.length,
        missing: coverage.missing,
      },
      completionGates: {
        storedPassed: storedGate.length === 0,
        recomputedPassed: runtime.passed,
        verdicts,
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
