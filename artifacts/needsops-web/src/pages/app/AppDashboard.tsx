/**
 * App Dashboard — Sprint 2
 * Updated with AI Workforce widgets, task queue, and upcoming approvals.
 */

import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

const PACK_COLOURS: Record<string, string> = {
  core: "#00D4FF",
  compliance: "#FF8C00",
  operations: "#1E90FF",
  finance: "#32CD32",
  hr: "#FF69B4",
  marketing: "#FF1493",
};

const TASK_STATE_BADGE: Record<string, { label: string; cls: string }> = {
  queued:            { label: "Queued",            cls: "bg-blue-900/30 text-blue-400" },
  planning:          { label: "Planning",          cls: "bg-purple-900/30 text-purple-400" },
  awaiting_approval: { label: "Awaiting Approval", cls: "bg-amber-900/30 text-amber-400" },
  approved:          { label: "Approved",          cls: "bg-cyan-900/30 text-cyan-400" },
  executing:         { label: "Executing",         cls: "bg-indigo-900/30 text-indigo-400" },
  completed:         { label: "Completed",         cls: "bg-emerald-900/30 text-emerald-400" },
  cancelled:         { label: "Cancelled",         cls: "bg-[#1E3A5F] text-[#64748B]" },
  failed:            { label: "Failed",            cls: "bg-red-900/30 text-red-400" },
  draft:             { label: "Draft",             cls: "bg-[#1E3A5F] text-[#64748B]" },
};

export default function AppDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();

  const { data: orgData } = useQuery({
    queryKey: ["org", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}`).then(r => r.json()),
    enabled: !!slug,
  });
  const { data: membersData } = useQuery({
    queryKey: ["org-members", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/members`).then(r => r.json()),
    enabled: !!slug,
  });
  const { data: packsData } = useQuery({
    queryKey: ["workforce-packs"],
    queryFn: () => apiFetch("/v1/workforce/packs").then(r => r.json()),
  });
  const { data: specialistsData } = useQuery({
    queryKey: ["workforce-specialists-all"],
    queryFn: () => apiFetch("/v1/workforce/specialists").then(r => r.json()),
  });
  const { data: tasksData } = useQuery({
    queryKey: ["tasks-recent", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/tasks`).then(r => r.json()),
    enabled: !!slug,
  });
  const { data: approvalsData } = useQuery({
    queryKey: ["approvals-pending", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/approvals?state=pending`).then(r => r.json()),
    enabled: !!slug,
  });
  // Sprint 3: plan + usage data
  const { data: subData } = useQuery({
    queryKey: ["subscription", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/subscription`).then(r => r.json()),
    enabled: !!slug,
  });
  const { data: usageData } = useQuery({
    queryKey: ["usage", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/usage`).then(r => r.json()),
    enabled: !!slug,
  });
  const { data: seatsData } = useQuery({
    queryKey: ["seats", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/seats`).then(r => r.json()),
    enabled: !!slug,
  });

  const org = orgData?.organisation;
  const members = membersData?.members ?? [];
  const packs: any[] = packsData?.packs ?? [];
  const specialists: any[] = specialistsData?.specialists ?? [];
  const tasks: any[] = tasksData?.tasks ?? [];
  const pendingApprovals: any[] = approvalsData?.approvals ?? [];
  const availablePacks = packs.filter((p: any) => p.status === "available");
  const availableSpecialists = specialists.filter((s: any) => s.executionStatus === "available");

  // Sprint 3 plan/usage
  const sub = subData?.subscription;
  const planCode: string = sub?.plan?.code ?? "foundation";
  const PLAN_COLOURS: Record<string, string> = { foundation: "#64748B", professional: "#00D4FF", business: "#FF8C00", enterprise: "#A855F7" };
  const planColour = PLAN_COLOURS[planCode] ?? "#64748B";
  const trialEndsAt = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
  const trialDaysLeft = trialEndsAt ? Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000) : null;
  const isOnTrial = sub?.status === "trialing" && trialDaysLeft !== null && trialDaysLeft > 0;
  const usageAllowances: any[] = usageData?.allowances ?? [];
  const warningDims = usageAllowances.filter((a: any) => (a.usagePct ?? 0) >= 80).sort((a: any, b: any) => (b.usagePct ?? 0) - (a.usagePct ?? 0));
  const seatLimit: number | null = seatsData?.seats?.limit ?? null;
  const seatUsed: number = seatsData?.seats?.used ?? 0;

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-6xl">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#E2E8F0]">
              {org?.displayName ?? org?.name ?? "Dashboard"}
            </h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                org?.status === "active" ? "bg-emerald-900/30 text-emerald-400" : "bg-[#1E3A5F] text-[#64748B]"
              }`}>{org?.status ?? "—"}</span>
              <span className="text-[#64748B] text-sm">{org?.subscriptionTier} plan</span>
            </div>
          </div>

          {/* Sprint 3: Plan + Usage summary strip */}
          {sub && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {/* Current plan */}
              <button
                onClick={() => setLocation(`/app/${slug}/plan`)}
                className="text-left bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 hover:border-[#00D4FF]/40 transition-colors"
              >
                <p className="text-[#64748B] text-xs mb-1.5">Current Plan</p>
                <div className="flex items-center gap-2">
                  <span className="text-[#E2E8F0] font-bold text-lg">
                    {sub.plan?.name ?? planCode.charAt(0).toUpperCase() + planCode.slice(1)}
                  </span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-semibold"
                    style={{ backgroundColor: planColour + "22", color: planColour }}
                  >
                    {isOnTrial ? `Trial – ${trialDaysLeft}d` : sub.status ?? "active"}
                  </span>
                </div>
                <p className="text-[#00D4FF] text-xs mt-1.5">View plan details →</p>
              </button>

              {/* Seats */}
              <button
                onClick={() => setLocation(`/app/${slug}/plan`)}
                className="text-left bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 hover:border-[#00D4FF]/40 transition-colors"
              >
                <p className="text-[#64748B] text-xs mb-1.5">Team Seats</p>
                <div className="flex items-end gap-2">
                  <span className="text-[#E2E8F0] font-bold text-lg">{seatUsed}</span>
                  <span className="text-[#64748B] text-sm mb-0.5">/ {seatLimit !== null ? seatLimit : "∞"}</span>
                </div>
                {seatLimit !== null && (
                  <div className="mt-2 h-1 bg-[#1E3A5F] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(Math.round((seatUsed / seatLimit) * 100), 100)}%`,
                        backgroundColor: seatUsed / seatLimit >= 0.95 ? "#F87171" : seatUsed / seatLimit >= 0.80 ? "#FB923C" : "#00D4FF",
                      }}
                    />
                  </div>
                )}
              </button>

              {/* Usage warnings or all-clear */}
              <button
                onClick={() => setLocation(`/app/${slug}/usage`)}
                className={`text-left bg-[#112033] border rounded-xl p-4 hover:border-[#00D4FF]/40 transition-colors ${
                  warningDims.length > 0 ? "border-amber-500/40" : "border-[#1E3A5F]"
                }`}
              >
                <p className="text-[#64748B] text-xs mb-1.5">Usage Health</p>
                {warningDims.length === 0 ? (
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 text-lg">✓</span>
                    <span className="text-[#E2E8F0] font-medium text-sm">All limits healthy</span>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-amber-400 text-base">⚠</span>
                      <span className="text-amber-300 font-semibold text-sm">{warningDims.length} dimension{warningDims.length > 1 ? "s" : ""} near limit</span>
                    </div>
                    <p className="text-[#64748B] text-xs truncate">
                      {warningDims[0]?.dimensionCode?.replace(/_/g, " ")} at {Math.round(warningDims[0]?.usagePct ?? 0)}%
                    </p>
                  </div>
                )}
                <p className="text-[#00D4FF] text-xs mt-1.5">View usage →</p>
              </button>
            </div>
          )}

          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: "Team Members", value: members.length, icon: "👥", path: "/team" },
              { label: "Available Specialists", value: availableSpecialists.length, icon: "🤖", path: "/workforce" },
              { label: "Active Tasks", value: tasks.filter((t: any) => !["completed","cancelled","failed"].includes(t.currentState)).length, icon: "📌", path: "/tasks" },
              { label: "Pending Approvals", value: pendingApprovals.length, icon: "✅", path: "/approvals", highlight: pendingApprovals.length > 0 },
            ].map(s => (
              <button
                key={s.label}
                onClick={() => setLocation(`/app/${slug}${s.path}`)}
                className={`text-left bg-[#112033] border rounded-xl p-5 hover:border-[#00D4FF]/40 transition-colors ${
                  s.highlight ? "border-amber-500/50" : "border-[#1E3A5F]"
                }`}
              >
                <p className="text-[#64748B] text-xs mb-1">{s.icon} {s.label}</p>
                <p className={`text-2xl font-bold ${s.highlight ? "text-amber-400" : "text-[#E2E8F0]"}`}>{s.value}</p>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* AI Workforce packs */}
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[#E2E8F0] font-semibold">AI Workforce</h2>
                <button
                  onClick={() => setLocation(`/app/${slug}/workforce`)}
                  className="text-[#00D4FF] text-xs hover:underline"
                >
                  View all →
                </button>
              </div>
              {packs.length === 0 ? (
                <p className="text-[#64748B] text-sm">Loading workforce…</p>
              ) : (
                <div className="space-y-2">
                  {availablePacks.map((pack: any) => (
                    <div key={pack.code} className="flex items-center gap-3 py-2">
                      <div
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ backgroundColor: (PACK_COLOURS[pack.code] ?? "#00D4FF") + "22", color: PACK_COLOURS[pack.code] ?? "#00D4FF" }}
                      >
                        {pack.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[#E2E8F0] text-sm font-medium truncate">{pack.name}</p>
                        <p className="text-[#64748B] text-xs">{pack.specialists?.length ?? 0} specialists</p>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 shrink-0">Active</span>
                    </div>
                  ))}
                  {packs.filter((p: any) => p.status === "coming_soon").length > 0 && (
                    <div className="pt-1 border-t border-[#1E3A5F]">
                      {packs.filter((p: any) => p.status === "coming_soon").map((pack: any) => (
                        <div key={pack.code} className="flex items-center gap-3 py-2 opacity-50">
                          <div className="h-7 w-7 rounded-lg bg-[#1E3A5F] flex items-center justify-center text-xs font-bold text-[#64748B] shrink-0">
                            {pack.name.charAt(0)}
                          </div>
                          <p className="text-[#64748B] text-sm flex-1 truncate">{pack.name}</p>
                          <span className="text-xs text-[#64748B] shrink-0">Coming soon</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pending approvals */}
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[#E2E8F0] font-semibold">Upcoming Approvals</h2>
                <button
                  onClick={() => setLocation(`/app/${slug}/approvals`)}
                  className="text-[#00D4FF] text-xs hover:underline"
                >
                  View all →
                </button>
              </div>
              {pendingApprovals.length === 0 ? (
                <p className="text-[#64748B] text-sm">No pending approvals</p>
              ) : (
                <div className="space-y-3">
                  {pendingApprovals.slice(0, 5).map((a: any) => (
                    <div key={a.id} className="flex items-start gap-3 py-2 border-b border-[#1E3A5F] last:border-0">
                      <span className="text-amber-400 text-base shrink-0 mt-0.5">⏳</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[#E2E8F0] text-sm font-medium truncate">{a.approvalType?.replace(/_/g, " ")}</p>
                        <p className="text-[#64748B] text-xs">Task: {a.taskId?.slice(0, 8)}…</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Task queue */}
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[#E2E8F0] font-semibold">Recent Tasks</h2>
              <button
                onClick={() => setLocation(`/app/${slug}/tasks`)}
                className="text-[#00D4FF] text-xs hover:underline"
              >
                Task Centre →
              </button>
            </div>
            {tasks.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-[#64748B] text-sm mb-2">No tasks yet</p>
                <button
                  onClick={() => setLocation(`/app/${slug}/tasks`)}
                  className="text-[#00D4FF] text-sm hover:underline"
                >
                  Create your first task →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.slice(0, 6).map((task: any) => {
                  const badge = TASK_STATE_BADGE[task.currentState] ?? TASK_STATE_BADGE.draft!;
                  return (
                    <div key={task.id} className="flex items-center gap-3 py-2 border-b border-[#1E3A5F] last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-[#E2E8F0] text-sm font-medium truncate">{task.title}</p>
                        <p className="text-[#64748B] text-xs">{new Date(task.createdAt).toLocaleDateString("en-AU")}</p>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </AppShell>
    </>
  );
}
