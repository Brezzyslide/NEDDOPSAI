/**
 * Unified Approval Centre — /app/:slug/approvals
 *
 * Sprint 24. Aggregates every pending approval type into one experience:
 *   • Knowledge proposals  (curation proposals API)
 *   • Memory proposals     (org memory API, status=proposed)
 *   • Library reviews      (knowledge sources, status=review_required)
 *   • Completed work       (completed-work API, status=awaiting_approval)
 *   • System approvals     (approvals API, state=pending)
 *   • Execution intents    (execution-intents API, status=pending_approval) [Sprint 29]
 *   • Pack requests        (pack-access-requests API, status=pending)      [Sprint 29]
 *
 * Supports: approve · reject · request changes (comment) · bulk actions (server-batched) ·
 *            filter by type · search · sort by date/priority · approval history drilldown
 */

import { useState, useMemo }       from "react";
import { useParams, useLocation }  from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show }                    from "@clerk/react";
import { Redirect }                from "wouter";
import AppShell                    from "@/components/layout/AppShell";
import { useAuthFetch }            from "@/lib/api";
import { useOrgRole }              from "@/hooks/useOrgRole";
import { ApprovalHistoryPanel }    from "@/components/governance/ApprovalHistoryPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type ApprovalCategory = "knowledge" | "memory" | "library" | "work" | "system" | "intent" | "pack";

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
  knowledge: { icon: "🧠", label: "Knowledge",        colour: "text-cyan-400" },
  memory:    { icon: "💡", label: "Memory",            colour: "text-purple-400" },
  library:   { icon: "📚", label: "Library Review",   colour: "text-blue-400" },
  work:      { icon: "📋", label: "Completed Work",   colour: "text-emerald-400" },
  system:    { icon: "✅", label: "System Approval",  colour: "text-amber-400" },
  intent:    { icon: "⚡", label: "Execution Intent", colour: "text-orange-400" },
  pack:      { icon: "📦", label: "Pack Request",     colour: "text-pink-400" },
};

const CATEGORY_FILTERS: { key: ApprovalCategory | "all"; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "knowledge", label: "Knowledge" },
  { key: "memory",    label: "Memory" },
  { key: "library",   label: "Library" },
  { key: "work",      label: "Work" },
  { key: "system",    label: "System" },
  { key: "intent",    label: "Intents" },
  { key: "pack",      label: "Packs" },
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
          <p className="text-[#64748B] text-xs mt-1 truncate">{item.title}</p>
        </div>
        <div className="p-5">
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={needsComment ? "Reason is required…" : "Optional comment…"}
            rows={3}
            className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] resize-none focus:outline-none focus:border-[#00D4FF]/50"
          />
        </div>
        <div className="px-5 pb-5 flex gap-3 justify-end">
          <button onClick={onClose} disabled={isPending}
            className="px-4 py-2 border border-[#1E3A5F] text-[#94A3B8] text-sm rounded-lg hover:text-[#E2E8F0] transition-colors">
            Cancel
          </button>
          <button onClick={() => onConfirm(comment)} disabled={isPending || (needsComment && !comment.trim())}
            className={`px-5 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 ${l.cls}`}>
            {isPending ? "Working…" : l.btn}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Item card ────────────────────────────────────────────────────────────────

function ItemCard({
  item, selected, onSelect, onAction, onHistory, bulkMode, canApprove,
}: {
  item: UnifiedItem;
  selected: boolean;
  onSelect: () => void;
  onAction: (action: "approve" | "reject" | "request_changes") => void;
  onHistory: () => void;
  bulkMode: boolean;
  canApprove: boolean;
}) {
  const meta = CATEGORY_META[item.category];
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className={`bg-[#112033] border rounded-xl p-4 transition-all ${
      selected ? "border-[#00D4FF]/40 bg-[#00D4FF]/5" : "border-[#1E3A5F] hover:border-[#1E3A5F]/80"
    }`}>
      <div className="flex items-start gap-3">
        {/* Checkbox (bulk mode) */}
        {bulkMode && (
          <button onClick={onSelect}
            className={`mt-0.5 h-4 w-4 shrink-0 rounded border transition-colors ${
              selected ? "bg-[#00D4FF] border-[#00D4FF]" : "bg-transparent border-[#1E3A5F]"
            }`}>
            {selected && <span className="flex items-center justify-center text-[#0B1829] text-xs leading-none font-bold">✓</span>}
          </button>
        )}

        {/* Icon */}
        <span className="text-xl shrink-0">{meta.icon}</span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#0B1829] ${meta.colour}`}>
              {meta.label}
            </span>
            {item.priority === "high" && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-900/30 text-red-400">High priority</span>
            )}
          </div>
          <p className="text-[#E2E8F0] text-sm font-medium truncate">{item.title}</p>
          <p className="text-[#64748B] text-xs leading-relaxed mt-0.5 line-clamp-2">{item.description}</p>

          {/* Detail chips */}
          {showDetail && (
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(item.detail).filter(([, v]) => v !== "" && v !== 0).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1 bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-2 py-1">
                  <span className="text-[#64748B] text-xs capitalize">{k}:</span>
                  <span className="text-[#94A3B8] text-xs">
                    {k === "confidence" ? <ConfidencePip value={Number(v)} /> : Array.isArray(v) ? v.join(", ") : String(v)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-[#64748B] text-xs shrink-0">{timeAgo(item.timestamp)}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#1E3A5F]/50 flex-wrap">
        {/* Sprint 29N.10: action buttons only shown to owners/administrators */}
        {canApprove ? (
          <>
            <button onClick={() => onAction("approve")}
              className="px-3 py-1.5 bg-emerald-800/40 text-emerald-400 text-xs font-medium rounded-lg hover:bg-emerald-700/50 transition-colors">
              ✓ Approve
            </button>
            <button onClick={() => onAction("reject")}
              className="px-3 py-1.5 bg-red-900/30 text-red-400 text-xs font-medium rounded-lg hover:bg-red-800/40 transition-colors">
              ✗ Reject
            </button>
            <button onClick={() => onAction("request_changes")}
              className="px-3 py-1.5 border border-[#1E3A5F] text-[#94A3B8] text-xs rounded-lg hover:text-[#E2E8F0] transition-colors">
              💬 Request changes
            </button>
          </>
        ) : (
          <span className="text-[#64748B] text-xs italic">View only — admin approval required</span>
        )}
        {/* History drilldown — only for system approvals with a raw ID */}
        {item.category === "system" && (
          <button onClick={onHistory}
            className="px-3 py-1.5 border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-[#00D4FF] transition-colors">
            📋 History
          </button>
        )}
        <button onClick={() => setShowDetail(d => !d)}
          className="ml-auto text-[#64748B] text-xs hover:text-[#E2E8F0] transition-colors">
          {showDetail ? "Less ▲" : "More ▼"}
        </button>
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
  // Sprint 29N.10: action controls gated to org owners/administrators
  const { canApprove }  = useOrgRole(slug);

  const [categoryFilter, setCategoryFilter] = useState<ApprovalCategory | "all">("all");
  const [search,         setSearch]         = useState("");
  const [sortBy,         setSortBy]         = useState<"date" | "priority">("priority");
  const [bulkMode,       setBulkMode]       = useState(false);
  const [selected,       setSelected]       = useState<Set<string>>(new Set());
  const [modal,          setModal]          = useState<{ item: UnifiedItem; action: "approve" | "reject" | "request_changes" } | null>(null);
  const [historyId,      setHistoryId]      = useState<string | null>(null); // raw approval ID for history drilldown

  // ── Data queries ────────────────────────────────────────────────────────────
  const { data: proposalsData } = useQuery({
    queryKey: ["proposals-approvals", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/knowledge/curation/proposals?status=proposed&limit=50`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 30_000,
  });

  const { data: memoryData } = useQuery({
    queryKey: ["memory-approvals", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/memory?status=proposed&limit=50`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 30_000,
  });

  const { data: sourcesData } = useQuery({
    queryKey: ["sources-review", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/knowledge/sources?status=review_required&limit=50`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 60_000,
  });

  const { data: completedWorkData } = useQuery({
    queryKey: ["work-approvals", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/completed-work?limit=50`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 30_000,
  });

  const { data: systemApprovalsData } = useQuery({
    queryKey: ["system-approvals", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/approvals?state=pending`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 30_000,
  });

  // Sprint 29: execution intents awaiting approval
  const { data: intentsData } = useQuery({
    queryKey: ["execution-intents-approvals", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/execution-intents?status=pending_approval`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 30_000,
  });

  // Sprint 29: pack access requests
  const { data: packRequestsData } = useQuery({
    queryKey: ["pack-requests-approvals", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/pack-access-requests?status=pending`).then(r => r.json()),
    enabled: !!slug && slug !== "undefined", staleTime: 60_000,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["proposals-approvals", slug] });
    qc.invalidateQueries({ queryKey: ["memory-approvals", slug] });
    qc.invalidateQueries({ queryKey: ["sources-review", slug] });
    qc.invalidateQueries({ queryKey: ["work-approvals", slug] });
    qc.invalidateQueries({ queryKey: ["system-approvals", slug] });
    qc.invalidateQueries({ queryKey: ["execution-intents-approvals", slug] });
    qc.invalidateQueries({ queryKey: ["pack-requests-approvals", slug] });
  };

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

    // Sprint 29: Execution intents awaiting approval
    for (const i of (intentsData?.intents ?? [])) {
      items.push({
        id: `intent-${i.id}`, category: "intent",
        title: i.intentTitle ?? i.intentType?.replace(/_/g, " ") ?? "Execution request",
        description: i.rationale ?? i.description ?? "Your AI Workforce is requesting permission to execute this action.",
        detail: {
          specialist: i.specialistCode ?? "",
          task:       i.taskId ?? "",
          action:     i.intentType ?? "",
        },
        timestamp: i.createdAt ?? "",
        priority: "high",
        raw: i,
      });
    }

    // Sprint 29: Pack access requests
    for (const r of (packRequestsData?.requests ?? []).filter((r: any) => r.status === "pending")) {
      items.push({
        id: `pack-${r.id}`, category: "pack",
        title: `Pack request: ${(r.packCode ?? "unknown").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}`,
        description: r.reason ?? r.notes ?? "Your organisation has requested access to an AI Workforce pack.",
        detail: {
          pack:       r.packCode ?? "",
          requestedBy: r.requestedBy ?? "",
        },
        timestamp: r.requestedAt ?? r.createdAt ?? "",
        priority: "normal",
        raw: r,
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
  }, [proposalsData, memoryData, sourcesData, completedWorkData, systemApprovalsData, intentsData, packRequestsData, sortBy]);

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
        return apiFetch(ep, { method: "POST", body: JSON.stringify({ reason: comment, notes: comment }) });
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

      // Sprint 29: Execution intents
      if (category === "intent") {
        const ep = action === "approve"
          ? `/v1/organisations/${slug}/execution-intents/${raw.id}/approve`
          : `/v1/organisations/${slug}/execution-intents/${raw.id}/reject`;
        return apiFetch(ep, { method: "POST", body: JSON.stringify({ reason: comment }) });
      }

      // Sprint 29: Pack requests (platform-approved; org can only request, not approve)
      if (category === "pack") {
        // Pack requests are approved by the platform, not the org
        // Show as informational in the feed; reject = cancel the request
        if (action !== "approve") {
          return apiFetch(`/v1/organisations/${slug}/pack-access-requests/${raw.id}/cancel`, {
            method: "POST", body: JSON.stringify({ reason: comment }),
          }).catch(() => ({ ok: true })); // graceful if endpoint absent
        }
      }
    },
    onSuccess: () => {
      setModal(null);
      setSelected(new Set());
      invalidateAll();
    },
  });

  // ── Bulk actions (Sprint 29: server-batched for system approvals) ─────────────
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkResult,  setBulkResult]  = useState<{ succeeded: number; failed: number } | null>(null);

  async function bulkAction(action: "approved" | "rejected") {
    setBulkPending(true);
    setBulkResult(null);
    const items = visible.filter(i => selected.has(i.id));

    // Separate system approvals (can be server-batched) from other categories
    const systemItems = items.filter(i => i.category === "system");
    const otherItems  = items.filter(i => i.category !== "system");

    let succeeded = 0;
    let failed    = 0;

    // Server-batched for system approvals
    if (systemItems.length > 0) {
      try {
        const res = await apiFetch(`/v1/organisations/${slug}/approvals/bulk`, {
          method: "POST",
          body: JSON.stringify({
            approvalIds: systemItems.map(i => i.raw.id),
            action,
          }),
        });
        if (res.ok) {
          const body = await res.json();
          succeeded += body.succeeded ?? systemItems.length;
          failed    += body.failed    ?? 0;
        } else {
          failed += systemItems.length;
        }
      } catch {
        failed += systemItems.length;
      }
    }

    // Sequential for other categories
    for (const item of otherItems) {
      try {
        await actionMutation.mutateAsync({ item, action: action === "approved" ? "approve" : "reject", comment: "" });
        succeeded++;
      } catch {
        failed++;
      }
    }

    setBulkResult({ succeeded, failed });
    setSelected(new Set());
    setBulkMode(false);
    setBulkPending(false);
    invalidateAll();
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
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => { setBulkMode(b => !b); setSelected(new Set()); setBulkResult(null); }}
                className={`px-4 py-2 border text-sm rounded-lg transition-colors ${
                  bulkMode ? "border-[#00D4FF]/50 text-[#00D4FF] bg-[#00D4FF]/10" : "border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0]"
                }`}>
                {bulkMode ? "Exit bulk" : "Bulk actions"}
              </button>
              {bulkMode && selected.size > 0 && (
                <>
                  <button onClick={() => bulkAction("approved")} disabled={bulkPending}
                    className="px-4 py-2 bg-emerald-700 text-white text-sm font-semibold rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                    {bulkPending ? "Working…" : `Approve ${selected.size}`}
                  </button>
                  <button onClick={() => bulkAction("rejected")} disabled={bulkPending}
                    className="px-4 py-2 bg-red-800/60 text-red-300 text-sm font-semibold rounded-lg hover:bg-red-700/60 disabled:opacity-50 transition-colors">
                    {bulkPending ? "Working…" : `Reject ${selected.size}`}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Bulk result banner */}
          {bulkResult && (
            <div className={`mb-4 px-4 py-3 rounded-xl text-sm border ${
              bulkResult.failed === 0
                ? "bg-emerald-900/20 border-emerald-800/40 text-emerald-400"
                : "bg-amber-900/20 border-amber-800/40 text-amber-400"
            }`}>
              Bulk action complete — {bulkResult.succeeded} succeeded, {bulkResult.failed} failed.
              <button onClick={() => setBulkResult(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
            </div>
          )}

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
                  onHistory={() => setHistoryId(item.raw.id)}
                  bulkMode={bulkMode}
                  canApprove={canApprove}
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

        {/* Approval history panel (Sprint 29) */}
        {historyId && slug && (
          <ApprovalHistoryPanel
            approvalId={historyId}
            orgSlug={slug}
            onClose={() => setHistoryId(null)}
          />
        )}
      </AppShell>
    </>
  );
}
