/**
 * Platform Console — Specialist Operations Monitoring
 * Sprint 9.5
 *
 * /platform/specialist-ops
 *
 * Shows platform-wide specialist run monitoring:
 * - Live run stats (active, queued, blocked, failed, completed)
 * - Run success rate
 * - Per-org and per-role breakdown
 * - Instruction version tracker
 * - OpenClaw handoff status
 */

import { useQuery } from "@tanstack/react-query";
import { useAuthFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpecialistRunStats {
  total: number;
  completed: number;
  failed: number;
  running: number;
  queued: number;
  awaitingClarification: number;
  completionRatePercent: number;
}

interface SpecialistRunRow {
  id: string;
  organizationId: string;
  taskId: string;
  workforceRoleCode: string;
  workerProfileCode: string;
  status: string;
  priority: number;
  attemptNumber: number;
  confidence: number | null;
  modelProvider: string | null;
  modelName: string | null;
  specialistInstructionVersion: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  created: "text-[#64748B]",
  queued: "text-blue-400",
  preparing: "text-purple-400",
  running: "text-cyan-400",
  awaiting_clarification: "text-amber-400",
  awaiting_approval: "text-amber-400",
  completed: "text-emerald-400",
  failed: "text-red-400",
  cancelled: "text-[#64748B]",
};

const ROLE_LABELS: Record<string, string> = {
  compliance_officer:  "Compliance Officer",
  document_specialist: "Document Specialist",
  operations_manager:  "Operations Manager",
  chief_of_staff:      "Chief of Staff",
  research_specialist: "Research Specialist",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SpecialistOpsPage() {
  const authFetch = useAuthFetch();

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["platform", "specialist-runs-stats"],
    queryFn: async () => {
      const res = await authFetch("/v1/platform/specialist-runs/stats");
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json() as Promise<{ stats: SpecialistRunStats }>;
    },
    refetchInterval: 15000,
  });

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ["platform", "specialist-runs"],
    queryFn: async () => {
      const res = await authFetch("/v1/platform/specialist-runs");
      if (!res.ok) throw new Error("Failed to load runs");
      return res.json() as Promise<{ runs: SpecialistRunRow[]; total: number }>;
    },
    refetchInterval: 15000,
  });

  const stats = statsData?.stats;
  const runs = runsData?.runs ?? [];

  // Derive per-role stats from runs
  const byRole = runs.reduce((acc, r) => {
    if (!acc[r.workforceRoleCode]) acc[r.workforceRoleCode] = { total: 0, completed: 0, failed: 0 };
    acc[r.workforceRoleCode]!.total++;
    if (r.status === "completed") acc[r.workforceRoleCode]!.completed++;
    if (r.status === "failed") acc[r.workforceRoleCode]!.failed++;
    return acc;
  }, {} as Record<string, { total: number; completed: number; failed: number }>);

  // Track instruction versions
  const versionCounts = runs.reduce((acc, r) => {
    const v = r.specialistInstructionVersion;
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-[#E2E8F0]">Specialist Operations</h1>
        <p className="text-sm text-[#64748B] mt-1">
          Platform-wide monitoring of specialist AI runs across all organisations.
        </p>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {statsLoading ? (
          <div className="col-span-full text-[#64748B] text-sm text-center py-6 animate-pulse">Loading stats…</div>
        ) : stats ? (
          <>
            <StatCard label="Total Runs"     value={stats.total}                    color="text-[#E2E8F0]" />
            <StatCard label="Completed"      value={stats.completed}                color="text-emerald-400" />
            <StatCard label="Failed"         value={stats.failed}                   color="text-red-400" />
            <StatCard label="Running"        value={stats.running}                  color="text-cyan-400" />
            <StatCard label="Queued"         value={stats.queued}                   color="text-blue-400" />
            <StatCard label="Clarification"  value={stats.awaitingClarification}    color="text-amber-400" />
            <StatCard label="Success Rate"   value={`${stats.completionRatePercent}%`} color="text-emerald-400" />
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── By role ── */}
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-[#E2E8F0] mb-3">Usage by Specialist Role</h3>
          {Object.entries(byRole).length === 0 ? (
            <p className="text-[#64748B] text-xs text-center py-4">No runs yet</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(byRole)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([role, counts]) => (
                  <div key={role} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#E2E8F0] truncate">
                        {ROLE_LABELS[role] ?? role.replace(/_/g, " ")}
                      </p>
                      <div className="flex gap-2 mt-0.5 text-[10px] text-[#64748B]">
                        <span className="text-emerald-400">{counts.completed} done</span>
                        {counts.failed > 0 && <span className="text-red-400">{counts.failed} failed</span>}
                      </div>
                    </div>
                    <span className="text-sm font-bold text-[#E2E8F0] shrink-0">{counts.total}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* ── Instruction versions ── */}
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-[#E2E8F0] mb-3">Instruction Versions</h3>
          {Object.entries(versionCounts).length === 0 ? (
            <p className="text-[#64748B] text-xs text-center py-4">No runs yet</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(versionCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([version, count]) => (
                  <div key={version} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono bg-[#0D1B2E] px-2 py-0.5 rounded text-[#94A3B8]">v{version}</span>
                    </div>
                    <span className="text-xs text-[#64748B]">{count} run{count !== 1 ? "s" : ""}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* ── Recent failed runs ── */}
        <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-[#E2E8F0] mb-3">Recent Failed Runs</h3>
          {runs.filter(r => r.status === "failed").length === 0 ? (
            <div className="text-center py-4">
              <p className="text-emerald-400 text-xs">✅ No failed runs</p>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.filter(r => r.status === "failed").slice(0, 5).map(r => (
                <div key={r.id} className="bg-[#0D1B2E] rounded-lg px-2.5 py-2">
                  <p className="text-xs font-medium text-[#E2E8F0] truncate">
                    {ROLE_LABELS[r.workforceRoleCode] ?? r.workforceRoleCode}
                  </p>
                  <p className="text-[10px] text-[#64748B] truncate">
                    Org: {r.organizationId.slice(0, 8)}…
                  </p>
                  <p className="text-[10px] text-red-400 mt-0.5">
                    {r.failedAt ? new Date(r.failedAt).toLocaleString() : "Unknown time"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Live run table ── */}
      <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1E3A5F] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#E2E8F0]">
            All Runs ({runsData?.total ?? 0})
          </h3>
          <span className="text-[10px] text-[#64748B]">Auto-refreshes every 15s</span>
        </div>

        {runsLoading ? (
          <p className="text-[#64748B] text-xs text-center py-8 animate-pulse">Loading runs…</p>
        ) : runs.length === 0 ? (
          <p className="text-[#64748B] text-xs text-center py-8">No specialist runs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1E3A5F]">
                  <th className="text-left px-4 py-2 text-[#64748B] font-semibold">Role</th>
                  <th className="text-left px-4 py-2 text-[#64748B] font-semibold">Status</th>
                  <th className="text-left px-4 py-2 text-[#64748B] font-semibold">Org</th>
                  <th className="text-left px-4 py-2 text-[#64748B] font-semibold">Confidence</th>
                  <th className="text-left px-4 py-2 text-[#64748B] font-semibold">Model</th>
                  <th className="text-left px-4 py-2 text-[#64748B] font-semibold">Attempts</th>
                  <th className="text-left px-4 py-2 text-[#64748B] font-semibold">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A5F]/50">
                {runs.slice(0, 50).map(r => (
                  <tr key={r.id} className="hover:bg-[#0D1B2E] transition-colors">
                    <td className="px-4 py-2 text-[#E2E8F0]">
                      {ROLE_LABELS[r.workforceRoleCode] ?? r.workforceRoleCode}
                    </td>
                    <td className="px-4 py-2">
                      <span className={STATUS_COLORS[r.status] ?? "text-[#64748B]"}>{r.status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="px-4 py-2 text-[#64748B] font-mono">{r.organizationId.slice(0, 8)}…</td>
                    <td className="px-4 py-2 text-[#94A3B8]">
                      {r.confidence !== null ? `${Math.round(r.confidence * 100)}%` : "—"}
                    </td>
                    <td className="px-4 py-2 text-[#64748B]">
                      {r.modelProvider ? `${r.modelProvider}/${r.modelName}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-[#64748B]">{r.attemptNumber}</td>
                    <td className="px-4 py-2 text-[#64748B]">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── StatCard helper ──────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl px-4 py-3 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-[#64748B] mt-0.5">{label}</p>
    </div>
  );
}
