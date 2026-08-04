/**
 * Platform Organisations — /platform/organisations
 * Searchable, filterable directory of all organisations.
 * Task #33: Added "Create Organisation" button + multi-step provisioning modal.
 */
import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

interface Org {
  id: string; name: string; slug: string; status: string;
  subscriptionTier: string; activeMemberCount: number;
  subscription: { status: string; trialEndAt?: string; planId: string } | null;
  plan: { code: string; name: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400 bg-emerald-950/30",
  suspended: "text-yellow-400 bg-yellow-950/30",
  onboarding: "text-[#00D4FF] bg-[#00D4FF]/10",
  closed: "text-red-400 bg-red-950/30",
  trial: "text-purple-400 bg-purple-950/30",
  trial_expired: "text-red-400 bg-red-950/30",
};

type ProvisionStep = { status: "pending" | "running" | "completed" | "failed" | "skipped"; error?: string };
type ProvisionSteps = { create_org: ProvisionStep; provision_packs: ProvisionStep; send_invitation: ProvisionStep };

const STEP_LABELS: Record<keyof ProvisionSteps, string> = {
  create_org: "Create organisation",
  provision_packs: "Provision Core pack",
  send_invitation: "Send invitation",
};

function StepRow({ step, label }: { step: ProvisionStep; label: string }) {
  const icon =
    step.status === "completed" ? "✓" :
    step.status === "failed"    ? "✗" :
    step.status === "skipped"   ? "—" :
    step.status === "running"   ? "⋯" : "·";
  const color =
    step.status === "completed" ? "text-emerald-400" :
    step.status === "failed"    ? "text-red-400" :
    step.status === "skipped"   ? "text-[#4A5568]" :
    step.status === "running"   ? "text-[#00D4FF]" : "text-[#4A5568]";
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className={`w-4 shrink-0 text-center font-mono text-sm ${color}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${color}`}>{label}</span>
        {step.error && <p className="mt-0.5 text-xs text-red-400">{step.error}</p>}
      </div>
    </div>
  );
}

function ProvisioningModal({
  jobId,
  orgId,
  steps: initialSteps,
  overallStatus,
  onClose,
  onViewOrg,
  fetch,
}: {
  jobId: string;
  orgId: string | null;
  steps: ProvisionSteps;
  overallStatus: string;
  onClose: () => void;
  onViewOrg: (id: string) => void;
  fetch: ReturnType<typeof usePlatformFetch>;
}) {
  const [steps, setSteps] = useState(initialSteps);
  const [status, setStatus] = useState(overallStatus);

  // Poll until completed or failed
  useEffect(() => {
    if (status === "completed" || status === "failed") return;
    const interval = setInterval(async () => {
      if (!orgId) return;
      try {
        const r = await fetch(`/organisations/${orgId}/provisioning`);
        const d = await r.json();
        if (d.job) {
          setSteps(d.job.steps as ProvisionSteps);
          setStatus(d.job.status);
        }
      } catch { /* ignore */ }
    }, 1500);
    return () => clearInterval(interval);
  }, [orgId, status, fetch]);

  const allDone = status === "completed";
  const failed  = status === "failed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#1E3A5F] bg-[#112033] p-6">
        <h2 className="mb-1 text-lg font-semibold text-[#E2E8F0]">
          {allDone ? "Organisation created" : failed ? "Provisioning failed" : "Creating organisation…"}
        </h2>
        <p className="mb-5 text-sm text-[#64748B]">
          {allDone ? "The organisation has been provisioned and is ready." :
           failed  ? "One or more steps failed. You can retry from the org detail page." :
                     "Please wait while we set up the organisation."}
        </p>

        <div className="rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-2 mb-6">
          {(Object.keys(STEP_LABELS) as (keyof ProvisionSteps)[]).map(key => (
            <StepRow key={key} step={steps[key]} label={STEP_LABELS[key]} />
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-[#1E3A5F] px-4 py-2.5 text-sm text-[#E2E8F0] hover:border-[#00D4FF]"
          >
            {allDone ? "Close" : "Close"}
          </button>
          {allDone && orgId && (
            <button
              onClick={() => onViewOrg(orgId)}
              className="flex-1 rounded-lg bg-[#00D4FF] px-4 py-2.5 text-sm font-semibold text-[#0B1829] hover:bg-[#00B8D9]"
            >
              View organisation →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateOrgModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: Record<string, string>) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    type: "ndis_provider",
    industry: "disability_services",
    country: "AU",
    state: "",
    primaryContactName: "",
    primaryContactEmail: "",
    initialAdminEmail: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.name.trim() || form.name.trim().length < 2) {
      setError("Organisation name must be at least 2 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreate(form);
    } catch (e: any) {
      setError(e.message ?? "An error occurred.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-[#1E3A5F] bg-[#112033] p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#E2E8F0]">Create Organisation</h2>
          <span className="text-xs text-[#4A5568]">Step {step} of 2</span>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-[#E2E8F0]">Organisation name <span className="text-red-400">*</span></label>
              <input
                value={form.name}
                onChange={set("name")}
                placeholder="Acme Support Services"
                autoFocus
                className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-[#E2E8F0]">Organisation type</label>
                <select
                  value={form.type}
                  onChange={set("type")}
                  className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2.5 text-sm text-[#E2E8F0] focus:border-[#00D4FF] focus:outline-none"
                >
                  <option value="ndis_provider">NDIS Provider</option>
                  <option value="aged_care">Aged Care</option>
                  <option value="mental_health">Mental Health</option>
                  <option value="allied_health">Allied Health</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-[#E2E8F0]">State</label>
                <select
                  value={form.state}
                  onChange={set("state")}
                  className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2.5 text-sm text-[#E2E8F0] focus:border-[#00D4FF] focus:outline-none"
                >
                  <option value="">Any</option>
                  {["NSW","VIC","QLD","WA","SA","TAS","ACT","NT"].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-[#E2E8F0]">Primary contact name</label>
              <input
                value={form.primaryContactName}
                onChange={set("primaryContactName")}
                placeholder="Jane Smith"
                className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-[#E2E8F0]">Primary contact email</label>
              <input
                type="email"
                value={form.primaryContactEmail}
                onChange={set("primaryContactEmail")}
                placeholder="jane@org.com.au"
                className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-[#E2E8F0]">
                Initial admin invitation <span className="text-[#4A5568]">(optional)</span>
              </label>
              <input
                type="email"
                value={form.initialAdminEmail}
                onChange={set("initialAdminEmail")}
                placeholder="admin@org.com.au"
                className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none"
              />
              <p className="mt-1 text-xs text-[#4A5568]">
                An administrator invitation will be sent to this address after org creation.
              </p>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-6 flex gap-3">
          {step === 1 ? (
            <>
              <button onClick={onClose} className="flex-1 rounded-lg border border-[#1E3A5F] px-4 py-2.5 text-sm text-[#E2E8F0] hover:border-[#00D4FF]">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!form.name.trim() || form.name.trim().length < 2) {
                    setError("Organisation name must be at least 2 characters.");
                    return;
                  }
                  setError("");
                  setStep(2);
                }}
                className="flex-1 rounded-lg bg-[#00D4FF] px-4 py-2.5 text-sm font-semibold text-[#0B1829] hover:bg-[#00B8D9]"
              >
                Next →
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep(1)} className="flex-1 rounded-lg border border-[#1E3A5F] px-4 py-2.5 text-sm text-[#E2E8F0] hover:border-[#00D4FF]">
                ← Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={busy}
                className="flex-1 rounded-lg bg-[#00D4FF] px-4 py-2.5 text-sm font-semibold text-[#0B1829] hover:bg-[#00B8D9] disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create organisation"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PlatformOrgs() {
  const fetch = usePlatformFetch();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create Org state
  const [showCreate, setShowCreate] = useState(false);
  const [provision, setProvision] = useState<{
    jobId: string;
    orgId: string | null;
    steps: ProvisionSteps;
    status: string;
  } | null>(null);

  const load = useCallback((pg: number, s: string, st: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(pg), limit: "20" });
    if (s) params.set("search", s);
    if (st) params.set("status", st);
    fetch(`/organisations?${params}`)
      .then(r => r.json())
      .then(d => { setOrgs(d.organisations ?? []); setTotal(d.total ?? 0); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [fetch]);

  useEffect(() => { load(page, search, status); }, [page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    load(1, search, status);
  };

  const handleCreate = async (form: Record<string, string>) => {
    const r = await fetch("/organisations", {
      method: "POST",
      body: JSON.stringify({
        name: form.name,
        type: form.type || undefined,
        country: form.country || "AU",
        state: form.state || undefined,
        primaryContactName: form.primaryContactName || undefined,
        primaryContactEmail: form.primaryContactEmail || undefined,
        initialAdminEmail: form.initialAdminEmail || undefined,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      throw new Error(d.error?.message ?? "Failed to create organisation.");
    }
    setShowCreate(false);
    setProvision({
      jobId: d.jobId,
      orgId: d.orgId,
      steps: d.steps ?? { create_org: { status: "completed" }, provision_packs: { status: "pending" }, send_invitation: { status: "pending" } },
      status: d.error ? "failed" : "running",
    });
    // Refresh the list
    load(1, "", "");
  };

  const subStatusLabel = (org: Org) => org.subscription?.status ?? "no subscription";

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Organisations</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-[#64748B]">{total} total</span>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-[#00D4FF] px-4 py-1.5 text-sm font-semibold text-[#0B1829] hover:bg-[#00B8D9]"
            >
              + Create Organisation
            </button>
          </div>
        </header>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex shrink-0 items-center gap-3 border-b border-[#1E3A5F] bg-[#0B1829] px-6 py-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or slug…"
            className="flex-1 rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:outline-none focus:border-[#00D4FF]"
          />
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0]"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="onboarding">Onboarding</option>
            <option value="closed">Closed</option>
          </select>
          <button type="submit" className="rounded-lg bg-[#00D4FF] px-4 py-1.5 text-sm font-semibold text-[#0B1829]">
            Search
          </button>
          <a
            href="/v1/platform/export/organisations"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[#1E3A5F] px-3 py-1.5 text-sm text-[#64748B] hover:text-[#E2E8F0]"
          >
            CSV
          </a>
        </form>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
            </div>
          )}
          {error && <div className="m-4 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-400">{error}</div>}
          {!loading && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#0B1829]">
                <tr className="border-b border-[#1E3A5F] text-left text-xs font-medium uppercase tracking-wider text-[#64748B]">
                  <th className="px-6 py-3">Organisation</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Subscription</th>
                  <th className="px-4 py-3 text-right">Members</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A5F]">
                {orgs.map(org => (
                  <tr key={org.id} className="group hover:bg-[#0B1829]/50">
                    <td className="px-6 py-3">
                      <div className="font-medium text-[#E2E8F0]">{org.name}</div>
                      <div className="text-xs text-[#4A5568]">/{org.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[org.status] ?? "text-[#94A3B8]"}`}>
                        {org.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#94A3B8]">
                      {org.plan?.name ?? org.subscriptionTier ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs capitalize ${STATUS_COLORS[org.subscription?.status ?? ""] ?? "text-[#4A5568]"}`}>
                        {subStatusLabel(org)}
                      </span>
                      {org.subscription?.trialEndAt && (
                        <div className="text-xs text-[#4A5568]">
                          Trial ends {new Date(org.subscription.trialEndAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[#94A3B8]">{org.activeMemberCount}</td>
                    <td className="px-4 py-3">
                      <Link href={`/platform/organisations/${org.id}`}>
                        <a className="rounded bg-[#1E3A5F] px-2 py-1 text-xs text-[#00D4FF] hover:bg-[#00D4FF]/20">
                          View →
                        </a>
                      </Link>
                    </td>
                  </tr>
                ))}
                {orgs.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-sm text-[#4A5568]">
                      No organisations found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="flex shrink-0 items-center justify-between border-t border-[#1E3A5F] px-6 py-3 text-sm text-[#64748B]">
          <span>Page {page} · {total} total</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="rounded px-3 py-1 hover:bg-[#1E3A5F] disabled:opacity-40">← Prev</button>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}
              className="rounded px-3 py-1 hover:bg-[#1E3A5F] disabled:opacity-40">Next →</button>
          </div>
        </div>
      </div>

      {/* Create Org modal */}
      {showCreate && (
        <CreateOrgModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Provisioning progress modal */}
      {provision && (
        <ProvisioningModal
          jobId={provision.jobId}
          orgId={provision.orgId}
          steps={provision.steps}
          overallStatus={provision.status}
          onClose={() => setProvision(null)}
          onViewOrg={(id) => { setProvision(null); window.location.href = `/platform/organisations/${id}`; }}
          fetch={fetch}
        />
      )}
    </PlatformShell>
  );
}
