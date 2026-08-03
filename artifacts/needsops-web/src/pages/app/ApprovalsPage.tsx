/**
 * Unified Approval Centre — /app/:slug/approvals
 *
 * Sprint 24. Aggregates every pending approval type into one experience:
 *   • Knowledge proposals  (curation proposals API)
 *   • Memory proposals     (org memory API, status=proposed)
 *   • Library reviews      (knowledge sources, status=review_required)
 *   • Completed work       (completed-work API, status=awaiting_approval)
 *   • System approvals     (approvals API, state=pending)
 *
 * Supports: approve · reject · request changes (comment) · bulk actions ·
 *            filter by type · search · sort by date/priority
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ApprovalCategory = "knowledge" | "memory" | "library" | "work" | "system";

interface UnifiedItem {
  id:          string;
  category:    ApprovalCategory;
  title:       string;
  description: string;
  detail:      Record<string, string | number | string[]>;
  timestamp:   string;
  priority:    "high" | "normal";
  raw:         any;
}

const CATEGORY_META: Record<ApprovalCategory, { icon: string; label: string; colour: string }> = {
  knowledge: { icon: "🧠", label: "Knowledge",       colour: "text-cyan-400" },
  memory:    { icon: "💡", label: "Memory",           colour: "text-purple-400" },
  library:   { icon: "📚", label: "Library Review",  colour: "text-blue-400" },
  work:      { icon: "📋", label: "Completed Work",  colour: "text-emerald-400" },
  system:    { icon: "✅", label: "System Approval", colour: "text-amber-400" },
};

const CATEGORY_FILTERS: { key: ApprovalCategory | "all"; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "knowledge", label: "Knowledge" },
  { key: "memory",    label: "Memory" },
  { key: "library",   label: "Library" },
  { key: "work",      label: "Work" },
  { key: "system",    label: "System" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ConfidencePip({ value }: { value: number }) {
  const pct = Math.round(value <= 1 ? value * 100 : value);
  const cls = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";
  return <span className={`text-xs font-medium ${cls}`}>{pct}% confidence</span>;
}

// ─── Action modal ─────────────────────────────────────────────────────────────

function ActionModal({
  item, action, onClose, onConfirm, isPending,
}: {
  item: UnifiedItem;
  action: "approve" | "reject" | "request_changes";
  onClose: () => void;
  onConfirm: (comment: string) => void;
  isPending: boolean;
}) {
  const [comment, setComment] = useState("");
  const needsComment = action === "reject" || action === "request_changes";

  const labels = {
    approve:         { title: "Confirm approval", btn: "Approve", cls: "bg-emerald-600 hover:bg-emerald-500 text-white" },
    reject:          { title: "Reject with reason", btn: "Reject", cls: "bg-red-800/60 hover:bg-red-700/60 text-red-300" },
    request_changes: { title: "Request changes", btn: "Send request", cls: "bg-amber-700/60 hover:bg-amber-600/60 text-amber-200" },
  };
  const l = labels[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-[#1E3A5F]">
          <p className="text-[#E2E8F0] font-semibold">{l.title}</p>
          <p className="text-[#64748B] text-sm mt-0.5 truncate">{item.title}</p>
        </div>
        <div className="p-5">
          {needsComment ? (
            <div>
              <label className="text-[#64748B] text-xs mb-1.5 block">
                {action === "reject" ? "Reason for rejection" : "What changes are needed?"}{" "}
                <span className="text-red-400">*</span>
              </label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={3}
                placeholder={action === "reject" ? "Explain why this is being rejected…" : "Describe the changes needed before this can be approved…"}
                className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50 resize-none"
              />
            </div>
          ) : (
            <div>
              <label className="text-[#64748B] text-xs mb-1.5 block">Notes for the audit trail (optional)</label>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={2}
                placeholder="Add context for the audit record…"
                className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50 resize-none"
              />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-5 pb-5">
          <button onClick={onClose} disabled={isPending}
            className="px-4 py-2 border border-[#1E3A5F] text-[#64748B] text-sm rounded-lg hover:text-[#E2E8F0] transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(comment)}
            disabled={isPending || (needsComment && !comment.trim())}
            className={`px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors ${l.cls}`}
          >
            {isPending ? "Saving…" : l.btn}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Item card ────────────────────────────────────────────────────────────────

function ItemCard({
  item, selected, onSelect, onAction, bulkMode,
}: {
  item: UnifiedItem;
  selected: boolean;
  onSelect: () => void;
  onAction: (action: "approve" | "reject" | "request_changes") => void;
  bulkMode: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = CATEGORY_META[item.category];

  return (
    <div className={`bg-[#112033] border rounded-xl transition-all ${
      selected ? "border-[#00D4FF]/50" : item.priority === "high" ? "border-amber-900/40" : "border-[#1E3A5F]"
    }`}>
      <div className="p-5">
        <div className="flex items-start gap-4">
          {bulkMode && (
            <button onClick={onSelect}
              className={`shrink-0 mt-0.5 h-4 w-4 rounded border transition-colors ${
                selected ? "bg-[#00D4FF] border-[#00D4FF]" : "bg-transparent border-[#1E3A5F] hover:border-[#00D4FF]/50"
              }`}>
              {selected && <span className="flex items-center justify-center text-[#0B1829] text-xs leading-none font-bold">✓</span>}
            </button>
          )}

          <div className="shrink-0 h-9 w-9 rounded-lg bg-[#0B1829] border border-[#1E3A5F] flex items-center justify-center text-base">
            {meta.icon}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-[#E2E8F0] text-sm font-medium">{item.title}</p>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[10px] font-semibold ${meta.colour}`}>{meta.label}</span>
                <span className="text-[#64748B] text-xs">{timeAgo(item.timestamp)}</span>
              </div>
            </div>
            <p className="text-[#64748B] text-xs leading-relaxed line-clamp-2">{item.description}</p>

            {/* Inline detail chips */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {item.detail.confidence !== undefined && (
                <ConfidencePip value={item.detail.confidence as number} />
              )}
              {item.detail.type && (
                <span className="text-xs text-[#64748B] bg-[#0B1829] px-2 py-0.5 rounded-full border border-[#1E3A5F]">
                  {String(item.detail.type).replace(/_/g, " ")}
                </span>
              )}
              {item.detail.specialist && (
                <span className="text-xs text-[#64748B]">
                  via {String(item.detail.specialist).replace(/_/g, " ")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions row */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#1E3A5F]">
          <button onClick={() => onAction("approve")}
            className="px-3 py-1.5 bg-emerald-900/30 border border-emerald-700/40 text-emerald-400 text-xs rounded-lg hover:bg-emerald-900/50 transition-colors font-medium">
            ✓ Approve
          </button>
          <button onClick={() => onAction("reject")}
            className="px-3 py-1.5 bg-red-900/20 border border-red-800/40 text-red-400 text-xs rounded-lg hover:bg-red-900/40 transition-colors font-medium">
            ✗ Reject
          </button>
          <button onClick={() => onAction("request_changes")}
            className="px-3 py-1.5 bg-[#0B1829] border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-[#E2E8F0] transition-colors">
            Request changes
          </button>
          <button onClick={() => setExpanded(e => !e)}
            className="ml-auto px-3 py-1.5 text-[#64748B] text-xs hover:text-[#E2E8F0] transition-colors">
            {expanded ? "Less ▲" : "Details ▼"}
          </button>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-4 pt-3 border-t border-[#1E3A5F] space-y-2">
            {Object.entries(item.detail).map(([k, v]) => (
              <div key={k} className="flex items-start gap-3">
                <span className="text-[#64748B] text-xs w-36 shrink-0 capitalize">
                  {k.replace(/_/g, " ")}
                </span>
                <span className="text-[#94A3B8] text-xs">
                  {Array.isArray(v) ? v.join(", ") || "—" : String(v) || "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();
  const qc              = useQueryClient();

  const [categoryFilter, setCategoryFilter] = useState<ApprovalCategory | "all">("all");
  const [search,         setSearch]         = useState("");
  const [sortBy,         setSortBy]         = useState<"date" | "priority">("priority");
  const [bulkMode,       setBulkMode]       = useState(false);
  const [selected,       setSelected]       = useState<Set<string>>(new Set());
  const [modal,          setModal]          = useState<{ item: UnifiedItem; action: "approve" | "reject" | "request_changes" } | null>(null);

  // ── Data queries ────────────────────────────────────────────────────────────
  const { data: proposalsData } = useQuery({
    queryKey: ["proposals-approvals", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/knowledge/curation/proposals?status=proposed&limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 30_000,
  });

  const { data: memoryData } = useQuery({
    queryKey: ["memory-approvals", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/memory?status=proposed&limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 30_000,
  });

  const { data: sourcesData } = useQuery({
    queryKey: ["sources-review", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/knowledge/sources?status=review_required&limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 60_000,
  });

  const { data: completedWorkData } = useQuery({
    queryKey: ["work-approvals", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/completed-work?limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 30_000,
  });

  const { data: systemApprovalsData } = useQuery({
    queryKey: ["system-approvals", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/approvals?state=pending`).then(r => r.json()),
    enabled: !!slug, staleTime: 30_000,
  });

  // ── Build unified list ───────────────────────────────────────────────────────
  const allItems = useMemo<UnifiedItem[]>(() => {
    const items: UnifiedItem[] = [];

    // Knowledge proposals
    for (const p of (proposalsData?.proposals ?? [])) {
      items.push({
        id: `knowledge-${p.id}`, category: "knowledge",
        title: p.title ?? "Untitled knowledge update",
        description: p.rationale ?? p.content ?? "AI-proposed knowledge update awaiting your review.",
        detail: {
          type:              p.memoryType ?? "knowledge",
          confidence:        p.confidence ?? 0,
          section:           p.section ?? "",
          page:              p.pageReference ?? "",
          specialists:       p.affectedSpecialists ?? [],
          "suggested action":p.suggestedAction ?? "",
        },
        timestamp: p.createdAt ?? "",
        priority: (p.confidence ?? 1) < 0.7 ? "high" : "normal",
        raw: p,
      });
    }

    // Memory proposals
    for (const m of (memoryData?.items ?? [])) {
      items.push({
        id: `memory-${m.id}`, category: "memory",
        title: m.title ?? "Memory update",
        description: m.content ?? "Proposed memory entry awaiting approval.",
        detail: {
          type:       m.memoryType ?? "other",
          confidence: m.confidence ?? 0,
          importance: m.importance ?? 0,
          source:     m.sourceType ?? "",
        },
        timestamp: m.createdAt ?? "",
        priority: m.importance >= 8 ? "high" : "normal",
        raw: m,
      });
    }

    // Library review requests
    for (const s of (sourcesData?.sources ?? [])) {
      items.push({
        id: `library-${s.id}`, category: "library",
        title: s.name ?? "Document awaiting review",
        description: s.description ?? "This document has been flagged for review before it can be used by your AI Workforce.",
        detail: {
          type:    s.sourceType ?? s.mimeType ?? "document",
          version: s.currentVersion ?? "",
          specialist: s.specialistScope ?? "",
        },
        timestamp: s.updatedAt ?? s.createdAt ?? "",
        priority: "normal",
        raw: s,
      });
    }

    // Completed work awaiting approval
    for (const w of (completedWorkData?.completedWork ?? []).filter((w: any) => w.status === "awaiting_approval")) {
      items.push({
        id: `work-${w.id}`, category: "work",
        title: w.title ?? "Work item",
        description: `Completed by ${w.primarySpecialist?.replace(/_/g, " ") ?? "AI Workforce"}. Ready for your review and approval.`,
        detail: {
          specialist:  w.primarySpecialist ?? "",
          blueprint:   w.blueprintCode ?? "",
          "self-review score": w.selfReviewScore ?? "",
        },
        timestamp: w.updatedAt ?? w.createdAt ?? "",
        priority: "high",
        raw: w,
      });
    }

    // System approvals
    for (const a of (systemApprovalsData?.approvals ?? [])) {
      items.push({
        id: `system-${a.id}`, category: "system",
        title: (a.approvalType ?? "System approval").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        description: a.notes ?? a.description ?? "A system action requires your authorisation.",
        detail: {
          type:   a.approvalType ?? "",
          "task": a.taskId ?? "",
        },
        timestamp: a.requestedAt ?? a.createdAt ?? "",
        priority: "high",
        raw: a,
      });
    }

    // Sort
    const sorted = [...items];
    if (sortBy === "priority") {
      sorted.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
    } else {
      sorted.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    return sorted;
  }, [proposalsData, memoryData, sourcesData, completedWorkData, systemApprovalsData, sortBy]);

  // Apply filters
  const visible = useMemo(() => allItems.filter(item => {
    if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!item.title.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [allItems, categoryFilter, search]);

  // ── Mutations ────────────────────────────────────────────────────────────────
  const actionMutation = useMutation({
    mutationFn: async ({ item, action, comment }: { item: UnifiedItem; action: string; comment: string }) => {
      const { category, raw } = item;

      if (category === "knowledge") {
        const ep = action === "approve"
          ? `/v1/organisations/${slug}/knowledge/curation/proposals/${raw.id}/approve`
          : `/v1/organisations/${slug}/knowledge/curation/proposals/${raw.id}/reject`;
        return apiFetch(ep, {
          method: "POST",
          body: JSON.stringify({ reason: comment, notes: comment }),
        });
      }

      if (category === "memory") {
        const ep = action === "approve"
          ? `/v1/organisations/${slug}/memory/${raw.id}/approve`
          : `/v1/organisations/${slug}/memory/${raw.id}/reject`;
        return apiFetch(ep, { method: "POST", body: JSON.stringify({ reason: comment }) });
      }

      if (category === "library") {
        const ep = action === "approve"
          ? `/v1/organisations/${slug}/knowledge/sources/${raw.id}/approve`
          : `/v1/organisations/${slug}/knowledge/sources/${raw.id}/revoke`;
        return apiFetch(ep, { method: "POST", body: JSON.stringify({ reason: comment }) });
      }

      if (category === "work") {
        const ep = action === "approve"
          ? `/v1/organisations/${slug}/completed-work/${raw.id}/approve`
          : `/v1/organisations/${slug}/completed-work/${raw.id}/reject`;
        return apiFetch(ep, { method: "POST", body: JSON.stringify({ comment }) });
      }

      if (category === "system") {
        const resolveAction = action === "approve" ? "approved" : "rejected";
        return apiFetch(`/v1/organisations/${slug}/approvals/${raw.id}/resolve`, {
          method: "POST",
          body: JSON.stringify({ action: resolveAction, notes: comment }),
        });
      }
    },
    onSuccess: () => {
      setModal(null);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["proposals-approvals", slug] });
      qc.invalidateQueries({ queryKey: ["memory-approvals", slug] });
      qc.invalidateQueries({ queryKey: ["sources-review", slug] });
      qc.invalidateQueries({ queryKey: ["work-approvals", slug] });
      qc.invalidateQueries({ queryKey: ["system-approvals", slug] });
    },
  });

  // ── Bulk actions ─────────────────────────────────────────────────────────────
  const [bulkPending, setBulkPending] = useState(false);
  async function bulkApprove() {
    setBulkPending(true);
    const items = visible.filter(i => selected.has(i.id));
    for (const item of items) {
      await actionMutation.mutateAsync({ item, action: "approve", comment: "" }).catch(() => {});
    }
    setSelected(new Set());
    setBulkMode(false);
    setBulkPending(false);
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map(i => i.id)));
  };

  // ── Category counts ─────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: allItems.length };
    for (const item of allItems) {
      c[item.category] = (c[item.category] ?? 0) + 1;
    }
    return c;
  }, [allItems]);

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-5xl mx-auto">

          {/* Header */}
          <div className="mb-7 flex items-start justify-between gap-4">
            <div>
              <button onClick={() => setLocation(`/app/${slug}/governance`)} className="text-[#64748B] text-xs hover:text-[#E2E8F0] mb-2 block">← Governance Centre</button>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Approval Centre</h1>
              <p className="text-[#64748B] text-sm mt-1">
                {allItems.length} item{allItems.length !== 1 ? "s" : ""} awaiting your decision
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setBulkMode(b => !b); setSelected(new Set()); }}
                className={`px-4 py-2 border text-sm rounded-lg transition-colors ${
                  bulkMode ? "border-[#00D4FF]/50 text-[#00D4FF] bg-[#00D4FF]/10" : "border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0]"
                }`}>
                {bulkMode ? "Exit bulk" : "Bulk actions"}
              </button>
              {bulkMode && selected.size > 0 && (
                <button onClick={bulkApprove} disabled={bulkPending}
                  className="px-4 py-2 bg-emerald-700 text-white text-sm font-semibold rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                  {bulkPending ? "Approving…" : `Approve ${selected.size} selected`}
                </button>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            {/* Category tabs */}
            <div className="flex items-center gap-0.5 p-1 bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-x-auto">
              {CATEGORY_FILTERS.map(f => (
                <button key={f.key} onClick={() => setCategoryFilter(f.key)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    categoryFilter === f.key ? "bg-[#00D4FF]/10 text-[#00D4FF]" : "text-[#64748B] hover:text-[#E2E8F0]"
                  }`}>
                  {f.label}
                  {(counts[f.key] ?? 0) > 0 && (
                    <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${
                      categoryFilter === f.key ? "bg-[#00D4FF]/20" : "bg-[#1E3A5F]"
                    }`}>{counts[f.key]}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-xs">🔍</span>
              <input type="text" placeholder="Search approvals…" value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#112033] border border-[#1E3A5F] rounded-lg pl-8 pr-4 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50" />
            </div>

            {/* Sort */}
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
              className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50 shrink-0">
              <option value="priority">Sort: Priority</option>
              <option value="date">Sort: Newest</option>
            </select>
          </div>

          {/* Bulk select-all */}
          {bulkMode && visible.length > 0 && (
            <div className="flex items-center gap-3 mb-3 px-1">
              <button onClick={toggleAll}
                className={`h-4 w-4 rounded border transition-colors ${
                  selected.size === visible.length ? "bg-[#00D4FF] border-[#00D4FF]" : "bg-transparent border-[#1E3A5F]"
                }`}>
                {selected.size === visible.length && (
                  <span className="flex items-center justify-center text-[#0B1829] text-xs leading-none font-bold">✓</span>
                )}
              </button>
              <span className="text-[#64748B] text-xs">
                {selected.size === 0 ? "Select all" : `${selected.size} of ${visible.length} selected`}
              </span>
            </div>
          )}

          {/* List */}
          {visible.length === 0 ? (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-16 text-center">
              <p className="text-4xl mb-3 opacity-30">✅</p>
              <p className="text-[#E2E8F0] font-medium text-lg mb-1">All clear</p>
              <p className="text-[#64748B] text-sm">
                {categoryFilter === "all"
                  ? "There are no pending approvals. Your AI Workforce is running smoothly."
                  : `No pending ${categoryFilter} approvals.`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  onSelect={() => toggleSelect(item.id)}
                  onAction={action => setModal({ item, action })}
                  bulkMode={bulkMode}
                />
              ))}
            </div>
          )}
        </div>

        {/* Action modal */}
        {modal && (
          <ActionModal
            item={modal.item}
            action={modal.action}
            onClose={() => setModal(null)}
            onConfirm={comment =>
              actionMutation.mutate({ item: modal.item, action: modal.action, comment })
            }
            isPending={actionMutation.isPending}
          />
        )}
      </AppShell>
    </>
  );
}
