/**
 * Notification Centre — Task #36
 *
 * Aggregates all platform notifications:
 *   - Unread conversation messages
 *   - Work items awaiting approval
 *   - Knowledge proposals
 *   - Pending system approvals
 *
 * Read / archive / restore / mark-unread state is server-backed via
 * notification_reads (not localStorage). Optimistic local state gives
 * instant UI feedback while the server mutation is in-flight.
 */

import { useState, useMemo, useCallback }   from "react";
import { useParams, useLocation }            from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show }                              from "@clerk/react";
import { Redirect }                          from "wouter";
import AppShell                              from "@/components/layout/AppShell";
import { useAuthFetch }                      from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type NotifType = "work" | "approval" | "knowledge" | "conversation";

interface Notification {
  id:           string;
  type:         NotifType;
  icon:         string;
  title:        string;
  body:         string;
  timestamp:    string;
  read:         boolean;
  archived:     boolean;
  actionPath?:  string;
  actionLabel?: string;
  priority:     "high" | "normal";
}

interface ServerNotifState {
  notificationId: string;
  isRead:         boolean;
  isArchived:     boolean;
  snoozedUntil:   string | null;
}

const TYPE_META: Record<NotifType, { icon: string; label: string; colour: string }> = {
  work:         { icon: "📋", label: "Work",         colour: "text-blue-400" },
  approval:     { icon: "✅", label: "Approval",     colour: "text-amber-400" },
  knowledge:    { icon: "🧠", label: "Knowledge",    colour: "text-cyan-400" },
  conversation: { icon: "💬", label: "Conversation", colour: "text-purple-400" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NotificationCentrePage() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();
  const queryClient     = useQueryClient();

  const [tab, setTab]         = useState<"all" | "unread" | "archived">("all");
  const [search, setSearch]   = useState("");
  const [typeFilter, setTypeFilter] = useState<NotifType | "all">("all");

  // Optimistic override map — single source of truth for pending local state.
  // Keys are notification IDs; values are the locally-pending overrides.
  // Using a single map (not separate Sets) avoids contradictory states that
  // make transitions like archive → restore → archive impossible in one session.
  const [optimisticRead,  setOptimisticRead]  = useState<Set<string>>(new Set());
  const [optimisticUnread, setOptimisticUnread] = useState<Set<string>>(new Set());
  // null = restored (server-archived but locally undone); true = locally archived
  const [optimisticArchive, setOptimisticArchive] = useState<Map<string, boolean>>(new Map());

  // ── Server queries ────────────────────────────────────────────────────────

  const { data: completedWorkData } = useQuery({
    queryKey: ["completed-work-notif", slug],
    queryFn:  () => apiFetch(`/v1/organisations/${slug}/completed-work?limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 30_000,
  });

  const { data: approvalsData } = useQuery({
    queryKey: ["approvals-notif", slug],
    queryFn:  () => apiFetch(`/v1/organisations/${slug}/approvals?state=pending`).then(r => r.json()),
    enabled: !!slug, staleTime: 30_000,
  });

  const { data: proposalsData } = useQuery({
    queryKey: ["proposals-notif", slug],
    queryFn:  () =>
      apiFetch(`/v1/organisations/${slug}/knowledge/curation/proposals?status=proposed&limit=20`)
        .then(r => r.json()),
    enabled: !!slug, staleTime: 60_000,
  });

  const { data: unreadData } = useQuery({
    queryKey:        ["notif-unread", slug],
    queryFn:         () => apiFetch(`/v1/organisations/${slug}/notifications/unread-count`).then(r => r.json()),
    enabled:         !!slug,
    refetchInterval: 60_000,
  });

  // Server notification state — read/archive map for this user
  const { data: stateData } = useQuery({
    queryKey: ["notif-state", slug],
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

  // Derive effective read/archived state: server state + optimistic overrides
  const isRead = useCallback((id: string) => {
    if (optimisticUnread.has(id))   return false;
    if (optimisticRead.has(id))     return true;
    return stateMap.get(id)?.isRead ?? false;
  }, [stateMap, optimisticRead, optimisticUnread]);

  const isArchived = useCallback((id: string) => {
    // Local override wins; then fall through to server truth
    if (optimisticArchive.has(id)) return optimisticArchive.get(id) as boolean;
    return stateMap.get(id)?.isArchived ?? false;
  }, [stateMap, optimisticArchive]);

  const invalidateState = () => {
    queryClient.invalidateQueries({ queryKey: ["notif-state", slug] });
    queryClient.invalidateQueries({ queryKey: ["notif-unread", slug] });
    queryClient.invalidateQueries({ queryKey: ["nav-notif-badge", slug] });
  };

  // ── Mutations ─────────────────────────────────────────────────────────────

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch(`/v1/organisations/${slug}/notifications/mark-read`, {
        method: "POST",
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: invalidateState,
  });

  const markUnreadMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch(`/v1/organisations/${slug}/notifications/mark-unread`, {
        method: "POST",
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: invalidateState,
  });

  const archiveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch(`/v1/organisations/${slug}/notifications/archive`, {
        method: "POST",
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: (_data, ids) => {
      invalidateState();
      // Server has confirmed — remove local override so future transitions are clean
      setOptimisticArchive(prev => {
        const next = new Map(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    },
    onError: (_err, ids) => {
      // Roll back optimistic override on failure
      setOptimisticArchive(prev => {
        const next = new Map(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch(`/v1/organisations/${slug}/notifications/restore`, {
        method: "POST",
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: (_data, ids) => {
      invalidateState();
      // Server has confirmed — remove local override so future transitions are clean
      setOptimisticArchive(prev => {
        const next = new Map(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    },
    onError: (_err, ids) => {
      // Roll back optimistic override on failure
      setOptimisticArchive(prev => {
        const next = new Map(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
    },
  });

  // ── Action helpers ────────────────────────────────────────────────────────

  const handleMarkRead = (ids: string[]) => {
    setOptimisticRead(prev => new Set([...prev, ...ids]));
    setOptimisticUnread(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    markReadMutation.mutate(ids);
  };

  const handleMarkUnread = (ids: string[]) => {
    setOptimisticUnread(prev => new Set([...prev, ...ids]));
    setOptimisticRead(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    markUnreadMutation.mutate(ids);
  };

  const handleArchive = (ids: string[]) => {
    setOptimisticArchive(prev => {
      const next = new Map(prev);
      ids.forEach(id => next.set(id, true));  // mark archived; clears any prior restore override
      return next;
    });
    archiveMutation.mutate(ids);
  };

  const handleRestore = (ids: string[]) => {
    setOptimisticArchive(prev => {
      const next = new Map(prev);
      ids.forEach(id => next.set(id, false)); // mark restored; clears any prior archive override
      return next;
    });
    restoreMutation.mutate(ids);
  };

  // ── Build notification list ───────────────────────────────────────────────

  const notifications = useMemo<Notification[]>(() => {
    const items: Notification[] = [];

    // Work awaiting approval
    for (const w of (completedWorkData?.completedWork ?? []).filter((w: any) => w.status === "awaiting_approval")) {
      const id = `work-${w.id}`;
      items.push({
        id, type: "work", icon: "📋",
        title:     "Work ready for your approval",
        body:      `"${w.title ?? "A work item"}" has been submitted by ${w.primarySpecialist?.replace(/_/g, " ") ?? "your AI Workforce"}.`,
        timestamp: w.updatedAt ?? w.createdAt,
        read:      isRead(id),
        archived:  isArchived(id),
        actionPath: `/app/${slug}/active-work`, actionLabel: "Review",
        priority: "high",
      });
    }

    // Recently approved
    for (const w of (completedWorkData?.completedWork ?? []).filter((w: any) => w.status === "approved").slice(0, 5)) {
      const id = `approved-${w.id}`;
      items.push({
        id, type: "work", icon: "✓",
        title:     "Work delivered",
        body:      `"${w.title ?? "A work item"}" was approved and added to your records.`,
        timestamp: w.updatedAt ?? w.createdAt,
        read:      isRead(id),
        archived:  isArchived(id),
        actionPath: `/app/${slug}/active-work`, actionLabel: "View",
        priority: "normal",
      });
    }

    // Pending approvals
    for (const a of (approvalsData?.approvals ?? [])) {
      const id = `approval-${a.id}`;
      items.push({
        id, type: "approval", icon: "✅",
        title:     "Approval required",
        body:      a.description ?? `${a.approvalType?.replace(/_/g, " ") ?? "An item"} requires your decision.`,
        timestamp: a.createdAt ?? new Date().toISOString(),
        read:      isRead(id),
        archived:  isArchived(id),
        actionPath: `/app/${slug}/approvals`, actionLabel: "Review",
        priority: "high",
      });
    }

    // Knowledge proposals
    for (const p of (proposalsData?.proposals ?? [])) {
      const id = `proposal-${p.id}`;
      items.push({
        id, type: "knowledge", icon: "🧠",
        title:     "Knowledge update proposed",
        body:      p.title ?? "Your AI Workforce has suggested a knowledge update for your review.",
        timestamp: p.createdAt ?? new Date().toISOString(),
        read:      isRead(id),
        archived:  isArchived(id),
        actionPath: `/app/${slug}/memory`, actionLabel: "Review",
        priority: "normal",
      });
    }

    // Conversation unread count (synthetic item)
    const unreadCount: number = unreadData?.unreadCount ?? 0;
    if (unreadCount > 0) {
      const id = "conv-unread";
      items.push({
        id, type: "conversation", icon: "💬",
        title:     `${unreadCount} unread message${unreadCount > 1 ? "s" : ""}`,
        body:      "Your Chief of Staff or team members have sent messages you haven't read yet.",
        timestamp: new Date().toISOString(),
        read:      isRead(id),
        archived:  isArchived(id),
        actionPath: `/app/${slug}/chat`, actionLabel: "Open Chat",
        priority: unreadCount > 5 ? "high" : "normal",
      });
    }

    return items.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [completedWorkData, approvalsData, proposalsData, unreadData, isRead, isArchived, slug]);

  // ── Apply filters ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return notifications.filter(n => {
      if (tab === "unread"   && n.read)         return false;
      if (tab === "archived" && !n.archived)    return false;
      if (tab !== "archived" && n.archived)     return false;
      if (typeFilter !== "all" && n.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!n.title.toLowerCase().includes(q) && !n.body.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [notifications, tab, typeFilter, search]);

  const unreadInView    = filtered.filter(n => !n.read).length;
  const totalUnread     = notifications.filter(n => !n.read && !n.archived).length;

  const TYPE_FILTERS: { key: NotifType | "all"; label: string }[] = [
    { key: "all",          label: "All types" },
    { key: "work",         label: "Work" },
    { key: "approval",     label: "Approvals" },
    { key: "knowledge",    label: "Knowledge" },
    { key: "conversation", label: "Conversations" },
  ];

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Notifications</h1>
              <p className="text-[#64748B] text-sm mt-1">{totalUnread} unread</p>
            </div>
            {unreadInView > 0 && tab !== "archived" && (
              <button
                onClick={() => handleMarkRead(filtered.filter(n => !n.read).map(n => n.id))}
                className="shrink-0 px-4 py-2 bg-[#112033] border border-[#1E3A5F] text-[#64748B] text-sm rounded-lg hover:text-[#E2E8F0] transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mb-4 p-1 bg-[#112033] border border-[#1E3A5F] rounded-xl w-fit">
            {[
              { key: "all",      label: "All" },
              { key: "unread",   label: "Unread" },
              { key: "archived", label: "Archived" },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as any)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "bg-[#00D4FF]/10 text-[#00D4FF]"
                    : "text-[#64748B] hover:text-[#E2E8F0]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Search + type filter */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search notifications..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#112033] border border-[#1E3A5F] rounded-lg pl-9 pr-4 py-2.5 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50"
              />
            </div>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as any)}
              className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50"
            >
              {TYPE_FILTERS.map(f => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* Notification list */}
          {filtered.length === 0 ? (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-16 text-center">
              <p className="text-4xl mb-3 opacity-30">🔔</p>
              <p className="text-[#E2E8F0] font-medium text-lg mb-1">
                {tab === "archived" ? "No archived notifications" : "All clear"}
              </p>
              <p className="text-[#64748B] text-sm">
                {tab === "unread"
                  ? "You have no unread notifications."
                  : tab === "archived"
                  ? "Archived notifications will appear here."
                  : "No notifications match your current filter."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(n => {
                const meta = TYPE_META[n.type];
                return (
                  <div
                    key={n.id}
                    className={`bg-[#112033] border rounded-xl p-4 transition-all ${
                      !n.read
                        ? "border-l-2 border-l-[#00D4FF] border-[#1E3A5F] border-t-[#1E3A5F] border-r-[#1E3A5F] border-b-[#1E3A5F]"
                        : n.priority === "high"
                        ? "border-amber-900/30"
                        : "border-[#1E3A5F]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Unread dot */}
                      <div className="shrink-0 mt-1">
                        {!n.read
                          ? <span className="block h-2 w-2 rounded-full bg-[#00D4FF]" />
                          : <span className="block h-2 w-2 rounded-full bg-transparent" />
                        }
                      </div>

                      {/* Icon */}
                      <div className="shrink-0 h-9 w-9 rounded-lg bg-[#0B1829] border border-[#1E3A5F] flex items-center justify-center text-sm">
                        {n.icon}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className={`text-sm font-medium ${n.read ? "text-[#94A3B8]" : "text-[#E2E8F0]"}`}>
                            {n.title}
                          </p>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[10px] font-semibold ${meta.colour}`}>{meta.label}</span>
                            <span className="text-[#64748B] text-xs">{relativeTime(n.timestamp)}</span>
                          </div>
                        </div>
                        <p className="text-[#64748B] text-xs leading-relaxed">{n.body}</p>

                        {/* Actions */}
                        <div className="flex items-center gap-2 mt-3">
                          {n.actionPath && (
                            <button
                              onClick={() => {
                                handleMarkRead([n.id]);
                                setLocation(n.actionPath!);
                              }}
                              className="px-3 py-1.5 bg-[#00D4FF]/10 border border-[#00D4FF]/30 text-[#00D4FF] text-xs rounded-lg hover:bg-[#00D4FF]/20 transition-colors font-medium"
                            >
                              {n.actionLabel ?? "Open"}
                            </button>
                          )}
                          {!n.read ? (
                            <button
                              onClick={() => handleMarkRead([n.id])}
                              className="px-3 py-1.5 bg-[#0B1829] border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-[#E2E8F0] transition-colors"
                            >
                              Mark read
                            </button>
                          ) : (
                            <button
                              onClick={() => handleMarkUnread([n.id])}
                              className="px-3 py-1.5 bg-[#0B1829] border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-[#E2E8F0] transition-colors"
                            >
                              Mark unread
                            </button>
                          )}
                          {tab === "archived" ? (
                            <button
                              onClick={() => handleRestore([n.id])}
                              className="px-3 py-1.5 bg-[#0B1829] border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-[#E2E8F0] transition-colors"
                            >
                              Restore
                            </button>
                          ) : (
                            <button
                              onClick={() => handleArchive([n.id])}
                              className="px-3 py-1.5 bg-[#0B1829] border border-[#1E3A5F] text-[#64748B] text-xs rounded-lg hover:text-[#E2E8F0] transition-colors"
                            >
                              Archive
                            </button>
                          )}
                        </div>
                      </div>
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
