/**
 * Executive Inbox — Task #36
 *
 * Unified inbox aggregating:
 *   - Completed work delivered (awaiting_approval items)
 *   - Pending system approvals
 *   - Knowledge proposals awaiting review
 *   - Conversation messages (unread count)
 *
 * Archive state is now server-backed via notification_reads.
 * Optimistic updates give instant feedback.
 */

import { useState, useMemo, useCallback } from "react";
import { useParams, useLocation }          from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show }                            from "@clerk/react";
import { Redirect }                        from "wouter";
import AppShell                            from "@/components/layout/AppShell";
import { useAuthFetch }                    from "@/lib/api";

// ─── Item types ───────────────────────────────────────────────────────────────

type InboxItemType =
  | "work_delivered"
  | "approval_required"
  | "knowledge_proposal"
  | "conversation";

interface InboxItem {
  id:           string;
  type:         InboxItemType;
  title:        string;
  description:  string;
  timestamp:    string;
  actionPath?:  string;
  priority?:    "high" | "normal";
}

interface ServerNotifState {
  notificationId: string;
  isRead:         boolean;
  isArchived:     boolean;
  snoozedUntil:   string | null;
}

const TYPE_META: Record<InboxItemType, { icon: string; colour: string; label: string }> = {
  work_delivered:     { icon: "📄", colour: "text-emerald-400", label: "Work Delivered" },
  approval_required:  { icon: "✅", colour: "text-amber-400",   label: "Approval Required" },
  knowledge_proposal: { icon: "🧠", colour: "text-cyan-400",    label: "Knowledge Update" },
  conversation:       { icon: "💬", colour: "text-blue-400",    label: "Conversation" },
};

// ─── Time helpers ─────────────────────────────────────────────────────────────

function dateGroup(dateStr: string): "Today" | "Yesterday" | "Earlier" {
  const d     = new Date(dateStr);
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest  = new Date(today); yest.setDate(yest.getDate() - 1);
  if (d >= today) return "Today";
  if (d >= yest)  return "Yesterday";
  return "Earlier";
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExecutiveInbox() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();
  const queryClient     = useQueryClient();
  const [filter, setFilter] = useState<"all" | InboxItemType>("all");

  // Optimistic archive/restore sets for instant feedback
  const [optimisticArchived, setOptimisticArchived] = useState<Set<string>>(new Set());
  const [optimisticRestored, setOptimisticRestored] = useState<Set<string>>(new Set());

  // ── Server queries ────────────────────────────────────────────────────────

  const { data: completedWorkData } = useQuery({
    queryKey: ["completed-work-inbox", slug],
    queryFn:  () => apiFetch(`/v1/organisations/${slug}/completed-work?limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 30_000,
  });

  const { data: approvalsData } = useQuery({
    queryKey: ["approvals-inbox", slug],
    queryFn:  () => apiFetch(`/v1/organisations/${slug}/approvals?state=pending`).then(r => r.json()),
    enabled: !!slug, staleTime: 30_000,
  });

  const { data: proposalsData } = useQuery({
    queryKey: ["proposals-inbox", slug],
    queryFn:  () =>
      apiFetch(`/v1/organisations/${slug}/knowledge/curation/proposals?status=proposed&limit=20`)
        .then(r => r.json()),
    enabled: !!slug, staleTime: 60_000,
  });

  const { data: notifData } = useQuery({
    queryKey:        ["notif-unread-inbox", slug],
    queryFn:         () => apiFetch(`/v1/organisations/${slug}/notifications/unread-count`).then(r => r.json()),
    enabled:         !!slug,
    refetchInterval: 60_000,
  });

  // Server state for archive/restore persistence across devices
  const { data: stateData } = useQuery({
    queryKey: ["notif-state-inbox", slug],
    queryFn:  () => apiFetch(`/v1/organisations/${slug}/notifications/state`).then(r => r.json()),
    enabled:  !!slug,
    staleTime: 30_000,
  });

  const stateMap = useMemo<Map<string, ServerNotifState>>(() => {
    const m = new Map<string, ServerNotifState>();
    for (const s of (stateData?.states ?? []) as ServerNotifState[]) {
      m.set(s.notificationId, s);
    }
    return m;
  }, [stateData]);

  const isArchivedItem = useCallback((id: string) => {
    if (optimisticRestored.has(id)) return false;
    if (optimisticArchived.has(id)) return true;
    return stateMap.get(id)?.isArchived ?? false;
  }, [stateMap, optimisticArchived, optimisticRestored]);

  const invalidateState = () => {
    queryClient.invalidateQueries({ queryKey: ["notif-state-inbox", slug] });
    queryClient.invalidateQueries({ queryKey: ["notif-state", slug] });
    queryClient.invalidateQueries({ queryKey: ["nav-notif-badge", slug] });
  };

  // ── Mutations ─────────────────────────────────────────────────────────────

  const archiveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch(`/v1/organisations/${slug}/notifications/archive`, {
        method: "POST",
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: invalidateState,
  });

  const restoreMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch(`/v1/organisations/${slug}/notifications/restore`, {
        method: "POST",
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: invalidateState,
  });

  const handleArchive = (id: string) => {
    setOptimisticArchived(prev => new Set([...prev, id]));
    archiveMutation.mutate([id]);
  };

  // ── Build unified inbox items ─────────────────────────────────────────────

  const allItems: InboxItem[] = [];

  for (const w of (completedWorkData?.completedWork ?? []).filter((w: any) => w.status === "awaiting_approval")) {
    allItems.push({
      id: `work-${w.id}`, type: "work_delivered",
      title:       w.title ?? "Work item ready for review",
      description: `${w.primarySpecialist?.replace(/_/g, " ") ?? "AI Workforce"} has submitted work for your approval.`,
      timestamp:   w.updatedAt ?? w.createdAt, priority: "high",
      actionPath:  `/app/${slug}/active-work`,
    });
  }

  for (const w of (completedWorkData?.completedWork ?? []).filter((w: any) => w.status === "approved").slice(0, 5)) {
    allItems.push({
      id: `done-${w.id}`, type: "work_delivered",
      title:       `${w.title ?? "Work item"} completed`,
      description: `${w.primarySpecialist?.replace(/_/g, " ") ?? "AI Workforce"} completed this work.`,
      timestamp:   w.updatedAt ?? w.createdAt,
      actionPath:  `/app/${slug}/active-work`,
    });
  }

  for (const a of (approvalsData?.approvals ?? []).slice(0, 10)) {
    allItems.push({
      id: `approval-${a.id}`, type: "approval_required",
      title:       a.approvalType?.replace(/_/g, " ")?.replace(/\b\w/g, (c: string) => c.toUpperCase()) ?? "Approval required",
      description: a.description ?? a.requestedBy ?? "An approval requires your decision.",
      timestamp:   a.createdAt ?? new Date().toISOString(), priority: "high",
      actionPath:  `/app/${slug}/approvals`,
    });
  }

  for (const p of (proposalsData?.proposals ?? []).slice(0, 10)) {
    allItems.push({
      id: `proposal-${p.id}`, type: "knowledge_proposal",
      title:       p.title ?? "New knowledge proposal",
      description: p.rationale ?? "Your AI Workforce has suggested a knowledge update for review.",
      timestamp:   p.createdAt ?? new Date().toISOString(),
      actionPath:  `/app/${slug}/memory`,
    });
  }

  allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply filter and remove server-archived items
  const visibleItems = allItems.filter(item => {
    if (isArchivedItem(item.id)) return false;
    if (filter !== "all" && item.type !== filter) return false;
    return true;
  });

  // Group by day
  const groups: Record<string, InboxItem[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const item of visibleItems) {
    groups[dateGroup(item.timestamp)].push(item);
  }

  const unreadCount: number = notifData?.unreadCount ?? 0;

  const FILTERS: { key: "all" | InboxItemType; label: string }[] = [
    { key: "all",               label: "All" },
    { key: "work_delivered",    label: "Work" },
    { key: "approval_required", label: "Approvals" },
    { key: "knowledge_proposal",label: "Knowledge" },
  ];

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Inbox</h1>
              <p className="text-[#64748B] text-sm mt-1">
                {visibleItems.length} item{visibleItems.length !== 1 ? "s" : ""}
                {unreadCount > 0 && ` · ${unreadCount} unread conversation message${unreadCount !== 1 ? "s" : ""}`}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => setLocation(`/app/${slug}/chat`)}
                className="px-4 py-2 bg-[#00D4FF]/10 border border-[#00D4FF]/30 text-[#00D4FF] text-sm rounded-lg hover:bg-[#00D4FF]/20 transition-colors"
              >
                {unreadCount} unread in Chat →
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 mb-6 p-1 bg-[#112033] border border-[#1E3A5F] rounded-xl w-fit">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === f.key
                    ? "bg-[#00D4FF]/10 text-[#00D4FF]"
                    : "text-[#64748B] hover:text-[#E2E8F0]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Items */}
          {visibleItems.length === 0 ? (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-12 text-center">
              <p className="text-4xl mb-3 opacity-30">📥</p>
              <p className="text-[#E2E8F0] font-medium text-lg mb-1">All clear</p>
              <p className="text-[#64748B] text-sm">No items require your attention right now.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {(["Today", "Yesterday", "Earlier"] as const).map(groupName => {
                const items = groups[groupName];
                if (!items.length) return null;
                return (
                  <div key={groupName}>
                    <p className="text-[#64748B] text-xs uppercase tracking-widest font-semibold mb-3 px-1">
                      {groupName}
                    </p>
                    <div className="space-y-2">
                      {items.map(item => {
                        const meta = TYPE_META[item.type];
                        return (
                          <div
                            key={item.id}
                            className={`bg-[#112033] border rounded-xl p-4 transition-colors ${
                              item.priority === "high"
                                ? "border-amber-900/40 hover:border-amber-500/40"
                                : "border-[#1E3A5F] hover:border-[#00D4FF]/30"
                            }`}
                          >
                            <div className="flex items-start gap-4">
                              <div className="shrink-0 h-9 w-9 rounded-lg bg-[#0B1829] border border-[#1E3A5F] flex items-center justify-center text-base">
                                {meta.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <p className="text-[#E2E8F0] text-sm font-medium">{item.title}</p>
                                  <span className={`shrink-0 text-[10px] font-semibold ${meta.colour}`}>
                                    {meta.label}
                                  </span>
                                </div>
                                <p className="text-[#64748B] text-xs leading-relaxed">{item.description}</p>
                                <p className="text-[#64748B]/60 text-xs mt-2">
                                  {groupName === "Today" ? formatTime(item.timestamp) : formatDate(item.timestamp)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#1E3A5F]">
                              {item.actionPath && (
                                <button
                                  onClick={() => setLocation(item.actionPath!)}
                                  className="px-3 py-1.5 bg-[#00D4FF]/10 border border-[#00D4FF]/30 text-[#00D4FF] text-xs rounded-lg hover:bg-[#00D4FF]/20 transition-colors font-medium"
                                >
                                  Open
                                </button>
                              )}
                              <button
                                onClick={() => handleArchive(item.id)}
                                className="px-3 py-1.5 bg-[#0B1829] border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-[#E2E8F0] transition-colors"
                              >
                                Archive
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}
