/**
 * Platform Org Detail — /platform/organisations/:id
 * Full 13-tab detail page for a single organisation.
 * Tabs: Overview, Subscription, Members, Workforce, Usage, Entitlements, Overrides,
 *       Notes, Tasks, Approvals, Audit, Security, Placeholders
 */
import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

type Tab = "overview" | "subscription" | "members" | "invitations" | "workforce" | "usage" | "entitlements" |
           "overrides" | "notes" | "tasks" | "approvals" | "audit" | "security" | "placeholders";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview",      label: "Overview" },
  { id: "subscription",  label: "Subscription" },
  { id: "members",       label: "Members" },
  { id: "invitations",   label: "Invitations" },
  { id: "workforce",     label: "Workforce" },
  { id: "usage",         label: "Usage" },
  { id: "entitlements",  label: "Entitlements" },
  { id: "overrides",     label: "Overrides" },
  { id: "notes",         label: "Notes" },
  { id: "tasks",         label: "Tasks" },
  { id: "approvals",     label: "Approvals" },
  { id: "audit",         label: "Audit" },
  { id: "security",      label: "Security" },
  { id: "placeholders",  label: "Pending" },
];

const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "invoice", label: "Invoice" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "enterprise_contract", label: "Enterprise Contract" },
  { value: "pilot", label: "Pilot" },
  { value: "reseller", label: "Reseller" },
];

interface OrgData {
  organisation: any;
  subscription: any;
  members: any[];
  activeOverrides: any[];
  allOverrides: any[];
  entitlements: any[];
  workforcePacks: any[];
  internalNotes: any[];
  tasks: any[];
  approvals: any[];
  usageSummary: any[];
  seatInfo: any;
  placeholders: Record<string, any>;
}

// ─── Convert Trial Modal ───────────────────────────────────────────────────────
function ConvertTrialModal({ subId, fetch, onClose, onSuccess }: {
  subId: string; fetch: any; onClose: () => void; onSuccess: () => void;
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
      if (!r.ok) { setErr(d.error?.message ?? "Error converting trial."); }
      else { onSuccess(); onClose(); }
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[440px] rounded-2xl border border-[#1E3A5F] bg-[#0B1829] p-6 shadow-2xl">
        <h3 className="mb-4 text-base font-semibold text-[#E2E8F0]">Convert Trial to Paid</h3>
        {err && <p className="mb-3 rounded-lg border border-red-800 bg-red-950/20 px-3 py-2 text-xs text-red-400">{err}</p>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[#64748B]">Source</label>
            <select value={source} onChange={e => setSource(e.target.value)}
              className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0]">
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#64748B]">Activation Date</label>
            <input type="date" value={activationDate} onChange={e => setActivationDate(e.target.value)}
              className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0]" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#64748B]">Renewal Date (optional)</label>
            <input type="date" value={renewalDate} onChange={e => setRenewalDate(e.target.value)}
              className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0]" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#64748B]">Note</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Optional internal note…"
              className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#4A5568]" />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={submit} disabled={busy}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            {busy ? "Converting…" : "Convert to Paid"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-[#1E3A5F] px-4 py-1.5 text-sm text-[#64748B]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Grant Pack Panel ──────────────────────────────────────────────────────────
function GrantPackPanel({ orgId, fetch, onClose, onSuccess }: {
  orgId: string; fetch: any; onClose: () => void; onSuccess: () => void;
}) {
  const [packCode, setPackCode] = useState("");
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("manual");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!packCode.trim()) { setErr("Pack code is required."); return; }
    if (!reason.trim()) { setErr("Reason is required."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/packs/${packCode.trim()}/grant`, {
        method: "POST",
        body: JSON.stringify({ organisationId: orgId, reason, source }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error?.message ?? "Error granting pack."); }
      else { onSuccess(); onClose(); }
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[400px] rounded-2xl border border-[#1E3A5F] bg-[#0B1829] p-6 shadow-2xl">
        <h3 className="mb-4 text-base font-semibold text-[#E2E8F0]">Grant Workforce Pack</h3>
        {err && <p className="mb-3 rounded-lg border border-red-800 bg-red-950/20 px-3 py-2 text-xs text-red-400">{err}</p>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[#64748B]">Pack Code</label>
            <input value={packCode} onChange={e => setPackCode(e.target.value)}
              placeholder="e.g. PACK_WORKFORCE_BASIC"
              className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm font-mono text-[#E2E8F0] placeholder-[#4A5568]" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#64748B]">Source</label>
            <select value={source} onChange={e => setSource(e.target.value)}
              className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0]">
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#64748B]">Reason (logged to audit)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="Reason for granting this pack…"
              className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#4A5568]" />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={submit} disabled={busy}
            className="rounded-lg bg-[#00D4FF] px-4 py-1.5 text-sm font-semibold text-[#0B1829] hover:bg-[#00B8E0] disabled:opacity-50">
            {busy ? "Granting…" : "Grant Pack"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-[#1E3A5F] px-4 py-1.5 text-sm text-[#64748B]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Action Bar ────────────────────────────────────────────────────────────────
function ActionBar({ org, sub, fetch, onRefresh, platformRole, onNavigate }: {
  org: any; sub: any; fetch: any; onRefresh: () => void;
  platformRole?: string; onNavigate: (path: string) => void;
}) {
  const [showSuspend, setShowSuspend] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const doAction = async (action: string) => {
    if (!reason.trim()) { alert("Reason is required."); return; }
    setBusy(true);
    try {
      const r = await fetch(`/organisations/${org.id}/${action}`, { method: "POST", body: JSON.stringify({ reason }) });
      const d = await r.json();
      if (!r.ok) { alert(d.error?.message ?? "Error."); } else { setReason(""); setShowSuspend(false); onRefresh(); }
    } finally { setBusy(false); }
  };

  const doFreezeExecution = async () => {
    const r = window.prompt("Reason for freezing execution:");
    if (!r) return;
    const res = await fetch(`/organisations/${org.id}/freeze-execution`, { method: "POST", body: JSON.stringify({ reason: r }) });
    if (res.ok) onRefresh(); else { const d = await res.json(); alert(d.error?.message ?? "Error freezing."); }
  };

  const doUnfreezeExecution = async () => {
    const res = await fetch(`/organisations/${org.id}/unfreeze-execution`, { method: "POST" });
    if (res.ok) onRefresh(); else { const d = await res.json(); alert(d.error?.message ?? "Error unfreezing."); }
  };

  const doCloseOrg = async () => {
    if (!window.confirm("Are you sure? This is irreversible.")) return;
    const r = window.prompt("Reason for closing this organisation:");
    if (!r) return;
    const res = await fetch(`/organisations/${org.id}/close`, { method: "POST", body: JSON.stringify({ reason: r }) });
    if (res.ok) onNavigate("/platform/organisations");
    else { const d = await res.json(); alert(d.error?.message ?? "Error closing organisation."); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Suspend / Reactivate */}
      {org.status !== "suspended" && (
        <button onClick={() => setShowSuspend(true)}
          className="rounded-lg border border-yellow-800 px-3 py-1.5 text-sm text-yellow-400 hover:bg-yellow-950/30">
          Suspend Org
        </button>
      )}
      {org.status === "suspended" && (
        <button onClick={() => setShowSuspend(true)}
          className="rounded-lg border border-emerald-800 px-3 py-1.5 text-sm text-emerald-400 hover:bg-emerald-950/30">
          Reactivate Org
        </button>
      )}

      {/* Freeze / Unfreeze Execution */}
      {!org.executionFrozen ? (
        <button onClick={doFreezeExecution}
          className="rounded-lg border border-amber-700 px-3 py-1.5 text-sm text-amber-400 hover:bg-amber-950/30">
          🧊 Freeze Execution
        </button>
      ) : (
        <button onClick={doUnfreezeExecution}
          className="rounded-lg border border-emerald-700 px-3 py-1.5 text-sm text-emerald-400 hover:bg-emerald-950/30">
          ▶ Unfreeze Execution
        </button>
      )}

      {/* Close Organisation — super_admin only */}
      {platformRole === "super_admin" && (
        <button onClick={doCloseOrg}
          className="rounded-lg border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/30">
          ✕ Close Organisation
        </button>
      )}

      {showSuspend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-96 rounded-2xl border border-[#1E3A5F] bg-[#0B1829] p-6 shadow-2xl">
            <h3 className="mb-3 font-semibold text-[#E2E8F0]">
              {org.status === "suspended" ? "Reactivate" : "Suspend"} Organisation
            </h3>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Reason (required, logged to audit)…"
              className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] p-2 text-sm text-[#E2E8F0] placeholder-[#4A5568]"
              rows={3}
            />
            <div className="mt-3 flex gap-2">
              <button onClick={() => doAction(org.status === "suspended" ? "reactivate" : "suspend")}
                disabled={busy}
                className="rounded-lg bg-[#00D4FF] px-4 py-1.5 text-sm font-semibold text-[#0B1829] disabled:opacity-50">
                {busy ? "…" : "Confirm"}
              </button>
              <button onClick={() => setShowSuspend(false)} className="rounded-lg border border-[#1E3A5F] px-4 py-1.5 text-sm text-[#64748B]">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 py-2 border-b border-[#1E3A5F]">
      <dt className="w-40 shrink-0 text-xs font-medium text-[#64748B]">{label}</dt>
      <dd className="text-sm text-[#E2E8F0]">{value ?? "—"}</dd>
    </div>
  );
}

export default function PlatformOrgDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const fetch = usePlatformFetch();
  const [data, setData] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Platform role (stored in localStorage by auth layer)
  const platformRole = typeof window !== "undefined"
    ? (localStorage.getItem("platformRole") ?? undefined)
    : undefined;

  // Note form
  const [noteContent, setNoteContent] = useState("");
  const [notePriority, setNotePriority] = useState("medium");
  const [noteCategory, setNoteCategory] = useState("general");
  const [noteFlagged, setNoteFlagged] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);

  // Trial modal
  const [showConvertModal, setShowConvertModal] = useState(false);

  // Pack panel
  const [showGrantPack, setShowGrantPack] = useState(false);

  // Invitations panel
  const [invitations, setInvitations] = useState<any[]>([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invError, setInvError] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("administrator");
  const [invBusy, setInvBusy] = useState(false);
  const [invFormError, setInvFormError] = useState("");
  const [invPreviewUrls, setInvPreviewUrls] = useState<Record<string, string>>({});
  const isDev = import.meta.env.DEV;

  const loadInvitations = useCallback(() => {
    if (!params.id) return;
    setInvLoading(true);
    setInvError("");
    fetch(`/organisations/${params.id}/invitations`)
      .then(r => r.json())
      .then(d => setInvitations(d.invitations ?? []))
      .catch(e => setInvError(e.message))
      .finally(() => setInvLoading(false));
  }, [params.id, fetch]);

  useEffect(() => {
    if (activeTab === "invitations") loadInvitations();
  }, [activeTab]);

  const sendInvitation = async () => {
    if (!invEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invEmail)) {
      setInvFormError("Valid email is required."); return;
    }
    setInvBusy(true); setInvFormError("");
    try {
      const r = await fetch(`/organisations/${params.id}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email: invEmail, role: invRole }),
      });
      const d = await r.json();
      if (!r.ok) { setInvFormError(d.error?.message ?? "Failed to send invitation."); return; }
      if (d.previewUrl && d.invitation?.id) {
        setInvPreviewUrls(prev => ({ ...prev, [d.invitation.id]: d.previewUrl }));
      }
      setInvEmail(""); setShowInviteForm(false);
      loadInvitations();
    } finally { setInvBusy(false); }
  };

  const load = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    fetch(`/organisations/${params.id}`)
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const submitNote = async () => {
    if (!noteContent.trim()) { alert("Note content is required."); return; }
    setNoteBusy(true);
    try {
      const r = await fetch(`/organisations/${params.id}/internal-notes`, {
        method: "POST",
        body: JSON.stringify({ content: noteContent, priority: notePriority, category: noteCategory, isFlagged: noteFlagged }),
      });
      if (r.ok) { setNoteContent(""); setNoteFlagged(false); load(); }
    } finally { setNoteBusy(false); }
  };

  const revokePackAction = async (packCode: string) => {
    const reason = window.prompt(`Reason for revoking pack "${packCode}":`);
    if (!reason) return;
    const r = await fetch(`/packs/${packCode}/revoke`, {
      method: "POST",
      body: JSON.stringify({ organisationId: params.id, reason }),
    });
    if (r.ok) load(); else { const d = await r.json(); alert(d.error?.message ?? "Error revoking pack."); }
  };

  const org = data?.organisation;
  const sub = data?.subscription;

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[#1E3A5F] px-6">
          <a href="/platform/organisations" className="text-[#64748B] hover:text-[#00D4FF]">← Orgs</a>
          <h1 className="text-lg font-semibold text-[#E2E8F0]">{org?.name ?? "Loading…"}</h1>
          {org && <span className="text-xs text-[#4A5568]">/{org.slug}</span>}

          {/* Status badges */}
          {org?.executionFrozen && (
            <span className="rounded-full border border-red-800 bg-red-950/30 px-2 py-0.5 text-xs font-medium text-red-400">
              🧊 Execution Frozen
            </span>
          )}
          {org?.loginDisabled && (
            <span className="rounded-full border border-amber-800 bg-amber-950/30 px-2 py-0.5 text-xs font-medium text-amber-400">
              🚫 Logins Disabled
            </span>
          )}

          {org && (
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
              org.status === "active" ? "bg-emerald-950/30 text-emerald-400" :
              org.status === "suspended" ? "bg-yellow-950/30 text-yellow-400" : "bg-[#1E3A5F] text-[#94A3B8]"
            }`}>{org.status}</span>
          )}
        </header>

        {loading && <div className="flex flex-1 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" /></div>}
        {error && <div className="m-4 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-400">{error}</div>}

        {data && org && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Action Bar */}
            <div className="flex shrink-0 items-center gap-3 border-b border-[#1E3A5F] bg-[#0B1829] px-6 py-2">
              <ActionBar
                org={org}
                sub={sub}
                fetch={fetch}
                onRefresh={load}
                platformRole={platformRole}
                onNavigate={navigate}
              />
            </div>

            {/* Tabs */}
            <div className="flex shrink-0 overflow-x-auto border-b border-[#1E3A5F] bg-[#08111e]">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`shrink-0 px-4 py-2.5 text-sm transition-colors ${
                    activeTab === t.id
                      ? "border-b-2 border-[#00D4FF] text-[#00D4FF]"
                      : "text-[#64748B] hover:text-[#E2E8F0]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* OVERVIEW */}
              {activeTab === "overview" && (
                <dl className="max-w-lg">
                  <InfoRow label="ID" value={<code className="text-xs text-[#94A3B8]">{org.id}</code>} />
                  <InfoRow label="Name" value={org.name} />
                  <InfoRow label="Slug" value={`/${org.slug}`} />
                  <InfoRow label="Status" value={org.status} />
                  <InfoRow label="Tier (legacy)" value={org.subscriptionTier} />
                  <InfoRow label="Execution Frozen" value={
                    org.executionFrozen
                      ? <span className="text-red-400">Yes</span>
                      : <span className="text-emerald-400">No</span>
                  } />
                  <InfoRow label="Logins Disabled" value={
                    org.loginDisabled
                      ? <span className="text-amber-400">Yes</span>
                      : <span className="text-emerald-400">No</span>
                  } />
                  <InfoRow label="Active Members" value={data.members.filter(m => m.membership.status === "active").length} />
                  <InfoRow label="Created" value={org.createdAt ? new Date(org.createdAt).toLocaleString() : "—"} />
                  <InfoRow label="Updated" value={org.updatedAt ? new Date(org.updatedAt).toLocaleString() : "—"} />
                </dl>
              )}

              {/* SUBSCRIPTION */}
              {activeTab === "subscription" && (
                <div className="max-w-xl space-y-6">
                  {!sub && <p className="text-sm text-[#4A5568]">No subscription record.</p>}
                  {sub && (
                    <>
                      {/* Current subscription details */}
                      <div>
                        <h3 className="mb-3 text-sm font-semibold text-[#E2E8F0]">Subscription Details</h3>
                        <dl>
                          <InfoRow label="Subscription ID" value={<code className="text-xs text-[#94A3B8]">{sub.id}</code>} />
                          <InfoRow label="Status" value={
                            <span className={`capitalize ${
                              sub.status === "active" ? "text-emerald-400" :
                              sub.status === "trial" ? "text-[#00D4FF]" :
                              sub.status === "trial_expired" ? "text-red-400" : "text-[#94A3B8]"
                            }`}>{sub.status}</span>
                          } />
                          <InfoRow label="Plan ID" value={sub.planId} />
                          <InfoRow label="Billing Cycle" value={sub.billingCycle} />
                          <InfoRow label="Period Start" value={sub.currentPeriodStart ? new Date(sub.currentPeriodStart).toLocaleDateString() : "—"} />
                          <InfoRow label="Period End" value={sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : "—"} />
                          <InfoRow label="Trial Start" value={sub.trialStartAt ? new Date(sub.trialStartAt).toLocaleDateString() : "—"} />
                          <InfoRow label="Trial End" value={sub.trialEndAt ? new Date(sub.trialEndAt).toLocaleDateString() : "—"} />
                          <InfoRow label="Note" value={sub.internalNote} />
                        </dl>
                      </div>

                      {/* Trial Actions */}
                      {sub.status === "trial" && (
                        <div className="rounded-xl border border-[#00D4FF]/20 bg-[#00D4FF]/5 p-4">
                          <h3 className="mb-3 text-sm font-semibold text-[#00D4FF]">Trial Actions</h3>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => setShowConvertModal(true)}
                              className="rounded-lg border border-emerald-700 px-3 py-1.5 text-sm text-emerald-400 hover:bg-emerald-950/30">
                              ✓ Convert Trial to Paid
                            </button>
                            <button
                              onClick={async () => {
                                const days = window.prompt("Extend trial by how many additional days?");
                                if (!days || isNaN(Number(days)) || Number(days) <= 0) return;
                                const r = await fetch(`/trials/${sub.id}/extend`, {
                                  method: "POST",
                                  body: JSON.stringify({ additionalDays: Number(days), reason: "Extended from platform console" }),
                                });
                                if (r.ok) load(); else { const d = await r.json(); alert(d.error?.message ?? "Error extending trial."); }
                              }}
                              className="rounded-lg border border-[#1E3A5F] px-3 py-1.5 text-sm text-[#00D4FF] hover:bg-[#1E3A5F]">
                              + Extend Trial
                            </button>
                            <button
                              onClick={async () => {
                                if (!window.confirm("Cancel this trial? This will end the trial period.")) return;
                                const r = await fetch(`/trials/${sub.id}/cancel`, {
                                  method: "POST",
                                  body: JSON.stringify({ reason: "Cancelled from platform console" }),
                                });
                                if (r.ok) load(); else { const d = await r.json(); alert(d.error?.message ?? "Error cancelling trial."); }
                              }}
                              className="rounded-lg border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/30">
                              ✕ Cancel Trial
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Convert Trial Modal */}
                  {showConvertModal && sub && (
                    <ConvertTrialModal
                      subId={sub.id}
                      fetch={fetch}
                      onClose={() => setShowConvertModal(false)}
                      onSuccess={load}
                    />
                  )}
                </div>
              )}

              {/* MEMBERS */}
              {activeTab === "members" && (
                <div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#1E3A5F] text-left text-xs text-[#64748B]">
                        <th className="pb-2">User</th><th className="pb-2">Email</th><th className="pb-2">Role</th><th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E3A5F]">
                      {data.members.map((m, i) => (
                        <tr key={i}>
                          <td className="py-2 text-[#E2E8F0]">{m.user?.firstName} {m.user?.lastName}</td>
                          <td className="py-2 text-[#94A3B8]">{m.user?.email}</td>
                          <td className="py-2 text-[#94A3B8] capitalize">{m.membership.role}</td>
                          <td className="py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${m.membership.status === "active" ? "bg-emerald-950/30 text-emerald-400" : "bg-[#1E3A5F] text-[#94A3B8]"}`}>{m.membership.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* INVITATIONS */}
              {activeTab === "invitations" && (
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[#E2E8F0]">Staff Invitations</h3>
                    <button
                      onClick={() => { setShowInviteForm(true); setInvFormError(""); }}
                      className="rounded-lg border border-[#00D4FF]/40 px-3 py-1.5 text-sm text-[#00D4FF] hover:bg-[#00D4FF]/10"
                    >
                      + Send Invitation
                    </button>
                  </div>

                  {invLoading && <div className="text-sm text-[#64748B]">Loading…</div>}
                  {invError && <div className="rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-400">{invError}</div>}

                  {!invLoading && invitations.length === 0 && (
                    <p className="text-sm text-[#4A5568]">No invitations for this organisation.</p>
                  )}

                  {!invLoading && invitations.length > 0 && (
                    <div className="space-y-2">
                      {invitations.map((inv: any) => {
                        const isPending = inv.status === "pending";
                        const devUrl = invPreviewUrls[inv.id];
                        return (
                          <div key={inv.id} className="rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-3">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm text-[#E2E8F0]">{inv.email}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                                    inv.role === "owner" ? "bg-[#00D4FF]/10 text-[#00D4FF]" :
                                    inv.role === "administrator" ? "bg-violet-900/20 text-violet-400" :
                                    "bg-[#1E3A5F] text-[#94A3B8]"
                                  }`}>{inv.role}</span>
                                  <span className={`text-xs capitalize ${
                                    isPending ? "text-[#00D4FF]" :
                                    inv.status === "accepted" ? "text-emerald-400" : "text-[#4A5568]"
                                  }`}>{inv.status}</span>
                                </div>
                                {inv.expiresAt && isPending && (
                                  <div className="mt-0.5 text-xs text-[#4A5568]">
                                    Expires {new Date(inv.expiresAt).toLocaleDateString("en-AU")}
                                  </div>
                                )}
                                {isDev && devUrl && isPending && (
                                  <div className="mt-1">
                                    <a href={devUrl} target="_blank" rel="noopener noreferrer"
                                      className="text-xs text-yellow-400 hover:text-yellow-300 underline">
                                      🔗 Open invitation preview
                                    </a>
                                    <span className="ml-1 text-[10px] text-[#4A5568]">(dev only)</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Send Invitation Form */}
                  {showInviteForm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={() => setShowInviteForm(false)}>
                      <div className="w-full max-w-md rounded-2xl border border-[#1E3A5F] bg-[#112033] p-6" onClick={e => e.stopPropagation()}>
                        <h2 className="mb-4 text-lg font-semibold text-[#E2E8F0]">Send Staff Invitation</h2>
                        <div className="space-y-4">
                          <div>
                            <label className="mb-1 block text-sm text-[#E2E8F0]">Email address</label>
                            <input
                              type="email"
                              value={invEmail}
                              onChange={e => setInvEmail(e.target.value)}
                              placeholder="colleague@org.com.au"
                              autoFocus
                              className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-sm text-[#E2E8F0]">Role</label>
                            <select
                              value={invRole}
                              onChange={e => setInvRole(e.target.value)}
                              className="w-full rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-3 py-2.5 text-sm text-[#E2E8F0] focus:border-[#00D4FF] focus:outline-none"
                            >
                              {["administrator","manager","member","viewer","auditor"].map(r => (
                                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                              ))}
                            </select>
                          </div>
                          {invFormError && <p className="text-sm text-red-400">{invFormError}</p>}
                        </div>
                        <div className="mt-6 flex gap-3">
                          <button onClick={() => setShowInviteForm(false)} className="flex-1 rounded-lg border border-[#1E3A5F] px-4 py-2.5 text-sm text-[#E2E8F0] hover:border-[#00D4FF]">
                            Cancel
                          </button>
                          <button
                            onClick={sendInvitation}
                            disabled={invBusy || !invEmail}
                            className="flex-1 rounded-lg bg-[#00D4FF] px-4 py-2.5 text-sm font-semibold text-[#0B1829] hover:bg-[#00B8D9] disabled:opacity-50"
                          >
                            {invBusy ? "Sending…" : "Send invitation"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* WORKFORCE */}
              {activeTab === "workforce" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[#E2E8F0]">Workforce Packs</h3>
                    <button
                      onClick={() => setShowGrantPack(true)}
                      className="rounded-lg border border-[#00D4FF]/40 px-3 py-1.5 text-sm text-[#00D4FF] hover:bg-[#00D4FF]/10">
                      + Grant Pack
                    </button>
                  </div>

                  {data.workforcePacks.length === 0 && (
                    <p className="text-sm text-[#4A5568]">No workforce packs granted.</p>
                  )}
                  <div className="space-y-2">
                    {data.workforcePacks.map((p, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-3">
                        <div>
                          <span className="font-mono text-sm text-[#E2E8F0]">{p.packCode}</span>
                          {p.source && <span className="ml-2 text-xs text-[#4A5568]">via {p.source}</span>}
                          {p.grantedAt && <div className="text-xs text-[#4A5568]">Granted {new Date(p.grantedAt).toLocaleDateString()}</div>}
                        </div>
                        <button
                          onClick={() => revokePackAction(p.packCode)}
                          className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-950/20">
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>

                  {showGrantPack && (
                    <GrantPackPanel
                      orgId={org.id}
                      fetch={fetch}
                      onClose={() => setShowGrantPack(false)}
                      onSuccess={load}
                    />
                  )}
                </div>
              )}

              {/* USAGE */}
              {activeTab === "usage" && (
                <div>
                  {data.usageSummary.length === 0 && <p className="text-sm text-[#4A5568]">No usage recorded yet.</p>}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#1E3A5F] text-left text-xs text-[#64748B]">
                        <th className="pb-2">Dimension</th><th className="pb-2">Total</th><th className="pb-2">Events</th><th className="pb-2">Period Start</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E3A5F]">
                      {data.usageSummary.map((u, i) => (
                        <tr key={i}>
                          <td className="py-2 font-mono text-xs text-[#00D4FF]">{u.dimensionCode}</td>
                          <td className="py-2 text-[#E2E8F0]">{u.totalQuantity}</td>
                          <td className="py-2 text-[#94A3B8]">{u.eventCount}</td>
                          <td className="py-2 text-[#4A5568]">{u.periodStart ? new Date(u.periodStart).toLocaleDateString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ENTITLEMENTS */}
              {activeTab === "entitlements" && (
                <div>
                  {data.entitlements.length === 0 && <p className="text-sm text-[#4A5568]">No entitlements.</p>}
                  <div className="space-y-2">
                    {data.entitlements.map((e, i) => (
                      <div key={i} className="rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-2 text-sm">
                        <span className="font-mono text-[#00D4FF]">{e.featureCode}</span>
                        <span className={`ml-3 text-xs ${e.isGranted ? "text-emerald-400" : "text-red-400"}`}>
                          {e.isGranted ? "granted" : "denied"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* OVERRIDES */}
              {activeTab === "overrides" && (
                <div>
                  {data.allOverrides.length === 0 && <p className="text-sm text-[#4A5568]">No overrides.</p>}
                  <div className="space-y-2">
                    {data.allOverrides.map((o, i) => (
                      <div key={i} className={`rounded-lg border px-4 py-3 text-sm ${o.isActive ? "border-[#00D4FF]/30 bg-[#00D4FF]/5" : "border-[#1E3A5F] opacity-50"}`}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-[#00D4FF]">{o.overrideType}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-xs ${o.isActive ? "bg-emerald-950/30 text-emerald-400" : "bg-[#1E3A5F] text-[#64748B]"}`}>
                            {o.isActive ? "active" : "revoked"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[#94A3B8]">{o.reason}</p>
                        <p className="mt-0.5 text-xs text-[#4A5568]">Created {o.createdAt ? new Date(o.createdAt).toLocaleString() : "—"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* NOTES */}
              {activeTab === "notes" && (
                <div className="space-y-4">
                  {/* Add note form */}
                  <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-4">
                    <h3 className="mb-3 text-sm font-semibold text-[#E2E8F0]">Add Internal Note</h3>
                    <textarea
                      value={noteContent}
                      onChange={e => setNoteContent(e.target.value)}
                      placeholder="Note content (never visible to customer)…"
                      rows={3}
                      className="w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] p-2 text-sm text-[#E2E8F0] placeholder-[#4A5568]"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <select value={notePriority} onChange={e => setNotePriority(e.target.value)}
                        className="rounded border border-[#1E3A5F] bg-[#08111e] px-2 py-1 text-xs text-[#E2E8F0]">
                        <option value="low">Low</option><option value="medium">Medium</option>
                        <option value="high">High</option><option value="critical">Critical</option>
                      </select>
                      <select value={noteCategory} onChange={e => setNoteCategory(e.target.value)}
                        className="rounded border border-[#1E3A5F] bg-[#08111e] px-2 py-1 text-xs text-[#E2E8F0]">
                        <option value="general">General</option><option value="support">Support</option>
                        <option value="billing">Billing</option><option value="security">Security</option>
                        <option value="technical">Technical</option>
                      </select>
                      <label className="flex items-center gap-1.5 text-xs text-yellow-400">
                        <input type="checkbox" checked={noteFlagged} onChange={e => setNoteFlagged(e.target.checked)} className="accent-yellow-400" />
                        Flag for security review
                      </label>
                      <button onClick={submitNote} disabled={noteBusy}
                        className="ml-auto rounded-lg bg-[#00D4FF] px-4 py-1.5 text-sm font-semibold text-[#0B1829] disabled:opacity-50">
                        {noteBusy ? "Saving…" : "Add Note"}
                      </button>
                    </div>
                  </div>

                  {/* Existing notes */}
                  {data.internalNotes.map((n, i) => (
                    <div key={i} className={`rounded-lg border px-4 py-3 ${n.isFlagged ? "border-yellow-800 bg-yellow-950/10" : "border-[#1E3A5F] bg-[#0B1829]"}`}>
                      <div className="mb-1 flex items-center gap-2">
                        <span className={`rounded-full px-1.5 py-0.5 text-xs capitalize ${
                          n.priority === "critical" ? "bg-red-950/30 text-red-400" :
                          n.priority === "high" ? "bg-orange-950/30 text-orange-400" :
                          n.priority === "medium" ? "bg-yellow-950/30 text-yellow-400" :
                          "bg-[#1E3A5F] text-[#94A3B8]"
                        }`}>{n.priority}</span>
                        <span className="text-xs text-[#64748B] capitalize">{n.category}</span>
                        {n.isFlagged && <span className="text-xs text-yellow-400">⚑ Flagged</span>}
                        <span className="ml-auto text-xs text-[#4A5568]">{n.createdAt ? new Date(n.createdAt).toLocaleString() : "—"}</span>
                      </div>
                      <p className="text-sm text-[#E2E8F0] whitespace-pre-wrap">{n.content}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* TASKS */}
              {activeTab === "tasks" && (
                <div>
                  {data.tasks.length === 0 && <p className="text-sm text-[#4A5568]">No tasks yet.</p>}
                  <div className="space-y-2">
                    {data.tasks.map((t, i) => (
                      <div key={i} className="rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-3 text-sm">
                        <div className="font-medium text-[#E2E8F0]">{t.title}</div>
                        <div className="text-xs text-[#4A5568]">{t.status} · {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* APPROVALS */}
              {activeTab === "approvals" && (
                <div>
                  {data.approvals.length === 0 && <p className="text-sm text-[#4A5568]">No approvals yet.</p>}
                  <div className="space-y-2">
                    {data.approvals.map((a, i) => (
                      <div key={i} className="rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-3 text-sm">
                        <div className="font-medium text-[#E2E8F0]">{a.workflowType}</div>
                        <div className="text-xs text-[#4A5568]">{a.state} · {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AUDIT */}
              {activeTab === "audit" && (
                <div className="space-y-2">
                  {data.usageSummary.length === 0 && <p className="text-sm text-[#4A5568]">Load audit from the Audit tab directly.</p>}
                  <a href={`/platform/audit?orgId=${org.id}`}
                    className="inline-block rounded-lg border border-[#1E3A5F] px-3 py-1.5 text-sm text-[#00D4FF] hover:bg-[#1E3A5F]">
                    View full audit for this org →
                  </a>
                </div>
              )}

              {/* SECURITY */}
              {activeTab === "security" && (
                <div className="space-y-4">
                  <p className="text-sm text-[#64748B]">Security flags and suspension history for this organisation.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        const reason = prompt("Security flag reason (required):");
                        if (!reason) return;
                        await fetch(`/organisations/${org.id}/flag-security`, { method: "POST", body: JSON.stringify({ reason }) });
                        load();
                      }}
                      className="rounded-lg border border-yellow-800 px-3 py-1.5 text-sm text-yellow-400 hover:bg-yellow-950/30">
                      ⚑ Flag for Security Review
                    </button>
                    <button
                      onClick={async () => {
                        const reason = prompt("High priority reason (required):");
                        if (!reason) return;
                        await fetch(`/organisations/${org.id}/mark-high-priority`, { method: "POST", body: JSON.stringify({ reason }) });
                        load();
                      }}
                      className="rounded-lg border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/30">
                      ⚠ Mark High Priority
                    </button>
                  </div>
                  <p className="text-xs text-[#4A5568]">All actions are logged to the platform audit log.</p>
                </div>
              )}

              {/* PLACEHOLDERS */}
              {activeTab === "placeholders" && (
                <div className="space-y-3">
                  {Object.entries(data.placeholders ?? {}).map(([k, v]: [string, any]) => (
                    <div key={k} className="rounded-lg border border-[#1E3A5F] bg-[#0B1829] p-4">
                      <div className="font-medium capitalize text-[#E2E8F0]">{k}</div>
                      <div className="mt-1 text-sm text-[#64748B]">{v.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
