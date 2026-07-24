/**
 * Platform Trials — /platform/trials
 * Trial management: view, filter, extend, cancel.
 */
import { useEffect, useState, useCallback } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

export default function PlatformTrials() {
  const fetch = usePlatformFetch();
  const [trials, setTrials] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState("trial");
  const [loading, setLoading] = useState(true);

  const load = useCallback((status: string) => {
    setLoading(true);
    fetch(`/trials?status=${status}`)
      .then(r => r.json())
      .then(d => { setTrials(d.trials ?? []); setSummary(d.summary); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(statusFilter); }, [statusFilter]);

  const extendTrial = async (orgId: string, orgName: string) => {
    const days = Number(prompt(`Extend trial for ${orgName} by how many days?`));
    if (!days || days <= 0) return;
    const reason = prompt("Reason for extension (required, logged to audit):");
    if (!reason) return;
    const r = await fetch(`/organisations/${orgId}/trial/extend`, {
      method: "POST", body: JSON.stringify({ days, reason }),
    });
    if (r.ok) load(statusFilter);
    else alert("Error extending trial.");
  };

  const cancelTrial = async (orgId: string, orgName: string) => {
    if (!confirm(`Cancel trial for ${orgName}? This will mark it as trial_expired.`)) return;
    const reason = prompt("Reason for cancellation (required):");
    if (!reason) return;
    const r = await fetch(`/organisations/${orgId}/trial/cancel`, {
      method: "POST", body: JSON.stringify({ reason }),
    });
    if (r.ok) load(statusFilter);
  };

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Trials</h1>
          <a href="/v1/platform/export/trials" target="_blank" className="text-xs text-[#00D4FF]">CSV Export</a>
        </header>

        {/* Summary Cards */}
        {summary && (
          <div className="flex shrink-0 gap-4 border-b border-[#1E3A5F] bg-[#0B1829] px-6 py-3">
            {[
              { label: "Active Trials", value: summary.active, color: "text-[#00D4FF]" },
              { label: "Expiring (7d)", value: summary.expiringSoon, color: "text-yellow-400" },
              { label: "Expired", value: summary.expired, color: "text-red-400" },
            ].map(c => (
              <div key={c.label} className="text-center">
                <div className={`text-xl font-bold ${c.color}`}>{c.value}</div>
                <div className="text-xs text-[#4A5568]">{c.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filter */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[#1E3A5F] px-6 py-3">
          {["trial", "trial_expired", "all"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`rounded-lg px-3 py-1.5 text-sm ${statusFilter === s ? "bg-[#00D4FF]/10 text-[#00D4FF]" : "text-[#64748B] hover:text-[#E2E8F0]"}`}>
              {s === "trial" ? "Active" : s === "trial_expired" ? "Expired" : "All"}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="flex items-center justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" /></div>}
          {!loading && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#0B1829]">
                <tr className="border-b border-[#1E3A5F] text-left text-xs text-[#64748B]">
                  <th className="px-6 py-3">Organisation</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Trial End</th>
                  <th className="px-4 py-3">Days Left</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A5F]">
                {trials.map((t: any, i: number) => {
                  const daysLeft = t.daysLeft;
                  const daysColor = daysLeft === null ? "" : daysLeft <= 0 ? "text-red-400" : daysLeft <= 7 ? "text-yellow-400" : "text-emerald-400";
                  return (
                    <tr key={i}>
                      <td className="px-6 py-3">
                        <div className="font-medium text-[#E2E8F0]">{t.organisation?.name ?? "—"}</div>
                        <div className="text-xs text-[#4A5568]">/{t.organisation?.slug}</div>
                      </td>
                      <td className="px-4 py-3 text-[#94A3B8]">{t.plan?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-xs capitalize text-[#94A3B8]">{t.subscription?.status}</td>
                      <td className="px-4 py-3 text-xs text-[#64748B]">
                        {t.trialEnd ? new Date(t.trialEnd).toLocaleDateString() : "—"}
                      </td>
                      <td className={`px-4 py-3 font-mono text-sm ${daysColor}`}>
                        {daysLeft !== null ? (daysLeft <= 0 ? "Expired" : `${daysLeft}d`) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {t.subscription?.status === "trial" && (
                            <>
                              <button onClick={() => extendTrial(t.organisation?.id, t.organisation?.name)}
                                className="rounded px-2 py-0.5 text-xs text-[#00D4FF] hover:bg-[#00D4FF]/10">Extend</button>
                              <button onClick={() => cancelTrial(t.organisation?.id, t.organisation?.name)}
                                className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-950/20">Cancel</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {trials.length === 0 && !loading && (
                  <tr><td colSpan={6} className="py-12 text-center text-sm text-[#4A5568]">No trials found.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </PlatformShell>
  );
}
