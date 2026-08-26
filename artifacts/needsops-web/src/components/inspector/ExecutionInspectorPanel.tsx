/**
 * Execution Inspector Panel — Sprint 27.4
 *
 * Renders a full observability snapshot for a specialist execution.
 * Accessible from: Completed Work Viewer, Active Work, Workroom, Dev Mode,
 * Platform Owner Mode.
 *
 * Shows: Summary · Evidence · Blueprint · Specialist Runtime ·
 *        Timeline · Diagnostics · Performance
 *
 * Never exposes: system prompts, embedding vectors, API keys,
 * chain-of-thought text, or LLM payloads.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthFetch } from "@/lib/api";

// ─── Types (mirror executionInspectorService) ─────────────────────────────────

interface InspectorEvidenceSource {
  sourceId: string;
  title: string;
  version: string | null;
  authorityLevel: string | null;
  sourceType: string;
  chunkCount: number;
  confidence: number | null;
  chunkPreview: string | null;
  citation: string | null;
  retrieved: boolean;
}

interface ExecutionInspection {
  executionId: string;
  manifestId: string;
  conversationId: string | null;
  completedWorkId: string | null;
  summary: {
    leadSpecialist: string;
    supportingSpecialists: string[];
    blueprintName: string | null;
    blueprintVersion: string | null;
    selectionMethod: "keyword" | "semantic" | "none";
    selectionConfidence: number;
    currentStage: string;
    runtimeStatus: "executing" | "completed" | "failed" | "awaiting_clarification" | "reviewing" | "unknown";
    knowledgeConfidence: number | null;
    validationPassed: boolean | null;
    completedWorkStatus: string | null;
    startedAt: string;
    durationMs: number | null;
  };
  evidence: {
    sources: InspectorEvidenceSource[];
    memoryEntries: number;
    taskUploads: number;
    totalChunks: number;
    noEvidenceReason: string | null;
  };
  blueprint: {
    blueprintId: string | null;
    name: string | null;
    version: string | null;
    selectionMethod: "keyword" | "semantic" | "none";
    matchedPhrase: string | null;
    semanticReason: string | null;
    confidence: number;
    validationPassed: boolean | null;
    validationMissingItems: string[];
    requiredKnowledge: Array<{ name: string; retrieved: boolean }>;
  };
  specialistRuntime: {
    dnaLoaded: boolean;
    organisationMemoryEntries: number;
    evidenceChunks: number;
    taskUploads: number;
    blueprintLoaded: boolean;
    expectedDeliverablesLoaded: boolean;
  };
  timeline: {
    entries: Array<{ id: string; timestamp: string; kind: string; humanLabel: string; stage?: string }>;
    isComplete: boolean;
    hasFailure: boolean;
  };
  diagnostics: {
    state: "running" | "awaiting_clarification" | "evidence_required" | "failed" | "completed";
    clarificationItems: Array<{ name: string; reason: string }>;
    failedStage: string | null;
    rootCause: string | null;
    retryAvailable: boolean;
  };
  performance: {
    blueprintSelectionMs: number | null;
    validationMs: number | null;
    retrievalMs: number | null;
    llmMs: number | null;
    reviewMs: number | null;
    totalMs: number | null;
    evidenceCacheHit: boolean;
    chunkCount: number;
    memoryCount: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SPECIALIST_LABELS: Record<string, string> = {
  chief_of_staff:               "Chief of Staff",
  operations_manager:           "Operations Manager",
  executive_assistant:          "Executive Assistant",
  compliance_quality_manager:   "Compliance & Quality Manager",
  knowledge_documentation:      "Knowledge & Documentation Specialist",
  incident_management:          "Incident Management Specialist",
  hr_workforce:                 "HR & Workforce Specialist",
};

function specLabel(code: string): string {
  return SPECIALIST_LABELS[code] ?? code.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const STATUS_COLORS: Record<string, string> = {
  executing:               "text-blue-300 bg-blue-900/40",
  completed:               "text-emerald-300 bg-emerald-900/40",
  reviewing:               "text-violet-300 bg-violet-900/40",
  failed:                  "text-red-300 bg-red-900/40",
  awaiting_clarification:  "text-amber-300 bg-amber-900/40",
  evidence_required:       "text-amber-300 bg-amber-900/40",
  unknown:                 "text-[#64748B] bg-[#112033]",
};

const TIMELINE_ICONS: Record<string, string> = {
  started:                "🟢",
  progress:               "⚙️",
  clarification_requested:"⏸️",
  clarification_received: "▶️",
  completed:              "✅",
  failed:                 "❌",
  approved:               "✅",
  rejected:               "🚫",
};

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  title, icon, children, defaultOpen = true,
}: {
  title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#1E3A5F] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-[#0B1829] hover:bg-[#112033] transition-colors text-left"
      >
        <span className="text-base">{icon}</span>
        <span className="text-[#E2E8F0] text-sm font-semibold flex-1">{title}</span>
        <span className="text-[#64748B] text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="bg-[#0D1F35] px-4 py-4">
          {children}
        </div>
      )}
    </div>
  );
}

function KV({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-[#1E3A5F]/40 last:border-0">
      <span className="text-[#64748B] text-xs shrink-0 pt-0.5 w-44">{label}</span>
      <span className={`text-xs text-right flex-1 ${mono ? "font-mono text-[#93C5FD]" : "text-[#E2E8F0]"}`}>
        {value}
      </span>
    </div>
  );
}

function Badge({ label, color }: { label: string; color?: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${color ?? "text-[#64748B] bg-[#112033]"}`}>
      {label}
    </span>
  );
}

// ─── Execution Summary ────────────────────────────────────────────────────────

function SummarySection({ d }: { d: ExecutionInspection }) {
  const s = d.summary;
  const statusColor = STATUS_COLORS[s.runtimeStatus] ?? STATUS_COLORS.unknown;

  return (
    <Section title="Execution Summary" icon="📋">
      <KV label="Lead Specialist" value={specLabel(s.leadSpecialist)} />
      {s.supportingSpecialists.length > 0 && (
        <KV label="Supporting Specialists" value={
          <div className="flex flex-wrap gap-1 justify-end">
            {s.supportingSpecialists.map(sp => (
              <Badge key={sp} label={specLabel(sp)} />
            ))}
          </div>
        } />
      )}
      <KV label="Blueprint" value={s.blueprintName ?? "Ad-hoc (no blueprint)"} />
      {s.blueprintVersion && <KV label="Version" value={s.blueprintVersion} />}
      <KV label="Selection Method" value={
        <Badge label={s.selectionMethod === "keyword" ? "Keyword" : s.selectionMethod === "semantic" ? "Semantic" : "None"} />
      } />
      {s.selectionConfidence > 0 && (
        <KV label="Confidence" value={s.selectionConfidence.toFixed(2)} />
      )}
      <KV label="Current Stage" value={s.currentStage} />
      <KV label="Runtime Status" value={<Badge label={s.runtimeStatus.replace(/_/g," ")} color={statusColor} />} />
      {s.knowledgeConfidence != null && (
        <KV label="Knowledge Confidence" value={s.knowledgeConfidence.toFixed(2)} />
      )}
      <KV label="Validation" value={
        s.validationPassed == null
          ? <Badge label="Pending" />
          : s.validationPassed
          ? <Badge label="Passed" color="text-emerald-300 bg-emerald-900/40" />
          : <Badge label="Failed" color="text-red-300 bg-red-900/40" />
      } />
      <KV label="Completed Work" value={
        s.completedWorkStatus
          ? <Badge label={s.completedWorkStatus.replace(/_/g," ")} color="text-violet-300 bg-violet-900/40" />
          : <Badge label="Pending" />
      } />
      <KV label="Started" value={fmtTimestamp(s.startedAt)} />
      <KV label="Duration" value={fmtDuration(s.durationMs)} />
      <KV label="Execution ID" value={d.executionId} mono />
      <KV label="Manifest ID" value={d.manifestId} mono />
      {d.conversationId && <KV label="Conversation" value={<Badge label="Linked" color="text-blue-300 bg-blue-900/40" />} />}
    </Section>
  );
}

// ─── Evidence Inspector ───────────────────────────────────────────────────────

function EvidenceSource({ src }: { src: InspectorEvidenceSource }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-[#1E3A5F]/60 rounded-lg p-3 mb-2">
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-xs">{src.retrieved ? "✓" : "○"}</span>
        <span className="text-[#E2E8F0] text-sm font-medium flex-1">{src.title}</span>
        {src.chunkCount > 0 && (
          <span className="text-xs text-[#64748B]">{src.chunkCount} chunk{src.chunkCount !== 1 ? "s" : ""}</span>
        )}
        <span className="text-[#64748B] text-xs ml-2">{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div className="mt-3 space-y-1.5 text-xs">
          {src.version && <div className="flex justify-between"><span className="text-[#64748B]">Version</span><span className="text-[#E2E8F0]">{src.version}</span></div>}
          <div className="flex justify-between"><span className="text-[#64748B]">Authority</span><span className="text-[#E2E8F0]">{src.authorityLevel ?? src.sourceType}</span></div>
          <div className="flex justify-between"><span className="text-[#64748B]">Chunks Retrieved</span><span className="text-[#E2E8F0]">{src.chunkCount}</span></div>
          {src.confidence != null && <div className="flex justify-between"><span className="text-[#64748B]">Confidence</span><span className="text-[#E2E8F0]">{src.confidence.toFixed(2)}</span></div>}
          {src.chunkPreview && (
            <div className="mt-2">
              <p className="text-[#64748B] mb-1">Chunk Preview</p>
              <p className="text-[#93C5FD] bg-[#0B1829] rounded p-2 leading-relaxed italic">
                "{src.chunkPreview}{src.chunkPreview.length >= 150 ? "…" : ""}"
              </p>
            </div>
          )}
          {src.citation && (
            <div className="flex justify-between mt-1">
              <span className="text-[#64748B]">Citation</span>
              <span className="text-[#E2E8F0] font-mono text-right">{src.citation} — internal only</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceSection({ d }: { d: ExecutionInspection }) {
  const ev = d.evidence;
  return (
    <Section title="Evidence Retrieved" icon="📚">
      {ev.noEvidenceReason && (
        <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3 mb-3">
          <p className="text-amber-300 text-xs">{ev.noEvidenceReason}</p>
        </div>
      )}
      {ev.sources.map(src => <EvidenceSource key={src.sourceId} src={src} />)}
      {ev.memoryEntries > 0 && (
        <div className="flex items-center gap-2 py-2 border-t border-[#1E3A5F]/40 mt-2">
          <span className="text-xs">✓</span>
          <span className="text-[#E2E8F0] text-xs flex-1">Organisation Memory</span>
          <span className="text-[#64748B] text-xs">{ev.memoryEntries} entries</span>
        </div>
      )}
      {ev.taskUploads > 0 && (
        <div className="flex items-center gap-2 py-2 border-t border-[#1E3A5F]/40">
          <span className="text-xs">✓</span>
          <span className="text-[#E2E8F0] text-xs flex-1">Participant Uploads</span>
          <span className="text-[#64748B] text-xs">{ev.taskUploads} document{ev.taskUploads !== 1 ? "s" : ""}</span>
        </div>
      )}
      {ev.sources.length === 0 && !ev.noEvidenceReason && (
        <p className="text-[#64748B] text-xs italic">No evidence sources were included in this execution.</p>
      )}
    </Section>
  );
}

// ─── Blueprint Inspector ──────────────────────────────────────────────────────

function BlueprintSection({ d }: { d: ExecutionInspection }) {
  const bp = d.blueprint;
  return (
    <Section title="Blueprint Inspector" icon="📐" defaultOpen={false}>
      <KV label="Blueprint Name" value={bp.name ?? "Ad-hoc (none)"} />
      {bp.version && <KV label="Version" value={bp.version} />}
      <KV label="Selection Method" value={
        <Badge
          label={bp.selectionMethod === "keyword" ? "Keyword" : bp.selectionMethod === "semantic" ? "Semantic" : "None"}
          color={bp.selectionMethod === "keyword" ? "text-blue-300 bg-blue-900/40" : bp.selectionMethod === "semantic" ? "text-violet-300 bg-violet-900/40" : undefined}
        />
      } />
      {bp.matchedPhrase && bp.selectionMethod === "keyword" && (
        <KV label="Matched Phrase" value={bp.matchedPhrase} mono />
      )}
      {bp.semanticReason && bp.selectionMethod === "semantic" && (
        <KV label="Semantic Reason" value={bp.semanticReason} />
      )}
      <KV label="Confidence" value={bp.confidence > 0 ? bp.confidence.toFixed(2) : "—"} />
      <KV label="Validation" value={
        bp.validationPassed == null
          ? <Badge label="Not run" />
          : bp.validationPassed
          ? <Badge label="Passed" color="text-emerald-300 bg-emerald-900/40" />
          : <Badge label="Failed" color="text-red-300 bg-red-900/40" />
      } />
      {bp.validationMissingItems.length > 0 && (
        <KV label="Missing Items" value={
          <div className="space-y-1 text-right">
            {bp.validationMissingItems.map(item => (
              <div key={item} className="text-red-300 text-xs">{item}</div>
            ))}
          </div>
        } />
      )}
      {bp.requiredKnowledge.length > 0 && (
        <div className="mt-3">
          <p className="text-[#64748B] text-xs mb-2">Required Knowledge</p>
          <div className="space-y-1">
            {bp.requiredKnowledge.map(k => (
              <div key={k.name} className="flex items-center gap-2">
                <span className="text-xs">{k.retrieved ? "✓" : "✗"}</span>
                <span className={`text-xs ${k.retrieved ? "text-emerald-300" : "text-red-300"}`}>{k.name}</span>
                <span className="text-[#64748B] text-xs ml-auto">{k.retrieved ? "Retrieved" : "Missing"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── Specialist Runtime ───────────────────────────────────────────────────────

function SpecialistRuntimeSection({ d }: { d: ExecutionInspection }) {
  const sr = d.specialistRuntime;
  const rows = [
    { label: "Professional DNA", value: sr.dnaLoaded ? "Loaded" : "Not loaded", ok: sr.dnaLoaded },
    { label: "Organisation Memory", value: `${sr.organisationMemoryEntries} entries`, ok: sr.organisationMemoryEntries >= 0 },
    { label: "Evidence Chunks", value: String(sr.evidenceChunks), ok: true },
    { label: "Task Uploads", value: String(sr.taskUploads), ok: true },
    { label: "Blueprint", value: sr.blueprintLoaded ? "Loaded" : "Ad-hoc (not required)", ok: true },
    { label: "Expected Deliverables", value: sr.expectedDeliverablesLoaded ? "Loaded" : "Not required", ok: true },
  ];
  return (
    <Section title="Specialist Runtime" icon="🤖" defaultOpen={false}>
      <div className="bg-[#0B1829] border border-[#1E3A5F]/40 rounded-lg p-3 mb-3">
        <p className="text-[#64748B] text-xs">
          Shows what the specialist received — counts only. System prompts and proprietary prompt engineering are not shown.
        </p>
      </div>
      {rows.map(row => (
        <div key={row.label} className="flex justify-between py-2 border-b border-[#1E3A5F]/40 last:border-0">
          <span className="text-[#64748B] text-xs">{row.label}</span>
          <span className={`text-xs font-medium ${row.ok ? "text-[#E2E8F0]" : "text-amber-300"}`}>{row.value}</span>
        </div>
      ))}
    </Section>
  );
}

// ─── Execution Timeline ───────────────────────────────────────────────────────

const STAGE_ORDER = [
  "Blueprint Selected",
  "Knowledge Retrieved",
  "Validation",
  "Execution",
  "Self Review",
  "Completed Work",
];

function TimelineSection({ d }: { d: ExecutionInspection }) {
  const tl = d.timeline;

  if (tl.entries.length === 0) {
    return (
      <Section title="Execution Timeline" icon="⏱" defaultOpen={false}>
        <p className="text-[#64748B] text-xs italic">Timeline data not yet available for this execution.</p>
      </Section>
    );
  }

  return (
    <Section title="Execution Timeline" icon="⏱" defaultOpen={false}>
      <div className="relative pl-6">
        {tl.entries.map((entry, i) => {
          const isLast = i === tl.entries.length - 1;
          const icon = TIMELINE_ICONS[entry.kind] ?? "•";
          const isFailed = entry.kind === "failed";
          const isComplete = entry.kind === "completed" || entry.kind === "approved";
          return (
            <div key={entry.id} className="relative mb-3">
              {/* Connector line */}
              {!isLast && (
                <div className="absolute left-[-17px] top-4 w-0.5 h-full bg-[#1E3A5F]" />
              )}
              {/* Dot */}
              <div className={`absolute left-[-21px] top-1 w-3 h-3 rounded-full border-2 ${
                isFailed ? "border-red-500 bg-red-900/40" :
                isComplete ? "border-emerald-500 bg-emerald-900/40" :
                "border-[#2563EB] bg-[#0B1829]"
              }`} />
              {/* Content */}
              <div>
                <p className={`text-xs font-medium ${isFailed ? "text-red-300" : "text-[#E2E8F0]"}`}>
                  {icon} {entry.humanLabel}
                </p>
                <p className="text-[#64748B] text-xs mt-0.5">{fmtTimestamp(entry.timestamp)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Failure Diagnostics ──────────────────────────────────────────────────────

function DiagnosticsSection({ d }: { d: ExecutionInspection }) {
  const diag = d.diagnostics;

  if (diag.state === "completed" || diag.state === "running") {
    return (
      <Section title="Failure Diagnostics" icon="🔍" defaultOpen={false}>
        <div className="flex items-center gap-2">
          <span className="text-emerald-400 text-base">{diag.state === "completed" ? "✅" : "⚙️"}</span>
          <span className="text-[#E2E8F0] text-sm">
            {diag.state === "completed" ? "Execution completed without errors." : "Execution is running normally."}
          </span>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Failure Diagnostics" icon="🔍" defaultOpen={true}>
      {(diag.state === "awaiting_clarification" || diag.state === "evidence_required") && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 mb-3">
          <p className="text-amber-300 text-sm font-semibold mb-2">
            ⏸ {diag.state === "evidence_required" ? "Evidence Required" : "Awaiting Clarification"}
          </p>
          {diag.clarificationItems.map(item => (
            <div key={item.name} className="mb-2 last:mb-0">
              <p className="text-[#E2E8F0] text-xs font-medium">Missing: {item.name}</p>
              <p className="text-[#64748B] text-xs">Reason: {item.reason}</p>
            </div>
          ))}
        </div>
      )}
      {diag.state === "failed" && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-3 mb-3">
          <p className="text-red-300 text-sm font-semibold mb-2">❌ Execution Failed</p>
          {diag.failedStage && <KV label="Failed Stage" value={diag.failedStage} />}
          {diag.rootCause && <KV label="Root Cause" value={diag.rootCause} />}
          <KV label="Retry Available" value={diag.retryAvailable ? "Yes" : "No"} />
          <KV label="Correlation ID" value={d.executionId} mono />
        </div>
      )}
    </Section>
  );
}

// ─── Performance Metrics ──────────────────────────────────────────────────────

function PerformanceSection({ d }: { d: ExecutionInspection }) {
  const p = d.performance;
  const metrics = [
    { label: "Blueprint Selection Time", value: fmtMs(p.blueprintSelectionMs) },
    { label: "Validation Time", value: fmtMs(p.validationMs) },
    { label: "Retrieval Time", value: fmtMs(p.retrievalMs) },
    { label: "LLM Time", value: fmtMs(p.llmMs) },
    { label: "Review Time", value: fmtMs(p.reviewMs) },
    { label: "Total Execution Time", value: fmtMs(p.totalMs) },
    { label: "Evidence Cache Hit", value: p.evidenceCacheHit ? "Yes" : "No" },
    { label: "Chunk Count", value: String(p.chunkCount) },
    { label: "Memory Count", value: String(p.memoryCount) },
  ];

  return (
    <Section title="Performance Metrics" icon="📊" defaultOpen={false}>
      {metrics.map(m => (
        <div key={m.label} className="flex justify-between py-2 border-b border-[#1E3A5F]/40 last:border-0">
          <span className="text-[#64748B] text-xs">{m.label}</span>
          <span className="text-[#E2E8F0] text-xs font-medium tabular-nums">{m.value}</span>
        </div>
      ))}
    </Section>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface ExecutionInspectorPanelProps {
  slug: string;
  /** Look up by completed work ID (from Completed Work Viewer) */
  completedWorkId?: string;
  /** Look up directly by execution ID (from Active Work / Workroom / Dev Mode) */
  executionId?: string;
}

export default function ExecutionInspectorPanel({
  slug, completedWorkId, executionId,
}: ExecutionInspectorPanelProps) {
  const apiFetch = useAuthFetch();

  const url = completedWorkId
    ? `/v1/organisations/${slug}/work/${completedWorkId}/inspector`
    : executionId
    ? `/v1/organisations/${slug}/executions/${executionId}/inspector`
    : null;

  const { data, isLoading, error } = useQuery<ExecutionInspection>({
    queryKey: ["execution-inspector", slug, completedWorkId ?? executionId],
    queryFn: () => apiFetch(url!),
    enabled: !!url && !!slug,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center space-y-2">
          <div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-[#64748B] text-sm">Loading execution inspection…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6">
        <p className="text-[#64748B] text-sm font-medium mb-1">Inspection Not Available</p>
        <p className="text-[#64748B] text-xs leading-relaxed">
          {(error as Error | null)?.message?.includes("404")
            ? "No execution record was found for this item. This may be a legacy item created before the Execution Inspector was introduced."
            : "Execution inspection data is not available. This may occur if the execution is still being assembled, or if you do not have access to this execution."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Security notice */}
      <div className="bg-[#0B1829] border border-[#1E3A5F]/50 rounded-xl p-3 flex items-start gap-2">
        <span className="text-xs mt-0.5">🔒</span>
        <p className="text-[#64748B] text-xs leading-relaxed">
          <span className="text-[#E2E8F0] font-medium">Execution Inspector — </span>
          System prompts, embedding vectors, API keys, and proprietary model internals are never shown. Evidence previews are limited to 150 characters.
        </p>
      </div>

      <SummarySection d={data} />
      <EvidenceSection d={data} />
      <BlueprintSection d={data} />
      <SpecialistRuntimeSection d={data} />
      <TimelineSection d={data} />
      <DiagnosticsSection d={data} />
      <PerformanceSection d={data} />
    </div>
  );
}
