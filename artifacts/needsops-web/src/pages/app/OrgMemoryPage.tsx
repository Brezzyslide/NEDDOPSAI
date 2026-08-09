/**
 * Memory Governance — /app/:slug/memory
 *
 * Sprint 24 rewrite. Full dark-theme, governance-grade experience.
 *
 * Displays: approved · pending · superseded · archived (rejected) memories
 *
 * Supports:
 *   - Approve / Reject pending entries
 *   - Pin / Unpin approved entries (importance 10 = pinned)
 *   - Edit metadata (title, content, type, importance, confidence)
 *   - Retire (supersede) an entry
 *   - View provenance (source type, source ID)
 *   - View related audit / version context
 *   - Propose new memory (carried over from Sprint 9.2)
 *   - Compare superseded vs. replacement
 */

import { useState, useMemo }      from "react";
import { useParams, useLocation } from "wouter";
import {
  useQuery, useMutation, useQueryClient,
}                                 from "@tanstack/react-query";
import { Show }                   from "@clerk/react";
import { Redirect }               from "wouter";
import AppShell                   from "@/components/layout/AppShell";
import { useAuthFetch }           from "@/lib/api";
import { useOrgRole }             from "@/hooks/useOrgRole";
import { MemoryAuditPanel }       from "@/components/governance/MemoryAuditPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type MemoryStatus = "proposed" | "approved" | "rejected" | "superseded" | "expired";
type MemoryType   =
  | "organisation_profile" | "operating_preference" | "terminology"
  | "approval_rule"        | "reporting_line"        | "system_information"
  | "workflow"             | "policy_reference"       | "customer_preference"
  | "risk_constraint"      | "compliance_context"     | "other";

interface OrgMemoryItem {
  id: string; memoryType: MemoryType; title: string; content: string;
  status: MemoryStatus; confidence: number; importance: number;
  sourceType: string; sourceId?: string; createdAt: string;
  approvedBy?: string; approvedAt?: string;
  structuredContent?: Record<string, any>;
}

const STATUS_META: Record<MemoryStatus, { label: string; dot: string; cls: string }> = {
  proposed:   { label: "Pending review", dot: "bg-amber-400",  cls: "bg-amber-900/30 text-amber-400" },
  approved:   { label: "Approved",       dot: "bg-emerald-400",cls: "bg-emerald-900/30 text-emerald-400" },
  rejected:   { label: "Archived",       dot: "bg-red-400",    cls: "bg-red-900/20 text-red-400" },
  superseded: { label: "Superseded",     dot: "bg-slate-500",  cls: "bg-[#1E3A5F] text-[#64748B]" },
  expired:    { label: "Expired",        dot: "bg-slate-600",  cls: "bg-[#1E3A5F] text-[#64748B]" },
};

const TYPE_LABELS: Record<MemoryType, string> = {
  organisation_profile: "Profile",     operating_preference:"Preference",
  terminology:          "Terminology", approval_rule:       "Approval Rule",
  reporting_line:       "Reporting",   system_information:  "System Info",
  workflow:             "Workflow",    policy_reference:    "Policy",
  customer_preference:  "Participant", risk_constraint:     "Risk",
  compliance_context:   "Compliance",  other:               "Other",
};

const ALL_TYPES: MemoryType[] = [
  "organisation_profile","operating_preference","terminology","approval_rule",
  "reporting_line","system_information","workflow","policy_reference",
  "customer_preference","risk_constraint","compliance_context","other",
];

const TABS: { key: MemoryStatus | "all"; label: string }[] = [
  { key: "proposed",   label: "Pending" },
  { key: "approved",   label: "Approved" },
  { key: "superseded", label: "Superseded" },
  { key: "rejected",   label: "Archived" },
  { key: "all",        label: "All" },
];

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({
  item, onClose, onSave, isPending,
}: {
  item: OrgMemoryItem;
  onClose: () => void;
  onSave: (updates: Partial<OrgMemoryItem>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    title:      item.title,
    content:    item.content,
    memoryType: item.memoryType,
    importance: item.importance,
    confidence: item.confidence,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
        <div className="px-6 pt-6 pb-4 border-b border-[#1E3A5F]">
          <h2 className="text-[#E2E8F0] font-semibold">Edit memory entry</h2>
          <p className="text-[#64748B] text-xs mt-0.5">Changes take effect immediately for approved entries.</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="text-[#64748B] text-xs mb-1.5 block">Type</label>
            <select value={form.memoryType} onChange={e => setForm(f => ({ ...f, memoryType: e.target.value as MemoryType }))}
              className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50">
              {ALL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[#64748B] text-xs mb-1.5 block">Title</label>
            <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50" />
          </div>
          <div>
            <label className="text-[#64748B] text-xs mb-1.5 block">Content</label>
            <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              rows={5} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] resize-none focus:outline-none focus:border-[#00D4FF]/50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#64748B] text-xs mb-1.5 block">Importance (1–10)</label>
              <input type="number" min={1} max={10} value={form.importance}
                onChange={e => setForm(f => ({ ...f, importance: parseInt(e.target.value) || 5 }))}
                className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50" />
            </div>
            <div>
              <label className="text-[#64748B] text-xs mb-1.5 block">Confidence (0–1)</label>
              <input type="number" min={0} max={1} step={0.05} value={form.confidence}
                onChange={e => setForm(f => ({ ...f, confidence: parseFloat(e.target.value) || 0.8 }))}
                className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#1E3A5F]">
          <button onClick={onClose} disabled={isPending}
            className="px-4 py-2 border border-[#1E3A5F] text-[#64748B] text-sm rounded-lg hover:text-[#E2E8F0] transition-colors">
            Cancel
          </button>
          <button onClick={() => onSave(form)} disabled={isPending || !form.title.trim() || !form.content.trim()}
            className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] text-sm font-semibold rounded-lg hover:bg-[#00B8D9] disabled:opacity-50 transition-colors">
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Propose modal ────────────────────────────────────────────────────────────

function ProposeModal({ onClose, onSubmit, isPending, error }: {
  onClose: () => void;
  onSubmit: (f: { title: string; content: string; memoryType: MemoryType; importance: number; confidence: number }) => void;
  isPending: boolean; error: string | null;
}) {
  const [form, setForm] = useState({
    title: "", content: "", memoryType: "policy_reference" as MemoryType,
    importance: 8, confidence: 0.9,
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
        <div className="px-6 pt-6 pb-4 border-b border-[#1E3A5F]">
          <h2 className="text-[#E2E8F0] font-semibold">Add memory entry</h2>
          <p className="text-[#64748B] text-xs mt-0.5">Approved entries are used by the Chief of Staff in every conversation.</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 text-xs text-red-400">{error}</div>
          )}
          <div>
            <label className="text-[#64748B] text-xs mb-1.5 block">Type</label>
            <select value={form.memoryType} onChange={e => setForm(f => ({ ...f, memoryType: e.target.value as MemoryType }))}
              className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50">
              {ALL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[#64748B] text-xs mb-1.5 block">Title <span className="text-red-400">*</span></label>
            <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. NDIS Restrictive Practices Policy"
              className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50" />
          </div>
          <div>
            <label className="text-[#64748B] text-xs mb-1.5 block">Content <span className="text-red-400">*</span></label>
            <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              rows={4} placeholder="Describe how the Chief of Staff should interpret and apply this memory…"
              className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] placeholder-[#64748B] resize-none focus:outline-none focus:border-[#00D4FF]/50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#64748B] text-xs mb-1.5 block">Importance (1–10)</label>
              <input type="number" min={1} max={10} value={form.importance}
                onChange={e => setForm(f => ({ ...f, importance: parseInt(e.target.value) || 5 }))}
                className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50" />
            </div>
            <div>
              <label className="text-[#64748B] text-xs mb-1.5 block">Confidence (0–1)</label>
              <input type="number" min={0} max={1} step={0.1} value={form.confidence}
                onChange={e => setForm(f => ({ ...f, confidence: parseFloat(e.target.value) || 0.8 }))}
                className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#1E3A5F]">
          <button onClick={onClose} disabled={isPending}
            className="px-4 py-2 border border-[#1E3A5F] text-[#64748B] text-sm rounded-lg hover:text-[#E2E8F0]">Cancel</button>
          <button onClick={() => onSubmit(form)}
            disabled={isPending || !form.title.trim() || !form.content.trim()}
            className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] text-sm font-semibold rounded-lg hover:bg-[#00B8D9] disabled:opacity-50 transition-colors">
            {isPending ? "Submitting…" : "Submit for review"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Memory card ──────────────────────────────────────────────────────────────

function MemoryCard({ item, onApprove, onReject, onPin, onEdit, onRetire, onMerge, onAudit, approving, rejecting, canApprove }: {
  item: OrgMemoryItem;
  onApprove?: () => void; onReject?: () => void;
  onPin?: () => void; onEdit?: () => void; onRetire?: () => void;
  onMerge?: () => void; onAudit?: () => void;
  approving?: boolean; rejecting?: boolean;
  canApprove?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta    = STATUS_META[item.status];
  const isPinned = item.importance >= 10;

  return (
    <div className={`bg-[#112033] border rounded-xl transition-all ${
      item.status === "proposed" ? "border-amber-900/40" :
      isPinned ? "border-[#00D4FF]/30" : "border-[#1E3A5F]"
    }`}>
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {isPinned && item.status === "approved" && (
                  <span className="text-[10px] font-semibold text-[#00D4FF] bg-[#00D4FF]/10 px-2 py-0.5 rounded-full">📌 Pinned</span>
                )}
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>
                  {meta.label}
                </span>
                <span className="text-[10px] text-[#64748B] bg-[#0B1829] border border-[#1E3A5F] px-2 py-0.5 rounded-full">
                  {TYPE_LABELS[item.memoryType]}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-[#64748B]">
                  Importance {item.importance}/10
                </span>
                <span className={`text-xs font-medium ${item.confidence >= 0.8 ? "text-emerald-400" : item.confidence >= 0.6 ? "text-amber-400" : "text-red-400"}`}>
                  {Math.round(item.confidence * 100)}%
                </span>
              </div>
            </div>

            <h3 className="text-[#E2E8F0] font-medium text-sm mb-1">{item.title}</h3>
            <p className={`text-[#64748B] text-xs leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
              {item.content}
            </p>

            {/* Provenance */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-[#64748B]/60 text-xs">
                {item.sourceType === "ai_proposed" ? "Proposed by AI" :
                 item.sourceType === "knowledge_source" ? "📎 Library policy" :
                 item.sourceType === "manual" ? "Manual entry" : item.sourceType}
              </span>
              {item.approvedBy && (
                <>
                  <span className="text-[#1E3A5F]">·</span>
                  <span className="text-[#64748B]/60 text-xs">
                    Approved {new Date(item.approvedAt ?? item.createdAt).toLocaleDateString("en-AU")}
                  </span>
                </>
              )}
              <span className="text-[#1E3A5F]">·</span>
              <span className="text-[#64748B]/60 text-xs">
                {new Date(item.createdAt).toLocaleDateString("en-AU")}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#1E3A5F] flex-wrap">
          {item.status === "proposed" && (
            canApprove ? (
              <>
                <button onClick={onApprove} disabled={approving}
                  className="px-3 py-1.5 bg-emerald-900/30 border border-emerald-700/40 text-emerald-400 text-xs rounded-lg hover:bg-emerald-900/50 disabled:opacity-50 transition-colors font-medium">
                  {approving ? "…" : "✓ Approve"}
                </button>
                <button onClick={onReject} disabled={rejecting}
                  className="px-3 py-1.5 bg-red-900/20 border border-red-800/40 text-red-400 text-xs rounded-lg hover:bg-red-900/40 disabled:opacity-50 transition-colors font-medium">
                  {rejecting ? "…" : "✗ Archive"}
                </button>
              </>
            ) : (
              <span className="text-[#64748B] text-xs italic">Pending admin review</span>
            )
          )}
          {item.status === "approved" && (
            <>
              <button onClick={onPin}
                className={`px-3 py-1.5 border text-xs rounded-lg transition-colors ${
                  isPinned
                    ? "border-[#00D4FF]/40 text-[#00D4FF] hover:bg-[#00D4FF]/10"
                    : "border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0]"
                }`}>
                {isPinned ? "📌 Pinned" : "📌 Pin"}
              </button>
              <button onClick={onEdit}
                className="px-3 py-1.5 border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-[#E2E8F0] transition-colors">
                Edit
              </button>
              {onMerge && (
                <button onClick={onMerge}
                  className="px-3 py-1.5 border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-purple-400 transition-colors">
                  🔀 Merge
                </button>
              )}
              <button onClick={onRetire}
                className="px-3 py-1.5 border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-red-400 transition-colors">
                Retire
              </button>
            </>
          )}
          {(item.status === "superseded" || item.status === "rejected") && onEdit && (
            <button onClick={onEdit}
              className="px-3 py-1.5 border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-[#E2E8F0] transition-colors">
              View / Edit
            </button>
          )}
          {onAudit && (
            <button onClick={onAudit}
              className="px-3 py-1.5 border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-[#00D4FF] transition-colors">
              📋 History
            </button>
          )}
          <button onClick={() => setExpanded(e => !e)}
            className="ml-auto text-[#64748B] text-xs hover:text-[#E2E8F0] transition-colors">
            {expanded ? "Less ▲" : "More ▼"}
          </button>
        </div>

        {/* Expanded provenance */}
        {expanded && (
          <div className="mt-4 pt-3 border-t border-[#1E3A5F] space-y-2">
            {[
              ["ID",          item.id],
              ["Source type", item.sourceType],
              ["Source ID",   item.sourceId ?? "—"],
              ["Importance",  `${item.importance} / 10`],
              ["Confidence",  `${Math.round(item.confidence * 100)}%`],
              ["Created",     new Date(item.createdAt).toLocaleString("en-AU")],
              ["Approved by", item.approvedBy ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-start gap-3">
                <span className="text-[#64748B] text-xs w-28 shrink-0">{k}</span>
                <span className="text-[#94A3B8] text-xs font-mono">{v}</span>
              </div>
            ))}
            {item.structuredContent && Object.keys(item.structuredContent).length > 0 && (
              <>
                <div className="border-t border-[#1E3A5F] my-2" />
                <p className="text-[#64748B] text-xs uppercase tracking-widest font-semibold">AI reasoning</p>
                {Object.entries(item.structuredContent).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-3">
                    <span className="text-[#64748B] text-xs w-28 shrink-0 capitalize">{k.replace(/_/g, " ")}</span>
                    <span className="text-[#94A3B8] text-xs">{Array.isArray(v) ? v.join(", ") : String(v)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OrgMemoryPage() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();
  const qc              = useQueryClient();

  const [activeTab,  setActiveTab]  = useState<MemoryStatus | "all">("proposed");
  const [typeFilter, setTypeFilter] = useState<MemoryType | "">("");
  const [search,     setSearch]     = useState("");
  const [showPropose, setShowPropose] = useState(false);
  const [editItem,      setEditItem]      = useState<OrgMemoryItem | null>(null);
  const [proposeError,  setProposeError]  = useState<string | null>(null);
  const [approvingId,   setApprovingId]   = useState<string | null>(null);
  const [rejectingId,   setRejectingId]   = useState<string | null>(null);
  const [mergeTarget,   setMergeTarget]   = useState<OrgMemoryItem | null>(null); // target (survivor)
  const [auditItem,     setAuditItem]     = useState<OrgMemoryItem | null>(null);

  const statusParam = activeTab === "all" ? undefined : activeTab;

  const { data, isLoading } = useQuery({
    queryKey: ["org-memory-gov", slug, activeTab, typeFilter],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (statusParam) p.set("status", statusParam);
      if (typeFilter)  p.set("memoryType", typeFilter);
      p.set("limit", "100");
      return apiFetch(`/v1/organisations/${slug}/memory?${p}`).then(r => r.json());
    },
    enabled: !!slug, staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["org-memory-gov", slug] });

  const approve = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/organisations/${slug}/memory/${id}/approve`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/organisations/${slug}/memory/${id}/reject`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const patch = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<OrgMemoryItem> }) =>
      apiFetch(`/v1/organisations/${slug}/memory/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      }),
    onSuccess: () => { setEditItem(null); invalidate(); },
  });

  const pin = useMutation({
    mutationFn: ({ id, importance }: { id: string; importance: number }) =>
      apiFetch(`/v1/organisations/${slug}/memory/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ importance }),
      }),
    onSuccess: invalidate,
  });

  // Sprint 29M Part I: "Retire" archives the entry (marks it rejected/archived).
  // Previously called the /supersede endpoint with the same ID (self-reference —
  // correctly rejected by the server with 400). Retire = archive, not supersede-with-self.
  const retire = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/organisations/${slug}/memory/${id}/reject`, {
        method: "POST",
      }),
    onSuccess: invalidate,
  });

  // Sprint 29: merge two memory records (sourceId absorbed into targetId)
  const merge = useMutation({
    mutationFn: async ({ targetId, sourceId }: { targetId: string; sourceId: string }) => {
      const res = await apiFetch(`/v1/organisations/${slug}/memory/${targetId}/merge`, {
        method: "POST",
        body: JSON.stringify({ sourceId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? "Merge failed");
      }
      return res.json();
    },
    onSuccess: () => { setMergeTarget(null); invalidate(); },
  });

  const propose = useMutation({
    mutationFn: async (f: { title: string; content: string; memoryType: MemoryType; importance: number; confidence: number }) => {
      setProposeError(null);
      const res = await apiFetch(`/v1/organisations/${slug}/memory`, {
        method: "POST",
        body: JSON.stringify({ ...f, sourceType: "manual" }),
      });
      if (!res.ok) {
        let msg = "Submission failed.";
        try { const b = await res.json(); msg = b?.error?.message ?? b?.error ?? msg; } catch {}
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: () => { setShowPropose(false); invalidate(); },
    onError: (e: Error) => setProposeError(e.message),
  });

  // Sprint 29N.10: action controls gated to org owners/administrators
  const { canApprove } = useOrgRole(slug);

  const items: OrgMemoryItem[] = data?.items ?? [];

  const filtered = useMemo(() => items.filter(item => {
    if (search) {
      const q = search.toLowerCase();
      if (!item.title.toLowerCase().includes(q) && !item.content.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [items, search]);

  // Tab counts from current data
  const pendingCount = items.filter(i => i.status === "proposed").length;

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-4xl mx-auto">

          {/* Header */}
          <div className="mb-7 flex items-start justify-between gap-4">
            <div>
              <button onClick={() => setLocation(`/app/${slug}/governance`)} className="text-[#64748B] text-xs hover:text-[#E2E8F0] mb-2 block">← Governance Centre</button>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Memory Governance</h1>
              <p className="text-[#64748B] text-sm mt-1">
                What your Chief of Staff remembers about your organisation
                {pendingCount > 0 && <span className="ml-2 text-amber-400">· {pendingCount} pending review</span>}
              </p>
            </div>
            {canApprove && (
              <button onClick={() => { setProposeError(null); setShowPropose(true); }}
                className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] text-sm font-semibold rounded-lg hover:bg-[#00B8D9] transition-colors shrink-0">
                + Add Memory
              </button>
            )}
          </div>

          {/* Tabs + filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <div className="flex items-center gap-0.5 p-1 bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-x-auto">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === t.key ? "bg-[#00D4FF]/10 text-[#00D4FF]" : "text-[#64748B] hover:text-[#E2E8F0]"
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-xs">🔍</span>
              <input type="text" placeholder="Search memory…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#112033] border border-[#1E3A5F] rounded-lg pl-8 pr-4 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50" />
            </div>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)}
              className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50 shrink-0">
              <option value="">All types</option>
              {ALL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 animate-pulse h-24" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-14 text-center">
              <p className="text-3xl mb-3 opacity-30">💡</p>
              <p className="text-[#E2E8F0] font-medium mb-1">
                {activeTab === "proposed" ? "No pending memory items" : "No entries found"}
              </p>
              <p className="text-[#64748B] text-sm">
                {activeTab === "proposed"
                  ? "The Chief of Staff will propose entries as conversations progress."
                  : "Try a different filter or search term."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(item => (
                <MemoryCard
                  key={item.id}
                  item={item}
                  approving={approvingId === item.id}
                  rejecting={rejectingId === item.id}
                  canApprove={canApprove}
                  onApprove={() => { setApprovingId(item.id); approve.mutate(item.id, { onSettled: () => setApprovingId(null) }); }}
                  onReject={() => { setRejectingId(item.id); reject.mutate(item.id, { onSettled: () => setRejectingId(null) }); }}
                  onPin={() => pin.mutate({ id: item.id, importance: item.importance >= 10 ? 8 : 10 })}
                  onEdit={() => setEditItem(item)}
                  onRetire={() => { if (confirm("Retire this memory entry? It will be marked as superseded.")) retire.mutate(item.id); }}
                  onMerge={item.status === "approved" ? () => setMergeTarget(item) : undefined}
                  onAudit={() => setAuditItem(item)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Edit modal */}
        {editItem && (
          <EditModal
            item={editItem}
            onClose={() => setEditItem(null)}
            onSave={updates => patch.mutate({ id: editItem.id, updates })}
            isPending={patch.isPending}
          />
        )}

        {/* Propose modal */}
        {showPropose && (
          <ProposeModal
            onClose={() => setShowPropose(false)}
            onSubmit={f => propose.mutate(f)}
            isPending={propose.isPending}
            error={proposeError}
          />
        )}

        {/* Sprint 29: Memory merge modal */}
        {mergeTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl w-full max-w-lg shadow-2xl">
              <div className="p-5 border-b border-[#1E3A5F]">
                <p className="text-[#E2E8F0] font-semibold">Merge Memory Entry</p>
                <p className="text-[#64748B] text-xs mt-1">
                  Select the memory entry to absorb into <span className="text-[#E2E8F0]">&ldquo;{mergeTarget.title}&rdquo;</span>.
                  The absorbed entry will be marked as superseded.
                </p>
              </div>
              <div className="p-5 space-y-3 max-h-80 overflow-y-auto">
                {items
                  .filter(i => i.id !== mergeTarget.id && i.status === "approved")
                  .map(i => (
                    <button
                      key={i.id}
                      disabled={merge.isPending}
                      onClick={() => merge.mutate({ targetId: mergeTarget.id, sourceId: i.id })}
                      className="w-full text-left bg-[#0B1829] border border-[#1E3A5F] rounded-xl p-3 hover:border-purple-500/40 transition-colors disabled:opacity-50"
                    >
                      <p className="text-[#E2E8F0] text-xs font-medium">{i.title}</p>
                      <p className="text-[#64748B] text-xs mt-0.5 line-clamp-1">{i.content}</p>
                    </button>
                  ))
                }
                {items.filter(i => i.id !== mergeTarget.id && i.status === "approved").length === 0 && (
                  <p className="text-[#64748B] text-sm text-center py-4">No other approved entries to merge.</p>
                )}
              </div>
              <div className="p-5 pt-0 flex justify-end">
                <button onClick={() => setMergeTarget(null)}
                  className="px-4 py-2 border border-[#1E3A5F] text-[#94A3B8] text-sm rounded-lg hover:text-[#E2E8F0] transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sprint 29: Memory audit history panel */}
        {auditItem && slug && (
          <MemoryAuditPanel
            memoryId={auditItem.id}
            orgSlug={slug}
            memoryTitle={auditItem.title}
            onClose={() => setAuditItem(null)}
          />
        )}
      </AppShell>
    </>
  );
}
