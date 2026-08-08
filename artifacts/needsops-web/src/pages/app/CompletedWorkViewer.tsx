/**
 * Completed Work Viewer — /app/:slug/work/:id
 *
 * Sprint 25. Professional document viewer experience comparable to
 * Word / Google Docs / Notion — but focused on reviewing AI-produced work.
 *
 * Tabs:
 *   Document    — rendered markdown with outline navigation
 *   Evidence    — citations grouped by source type
 *   Execution   — specialist · blueprint · validation · self-review · transparency
 *   Versions    — timeline · compare · download · restore
 *   Comments    — threaded + add comment
 *
 * Actions (status-aware):
 *   Draft             → Submit for Approval
 *   Awaiting Approval → Approve / Reject / Request Changes
 *   Approved          → Archive · Promote to Library · Download
 *   Rejected          → Reopen
 *   Any approved      → Download (MD/PDF stub/DOCX stub)
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, useLocation }               from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show }                                  from "@clerk/react";
import { Redirect }                              from "wouter";
import AppShell                                  from "@/components/layout/AppShell";
import { useAuthFetch }                          from "@/lib/api";
import { MarkdownRenderer, extractOutline }      from "@/components/MarkdownRenderer";
import { normaliseCompletedWorkContent }         from "@/lib/completedWorkNormaliser";
import ExecutionInspectorPanel                   from "@/components/inspector/ExecutionInspectorPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkStatus = "draft"|"awaiting_approval"|"approved"|"rejected"|"archived"|"superseded"|"reopened";

interface CompletedWorkItem {
  approvedVersionId?: string | null;
  id:               string;
  title:            string;
  outputType:       string;
  primarySpecialist:string;
  status:           WorkStatus;
  createdAt:        string;
  updatedAt:        string;
  blueprintId:      string | null;
  manifestId:       string | null;
  conversationId:   string | null;
  currentVersionId: string | null;
  createdByUserId:  string | null;
  approvedByUserId: string | null;
  rejectedAt:       string | null;
  archivedAt:       string | null;
  supersededById:   string | null;
}

interface CompletedWorkVersion {
  id:              string;
  versionNumber:   number;
  contentMarkdown: string | null;
  qualityScore:    number | null;
  changeNote:      string | null;
  createdByUserId: string | null;
  reviewDimensions:any[];
  isAutoRevision:  string;
  createdAt:       string;
}

interface CommentRow {
  id:               string;
  content:          string;
  authorUserId:     string;
  createdAt:        string;
  // Sprint 25 Hardening — server-backed resolution lifecycle
  status:           "open" | "resolved" | "reopened";
  resolvedByUserId: string | null;
  resolvedAt:       string | null;
  reopenedByUserId: string | null;
  reopenedAt:       string | null;
}

interface AssetRow {
  id:          string;
  assetType:   string;
  assetId:     string;
  role:        string;
  citationRef: string | null;
  createdAt:   string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<WorkStatus, { bg: string; text: string; label: string }> = {
  draft:             { bg: "bg-blue-900/40",    text: "text-blue-300",    label: "Draft" },
  awaiting_approval: { bg: "bg-amber-900/40",   text: "text-amber-300",   label: "Awaiting Approval" },
  approved:          { bg: "bg-emerald-900/40", text: "text-emerald-300", label: "Approved" },
  rejected:          { bg: "bg-red-900/40",     text: "text-red-300",     label: "Rejected" },
  archived:          { bg: "bg-gray-800/60",    text: "text-gray-400",    label: "Archived" },
  superseded:        { bg: "bg-purple-900/40",  text: "text-purple-300",  label: "Superseded" },
  reopened:          { bg: "bg-orange-900/40",  text: "text-orange-300",  label: "Reopened" },
};

const ASSET_TYPE_META: Record<string, { icon: string; label: string; desc: string }> = {
  library_source:    { icon: "📚", label: "Organisation Library",  desc: "Verified knowledge from your library" },
  organisation_memory: { icon: "💡", label: "Organisation Memory", desc: "Retained organisational knowledge" },
  task_document:     { icon: "📎", label: "Task Document",         desc: "Document uploaded to the task" },
  policy:            { icon: "📋", label: "Policy",                desc: "Policy referenced during work" },
  template:          { icon: "📐", label: "Template",              desc: "Template used as structure" },
  approved_example:  { icon: "✅", label: "Approved Example",      desc: "Previously approved similar work" },
  general_knowledge: { icon: "🌐", label: "General Knowledge",     desc: "AI Workforce professional knowledge" },
};

const SPECIALIST_LABELS: Record<string, string> = {
  chief_of_staff:                   "Chief of Staff",
  operations_manager:               "Operations Manager",
  compliance_manager:               "Compliance Manager",
  hr_manager:                       "HR Manager",
  finance_manager:                  "Finance Manager",
  incident_safeguarding_specialist: "Incident & Safeguarding Specialist",
};

const PROMOTE_DOC_TYPES = [
  { value: "approved_example", label: "Approved Example",  desc: "A completed example of this type of work" },
  { value: "template",         label: "Template",          desc: "A reusable structure for future documents" },
  { value: "policy",           label: "Policy",            desc: "An authoritative policy statement" },
  { value: "procedure",        label: "Procedure",         desc: "A step-by-step operational procedure" },
  { value: "guide",            label: "Guide",             desc: "Guidance material for staff or specialists" },
  { value: "reference",        label: "Reference Material",desc: "Supporting reference for other documents" },
];

const SPECIALIST_REACH: Record<string, string[]> = {
  chief_of_staff:   ["Chief of Staff","Operations Manager","Compliance Manager","HR Manager","Finance Manager"],
  operations_manager:["Operations Manager"],
  compliance_manager:["Compliance Manager","Chief of Staff"],
  hr_manager:       ["HR Manager","Chief of Staff"],
  finance_manager:  ["Finance Manager","Chief of Staff"],
  incident_safeguarding_specialist: ["Incident & Safeguarding Specialist","Chief of Staff"],
};

function specLabel(s: string) {
  return SPECIALIST_LABELS[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
function specIcon(s: string) {
  const icons: Record<string,string> = {
    chief_of_staff:"🎯", operations_manager:"⚙", compliance_manager:"📋",
    hr_manager:"👥", finance_manager:"💰", incident_safeguarding_specialist:"🛡",
  };
  return icons[s] ?? "🤖";
}
function fmtDate(d: string|null|undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-AU", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
}
function timeAgo(d: string) {
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60000)    return "just now";
  if (ms < 3600000)  return `${Math.floor(ms/60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)}h ago`;
  return `${Math.floor(ms/86400000)}d ago`;
}

// ─── Approval Modal ───────────────────────────────────────────────────────────

function ApprovalModal({
  action, onConfirm, onClose,
}: {
  action: "approve"|"reject"|"request_changes";
  onConfirm: (comment: string) => void;
  onClose: () => void;
}) {
  const [comment, setComment] = useState("");
  const titles = {
    approve:          { title:"Approve this work",    btn:"Approve",         colour:"bg-emerald-600 hover:bg-emerald-500" },
    reject:           { title:"Reject this work",     btn:"Reject",          colour:"bg-red-700 hover:bg-red-600" },
    request_changes:  { title:"Request changes",      btn:"Send to Revision",colour:"bg-amber-700 hover:bg-amber-600" },
  };
  const cfg = titles[action];
  const required = action !== "approve";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-[#E2E8F0] font-semibold text-lg mb-1">{cfg.title}</h3>
        <p className="text-[#64748B] text-sm mb-4">
          {action === "approve"
            ? "This will mark the document as approved and notify the team."
            : action === "reject"
            ? "The document will be rejected. Provide a reason for the team."
            : "The document will be sent back for revision. Describe what needs to change."}
        </p>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder={
            action === "approve" ? "Optional comment…" :
            action === "reject"  ? "Reason for rejection…" :
            "Describe the required changes…"
          }
          rows={4}
          className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50 resize-none mb-4"
        />
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-[#1E3A5F] rounded-lg text-[#64748B] hover:text-[#E2E8F0]">
            Cancel
          </button>
          <button
            onClick={() => { if (!required || comment.trim()) onConfirm(comment); }}
            disabled={required && !comment.trim()}
            className={`px-4 py-2 text-sm rounded-lg text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cfg.colour}`}
          >
            {cfg.btn}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Promote Modal ────────────────────────────────────────────────────────────

function PromoteModal({
  work, onConfirm, onClose,
}: {
  work: CompletedWorkItem;
  onConfirm: (docType: string) => void;
  onClose: () => void;
}) {
  const [selectedType, setSelectedType] = useState("");
  const reach = SPECIALIST_REACH[work.primarySpecialist] ?? [specLabel(work.primarySpecialist)];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-[#E2E8F0] font-semibold text-lg mb-1">Promote to Organisation Library</h3>
        <p className="text-[#64748B] text-sm mb-4">
          This document will become part of your organisation's knowledge base and will be made available to your AI Workforce.
        </p>

        <div className="space-y-2 mb-4">
          {PROMOTE_DOC_TYPES.map(dt => (
            <button
              key={dt.value}
              onClick={() => setSelectedType(dt.value)}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                selectedType === dt.value
                  ? "border-[#00D4FF]/50 bg-[#00D4FF]/10"
                  : "border-[#1E3A5F] hover:border-[#1E3A5F]/80 hover:bg-[#152840]"
              }`}
            >
              <span className="text-[#E2E8F0] text-sm font-medium">{dt.label}</span>
              <span className="text-[#64748B] text-xs ml-2">— {dt.desc}</span>
            </button>
          ))}
        </div>

        {selectedType && (
          <div className="bg-[#0B1829] border border-[#1E3A5F] rounded-lg p-3 mb-4">
            <p className="text-[#64748B] text-xs mb-2">This document will become available to the following specialists:</p>
            <div className="flex flex-wrap gap-2">
              {reach.map(s => (
                <span key={s} className="text-xs px-2 py-1 rounded-full bg-[#00D4FF]/10 text-[#00D4FF]">{s}</span>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-[#1E3A5F] rounded-lg text-[#64748B] hover:text-[#E2E8F0]">
            Cancel
          </button>
          <button
            onClick={() => selectedType && onConfirm(selectedType)}
            disabled={!selectedType}
            className="px-4 py-2 text-sm rounded-lg bg-[#00D4FF] text-[#0B1829] font-semibold hover:bg-cyan-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Promote to Library
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Document Outline ─────────────────────────────────────────────────────────

function DocumentOutline({ content }: { content: string }) {
  const headings = useMemo(() => extractOutline(content), [content]);
  if (headings.length === 0) return null;
  return (
    <nav className="w-52 shrink-0 hidden xl:block">
      <div className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto">
        <p className="text-[#64748B] text-xs uppercase tracking-widest mb-3 px-1">On this page</p>
        <ul className="space-y-1">
          {headings.map((h, i) => (
            <li key={i}>
              <a
                href={`#section-${h.idx}`}
                onClick={e => {
                  e.preventDefault();
                  document.getElementById(`section-${h.idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={`block text-xs leading-tight py-1 rounded hover:text-[#E2E8F0] transition-colors truncate ${
                  h.level === 1 ? "text-[#94A3B8] pl-1 font-medium" :
                  h.level === 2 ? "text-[#64748B] pl-3" :
                  "text-[#64748B]/70 pl-5"
                }`}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

// ─── Evidence Tab ─────────────────────────────────────────────────────────────

function EvidenceTab({ assets }: { assets: AssetRow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const grouped = useMemo(() => {
    const g: Record<string, AssetRow[]> = {};
    assets.forEach(a => { (g[a.assetType] = g[a.assetType] ?? []).push(a); });
    return g;
  }, [assets]);

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-3xl mb-3">📎</div>
        <p className="text-[#E2E8F0] font-medium mb-1">No citations recorded</p>
        <p className="text-[#64748B] text-sm">This document was produced without referencing library sources</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
        <p className="text-[#64748B] text-sm">
          This document references <span className="text-[#E2E8F0] font-medium">{assets.length}</span> source
          {assets.length !== 1 ? "s" : ""}. Select any source to view details about how it was used.
        </p>
      </div>

      {Object.entries(grouped).map(([type, items]) => {
        const meta = ASSET_TYPE_META[type] ?? { icon: "📄", label: type, desc: "" };
        return (
          <div key={type}>
            <h3 className="flex items-center gap-2 text-[#E2E8F0] font-semibold text-sm mb-3">
              <span>{meta.icon}</span>
              {meta.label}
              <span className="text-[#64748B] font-normal">({items.length})</span>
            </h3>
            <div className="space-y-2">
              {items.map(asset => (
                <div key={asset.id}>
                  <button
                    onClick={() => setSelected(selected === asset.id ? null : asset.id)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      selected === asset.id
                        ? "border-[#00D4FF]/40 bg-[#00D4FF]/5"
                        : "border-[#1E3A5F] bg-[#112033] hover:border-[#1E3A5F]/80"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{meta.icon}</span>
                        <div>
                          <p className="text-[#E2E8F0] text-sm font-medium">{asset.citationRef ?? asset.assetId}</p>
                          <p className="text-[#64748B] text-xs mt-0.5">{meta.desc}</p>
                        </div>
                      </div>
                      <span className="text-[#64748B] text-xs">{selected === asset.id ? "▲" : "▼"}</span>
                    </div>
                  </button>
                  {selected === asset.id && (
                    <div className="mt-1 p-4 bg-[#0B1829] border border-[#1E3A5F] border-t-0 rounded-b-xl space-y-3">
                      <DetailRow label="Source type"    value={meta.label} />
                      <DetailRow label="Source ID"      value={asset.assetId} mono />
                      <DetailRow label="Role in document" value={formatRole(asset.role)} />
                      {asset.citationRef && <DetailRow label="Citation reference" value={asset.citationRef} />}
                      <DetailRow label="Retrieved"      value={fmtDate(asset.createdAt)} />
                      <div className="pt-2 border-t border-[#1E3A5F]">
                        <p className="text-[#64748B] text-xs italic">
                          Technical retrieval details are not shown. This source was selected because it is relevant to the work being completed.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[#64748B] text-xs">{label}</span>
      <span className={`text-[#E2E8F0] text-xs text-right ${mono ? "font-mono text-[#00D4FF]" : ""}`}>{value}</span>
    </div>
  );
}

function formatRole(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Quality Review Section (Task #39) ───────────────────────────────────────

const DIMENSION_LABELS: Record<string, string> = {
  instruction_adherence:      "Instruction Adherence",
  policy_compliance:          "Policy Compliance",
  writing_style_compliance:   "Writing Style",
  source_coverage:            "Source Coverage",
  evidence_citation_grounding:"Evidence Citation Grounding",
  completeness:               "Completeness",
  confidence:                 "Confidence",
  missing_information:        "Missing Information",
  approval_requirements:      "Approval Requirements",
  safety:                     "Safety",
  consistency:                "Consistency",
};

function QualityReviewSection({
  dimensions, qualityScore, isAutoRevision,
}: {
  dimensions: any[];
  qualityScore: number | null;
  isAutoRevision: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const passed   = dimensions.filter(d => d.passed);
  const failed   = dimensions.filter(d => !d.passed);
  const score100 = qualityScore ?? (
    dimensions.length > 0
      ? Math.round(dimensions.reduce((s: number, d: any) => s + (d.score ?? 0), 0) / dimensions.length * 10)
      : null
  );

  const scoreColor = score100 == null ? "" : score100 >= 80 ? "text-emerald-400" : score100 >= 70 ? "text-amber-400" : "text-red-400";
  const barColor   = score100 == null ? "bg-gray-500" : score100 >= 80 ? "bg-emerald-500" : score100 >= 70 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[#64748B] text-xs uppercase tracking-widest">Quality Review</h3>
          {isAutoRevision && (
            <span className="mt-1 inline-block text-[10px] px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300">
              Auto-revised
            </span>
          )}
        </div>
        {score100 != null && (
          <div className="flex items-center gap-3">
            <div className="w-28 h-2 rounded-full bg-[#0B1829] overflow-hidden">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, score100)}%` }} />
            </div>
            <span className={`font-bold text-lg ${scoreColor}`}>{score100}/100</span>
          </div>
        )}
      </div>

      {/* Summary chips */}
      {(passed.length > 0 || failed.length > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {passed.length > 0 && (
            <span className="px-2 py-1 rounded-full bg-emerald-900/30 text-emerald-300">
              ✓ {passed.length} dimension{passed.length !== 1 ? "s" : ""} passed
            </span>
          )}
          {failed.length > 0 && (
            <span className="px-2 py-1 rounded-full bg-red-900/30 text-red-300">
              ✗ {failed.length} dimension{failed.length !== 1 ? "s" : ""} deducted
            </span>
          )}
        </div>
      )}

      {/* Per-dimension results */}
      <div className="space-y-2">
        {dimensions.map((dim: any, i: number) => {
          const dimLabel = DIMENSION_LABELS[dim.dimension] ?? dim.dimension;
          const score    = dim.score ?? 0;
          const score100d = Math.round(score * 10);
          const dimColor = dim.passed ? "bg-emerald-500" : "bg-red-500";
          const isOpen   = expanded === dim.dimension;
          const hasDetail = (dim.feedback || (dim.evidence?.length ?? 0) > 0 || (dim.improvementSuggestions?.length ?? 0) > 0);

          return (
            <div key={i} className={`rounded-lg border transition-colors ${dim.passed ? "border-[#1E3A5F]" : "border-red-900/40"}`}>
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left"
                onClick={() => hasDetail && setExpanded(isOpen ? null : dim.dimension)}
                disabled={!hasDetail}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-xs font-semibold ${dim.passed ? "text-emerald-400" : "text-red-400"}`}>
                    {dim.passed ? "✓" : "✗"}
                  </span>
                  <span className="text-[#E2E8F0] text-sm truncate">{dimLabel}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="w-20 h-1.5 rounded-full bg-[#0B1829] overflow-hidden">
                    <div className={`h-full rounded-full ${dimColor}`} style={{ width: `${score100d}%` }} />
                  </div>
                  <span className="text-[#64748B] text-xs w-8 text-right">{score}/10</span>
                  {hasDetail && (
                    <span className="text-[#475569] text-xs">{isOpen ? "▲" : "▼"}</span>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-[#1E3A5F]/40 pt-3">
                  {/* Plain-language reason */}
                  {dim.feedback && (
                    <p className="text-[#94A3B8] text-sm">{dim.feedback}</p>
                  )}
                  {/* Improvement suggestions */}
                  {(dim.improvementSuggestions?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[#64748B] text-xs uppercase tracking-widest mb-1">What to improve</p>
                      <ul className="space-y-1">
                        {dim.improvementSuggestions.map((s: string, j: number) => (
                          <li key={j} className="text-amber-300 text-xs flex items-start gap-2">
                            <span className="mt-0.5 shrink-0">→</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* Evidence citations */}
                  {(dim.evidence?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[#64748B] text-xs uppercase tracking-widest mb-1">Evidence checked</p>
                      <ul className="space-y-1">
                        {dim.evidence.map((e: string, j: number) => (
                          <li key={j} className="text-[#64748B] text-xs font-mono leading-relaxed">
                            · {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer note — no chain-of-thought exposed */}
      <p className="text-[#475569] text-xs">
        Quality scores are computed automatically from structural and content analysis. Scores do not reflect the underlying AI model's reasoning process.
      </p>
    </div>
  );
}

// ─── Execution Tab ────────────────────────────────────────────────────────────

function ExecutionTab({
  work, versions,
}: {
  work: CompletedWorkItem;
  versions: CompletedWorkVersion[];
}) {
  const latest    = versions[0];
  const reviewDim = (latest?.reviewDimensions ?? []) as any[];
  const avgScore  = reviewDim.length > 0
    ? Math.round(reviewDim.reduce((s: number, d: any) => s + (d.score ?? 0), 0) / reviewDim.length)
    : null;
  const timeTaken = work.updatedAt && work.createdAt
    ? Math.round((new Date(work.updatedAt).getTime() - new Date(work.createdAt).getTime()) / 1000)
    : null;

  function fmtTime(s: number) {
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
    return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
  }

  return (
    <div className="space-y-6">
      {/* Specialist card */}
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
        <h3 className="text-[#64748B] text-xs uppercase tracking-widest mb-4">Assigned Specialist</h3>
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-[#0B1829] border border-[#1E3A5F] flex items-center justify-center text-2xl">
            {specIcon(work.primarySpecialist)}
          </div>
          <div>
            <p className="text-[#E2E8F0] font-semibold">{specLabel(work.primarySpecialist)}</p>
            <p className="text-[#64748B] text-sm">NeedsOps AI Workforce</p>
          </div>
          <div className="ml-auto">
            <span className="text-xs px-2 py-1 rounded-full bg-emerald-900/40 text-emerald-300">Active</span>
          </div>
        </div>
      </div>

      {/* Work summary */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Blueprint",     value: work.blueprintId ? work.blueprintId.slice(0, 16) + "…" : "Standard",    icon: "📐" },
          { label: "Document type", value: work.outputType.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase()), icon: "📄" },
          { label: "Time taken",    value: timeTaken != null ? fmtTime(timeTaken) : "—",         icon: "⏱" },
          { label: "Versions",      value: String(versions.length),                               icon: "📑" },
        ].map(m => (
          <div key={m.label} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">{m.icon}</span>
              <span className="text-[#64748B] text-xs">{m.label}</span>
            </div>
            <p className="text-[#E2E8F0] font-semibold text-sm">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Related conversation */}
      {work.conversationId && (
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg">💬</span>
            <div>
              <p className="text-[#E2E8F0] text-sm font-medium">Related Conversation</p>
              <p className="text-[#64748B] text-xs">This work originated from a conversation with your Chief of Staff</p>
            </div>
          </div>
          <a
            href={`/app/${window.location.pathname.split("/")[2]}/tasks/${work.conversationId}`}
            className="text-xs px-3 py-1.5 rounded-lg border border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0] hover:border-[#00D4FF]/30"
          >
            View →
          </a>
        </div>
      )}

      {/* Transparency notice */}
      <div className="bg-[#0B1829] border border-[#1E3A5F]/50 rounded-xl p-4">
        <p className="text-[#64748B] text-xs leading-relaxed">
          <span className="text-[#E2E8F0] font-medium">Execution transparency: </span>
          This work was produced by your AI Workforce using verified organisational knowledge and professional standards. Technical implementation details are not shown. Contact your administrator to review the full execution log.
        </p>
      </div>
    </div>
  );
}

// ─── Versions Tab ─────────────────────────────────────────────────────────────

function VersionsTab({
  versions, workId, slug, onAddVersion, onExport,
}: {
  versions: CompletedWorkVersion[];
  workId: string;
  slug: string;
  onAddVersion: () => void;
  onExport: (format: "md" | "pdf" | "docx") => Promise<void>;
}) {
  const [compareA,    setCompareA]    = useState<number | null>(null);
  const [compareB,    setCompareB]    = useState<number | null>(null);
  const [exporting,   setExporting]   = useState<"pdf" | "docx" | null>(null);
  const apiFetch = useAuthFetch();

  function downloadMd(v: CompletedWorkVersion) {
    if (!v.contentMarkdown) return;
    const blob = new Blob([v.contentMarkdown], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `version-${v.versionNumber}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const vA = compareA != null ? versions.find(v => v.versionNumber === compareA) : null;
  const vB = compareB != null ? versions.find(v => v.versionNumber === compareB) : null;

  return (
    <div className="space-y-6">
      {/* Compare controls */}
      {versions.length > 1 && (
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <h3 className="text-[#64748B] text-xs uppercase tracking-widest mb-3">Compare Versions</h3>
          <div className="flex items-center gap-3">
            <select
              value={compareA ?? ""}
              onChange={e => setCompareA(e.target.value ? Number(e.target.value) : null)}
              className="flex-1 bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none"
            >
              <option value="">Select version A…</option>
              {versions.map(v => <option key={v.id} value={v.versionNumber}>Version {v.versionNumber}</option>)}
            </select>
            <span className="text-[#64748B]">vs</span>
            <select
              value={compareB ?? ""}
              onChange={e => setCompareB(e.target.value ? Number(e.target.value) : null)}
              className="flex-1 bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none"
            >
              <option value="">Select version B…</option>
              {versions.map(v => <option key={v.id} value={v.versionNumber}>Version {v.versionNumber}</option>)}
            </select>
            {(compareA || compareB) && (
              <button onClick={() => { setCompareA(null); setCompareB(null); }} className="text-[#64748B] hover:text-red-400 text-sm">✕</button>
            )}
          </div>
        </div>
      )}

      {/* Compare view */}
      {vA && vB && (
        <div className="grid grid-cols-2 gap-4">
          {[vA, vB].map((v, i) => (
            <div key={i} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[#E2E8F0] font-semibold text-sm">Version {v.versionNumber}</span>
                <span className="text-[#64748B] text-xs">{fmtDate(v.createdAt)}</span>
              </div>
              <div className="max-h-80 overflow-y-auto text-xs text-[#CBD5E1] font-mono whitespace-pre-wrap bg-[#0B1829] rounded-lg p-3">
                {v.contentMarkdown ?? "(no content)"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Version timeline */}
      <div>
        <h3 className="text-[#64748B] text-xs uppercase tracking-widest mb-3">Version History</h3>
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-px bg-[#1E3A5F]" />
          <div className="space-y-4">
            {versions.map((v, i) => (
              <div key={v.id} className="relative pl-10">
                <div className={`absolute left-2.5 top-3 h-3 w-3 rounded-full border-2 ${i === 0 ? "bg-[#00D4FF] border-[#00D4FF]" : "bg-[#1E3A5F] border-[#1E3A5F]"}`} />
                <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[#E2E8F0] font-semibold text-sm">Version {v.versionNumber}</span>
                      {i === 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-[#00D4FF]/10 text-[#00D4FF]">Current</span>}
                      {v.isAutoRevision === "true" && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/40 text-purple-300">AI Revised</span>}
                    </div>
                    <span className="text-[#64748B] text-xs">{fmtDate(v.createdAt)}</span>
                  </div>
                  {v.changeNote && <p className="text-[#94A3B8] text-sm mb-3">{v.changeNote}</p>}
                  {v.qualityScore != null && (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[#64748B] text-xs">Quality</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[#0B1829] overflow-hidden max-w-24">
                        <div className={`h-full rounded-full ${v.qualityScore >= 80 ? "bg-emerald-500" : v.qualityScore >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${v.qualityScore}%` }} />
                      </div>
                      <span className="text-[#64748B] text-xs">{v.qualityScore}/100</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => downloadMd(v)}
                      disabled={!v.contentMarkdown}
                      className="text-xs px-3 py-1.5 rounded-lg border border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0] hover:border-[#00D4FF]/30 disabled:opacity-30"
                    >
                      ↓ MD
                    </button>
                    <button
                      onClick={async () => { setExporting("pdf"); try { await onExport("pdf"); } finally { setExporting(null); } }}
                      disabled={exporting === "pdf"}
                      className="text-xs px-3 py-1.5 rounded-lg border border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0] hover:border-[#00D4FF]/30 disabled:opacity-40"
                    >
                      {exporting === "pdf" ? "…" : "↓ PDF"}
                    </button>
                    <button
                      onClick={async () => { setExporting("docx"); try { await onExport("docx"); } finally { setExporting(null); } }}
                      disabled={exporting === "docx"}
                      className="text-xs px-3 py-1.5 rounded-lg border border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0] hover:border-[#00D4FF]/30 disabled:opacity-40"
                    >
                      {exporting === "docx" ? "…" : "↓ DOCX"}
                    </button>
                    {i > 0 && (
                      <button
                        onClick={() => {
                          if (!v.contentMarkdown) return;
                          apiFetch(`/v1/organisations/${slug}/completed-work/${workId}/version`, {
                            method: "POST",
                            body: JSON.stringify({ contentMarkdown: v.contentMarkdown, changeNote: `Restored from version ${v.versionNumber}` }),
                          }).then(onAddVersion);
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-400 hover:bg-amber-900/20 ml-auto"
                      >
                        ↩ Restore
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Comments Tab ─────────────────────────────────────────────────────────────

function CommentsTab({
  comments, workId, slug, onAdded,
}: {
  comments: CommentRow[];
  workId: string;
  slug: string;
  onAdded: () => void;
}) {
  const [draft,      setDraft]   = useState("");
  const [sending,    setSend]    = useState(false);
  const [actingOn,   setActingOn]= useState<string | null>(null); // commentId being resolved/reopened
  const apiFetch = useAuthFetch();
  const qc       = useQueryClient();

  async function submit() {
    if (!draft.trim() || sending) return;
    setSend(true);
    try {
      const resp = await apiFetch(`/v1/organisations/${slug}/completed-work/${workId}/comment`, {
        method: "POST", body: JSON.stringify({ content: draft.trim() }),
      });
      if (!resp.ok) throw new Error("Failed to post comment");
      setDraft("");
      onAdded();
      qc.invalidateQueries({ queryKey: ["work-comments", workId] });
    } finally { setSend(false); }
  }

  async function handleResolve(commentId: string) {
    if (actingOn) return;
    setActingOn(commentId);
    try {
      const resp = await apiFetch(
        `/v1/organisations/${slug}/completed-work/${workId}/comment/${commentId}/resolve`,
        { method: "POST" },
      );
      if (!resp.ok) throw new Error("Failed to resolve comment");
      qc.invalidateQueries({ queryKey: ["work-comments", workId] });
      onAdded();
    } finally { setActingOn(null); }
  }

  async function handleReopen(commentId: string) {
    if (actingOn) return;
    setActingOn(commentId);
    try {
      const resp = await apiFetch(
        `/v1/organisations/${slug}/completed-work/${workId}/comment/${commentId}/reopen`,
        { method: "POST" },
      );
      if (!resp.ok) throw new Error("Failed to reopen comment");
      qc.invalidateQueries({ queryKey: ["work-comments", workId] });
      onAdded();
    } finally { setActingOn(null); }
  }

  const active    = comments.filter(c => c.status === "open" || c.status === "reopened");
  const resolvedC = comments.filter(c => c.status === "resolved");

  return (
    <div className="space-y-6">
      {/* Add comment */}
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
          placeholder="Add a comment… (⌘↵ to submit)"
          rows={3}
          className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50 resize-none mb-3"
        />
        <div className="flex items-center justify-between">
          <span className="text-[#64748B] text-xs">Markdown supported</span>
          <button
            onClick={submit}
            disabled={!draft.trim() || sending}
            className="px-4 py-1.5 text-sm rounded-lg bg-[#00D4FF] text-[#0B1829] font-semibold hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? "Sending…" : "Post Comment"}
          </button>
        </div>
      </div>

      {/* Active comments */}
      {active.length === 0 && resolvedC.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-3xl mb-3">💬</div>
          <p className="text-[#E2E8F0] font-medium mb-1">No comments yet</p>
          <p className="text-[#64748B] text-sm">Be the first to comment on this document</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-3">
              {active.map(c => (
                <div key={c.id} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-7 w-7 rounded-full bg-[#1E3A5F] flex items-center justify-center text-xs text-[#E2E8F0] shrink-0">
                        {c.authorUserId.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-[#64748B] text-xs">{timeAgo(c.createdAt)}</span>
                      {c.status === "reopened" && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-900/30 text-orange-300">Reopened</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleResolve(c.id)}
                      disabled={actingOn === c.id}
                      className="text-xs text-[#64748B] hover:text-emerald-400 shrink-0 disabled:opacity-40"
                    >
                      {actingOn === c.id ? "…" : "✓ Resolve"}
                    </button>
                  </div>
                  <p className="text-[#CBD5E1] text-sm leading-relaxed whitespace-pre-wrap">{c.content}</p>
                  {c.resolvedAt && (
                    <p className="text-[#64748B] text-xs mt-2">
                      Resolved by {c.resolvedByUserId?.slice(0, 8)}… · {fmtDate(c.resolvedAt)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {resolvedC.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-[#64748B] text-sm hover:text-[#E2E8F0] list-none flex items-center gap-2">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                {resolvedC.length} resolved comment{resolvedC.length !== 1 ? "s" : ""}
              </summary>
              <div className="mt-3 space-y-3 opacity-60">
                {resolvedC.map(c => (
                  <div key={c.id} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 text-xs">✓</span>
                        <span className="text-[#64748B] text-xs">{timeAgo(c.createdAt)}</span>
                        {c.resolvedAt && (
                          <span className="text-[#64748B] text-xs">
                            · resolved {fmtDate(c.resolvedAt)}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleReopen(c.id)}
                        disabled={actingOn === c.id}
                        className="text-xs text-[#64748B] hover:text-[#E2E8F0] disabled:opacity-40"
                      >
                        {actingOn === c.id ? "…" : "Reopen"}
                      </button>
                    </div>
                    <p className="text-[#64748B] text-sm line-through">{c.content}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// ─── Download Menu ────────────────────────────────────────────────────────────

function DownloadMenu({
  onDownload, exporting,
}: {
  onDownload: (format: "pdf" | "docx") => void;
  exporting: "pdf" | "docx" | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={!!exporting}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-[#1E3A5F] text-[#E2E8F0] hover:border-[#00D4FF]/30 hover:text-[#00D4FF] disabled:opacity-40 transition-colors"
      >
        {exporting ? "Exporting…" : "Download"} <span className="text-xs text-[#64748B]">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-[#112033] border border-[#1E3A5F] rounded-xl shadow-xl w-44 py-1">
          <button
            onClick={() => { setOpen(false); onDownload("pdf"); }}
            disabled={!!exporting}
            className="w-full text-left px-4 py-2.5 text-sm text-[#E2E8F0] hover:bg-[#1E3A5F]/40 disabled:opacity-40 flex items-center gap-2"
          >
            <span className="text-base">📄</span> PDF
          </button>
          <button
            onClick={() => { setOpen(false); onDownload("docx"); }}
            disabled={!!exporting}
            className="w-full text-left px-4 py-2.5 text-sm text-[#E2E8F0] hover:bg-[#1E3A5F]/40 disabled:opacity-40 flex items-center gap-2"
          >
            <span className="text-base">📝</span> Word (.docx)
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Viewer ──────────────────────────────────────────────────────────────

type Tab = "work" | "evidence" | "quality" | "details" | "inspector" | "versions" | "comments";

export default function CompletedWorkViewer() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [, setLocation] = useLocation();
  const apiFetch  = useAuthFetch();
  const qc        = useQueryClient();

  const [tab,          setTab]          = useState<Tab>("work");
  const [approvalModal,setApprovalModal]= useState<null | "approve"|"reject"|"request_changes">(null);
  const [promoteModal, setPromoteModal] = useState(false);
  const [toast,        setToast]        = useState<string|null>(null);
  const [printMode,    setPrintMode]    = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: workData, isLoading } = useQuery({
    queryKey: ["completed-work", id],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/completed-work/${id}`).then(r => r.json()),
    enabled: !!slug && !!id,
  });

  const { data: versionsData, refetch: refetchVersions } = useQuery({
    queryKey: ["work-versions", id],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/completed-work/${id}/versions`).then(r => r.json()),
    enabled: !!slug && !!id,
  });

  const { data: commentsData, refetch: refetchComments } = useQuery({
    queryKey: ["work-comments", id],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/completed-work/${id}/comments`).then(r => r.json()),
    enabled: !!slug && !!id,
  });

  const work     = workData?.completedWork as CompletedWorkItem | undefined;
  const assets   = (workData?.assets ?? []) as AssetRow[];
  const versions = (versionsData?.versions ?? []) as CompletedWorkVersion[];
  const comments = (commentsData?.comments ?? []) as CommentRow[];

  // ── Approved-version integrity (three-case resolver — mirrors server-side logic) ──
  //
  // CASE 1: Modern approved (approvedVersionId != null)
  //   Resolve the exact pinned version. If it cannot be found in the version list,
  //   hasBrokenPin = true → show integrity error state instead of any content.
  //   Never substitute versions[0] / latest / current for a broken modern pin.
  //
  // CASE 2: Legacy approved (approvedVersionId === null)
  //   LEGACY_APPROVAL_FALLBACK: created before this column existed.
  //   Fall back to versions[0]. Explicitly distinguishable from Case 1.
  //
  // CASE 3: Non-approved work
  //   Show versions[0] (current/latest). No pin applies.

  const hasBrokenPin: boolean = !!(
    work?.status === "approved"
    && work.approvedVersionId != null
    && versions.length > 0
    && !versions.find(v => v.id === work.approvedVersionId)
  );

  const approvedVersion: CompletedWorkVersion | undefined = (() => {
    if (!work || versions.length === 0) return undefined;
    if (work.status === "approved" && work.approvedVersionId != null) {
      // CASE 1: Modern approved record — resolve exactly or undefined (hasBrokenPin)
      return versions.find(v => v.id === work.approvedVersionId);
    }
    if (work.status === "approved" && work.approvedVersionId == null) {
      // CASE 2: LEGACY_APPROVAL_FALLBACK
      return versions[0];
    }
    // CASE 3: Non-approved work
    return versions[0];
  })();

  // True when a newer revision was added after approval (warn the user).
  // Only shown when the pin is valid (hasBrokenPin=false).
  const hasNewerRevision = !hasBrokenPin
    && work?.status === "approved"
    && !!approvedVersion
    && !!versions[0]
    && versions[0].id !== approvedVersion.id;

  // Normalise content format (JSON → human-readable markdown) before rendering.
  // The approved version's raw contentMarkdown may be structured JSON or fenced JSON —
  // normaliseCompletedWorkContent converts it to clean markdown for the viewer and exports.
  // This mirrors the server-side normalisation in completedWorkExportService.ts.
  const currentContent = normaliseCompletedWorkContent(approvedVersion?.contentMarkdown ?? "");

  // ── Mutations ──────────────────────────────────────────────────────────────

  const transition = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: any }) =>
      apiFetch(`/v1/organisations/${slug}/completed-work/${id}/${action}`, {
        method: "POST", body: body ? JSON.stringify(body) : undefined,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["completed-work", id] }); qc.invalidateQueries({ queryKey: ["completed-work-portal", slug] }); },
  });

  const promote = useMutation({
    mutationFn: (documentType: string) =>
      apiFetch(`/v1/organisations/${slug}/completed-work/${id}/promote`, {
        method: "POST", body: JSON.stringify({ documentType }),
      }),
    onSuccess: () => { showToast("Document promoted to Organisation Library"); setPromoteModal(false); },
  });

  // ── Approval handlers ──────────────────────────────────────────────────────

  async function handleApprovalConfirm(comment: string) {
    if (!approvalModal) return;
    if (approvalModal === "approve") {
      await transition.mutateAsync({ action: "approve" });
      if (comment) await apiFetch(`/v1/organisations/${slug}/completed-work/${id}/comment`, { method:"POST", body: JSON.stringify({ content: `Approval note: ${comment}` }) });
      showToast("Document approved");
    } else if (approvalModal === "reject") {
      await transition.mutateAsync({ action: "reject", body: { reason: comment } });
      showToast("Document rejected");
    } else {
      await transition.mutateAsync({ action: "reject", body: { reason: `Revision requested: ${comment}` } });
      showToast("Revision requested");
    }
    setApprovalModal(null);
    refetchComments();
  }

  // ── Download ───────────────────────────────────────────────────────────────

  function downloadMd() {
    if (!currentContent || !work) return;
    const blob = new Blob([`# ${work.title}\n\n${currentContent}`], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${work.title.replace(/[^a-z0-9]/gi,"_")}.md`; a.click();
    URL.revokeObjectURL(url);
  }

  const [exportingFmt, setExportingFmt] = useState<"pdf"|"docx"|null>(null);

  async function downloadExport(format: "pdf" | "docx") {
    if (exportingFmt || !work) return;
    setExportingFmt(format);
    try {
      const resp = await apiFetch(
        `/v1/organisations/${slug}/completed-work/${id}/export?format=${format}`,
      );
      if (!resp.ok) {
        showToast(`Export failed — please try again`);
        return;
      }
      const blob     = await resp.blob();
      const url      = URL.createObjectURL(blob);
      const filename = resp.headers.get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1]
        ?? `${work.title.replace(/[^a-z0-9]/gi, "_")}.${format}`;
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported as ${format.toUpperCase()}`);
    } catch {
      showToast("Export failed — please try again");
    } finally {
      setExportingFmt(null);
    }
  }

  // ── Status-aware action bar ────────────────────────────────────────────────

  function ActionBar() {
    if (!work) return null;
    const status = work.status;
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {status === "draft" && (
          <button
            onClick={() => transition.mutate({ action: "submit" })}
            className="px-3 py-1.5 text-sm rounded-lg bg-[#00D4FF] text-[#0B1829] font-semibold hover:bg-cyan-300"
          >
            Submit for Approval
          </button>
        )}
        {status === "awaiting_approval" && <>
          <button onClick={() => setApprovalModal("approve")}         className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium">Approve</button>
          <button onClick={() => setApprovalModal("request_changes")} className="px-3 py-1.5 text-sm rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-medium">Request Changes</button>
          <button onClick={() => setApprovalModal("reject")}          className="px-3 py-1.5 text-sm rounded-lg bg-red-800 hover:bg-red-700 text-white font-medium">Reject</button>
        </>}
        {status === "approved" && (
          <button onClick={() => setPromoteModal(true)} className="px-3 py-1.5 text-sm rounded-lg border border-[#00D4FF]/40 text-[#00D4FF] hover:bg-[#00D4FF]/10">
            📚 Promote to Library
          </button>
        )}
        {status === "rejected" && (
          <button onClick={() => transition.mutate({ action: "reopen" })} className="px-3 py-1.5 text-sm rounded-lg border border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0]">
            ↩ Reopen
          </button>
        )}
        {(status === "approved" || status === "draft") && currentContent && (
          <DownloadMenu onDownload={downloadExport} exporting={exportingFmt} />
        )}
        {status !== "archived" && (
          <button onClick={() => transition.mutate({ action: "archive" })} className="px-3 py-1.5 text-sm rounded-lg border border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0] ml-auto">
            Archive
          </button>
        )}
        <button onClick={() => setPrintMode(p => !p)} className="px-3 py-1.5 text-sm rounded-lg border border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0]">
          🖨 Print
        </button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
        <AppShell>
          <div className="min-h-full bg-[#0B1829] flex items-center justify-center">
            <div className="text-[#64748B] text-sm animate-pulse">Loading document…</div>
          </div>
        </AppShell>
      </Show>
    );
  }

  if (!work) {
    return (
      <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
        <AppShell>
          <div className="min-h-full bg-[#0B1829] flex flex-col items-center justify-center gap-4">
            <div className="text-4xl">📄</div>
            <p className="text-[#E2E8F0] font-medium">Document not found</p>
            <button onClick={() => setLocation(`/app/${slug}/work`)} className="text-[#00D4FF] text-sm hover:underline">← Back to Completed Work</button>
          </div>
        </AppShell>
      </Show>
    );
  }

  const badge = STATUS_BADGE[work.status] ?? STATUS_BADGE.draft;

  return (
    <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
      <AppShell>
        <div className={`min-h-full ${printMode ? "bg-white text-black" : "bg-[#0B1829] text-[#E2E8F0]"}`}>

          {/* ── Top bar ── */}
          <div className={`sticky top-0 z-20 ${printMode ? "hidden" : "bg-[#0A1628] border-b border-[#1E3A5F]"} px-6 py-3`}>
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-xs text-[#64748B] mb-2">
              <button onClick={() => setLocation(`/app/${slug}/work`)} className="hover:text-[#E2E8F0]">Completed Work</button>
              <span>/</span>
              <span className="text-[#E2E8F0] truncate max-w-xs">{work.title}</span>
            </div>

            {/* Title row */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl shrink-0">{specIcon(work.primarySpecialist)}</span>
                <div className="min-w-0">
                  <h1 className="text-[#E2E8F0] font-bold text-lg leading-tight truncate">{work.title}</h1>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.bg} ${badge.text}`}>{badge.label}</span>
                    <span className="text-[#64748B] text-xs">{specLabel(work.primarySpecialist)}</span>
                    {versions[0]?.qualityScore != null && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        (versions[0].qualityScore ?? 0) >= 80 ? "bg-emerald-900/40 text-emerald-300" :
                        (versions[0].qualityScore ?? 0) >= 70 ? "bg-amber-900/40 text-amber-300" :
                        "bg-red-900/40 text-red-300"
                      }`}>
                        Quality: {versions[0].qualityScore}/100
                      </span>
                    )}
                    <span className="text-[#64748B] text-xs">·</span>
                    <span className="text-[#64748B] text-xs">{fmtDate(work.updatedAt)}</span>
                    {versions.length > 0 && <span className="text-[#64748B] text-xs">· v{versions[0]?.versionNumber}</span>}
                  </div>
                </div>
              </div>
              <div className="shrink-0"><ActionBar /></div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 mt-3 overflow-x-auto">
              {(["work","evidence","quality","details","inspector","versions","comments"] as Tab[]).map(t => {
                const TAB_LABELS: Record<Tab, string> = {
                  work: "Work", evidence: "Evidence", quality: "Quality",
                  details: "Details", inspector: "🔍 Inspector",
                  versions: "Versions", comments: "Comments",
                };
                return (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`shrink-0 px-3 py-2 text-sm border-b-2 transition-colors ${
                      tab === t
                        ? "border-[#00D4FF] text-[#00D4FF]"
                        : "border-transparent text-[#64748B] hover:text-[#E2E8F0]"
                    }`}
                  >
                    {TAB_LABELS[t]}
                    {t === "comments" && comments.length  > 0 && <span className="ml-1 text-xs opacity-60">{comments.length}</span>}
                    {t === "evidence" && assets.length    > 0 && <span className="ml-1 text-xs opacity-60">{assets.length}</span>}
                    {t === "versions" && versions.length  > 0 && <span className="ml-1 text-xs opacity-60">{versions.length}</span>}
                    {t === "quality"  && versions[0]?.qualityScore != null && <span className="ml-1 text-xs opacity-60">{versions[0].qualityScore}/100</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Print header ── */}
          {printMode && (
            <div className="p-8 pb-4 border-b border-gray-200">
              <h1 className="text-2xl font-bold mb-1">{work.title}</h1>
              <p className="text-gray-500 text-sm">{specLabel(work.primarySpecialist)} · {fmtDate(work.updatedAt)} · {badge.label}</p>
              <button onClick={() => setPrintMode(false)} className="mt-3 text-blue-600 text-sm no-print">← Exit print mode</button>
            </div>
          )}

          {/* ── Content ── */}
          <div className={`flex gap-0 ${printMode ? "p-8" : "px-6 py-6"}`}>

            {/* Document outline (only in Work tab) */}
            {tab === "work" && !printMode && currentContent && (
              <div className="mr-6">
                <DocumentOutline content={currentContent} />
              </div>
            )}

            {/* Main panel */}
            <div className="flex-1 min-w-0 max-w-4xl">
              {tab === "work" && (
                <div>
                  {/* Integrity error — broken modern pin: refuse to show unapproved content */}
                  {hasBrokenPin && (
                    <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/20 border border-red-700/40 text-sm flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">🔒</span>
                      <span className="text-red-300">
                        <strong>Approved version cannot be resolved.</strong>{" "}
                        The version that was signed off is no longer accessible. Contact your platform administrator.
                        No content will be displayed to prevent misrepresentation of an unapproved document as approved.
                      </span>
                    </div>
                  )}
                  {/* Integrity banner — shown when a newer revision exists post-approval */}
                  {!hasBrokenPin && hasNewerRevision && (
                    <div className="mb-4 px-4 py-3 rounded-lg bg-amber-900/20 border border-amber-700/40 text-sm flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">⚠️</span>
                      <span className="text-amber-300">
                        You are viewing the{" "}
                        <strong>approved version (v{approvedVersion?.versionNumber})</strong>.
                        A newer revision exists —{" "}
                        <button
                          onClick={() => setTab("versions")}
                          className="underline hover:text-amber-200 transition-colors"
                        >
                          see Versions tab
                        </button>
                        . The approved version is the one exported to PDF and DOCX.
                      </span>
                    </div>
                  )}
                  {hasBrokenPin
                    ? null
                    : currentContent
                      ? <MarkdownRenderer content={currentContent} />
                      : <div className="flex flex-col items-center justify-center py-20 text-center">
                          <div className="text-4xl mb-4">📄</div>
                          <p className="text-[#E2E8F0] font-medium mb-1">No content yet</p>
                          <p className="text-[#64748B] text-sm">This document is still being produced by your AI Workforce</p>
                        </div>
                  }
                </div>
              )}
              {tab === "evidence" && <EvidenceTab assets={assets} />}
              {tab === "quality"  && (
                hasBrokenPin
                  ? <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="text-4xl mb-4">🔒</div>
                      <p className="text-[#E2E8F0] font-medium mb-1">Approved version cannot be resolved</p>
                      <p className="text-[#64748B] text-sm">Quality data cannot be displayed — the pinned approved version is no longer accessible</p>
                    </div>
                  : approvedVersion && (approvedVersion.reviewDimensions as any[]).length > 0
                    ? <QualityReviewSection
                        dimensions={approvedVersion.reviewDimensions as any[]}
                        qualityScore={approvedVersion.qualityScore ?? null}
                        isAutoRevision={approvedVersion.isAutoRevision === "true"}
                      />
                    : <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="text-4xl mb-4">📊</div>
                        <p className="text-[#E2E8F0] font-medium mb-1">No quality review data</p>
                        <p className="text-[#64748B] text-sm">Quality scores are recorded automatically when your AI Workforce produces work</p>
                      </div>
              )}
              {tab === "details"  && <ExecutionTab work={work} versions={versions} />}
              {tab === "inspector" && (
                <ExecutionInspectorPanel slug={slug!} completedWorkId={id!} />
              )}
              {tab === "versions"  && (
                <VersionsTab
                  versions={versions}
                  workId={id!}
                  slug={slug!}
                  onAddVersion={() => { refetchVersions(); qc.invalidateQueries({ queryKey: ["completed-work", id] }); }}
                  onExport={downloadExport}
                />
              )}
              {tab === "comments"  && (
                <CommentsTab
                  comments={comments}
                  workId={id!}
                  slug={slug!}
                  onAdded={refetchComments}
                />
              )}
            </div>
          </div>

          {/* ── Modals ── */}
          {approvalModal && (
            <ApprovalModal
              action={approvalModal}
              onConfirm={handleApprovalConfirm}
              onClose={() => setApprovalModal(null)}
            />
          )}
          {promoteModal && (
            <PromoteModal
              work={work}
              onConfirm={docType => promote.mutate(docType)}
              onClose={() => setPromoteModal(false)}
            />
          )}

          {/* ── Toast ── */}
          {toast && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#112033] border border-[#00D4FF]/30 text-[#E2E8F0] text-sm px-5 py-3 rounded-xl shadow-lg">
              ✓ {toast}
            </div>
          )}
        </div>
      </AppShell>
    </Show>
  );
}
