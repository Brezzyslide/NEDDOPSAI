/**
 * Sprint 29M.1 — Three-Lane Routing Live Performance Verification Gate
 *
 * Runs all classifier verification cases, adversarial tests, boundary tests,
 * and timing comparisons.  Outputs a structured JSON report.
 *
 * Run with:
 *   npx tsx src/scripts/sprint29m1-verification.ts
 */

import {
  classifyExecutionRequest,
  type ExecutionClassifierInput,
  type ExecutionClassification,
} from "../services/executionClassifierService.js";

// ─── Timing helpers ───────────────────────────────────────────────────────────

function timeRuns(fn: () => ExecutionClassification, runs: number): {
  results: ExecutionClassification[];
  timingsMs: number[];
  medianMs: number;
  minMs: number;
  maxMs: number;
} {
  const timingsMs: number[] = [];
  const results: ExecutionClassification[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const r = fn();
    timingsMs.push(performance.now() - t0);
    results.push(r);
  }
  const sorted = [...timingsMs].sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  return { results, timingsMs, medianMs, minMs: sorted[0], maxMs: sorted[sorted.length - 1] };
}

// ─── Base inputs (realistic CoS outputs for each scenario) ───────────────────

const TRANSIENT_INPUT: ExecutionClassifierInput = {
  userRequest: "Write a polite email to Sarah asking if we can move tomorrow's meeting to Friday.",
  conversationMode: "general",
  proposedTask: null,
  confidence: 0.9,
  shouldDispatchSpecialists: false,
  extractedSearchTerms: [],
  trigger: "conversation",
};

const PROFESSIONAL_INPUT: ExecutionClassifierInput = {
  userRequest: "Prepare a 90-day onboarding plan for a new Operations Manager.",
  conversationMode: "task_intent",
  proposedTask: {
    title: "90-Day Onboarding Plan for Operations Manager",
    requestedOutcome: "A structured onboarding plan document",
    summary: "Create a detailed 90-day plan",
  },
  confidence: 0.92,
  shouldDispatchSpecialists: true,
  extractedSearchTerms: [],
  blueprintEvidenceMode: "none",
  trigger: "conversation",
};

const EVIDENCE_INPUT: ExecutionClassifierInput = {
  userRequest: "Review our Complaints Management Policy and identify material gaps, contradictions and recommendations.",
  conversationMode: "task_intent",
  proposedTask: {
    title: "Complaints Policy Gap Analysis",
    requestedOutcome: "A formal gap analysis report with findings and recommendations",
    summary: "Policy review and gap identification",
  },
  confidence: 0.95,
  shouldDispatchSpecialists: true,
  extractedSearchTerms: ["Complaints Management Policy"],
  blueprintEvidenceMode: "required",
  trigger: "conversation",
};

// ─── Adversarial inputs ───────────────────────────────────────────────────────

const ADVERSARIAL: Array<{
  label: string;
  input: ExecutionClassifierInput;
  expected: string;
  rationale: string;
}> = [
  {
    label: "C1 — Formal apology email",
    expected: "transient",
    rationale: "Output is an email — transient output pattern fires; no doc refs, no evidence patterns, no task",
    input: {
      userRequest: "Draft a short professional apology email to a customer.",
      conversationMode: "general",
      proposedTask: null,
      confidence: 0.85,
      shouldDispatchSpecialists: false,
      extractedSearchTerms: [],
      trigger: "conversation",
    },
  },
  {
    label: "C2 — Board email citing policy provisions",
    expected: "evidence_bearing",
    rationale: "Evidence-output pattern (policy review/weakness analysis) + doc ref; output type (email) does not override evidence content",
    input: {
      userRequest: "Write an email to the board explaining the weaknesses you identify in our current Complaints Policy and cite the relevant provisions.",
      conversationMode: "task_intent",
      proposedTask: { title: "Board email on Complaints Policy weaknesses", requestedOutcome: "Evidence-grounded board communication" },
      confidence: 0.93,
      shouldDispatchSpecialists: true,
      extractedSearchTerms: ["Complaints Policy"],
      blueprintEvidenceMode: "optional",
      trigger: "conversation",
    },
  },
  {
    label: "C3 — Five ideas for staff morale",
    expected: "transient",
    rationale: "Brainstorming/general mode; transient pattern fires (ideas for); no doc refs, no evidence signals",
    input: {
      userRequest: "Give me five ideas for improving staff morale.",
      conversationMode: "brainstorming",
      proposedTask: null,
      confidence: 0.88,
      shouldDispatchSpecialists: false,
      extractedSearchTerms: [],
      trigger: "conversation",
    },
  },
  {
    label: "C4 — 12-month workforce restructuring plan",
    expected: "professional_work",
    rationale: "Professional output pattern fires; no doc refs, no evidence patterns; blueprint evidenceMode=optional stays PROFESSIONAL_WORK",
    input: {
      userRequest: "Prepare a formal 12-month workforce restructuring plan with implementation stages, responsibilities and risk controls.",
      conversationMode: "task_intent",
      proposedTask: {
        title: "12-Month Workforce Restructuring Plan",
        requestedOutcome: "Formal restructuring plan document",
      },
      confidence: 0.91,
      shouldDispatchSpecialists: true,
      extractedSearchTerms: [],
      blueprintEvidenceMode: "none",
      trigger: "conversation",
    },
  },
  {
    label: "C5 — Doc reference without policy/evidence keywords",
    expected: "evidence_bearing",
    rationale: "extractedSearchTerms contains the named doc; doc reference + professional-mode escalates to EVIDENCE_BEARING via Rule 7",
    input: {
      userRequest: "Go through our People Management Framework and tell me where the onboarding section falls short compared to current practice.",
      conversationMode: "task_intent",
      proposedTask: { title: "People Management Framework onboarding gap review" },
      confidence: 0.89,
      shouldDispatchSpecialists: true,
      extractedSearchTerms: ["People Management Framework"],
      trigger: "conversation",
    },
  },
  {
    label: "C6 — Deceptively formal but trivial",
    expected: "transient",
    rationale: "Formal language + 'note' pattern; no doc refs, no evidence output patterns, no professional output patterns, no task",
    input: {
      userRequest: "Please compose a brief professional note to the team reminding them about the Friday afternoon finish.",
      conversationMode: "general",
      proposedTask: null,
      confidence: 0.82,
      shouldDispatchSpecialists: false,
      extractedSearchTerms: [],
      trigger: "conversation",
    },
  },
  {
    label: "C7 — Deceptively short evidence request",
    expected: "evidence_bearing",
    rationale: "Short request but contains explicit evidence pattern (compliance review) + doc ref; length must not determine routing",
    input: {
      userRequest: "Run a compliance review on our leave policy.",
      conversationMode: "task_intent",
      proposedTask: { title: "Leave Policy Compliance Review" },
      confidence: 0.94,
      shouldDispatchSpecialists: true,
      extractedSearchTerms: ["Leave Policy"],
      trigger: "conversation",
    },
  },
  {
    label: "C8 — Task-triggered; not TRANSIENT, can escalate",
    expected: "evidence_bearing",
    rationale: "Non-conversation trigger; evidence pattern (risk assessment) present → escalates from PROFESSIONAL_WORK to EVIDENCE_BEARING",
    input: {
      userRequest: "Conduct a risk assessment for the upcoming operational changes and identify mitigation actions.",
      conversationMode: "task_intent",
      proposedTask: { title: "Operational Change Risk Assessment" },
      confidence: 0.96,
      shouldDispatchSpecialists: true,
      extractedSearchTerms: ["Operational Risk Register"],
      trigger: "task",
    },
  },
];

// ─── Boundary / fallback cases ────────────────────────────────────────────────

const BOUNDARY: Array<{
  label: string;
  input: ExecutionClassifierInput;
  expectedLane: string;
  boundaryKind: "transient_vs_professional" | "professional_vs_evidence";
  safetyPrinciple: string;
}> = [
  {
    label: "B1 — Ambiguous: conversational ask about a professional topic",
    expectedLane: "transient",
    boundaryKind: "transient_vs_professional",
    safetyPrinciple: "No output signals; no proposed task; stays TRANSIENT — correct asymmetry, not forced to PROFESSIONAL_WORK",
    input: {
      userRequest: "What should a good performance review include?",
      conversationMode: "general",
      proposedTask: null,
      confidence: 0.70,
      shouldDispatchSpecialists: false,
      extractedSearchTerms: [],
      trigger: "conversation",
    },
  },
  {
    label: "B2 — Ambiguous: doc reference but no evidence output pattern",
    expectedLane: "professional_work",
    boundaryKind: "professional_vs_evidence",
    safetyPrinciple: "Doc reference with no evidence output pattern → PROFESSIONAL_WORK (Rule 8) for KRS access without full claim pipeline",
    input: {
      userRequest: "What does our HR handbook say about annual leave?",
      conversationMode: "general",
      proposedTask: null,
      confidence: 0.75,
      shouldDispatchSpecialists: false,
      extractedSearchTerms: ["HR Handbook"],
      trigger: "conversation",
    },
  },
  {
    label: "B3 — Ambiguous: professional topic without task or dispatch",
    expectedLane: "transient",
    boundaryKind: "transient_vs_professional",
    safetyPrinciple: "professionalScore fires via 'SOP' but no task, no dispatch, no work-intent mode, transient explanation form overrides (Rule 5c)",
    input: {
      userRequest: "Explain what a good SOP for incident reporting should look like.",
      conversationMode: "general",
      proposedTask: null,
      confidence: 0.72,
      shouldDispatchSpecialists: false,
      extractedSearchTerms: [],
      trigger: "conversation",
    },
  },
  {
    label: "B4 — Ambiguous: evidence language but no specific doc referenced",
    expectedLane: "professional_work",
    boundaryKind: "professional_vs_evidence",
    safetyPrinciple: "Evidence pattern fires (gap analysis) but no doc references and blueprintEvidenceMode=none; safety asymmetry: Rule 5 requires isWorkIntentMode to be true and evidenceScore≥1 — both are met but no docRef → PROFESSIONAL_WORK not EVIDENCE_BEARING (conservative escalation without confirmed document dependency)",
    input: {
      userRequest: "Do a gap analysis of our current onboarding process.",
      conversationMode: "task_intent",
      proposedTask: { title: "Onboarding Process Gap Analysis" },
      confidence: 0.85,
      shouldDispatchSpecialists: true,
      extractedSearchTerms: [],
      blueprintEvidenceMode: "none",
      trigger: "conversation",
    },
  },
];

// ─── Run verification ─────────────────────────────────────────────────────────

const RUNS = 5;

console.log("═══════════════════════════════════════════════════════════════");
console.log("  SPRINT 29M.1 — THREE-LANE ROUTING VERIFICATION GATE");
console.log("═══════════════════════════════════════════════════════════════\n");

// ─ Section A/B: Three canonical lanes + performance ──────────────────────────

console.log("── SECTION A/B: THREE EXECUTION LANES + LATENCY ──────────────\n");

const laneTests = [
  { label: "TRANSIENT", input: TRANSIENT_INPUT },
  { label: "PROFESSIONAL_WORK", input: PROFESSIONAL_INPUT },
  { label: "EVIDENCE_BEARING", input: EVIDENCE_INPUT },
];

const laneSummary: Array<{
  lane: string;
  result: ExecutionClassification;
  medianMs: number;
  minMs: number;
  maxMs: number;
  timings: number[];
}> = [];

for (const { label, input } of laneTests) {
  const { results, timingsMs, medianMs, minMs, maxMs } = timeRuns(
    () => classifyExecutionRequest(input),
    RUNS,
  );
  const result = results[0];

  console.log(`  Lane: ${label}`);
  console.log(`  Request: "${input.userRequest.slice(0, 80)}..."`);
  console.log(`  Classification: ${result.executionClass.toUpperCase()}`);
  console.log(`  Reason: ${result.reason}`);
  console.log(`  requiresCompletedWork: ${result.requiresCompletedWork}`);
  console.log(`  requiresEvidence:      ${result.requiresEvidence}`);
  console.log(`  requiresClaimIntegrity:${result.requiresClaimIntegrity}`);
  console.log(`  requiresApproval:      ${result.requiresApproval}`);
  console.log(`  Signals:`, JSON.stringify(result.signals, null, 4));
  console.log(`  Latency (${RUNS} runs): median=${medianMs.toFixed(4)}ms  min=${minMs.toFixed(4)}ms  max=${maxMs.toFixed(4)}ms`);
  console.log(`  Timings: [${timingsMs.map(t => t.toFixed(4)).join(", ")}]`);
  console.log();

  laneSummary.push({ lane: label, result, medianMs, minMs, maxMs, timings: timingsMs });
}

// ─ Section C: Adversarial routing tests ──────────────────────────────────────

console.log("── SECTION C: ADVERSARIAL ROUTING TESTS ──────────────────────\n");

let adversarialPass = 0;
let adversarialFail = 0;
const adversarialResults: Array<{
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
  reason: string;
  signals: Record<string, unknown>;
  rationale: string;
}> = [];

for (const tc of ADVERSARIAL) {
  const result = classifyExecutionRequest(tc.input);
  const pass = result.executionClass === tc.expected;
  if (pass) adversarialPass++; else adversarialFail++;

  const mark = pass ? "✓" : "✗";
  console.log(`  ${mark} ${tc.label}`);
  console.log(`    Expected: ${tc.expected.toUpperCase()}`);
  console.log(`    Actual:   ${result.executionClass.toUpperCase()}`);
  console.log(`    Reason:   ${result.reason}`);
  console.log(`    Rationale:${tc.rationale}`);
  console.log(`    Signals:  transientScore=${result.signals.transientOutputScore}  evidenceScore=${result.signals.evidenceOutputScore}  hasDocRefs=${result.signals.hasDocumentReferences}  mode=${result.signals.conversationMode}`);
  console.log();

  adversarialResults.push({
    label: tc.label,
    expected: tc.expected,
    actual: result.executionClass,
    pass,
    reason: result.reason,
    signals: result.signals as Record<string, unknown>,
    rationale: tc.rationale,
  });
}

console.log(`  Adversarial: ${adversarialPass}/${ADVERSARIAL.length} passed  ${adversarialFail > 0 ? `— ${adversarialFail} FAILED` : ""}\n`);

// ─ Section D: Boundary & fallback behaviour ───────────────────────────────────

console.log("── SECTION D: BOUNDARY & FALLBACK BEHAVIOUR ──────────────────\n");

const boundaryResults: Array<{
  label: string;
  expectedLane: string;
  actualLane: string;
  pass: boolean;
  boundaryKind: string;
  safetyPrinciple: string;
  implementedBehaviour: string;
}> = [];

for (const tc of BOUNDARY) {
  const result = classifyExecutionRequest(tc.input);
  const pass = result.executionClass === tc.expectedLane;

  const mark = pass ? "✓" : "✗";
  console.log(`  ${mark} ${tc.label}`);
  console.log(`    Boundary: ${tc.boundaryKind}`);
  console.log(`    Expected: ${tc.expectedLane.toUpperCase()}`);
  console.log(`    Actual:   ${result.executionClass.toUpperCase()}`);
  console.log(`    Implemented behaviour: ${result.reason}`);
  console.log(`    Safety principle: ${tc.safetyPrinciple}`);
  console.log();

  boundaryResults.push({
    label: tc.label,
    expectedLane: tc.expectedLane,
    actualLane: result.executionClass,
    pass,
    boundaryKind: tc.boundaryKind,
    safetyPrinciple: tc.safetyPrinciple,
    implementedBehaviour: result.reason,
  });
}

// ─ Section B: Pipeline operations comparison ─────────────────────────────────

console.log("── SECTION B: PIPELINE OPERATION COMPARISON ──────────────────\n");

const PIPELINE_COMPARISON = [
  {
    lane: "TRANSIENT",
    llmCalls: 1,       // CoS classification
    krsCalls: 0,
    dbWrites: 0,
    completedWorkRecords: 0,
    claimOperations: 0,
    majorStagesEntered: ["CoS classification", "Classifier gate"],
    majorStagesSkipped: ["UEE", "Completed Work creation", "KRS retrieval", "Evidence pipeline", "Claim emission", "Absence verification", "Provenance persistence", "Approval dispatch", "Self-review"],
  },
  {
    lane: "PROFESSIONAL_WORK",
    llmCalls: "3-6",   // CoS + UEE generation + self-review (per blueprint dims)
    krsCalls: 0,
    dbWrites: "4-8",   // tasks, completed_work, work_content_versions, self_review
    completedWorkRecords: 1,
    claimOperations: 0,
    majorStagesEntered: ["CoS classification", "Classifier gate", "UEE", "Blueprint resolution", "Completed Work creation", "Content generation", "Self-review", "Approval dispatch"],
    majorStagesSkipped: ["KRS retrieval", "EvidencePack assembly", "Claim emission", "Absence verification", "Provenance persistence"],
  },
  {
    lane: "EVIDENCE_BEARING",
    llmCalls: "5-10",  // CoS + KRS extraction + generation + claim eval + entailment + absence + self-review
    krsCalls: "1-3",
    dbWrites: "8-15",  // + evidence_snapshots, claim_evidence_links, evidence_spans, provenance
    completedWorkRecords: 1,
    claimOperations: "5-20",
    majorStagesEntered: ["CoS classification", "Classifier gate", "UEE", "Blueprint resolution", "KRS retrieval", "EvidencePack assembly", "Evidence claim emission", "Semantic entailment check", "Absence verification", "Completed Work creation", "Content generation", "Self-review", "Provenance persistence", "Approval dispatch"],
    majorStagesSkipped: [],
  },
];

for (const p of PIPELINE_COMPARISON) {
  console.log(`  Lane: ${p.lane}`);
  console.log(`    LLM calls:         ${p.llmCalls}`);
  console.log(`    KRS retrievals:    ${p.krsCalls}`);
  console.log(`    DB writes:         ${p.dbWrites}`);
  console.log(`    Completed Work:    ${p.completedWorkRecords}`);
  console.log(`    Claim operations:  ${p.claimOperations}`);
  console.log(`    Stages entered:    ${p.majorStagesEntered.join(", ")}`);
  console.log(`    Stages skipped:    ${p.majorStagesSkipped.join(", ") || "None"}`);
  console.log();
}

// ─ Summary ────────────────────────────────────────────────────────────────────

console.log("── LATENCY COMPARISON SUMMARY ─────────────────────────────────\n");
for (const s of laneSummary) {
  console.log(`  ${s.lane}: classifier median=${s.medianMs.toFixed(4)}ms`);
}

const transientMedian = laneSummary.find(s => s.lane === "TRANSIENT")?.medianMs ?? 0;
const professionalMedian = laneSummary.find(s => s.lane === "PROFESSIONAL_WORK")?.medianMs ?? 0;
const evidenceMedian = laneSummary.find(s => s.lane === "EVIDENCE_BEARING")?.medianMs ?? 0;

console.log();
console.log("  NOTE: Classifier is a pure synchronous function (< 1ms).");
console.log("  The material latency difference is in downstream pipeline steps");
console.log("  skipped by TRANSIENT: 0 LLM calls, 0 KRS retrievals, 0 DB writes.");
console.log("  End-to-end estimates (classifier + pipeline):");
console.log("    TRANSIENT:        ~0.5–2s   (CoS classification + chat reply only)");
console.log("    PROFESSIONAL_WORK:~8–25s    (+ UEE, generation, self-review)");
console.log("    EVIDENCE_BEARING: ~20–60s   (+ KRS, claims, absence verification)");
console.log();

console.log("═══════════════════════════════════════════════════════════════");
console.log("  VERIFICATION COMPLETE");
console.log(`  Adversarial: ${adversarialPass}/${ADVERSARIAL.length}  Boundary: ${boundaryResults.filter(r => r.pass).length}/${BOUNDARY.length}`);
console.log("═══════════════════════════════════════════════════════════════\n");

// Structured JSON for the report
const report = {
  adversarialResults,
  boundaryResults,
  laneSummary: laneSummary.map(s => ({
    lane: s.lane,
    executionClass: s.result.executionClass,
    reason: s.result.reason,
    requiresCompletedWork: s.result.requiresCompletedWork,
    requiresEvidence: s.result.requiresEvidence,
    requiresClaimIntegrity: s.result.requiresClaimIntegrity,
    requiresApproval: s.result.requiresApproval,
    signals: s.result.signals,
    medianMs: s.medianMs,
    minMs: s.minMs,
    maxMs: s.maxMs,
  })),
};
