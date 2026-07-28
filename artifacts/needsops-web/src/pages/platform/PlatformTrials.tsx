/**
 * Platform Trials — /platform/trials
 * Trial management action centre: view, filter, extend, cancel, convert.
 */
import React, { useEffect, useState, useCallback } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "invoice", label: "Invoice" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "enterprise_contract", label: "Enterprise Contract" },
  { value: "pilot", label: "Pilot" },
  { value: "reseller", label: "Reseller" },
];

type FilterTab = "all" | "trial" | "expiring" | "trial_expired";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "trial",        label: "Active" },
  { id: "expiring",     label: "Expiring Soon (7d)" },
  { id: "trial_expired", label: "Expired" },
  { id: "all",          label: "All" },
];

// ─── Inline Convert Form ───────────────────────────────────────────────────────
function ConvertForm({ subId, orgName, fetch, onDone, onCancel }: {
  subId: string; orgName: string; fetch: any; onDone: () => void; onCancel: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [source, setSource] = useState("manual");
  const [activationDate, setActivationDate] = useState(today);
  const [renewalDate, setRenewalDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/trials/${subId}/convert`, {
        method: "POST",
        body: JSON.stringify({ source, activationDate, renewalDate: renewalDate || undefined, note }),
      });
      const d = await r.json();
      if (!r.ok) setErr(d.error?.message ?? "Error converting trial.");
      else onDone();
    } finally { setBusy(false); }
  };

  return (
    <tr>
      <td colSpan={7} className="bg-[#0B1829] px-6 py-4">
        <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/10 p-4">
          <p className="mb-3 text-sm font-semibold text-emerald-400">Convert Trial → Paid: <span className="text-[#E2E8F0]">{orgName}</span></p>
          {err && <p className="mb-2 text-xs text-red-400">{err}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-[#64748B]">Source</label>
              <select value={source} onChange={e => setSource(e.target.value)}
                className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-2 py-1.5 text-sm text-[#E2E8F0]">
                {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#64748B]">Activation Date</label>
              <input type="date" value={activationDate} onChange={e => setActivationDate(e.target.value)}
                className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-2 py-1.5 text-sm text-[#E2E8F0]" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#64748B]">Renewal Date (optional)</label>
              <input type="date" value={renewalDate} onChange={e => setRenewalDate(e.target.value)}
                className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-2 py-1.5 text-sm text-[#E2E8F0]" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#64748B]">Note</label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional…"
                className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-2 py-1.5 text-sm text-[#E2E8F0] placeholder-[#4A5568]" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={submit} disabled={busy}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
              {busy ? "Converting…" : "Confirm Convert"}
            </button>
            <button onClick={onCancel}
              className="rounded-lg border border-[#1E3A5F] px-3 py-1.5 text-sm text-[#64748B]">
              Cancel
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function PlatformTrials() {
  const apiFetch = usePlatformFetch();
  const [trials, setTrials] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("trial");
  const [loading, setLoading] = useState(true);
  const [expandedConvert, setExpandedConvert] = useState<string | null>(null); // subId

  const load = useCallback((tab: FilterTab) => {
    setLoading(true);
    setExpandedConvert(null);

    // Map filter tab to query params
    let url = "/trials?";
    if (tab === "expiring") {
      url += "status=trial&expiringSoon=7";
    } else if (tab === "all") {
      url += "status=all";
    } else {
      url += `status=${tab}`;
    }

    apiFetch(url)
      .then(r => r.json())
      .then(d => { setTrials(d.trials ?? []); setSummary(d.summary); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(filterTab); }, [filterTab]);

  const extendTrial = async (subId: string, orgName: string) => {
    const days = window.prompt(`Extend trial for "${orgName}" by how many additional days?`);
    if (!days || isNaN(Number(days)) || Number(days) <= 0) return;
    const r = await apiFetch(`/trials/${subId}/extend`, {
      method: "POST",
      body: JSON.stringify({ additionalDays: Number(days), reason: "Extended from platform console" }),
    });
    if (r.ok) load(filterTab);
    else { const d = await r.json(); alert(d.error?.message ?? "Error extending trial."); }
  };

  const cancelTrial = async (subId: string, orgName: string) => {
    if (!window.confirm(`Cancel trial for "${orgName}"? This will mark it as trial_expired.`)) return;
    const r = await apiFetch(`/trials/${subId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "Cancelled from platform console" }),
    });
    if (r.ok) load(filterTab);
    else { const d = await r.json(); alert(d.error?.message ?? "Error cancelling trial."); }
  };

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Trials</h1>
          <a href="/v1/platform/export/trials" target="_blank" className="text-xs text-[#00D4FF] hover:underline">
            CSV Export ↗
          </a>
        </header>

        {/* Summary Cards */}
        {summary && (
          <div className="flex shrink-0 gap-6 border-b border-[#1E3A5F] bg-[#0B1829] px-6 py-3">
            {[
              { label: "Active Trials",   value: summary.active,       color: "text-[#00D4FF]" },
              { label: "Expiring (7d)",   value: summary.expiringSoon, color: "text-yellow-400" },
              { label: "Expired",         value: summary.expired,      color: "text-red-400" },
            ].map(c => (
              <div key={c.label} className="text-center">
                <div className={`text-xl font-bold ${c.color}`}>{c.value ?? "—"}</div>
                <div className="text-xs text-[#4A5568]">{c.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex shrink-0 items-center gap-1 border-b border-[#1E3A5F] px-6 py-2">
          {FILTER_TABS.map(f => (
            <button key={f.id} onClick={() => setFilterTab(f.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                filterTab === f.id
                  ? "bg-[#00D4FF]/10 text-[#00D4FF]"
                  : "text-[#64748B] hover:text-[#E2E8F0]"
              }`}>
              {f.label}
              {f.id === "expiring" && summary?.expiringSoon > 0 && (
                <span className="ml-1.5 rounded-full bg-yellow-400/20 px-1.5 py-0.5 text-xs text-yellow-400">
                  {summary.expiringSoon}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
            </div>
          )}
          {!loading && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#0B1829]">
                <tr className="border-b border-[#1E3A5F] text-left text-xs text-[#64748B]">
                  <th className="px-6 py-3">Organisation</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sub ID</th>
                  <th className="px-4 py-3">Trial End</th>
                  <th className="px-4 py-3">Days Left</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A5F]">
                {trials.map((t: any, i: number) => {
                  const daysLeft = t.daysLeft;
                  const daysColor = daysLeft === null ? "" : daysLeft <= 0 ? "text-red-400" : daysLeft <= 7 ? "text-yellow-400" : "text-emerald-400";
                  const subId = t.subscription?.id;
                  const orgName = t.organisation?.name ?? "—";
                  const isActive = t.subscription?.status === "trial";
                  const isConverting = expandedConvert === subId;

                  return (
                    <React.Fragment key={i}>
                      <tr className={isConverting ? "bg-[#0B1829]" : "hover:bg-[#0B1829]/50"}>
                        <td className="px-6 py-3">
                          <a href={`/platform/organisations/${t.organisation?.id}`}
                            className="font-medium text-[#E2E8F0] hover:text-[#00D4FF]">
                            {orgName}
                          </a>
                          <div className="text-xs text-[#4A5568]">/{t.organisation?.slug}</div>
                        </td>
                        <td className="px-4 py-3 text-[#94A3B8]">{t.plan?.name ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs capitalize font-medium ${
                            t.subscription?.status === "trial" ? "bg-[#00D4FF]/10 text-[#00D4FF]" :
                            t.subscription?.status === "trial_expired" ? "bg-red-950/30 text-red-400" :
                            "bg-[#1E3A5F] text-[#94A3B8]"
                          }`}>
                            {t.subscription?.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {subId
                            ? <code className="text-xs text-[#4A5568]">{subId.slice(0, 8)}…</code>
                            : <span className="text-xs text-[#4A5568]">—</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-xs text-[#64748B]">
                          {t.trialEnd ? new Date(t.trialEnd).toLocaleDateString() : "—"}
                        </td>
                        <td className={`px-4 py-3 font-mono text-sm ${daysColor}`}>
                          {daysLeft !== null ? (daysLeft <= 0 ? "Expired" : `${daysLeft}d`) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {isActive && subId && (
                              <>
                                <button onClick={() => extendTrial(subId, orgName)}
                                  className="rounded px-2 py-0.5 text-xs text-[#00D4FF] hover:bg-[#00D4FF]/10">
                                  Extend
                                </button>
                                <button
                                  onClick={() => setExpandedConvert(isConverting ? null : subId)}
                                  className={`rounded px-2 py-0.5 text-xs hover:bg-emerald-950/30 ${isConverting ? "bg-emerald-950/20 text-emerald-300" : "text-emerald-400"}`}>
                                  {isConverting ? "▲ Converting" : "Convert"}
                                </button>
                                <button onClick={() => cancelTrial(subId, orgName)}
                                  className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-950/20">
                                  Cancel
                                </button>
                              </>
                            )}
                            <a href={`/platform/organisations/${t.organisation?.id}`}
                              className="rounded px-2 py-0.5 text-xs text-[#64748B] hover:text-[#E2E8F0]">
                              View →
                            </a>
                          </div>
                        </td>
                      </tr>
                      {isConverting && subId && (
                        <ConvertForm
                          subId={subId}
                          orgName={orgName}
                          fetch={apiFetch}
                          onDone={() => { setExpandedConvert(null); load(filterTab); }}
                          onCancel={() => setExpandedConvert(null)}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
                {trials.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-[#4A5568]">
                      No trials found for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </PlatformShell>
  );
}
