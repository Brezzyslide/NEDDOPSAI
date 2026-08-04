/**
 * Platform Commercial — /platform/commercial
 * Plan Designer, Plan Versions, Features, Packs, Usage Dimensions, Overrides.
 */
import { useEffect, useState, useCallback } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

type Section = "plans" | "features" | "usage-dims" | "overrides";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "plans",       label: "Plan Designer" },
  { id: "features",   label: "Features" },
  { id: "usage-dims", label: "Usage Dimensions" },
  { id: "overrides",  label: "All Overrides" },
];

function PlansSection({ fetch }: { fetch: ReturnType<typeof usePlatformFetch> }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, any[]>>({});

  // Trial edit state — keyed by planId
  const [editTrialPlanId, setEditTrialPlanId] = useState<string | null>(null);
  const [trialInput, setTrialInput] = useState<{ noTrial: boolean; days: string }>({ noTrial: false, days: "14" });
  const [trialSaving, setTrialSaving] = useState(false);
  const [trialError, setTrialError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/commercial/plans").then(r => r.json()).then(d => setPlans(d.plans ?? [])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, []);

  const loadVersions = async (planId: string) => {
    if (versions[planId]) { setExpanded(planId); return; }
    const r = await fetch(`/commercial/plans/${planId}/versions`);
    const d = await r.json();
    setVersions(v => ({ ...v, [planId]: d.versions ?? [] }));
    setExpanded(planId);
  };

  const activateVersion = async (planId: string, versionId: string) => {
    if (!confirm("Activate this version? The current active version will be deactivated.")) return;
    await fetch(`/commercial/plans/${planId}/versions/${versionId}/activate`, { method: "POST" });
    setVersions(v => ({ ...v, [planId]: [] })); // invalidate
    loadVersions(planId);
    load();
  };

  const createVersion = async (planId: string) => {
    const label = prompt("New version label (e.g. v2 — August 2026):");
    if (!label) return;
    await fetch(`/commercial/plans/${planId}/versions`, { method: "POST", body: JSON.stringify({ label }) });
    setVersions(v => ({ ...v, [planId]: [] }));
    loadVersions(planId);
  };

  const openTrialEdit = (plan: any) => {
    setTrialInput({
      noTrial: plan.trialLengthDays === 0,
      days: plan.trialLengthDays > 0 ? String(plan.trialLengthDays) : "14",
    });
    setTrialError("");
    setEditTrialPlanId(plan.id);
  };

  const saveTrialLength = async (planId: string) => {
    const days = trialInput.noTrial ? 0 : Number(trialInput.days);
    if (!trialInput.noTrial && (isNaN(days) || days < 1 || days > 365)) {
      setTrialError("Enter between 1 and 365 days, or choose 'No trial'.");
      return;
    }
    setTrialSaving(true); setTrialError("");
    try {
      const r = await fetch(`/commercial/plans/${planId}`, {
        method: "PATCH",
        body: JSON.stringify({ trialLengthDays: days }),
      });
      const d = await r.json();
      if (!r.ok) { setTrialError(d.error?.message ?? "Save failed."); return; }
      setEditTrialPlanId(null);
      load();
    } finally { setTrialSaving(false); }
  };

  if (loading) return <div className="py-8 text-center text-sm text-[#4A5568]">Loading plans…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-[#E2E8F0]">Plan Catalogue</h2>
        <span className="text-xs text-[#4A5568]">Plans are versioned — editing creates a new version, not an in-place change.</span>
        <a href="/v1/platform/export/plans" target="_blank" className="ml-auto text-xs text-[#00D4FF]">CSV Export</a>
      </div>

      {plans.map(plan => (
        <div key={plan.id} className="rounded-xl border border-[#1E3A5F] bg-[#0B1829]">
          <div className="flex items-center gap-3 p-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#E2E8F0]">{plan.name}</span>
                <span className="text-xs text-[#4A5568] font-mono">{plan.code}</span>
                {!plan.isActive && <span className="rounded-full bg-red-950/30 px-1.5 py-0.5 text-xs text-red-400">Inactive</span>}
                {!plan.isPublic && <span className="rounded-full bg-[#1E3A5F] px-1.5 py-0.5 text-xs text-[#64748B]">Hidden</span>}
              </div>
              <div className="mt-1 text-xs text-[#64748B]">{plan.description}</div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[#4A5568]">
                <span>
                  Trial:{" "}
                  {plan.trialLengthDays > 0
                    ? <span className="text-[#94A3B8]">{plan.trialLengthDays}d</span>
                    : <span className="text-amber-500">No trial</span>}
                  {" "}<button
                    onClick={() => editTrialPlanId === plan.id ? setEditTrialPlanId(null) : openTrialEdit(plan)}
                    className="text-[#00D4FF] hover:underline">
                    {editTrialPlanId === plan.id ? "Cancel" : "✏"}
                  </button>
                </span>
                {plan.monthlyPriceCents && <span>Monthly: {(plan.monthlyPriceCents / 100).toFixed(2)} {plan.currency}</span>}
                {plan.annualPriceCents && <span>Annual: {(plan.annualPriceCents / 100).toFixed(2)} {plan.currency}</span>}
                <span>{plan.subscriberCount} subscribers</span>
                <span>Active version: {plan.activeVersion?.label ?? "none"}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => createVersion(plan.id)} className="rounded border border-[#1E3A5F] px-2 py-1 text-xs text-[#64748B] hover:text-[#00D4FF]">
                + Version
              </button>
              <button onClick={() => expanded === plan.id ? setExpanded(null) : loadVersions(plan.id)}
                className="rounded border border-[#1E3A5F] px-2 py-1 text-xs text-[#64748B] hover:text-[#E2E8F0]">
                {expanded === plan.id ? "Hide" : "Versions"}
              </button>
            </div>
          </div>

          {/* Inline trial duration edit */}
          {editTrialPlanId === plan.id && (
            <div className="border-t border-[#00D4FF]/20 bg-[#00D4FF]/5 p-4 space-y-3">
              <p className="text-xs font-semibold text-[#00D4FF]">Edit trial duration — {plan.name}</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trialInput.noTrial}
                  onChange={e => setTrialInput(v => ({ ...v, noTrial: e.target.checked }))}
                  className="h-4 w-4 rounded border-[#1E3A5F] accent-[#00D4FF]"
                />
                <span className="text-sm text-[#E2E8F0]">No trial for this plan</span>
              </label>
              {!trialInput.noTrial && (
                <div className="flex items-end gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-[#64748B]">Trial days (1–365)</label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={trialInput.days}
                      onChange={e => setTrialInput(v => ({ ...v, days: e.target.value }))}
                      className="w-28 rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] focus:border-[#00D4FF] focus:outline-none"
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-amber-500">⚠ Only affects new trials — active trials are not changed.</p>
              {trialError && <p className="text-xs text-red-400 bg-red-950/20 rounded px-2 py-1">{trialError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => saveTrialLength(plan.id)}
                  disabled={trialSaving}
                  className="rounded-lg bg-[#00D4FF] px-4 py-1.5 text-sm font-semibold text-[#0B1829] hover:bg-[#00B8D9] disabled:opacity-50">
                  {trialSaving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setEditTrialPlanId(null)} className="rounded-lg border border-[#1E3A5F] px-4 py-1.5 text-sm text-[#94A3B8] hover:border-[#00D4FF]">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {expanded === plan.id && (
            <div className="border-t border-[#1E3A5F] p-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[#64748B]">
                    <th className="pb-2">Version</th><th className="pb-2">Label</th><th className="pb-2">Status</th>
                    <th className="pb-2">Seats</th><th className="pb-2">Subscribers</th><th className="pb-2">Created</th><th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E3A5F]">
                  {(versions[plan.id] ?? []).map((v: any) => (
                    <tr key={v.id}>
                      <td className="py-1.5 text-[#94A3B8]">v{v.versionNumber}</td>
                      <td className="py-1.5 text-[#E2E8F0]">{v.label}</td>
                      <td className="py-1.5">
                        {v.isActive && <span className="text-emerald-400">Active</span>}
                        {v.isLegacy && <span className="text-[#64748B]">Legacy</span>}
                        {!v.isActive && !v.isLegacy && <span className="text-[#4A5568]">Draft</span>}
                      </td>
                      <td className="py-1.5 text-[#94A3B8]">{v.includedSeats}{v.maxSeats ? `/${v.maxSeats}` : ""}</td>
                      <td className="py-1.5 text-[#94A3B8]">{v.subscriberCount}</td>
                      <td className="py-1.5 text-[#4A5568]">{v.createdAt ? new Date(v.createdAt).toLocaleDateString() : "—"}</td>
                      <td className="py-1.5">
                        {!v.isActive && (
                          <button onClick={() => activateVersion(plan.id, v.id)}
                            className="rounded px-2 py-0.5 text-[#00D4FF] hover:bg-[#00D4FF]/10">Activate</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FeaturesSection({ fetch }: { fetch: ReturnType<typeof usePlatformFetch> }) {
  const [features, setFeatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/commercial/features").then(r => r.json()).then(d => setFeatures(d.features ?? [])).finally(() => setLoading(false));
  }, []);

  const grouped: Record<string, any[]> = {};
  for (const f of features) {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category]!.push(f);
  }

  if (loading) return <div className="py-8 text-center text-sm text-[#4A5568]">Loading features…</div>;

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[#64748B]">{cat}</h3>
          <div className="flex flex-wrap gap-2">
            {items.map(f => (
              <div key={f.code} className="rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2">
                <div className="text-xs font-mono text-[#00D4FF]">{f.code}</div>
                <div className="text-xs text-[#64748B]">{f.name}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function UsageDimsSection({ fetch }: { fetch: ReturnType<typeof usePlatformFetch> }) {
  const [dims, setDims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/commercial/usage-dimensions").then(r => r.json()).then(d => setDims(d.dimensions ?? [])).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-[#4A5568]">Loading dimensions…</div>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[#1E3A5F] text-left text-xs text-[#64748B]">
          <th className="pb-2">Code</th><th className="pb-2">Name</th><th className="pb-2">Unit</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#1E3A5F]">
        {dims.map((d: any) => (
          <tr key={d.code}>
            <td className="py-2 font-mono text-xs text-[#00D4FF]">{d.code}</td>
            <td className="py-2 text-[#E2E8F0]">{d.name}</td>
            <td className="py-2 text-[#64748B]">{d.unitLabel ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OverridesSection({ fetch }: { fetch: ReturnType<typeof usePlatformFetch> }) {
  const [overrides, setOverrides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/commercial/overrides?active=true").then(r => r.json()).then(d => setOverrides(d.overrides ?? [])).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-[#4A5568]">Loading overrides…</div>;

  return (
    <div className="space-y-2">
      <p className="text-sm text-[#64748B]">{overrides.length} active platform overrides across all organisations.</p>
      {overrides.map((o: any, i: number) => (
        <div key={i} className="rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-[#00D4FF]">{o.override?.overrideType}</span>
            <span className="text-[#4A5568]">org: {o.override?.organizationId}</span>
            <span className="ml-auto text-xs text-[#4A5568]">{o.override?.createdAt ? new Date(o.override.createdAt).toLocaleDateString() : "—"}</span>
          </div>
          <p className="mt-1 text-xs text-[#94A3B8]">{o.override?.reason}</p>
        </div>
      ))}
    </div>
  );
}

export default function PlatformCommercial() {
  const fetch = usePlatformFetch();
  const [section, setSection] = useState<Section>("plans");

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Commercial</h1>
        </header>

        <div className="flex shrink-0 border-b border-[#1E3A5F] bg-[#08111e]">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={`px-4 py-2.5 text-sm transition-colors ${section === s.id ? "border-b-2 border-[#00D4FF] text-[#00D4FF]" : "text-[#64748B] hover:text-[#E2E8F0]"}`}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {section === "plans"      && <PlansSection fetch={fetch} />}
          {section === "features"  && <FeaturesSection fetch={fetch} />}
          {section === "usage-dims" && <UsageDimsSection fetch={fetch} />}
          {section === "overrides" && <OverridesSection fetch={fetch} />}
        </div>
      </div>
    </PlatformShell>
  );
}
