/**
 * Platform Staff — /platform/staff
 * Sprint 9.7 — Owner Control Plane
 *
 * Manage platform staff roles: list, invite, revoke, suspend, view activity.
 */
import { useEffect, useState, useCallback, Fragment } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaffMember {
  id: string;
  userId: string;
  role: string;
  grantedAt: string;
  user: { name: string | null; email: string | null };
}

interface AuditEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

// ─── Role badge colours ───────────────────────────────────────────────────────

const ROLE_BADGE: Record<string, string> = {
  platform_super_admin: "bg-violet-900/30 text-violet-300",
  platform_admin:       "bg-blue-900/30 text-blue-400",
  platform_commercial:  "bg-emerald-900/30 text-emerald-400",
  platform_operations:  "bg-amber-900/30 text-amber-400",
  platform_support:     "bg-sky-900/30 text-sky-400",
  platform_security:    "bg-red-900/30 text-red-400",
  platform_auditor:     "bg-slate-900/30 text-slate-400",
  platform_developer:   "bg-cyan-900/30 text-cyan-400",
};

function roleBadgeClass(role: string): string {
  return ROLE_BADGE[role] ?? "bg-[#1E3A5F]/40 text-[#94A3B8]";
}

const ROLE_OPTIONS = [
  "platform_super_admin",
  "platform_admin",
  "platform_commercial",
  "platform_operations",
  "platform_support",
  "platform_security",
  "platform_auditor",
  "platform_developer",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlatformStaff() {
  const pfetch = usePlatformFetch();

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Invite side-panel state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteRole, setInviteRole] = useState(ROLE_OPTIONS[1]!);
  const [inviteReason, setInviteReason] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);

  // Activity panel state
  const [activityUserId, setActivityUserId] = useState<string | null>(null);
  const [activityEvents, setActivityEvents] = useState<AuditEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const showFlash = (type: "success" | "error", message: string) => {
    setFlash({ type, message });
    setTimeout(() => setFlash(null), 4000);
  };

  const loadStaff = useCallback(async () => {
    setLoading(true);
    try {
      const r = await pfetch("/staff");
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message ?? "Failed to load staff.");
      setStaff(data.staff ?? []);
    } catch (err: any) {
      showFlash("error", err.message ?? "Failed to load staff.");
    } finally {
      setLoading(false);
    }
  }, [pfetch]);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  // ─── Invite ───────────────────────────────────────────────────────────────

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteUserId.trim() || !inviteReason.trim()) {
      showFlash("error", "User ID and reason are required.");
      return;
    }
    setInviteLoading(true);
    try {
      const r = await pfetch("/staff/invite", {
        method: "POST",
        body: JSON.stringify({ userId: inviteUserId.trim(), role: inviteRole, reason: inviteReason.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message ?? "Failed to invite staff member.");
      showFlash("success", "Staff member added successfully.");
      setShowInvite(false);
      setInviteUserId("");
      setInviteReason("");
      setInviteRole(ROLE_OPTIONS[1]!);
      await loadStaff();
    } catch (err: any) {
      showFlash("error", err.message ?? "Invite failed.");
    } finally {
      setInviteLoading(false);
    }
  }

  // ─── Revoke ───────────────────────────────────────────────────────────────

  async function handleRevoke(userId: string, role: string, userName: string) {
    if (!window.confirm(`Revoke the "${role}" role from ${userName || userId}? This cannot be undone.`)) return;
    try {
      const r = await pfetch(`/staff/${encodeURIComponent(userId)}/roles/${encodeURIComponent(role)}`, {
        method: "DELETE",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message ?? "Failed to revoke role.");
      showFlash("success", `Role "${role}" revoked.`);
      await loadStaff();
    } catch (err: any) {
      showFlash("error", err.message ?? "Revoke failed.");
    }
  }

  // ─── Suspend ──────────────────────────────────────────────────────────────

  async function handleSuspend(userId: string, userName: string) {
    const reason = window.prompt(`Enter reason for suspending ${userName || userId}:`);
    if (!reason?.trim()) return;
    try {
      const r = await pfetch(`/staff/${encodeURIComponent(userId)}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message ?? "Failed to suspend staff member.");
      showFlash("success", `${userName || userId} suspended — all roles revoked.`);
      await loadStaff();
    } catch (err: any) {
      showFlash("error", err.message ?? "Suspend failed.");
    }
  }

  // ─── Activity ─────────────────────────────────────────────────────────────

  async function handleViewActivity(userId: string) {
    if (activityUserId === userId) {
      setActivityUserId(null);
      setActivityEvents([]);
      return;
    }
    setActivityUserId(userId);
    setActivityLoading(true);
    setActivityEvents([]);
    try {
      const r = await pfetch(`/staff/${encodeURIComponent(userId)}/activity`);
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message ?? "Failed to load activity.");
      setActivityEvents(data.events ?? []);
    } catch (err: any) {
      showFlash("error", err.message ?? "Failed to load activity.");
    } finally {
      setActivityLoading(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Platform Staff</h1>
          <button
            onClick={() => { setShowInvite((v) => !v); }}
            className="rounded-lg bg-[#00D4FF]/10 px-4 py-1.5 text-sm font-medium text-[#00D4FF] hover:bg-[#00D4FF]/20 transition-colors"
          >
            {showInvite ? "✕ Cancel" : "+ Invite Staff Member"}
          </button>
        </header>

        {/* Flash message */}
        {flash && (
          <div className={`shrink-0 px-6 py-2 text-sm font-medium ${flash.type === "success" ? "bg-emerald-900/20 text-emerald-400 border-b border-emerald-800" : "bg-red-900/20 text-red-400 border-b border-red-800"}`}>
            {flash.message}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Main content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
              </div>
            ) : staff.length === 0 ? (
              <p className="text-sm text-[#64748B]">No platform staff assigned yet.</p>
            ) : (
              <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1E3A5F] bg-[#08111e]">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#64748B]">Name / Email</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#64748B]">Role</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#64748B]">Granted</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#64748B]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E3A5F]">
                    {staff.map((member) => (
                      <Fragment key={member.id}>
                        <tr className="hover:bg-[#0F2035] transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-[#E2E8F0]">{member.user.name ?? "—"}</div>
                            <div className="text-xs text-[#64748B]">{member.user.email ?? member.userId}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadgeClass(member.role)}`}>
                              {member.role}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-[#64748B]">
                            {new Date(member.grantedAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleViewActivity(member.userId)}
                                className="rounded px-2 py-1 text-xs text-[#64748B] hover:bg-[#1E3A5F] hover:text-[#E2E8F0] transition-colors"
                              >
                                {activityUserId === member.userId ? "Hide" : "Activity"}
                              </button>
                              <button
                                onClick={() => handleRevoke(member.userId, member.role, member.user.name ?? "")}
                                className="rounded px-2 py-1 text-xs text-amber-400 hover:bg-amber-900/20 transition-colors"
                              >
                                Revoke
                              </button>
                              <button
                                onClick={() => handleSuspend(member.userId, member.user.name ?? "")}
                                className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/20 transition-colors"
                              >
                                Suspend
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Activity panel inline */}
                        {activityUserId === member.userId && (
                          <tr>
                            <td colSpan={4} className="bg-[#08111e] px-6 pb-4 pt-2">
                              {activityLoading ? (
                                <div className="flex items-center gap-2 py-2 text-sm text-[#64748B]">
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
                                  Loading activity…
                                </div>
                              ) : activityEvents.length === 0 ? (
                                <p className="text-sm text-[#4A5568]">No recent activity found.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#64748B]">Recent Activity</p>
                                  {activityEvents.map((evt) => (
                                    <div key={evt.id} className="flex items-center gap-3 rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2">
                                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00D4FF]" />
                                      <span className="flex-1 text-sm text-[#E2E8F0]">{evt.eventType}</span>
                                      <span className="text-xs text-[#4A5568]">
                                        {evt.occurredAt ? new Date(evt.occurredAt).toLocaleString() : "—"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Invite side panel */}
          {showInvite && (
            <aside className="w-80 shrink-0 border-l border-[#1E3A5F] bg-[#08111e] overflow-y-auto">
              <div className="p-6">
                <h2 className="mb-4 text-sm font-semibold text-[#E2E8F0]">Invite Staff Member</h2>
                <form onSubmit={handleInvite} className="space-y-4">
                  {/* User ID */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#94A3B8]">Clerk User ID</label>
                    <input
                      type="text"
                      value={inviteUserId}
                      onChange={(e) => setInviteUserId(e.target.value)}
                      placeholder="user_xxxxxxxxxx"
                      className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none"
                      required
                    />
                  </div>

                  {/* Role */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#94A3B8]">Role</label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2 text-sm text-[#E2E8F0] focus:border-[#00D4FF] focus:outline-none"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>

                  {/* Reason */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#94A3B8]">Reason</label>
                    <textarea
                      value={inviteReason}
                      onChange={(e) => setInviteReason(e.target.value)}
                      placeholder="Why is this person being granted access?"
                      rows={3}
                      className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none resize-none"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={inviteLoading}
                    className="w-full rounded-lg bg-[#00D4FF] py-2 text-sm font-semibold text-[#0B1829] hover:bg-[#00B8D9] disabled:opacity-50 transition-colors"
                  >
                    {inviteLoading ? "Adding…" : "Add Staff Member"}
                  </button>
                </form>
              </div>
            </aside>
          )}
        </div>
      </div>
    </PlatformShell>
  );
}
