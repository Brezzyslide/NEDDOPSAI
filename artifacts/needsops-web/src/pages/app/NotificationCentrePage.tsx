/**
 * Notification Centre — Sprint 29M Part E
 *
 * Informational events only (the semantic boundary enforced by Sprint 29M).
 * ACTIONABLE items (awaiting_approval work, pending approvals, knowledge proposals)
 * belong exclusively in the Executive Inbox — this page must NOT duplicate them.
 *
 * This page shows:
 *   - Completed / approved work (INFORMATIONAL — user should know, no decision needed)
 *   - Unread conversation messages (INFORMATIONAL — awareness only)
 *
 * Removed from this page (moved to Inbox):
 *   - awaiting_approval work (requires approval decision → Inbox)
 *   - pending approvals        (requires approval decision → Inbox)
 *   - knowledge proposals      (requires governance decision → Inbox)
 */

import { useState, useMemo, useCallback }    from "react";
import { useParams, useLocation }            from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show }                              from "@clerk/react";
import { Redirect }                          from "wouter";
import AppShell                              from "@/components/layout/AppShell";
import { useAuthFetch }                      from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

// Sprint 29M Part E: Notifications surface only INFORMATIONAL types.
// "approval" and "knowledge" types live exclusively in Inbox.
type NotifType = "work" | "conversation";

type NotifTab  = "all" | "unread" | "archived";
interface Notification {
  id:          string;
  type:        NotifType;
  icon:        string;
  title:       string;
  body:        string;
  timestamp:   string;
  read:        boolean;
  archived:    boolean;
  priority:    "high" | "normal";
  actionPath:  string;
  actionLabel: string;
}

interface ServerNotifState {
  notificationId: string;
  isRead:         boolean;
  isArchived:     boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationCentrePage() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();
  const queryClient     = useQueryClient();

  const [tab,        setTab]        = useState<NotifTab>("all");
  const [typeFilter, setTypeFilter] = useState<NotifType | "all">("all");
  const [search,     setSearch]     = useState("");

  // Optimistic state maps
  const [optimisticRead,    setOptimisticRead]    = useState<Set<string>>(new Set());
  const [optimisticUnread,  setOptimisticUnread]  = useState<Set<string>>(new Set());
  const [optimisticArchive, setOptimisticArchive] = useState<Map<string, boolean>>(new Map());

  // ── Server queries ────────────────────────────────────────────────────────

  // Informational: completed/approved work records
  const { data: completedWorkData } = useQuery({
    queryKey: ["completed-work-notif", slug],
    queryFn:  () => apiFetch(`/v1/organisations/${slug}/completed-work?limit=50`).then(r => r.json()),
    enabled: !!slug, staleTime: 30_000,
  });

  const { data: unreadData } = useQuery({
    queryKey:        ["notif-unread", slug],
    queryFn:         () => apiFetch(`/v1/organisations/${slug}/notifications/unread-count`).then(r => r.json()),
    enabled:         !!slug,
    refetchInterval: 60_000,
  });

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

  const isRead = useCallback((id: string) => {
    if (optimisticUnread.has(id)) return false;
    if (optimisticRead.has(id))   return true;
    return stateMap.get(id)?.isRead ?? false;
  }, [stateMap, optimisticRead, optimisticUnread]);

  const isArchived = useCallback((id: string) => {
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
    // Sprint 29N.10: roll back optimistic state on failure
    onError: (_err: unknown, ids: string[]) => {
      setOptimisticRead(prev => {
        const n = new Set(prev);
        ids.forEach(id => n.delete(id));
        return n;
      });
    },
  });

  const markUnreadMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch(`/v1/organisations/${slug}/notifications/mark-unread`, {
        method: "POST",
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: invalidateState,
    onError: (_err: unknown, ids: string[]) => {
      setOptimisticUnread(prev => {
        const n = new Set(prev);
        ids.forEach(id => n.delete(id));
        return n;
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch(`/v1/organisations/${slug}/notifications/archive`, {
        method: "POST",
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: invalidateState,
    onError: (_err: unknown, ids: string[]) => {
      // Roll back: remove the optimistic archive entry so server state is re-shown
      setOptimisticArchive(prev => {
        const n = new Map(prev);
        ids.forEach(id => n.delete(id));
        return n;
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch(`/v1/organisations/${slug}/notifications/restore`, {
        method: "POST",
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: invalidateState,
    onError: (_err: unknown, ids: string[]) => {
      // Roll back: remove the optimistic restore entry so server state is re-shown
      setOptimisticArchive(prev => {
        const n = new Map(prev);
        ids.forEach(id => n.delete(id));
        return n;
      });
    },
  });

  const handleMarkRead = (id: string) => {
    setOptimisticRead(prev => new Set([...prev, id]));
    setOptimisticUnread(prev => { const n = new Set(prev); n.delete(id); return n; });
    markReadMutation.mutate([id]);
  };

  const handleMarkUnread = (id: string) => {
    setOptimisticUnread(prev => new Set([...prev, id]));
    setOptimisticRead(prev => { const n = new Set(prev); n.delete(id); return n; });
    markUnreadMutation.mutate([id]);
  };

  const handleArchive = (id: string) => {
    setOptimisticArchive(prev => new Map([...prev, [id, true]]));
    archiveMutation.mutate([id]);
  };

  const handleRestore = (id: string) => {
    setOptimisticArchive(prev => new Map([...prev, [id, false]]));
    restoreMutation.mutate([id]);
  };

  const handleMarkAllRead = () => {
    const unread = notifications.filter(n => !n.read && !n.archived).map(n => n.id);
    if (!unread.length) return;
    setOptimisticRead(prev => new Set([...prev, ...unread]));
    markReadMutation.mutate(unread);
  };

  // ── Build notification list ───────────────────────────────────────────────
  //
  // Sprint 29M Part E: Only INFORMATIONAL events appear here.
  // ACTIONABLE items (awaiting_approval, pending approvals, proposals)
  // are rendered exclusively in ExecutiveInbox.

  const notifications = useMemo<Notification[]>(() => {
    const items: Notification[] = [];

    // Approved / completed work — INFORMATIONAL
    for (const w of (completedWorkData?.completedWork ?? []).filter((w: any) => w.status === "approved").slice(0, 10)) {
      const id = `approved-${w.id}`;
      items.push({
        id, type: "work", icon: "✓",
        title:     "Work delivered",
        body:      `"${w.title ?? "A work item"}" was approved and added to your records.`,
        timestamp: w.updatedAt ?? w.createdAt,
        read:      isRead(id),
        archived:  isArchived(id),
        actionPath: `/app/${slug}/work`, actionLabel: "View",
        priority: "normal",
      });
    }

    // Conversation unread count (synthetic, awareness only) — INFORMATIONAL
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
  }, [completedWorkData, unreadData, isRead, isArchived, slug]);

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

  const unreadInView = filtered.filter(n => !n.read).length;
  const totalUnread  = notifications.filter(n => !n.read && !n.archived).length;

  const TYPE_FILTERS: { key: NotifType | "all"; label: string }[] = [
    { key: "all",          label: "All types"     },
    { key: "work",         label: "Completed Work" },
    { key: "conversation", label: "Conversations"  },
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
              <p className="text-[#64748B] text-sm mt-1">
                Stay informed — completed work, deliveries, and messages.
                {" "}
                <button
                  onClick={() => setLocation(`/app/${slug}/inbox`)}
                  className="text-[#00D4FF] hover:underline"
                >
                  Go to Inbox for items requiring your action →
                </button>
              </p>
            </div>
            {totalUnread > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="shrink-0 px-4 py-2 text-sm text-[#00D4FF] border border-[#00D4FF]/30 rounded-lg hover:bg-[#00D4FF]/10 transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-0.5 p-1 bg-[#112033] border border-[#1E3A5F] rounded-xl mb-5 w-fit">
            {(["all", "unread", "archived"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
                  tab === t
                    ? "bg-[#00D4FF]/10 text-[#00D4FF]"
                    : "text-[#64748B] hover:text-[#E2E8F0]"
                }`}
              >
                {t === "all" && totalUnread > 0 ? `All (${totalUnread} unread)` : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as any)}
              className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50"
            >
              {TYPE_FILTERS.map(f => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-xs">🔍</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search notifications…"
                className="w-full bg-[#112033] border border-[#1E3A5F] rounded-lg pl-8 pr-4 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50"
              />
            </div>
            {unreadInView > 0 && (
              <button
                onClick={() => {
                  const ids = filtered.filter(n => !n.read).map(n => n.id);
                  ids.forEach(id => setOptimisticRead(prev => new Set([...prev, id])));
                  markReadMutation.mutate(ids);
                }}
                className="px-4 py-2 text-sm text-[#64748B] hover:text-[#E2E8F0] transition-colors shrink-0"
              >
                Mark {unreadInView} read
              </button>
            )}
          </div>

          {/* Notifications list */}
          {filtered.length === 0 ? (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-14 text-center">
              <p className="text-3xl mb-3 opacity-30">🔔</p>
              <p className="text-[#E2E8F0] font-medium mb-1">
                {tab === "unread"   ? "You're all caught up" :
                 tab === "archived" ? "No archived notifications" :
                 "No notifications yet"}
              </p>
              <p className="text-[#64748B] text-sm max-w-sm mx-auto">
                {tab === "all"
                  ? "Notifications about completed work and messages will appear here. Approvals and proposals are in your Inbox."
                  : "Check other tabs for notifications."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(n => (
                <div
                  key={n.id}
                  className={`bg-[#112033] border rounded-xl p-4 transition-colors ${
                    n.read ? "border-[#1E3A5F]" : "border-[#00D4FF]/30"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-lg shrink-0">{n.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {!n.read && (
                          <span className="w-2 h-2 rounded-full bg-[#00D4FF] shrink-0" />
                        )}
                        <p className={`text-sm font-medium ${n.read ? "text-[#94A3B8]" : "text-[#E2E8F0]"}`}>
                          {n.title}
                        </p>
                      </div>
                      <p className="text-xs text-[#64748B] mb-2">{n.body}</p>
                      <p className="text-xs text-[#475569]">
                        {new Date(n.timestamp).toLocaleString("en-AU", {
                          day: "numeric", month: "short",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => setLocation(n.actionPath)}
                        className="px-3 py-1.5 bg-[#1E3A5F] text-[#E2E8F0] text-xs font-medium rounded-lg hover:bg-[#00D4FF]/10 hover:text-[#00D4FF] transition-colors"
                      >
                        {n.actionLabel}
                      </button>
                      {!n.archived ? (
                        <>
                          {n.read ? (
                            <button
                              onClick={() => handleMarkUnread(n.id)}
                              title="Mark unread"
                              className="px-2 py-1.5 text-[#64748B] hover:text-[#E2E8F0] text-xs rounded-lg hover:bg-[#1E3A5F] transition-colors"
                            >
                              ◉
                            </button>
                          ) : (
                            <button
                              onClick={() => handleMarkRead(n.id)}
                              title="Mark read"
                              className="px-2 py-1.5 text-[#64748B] hover:text-[#E2E8F0] text-xs rounded-lg hover:bg-[#1E3A5F] transition-colors"
                            >
                              ○
                            </button>
                          )}
                          <button
                            onClick={() => handleArchive(n.id)}
                            title="Archive"
                            className="px-2 py-1.5 text-[#64748B] hover:text-[#E2E8F0] text-xs rounded-lg hover:bg-[#1E3A5F] transition-colors"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleRestore(n.id)}
                          title="Restore"
                          className="px-2 py-1.5 text-[#64748B] hover:text-[#E2E8F0] text-xs rounded-lg hover:bg-[#1E3A5F] transition-colors"
                        >
                          ↩
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}
