/**
 * Platform Settings — /platform/settings
 * Feature flags, platform configuration, platform role management.
 */
import { useEffect, useState, useCallback } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

type View = "flags" | "config" | "roles";

export default function PlatformSettings() {
  const fetch = usePlatformFetch();
  const [view, setView] = useState<View>("flags");
  const [flags, setFlags] = useState<any[]>([]);
  const [config, setConfig] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/settings/flags").then(r => r.json()),
      fetch("/settings/config").then(r => r.json()),
      fetch("/settings/roles").then(r => r.json()),
    ]).then(([f, c, r]) => {
      setFlags(f.flags ?? []);
      setConfig(c.settings ?? []);
      setRoles(r.roles ?? []);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadAll(); }, []);

  const toggleFlag = async (key: string, currentValue: boolean) => {
    setBusy(key);
    try {
      const r = await fetch(`/settings/flags/${key}`, {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: !currentValue }),
      });
      if (r.ok) {
        setFlags(prev => prev.map(f => f.key === key ? { ...f, isEnabled: !currentValue } : f));
      } else {
        const d = await r.json();
        setError(d.error?.message ?? "Failed to update flag.");
      }
    } finally { setBusy(null); }
  };

  const createFlag = async () => {
    const key = prompt("Feature flag key (e.g. new_onboarding):");
    if (!key) return;
    const label = prompt("Label:");
    if (!label) return;
    const r = await fetch("/settings/flags", {
      method: "POST",
      body: JSON.stringify({ key, label, isEnabled: false }),
    });
    if (r.ok) loadAll();
  };

  const updateConfig = async (key: string, currentValue: any) => {
    const raw = prompt(`New value for "${key}" (JSON or plain):`, JSON.stringify(currentValue));
    if (!raw) return;
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    const r = await fetch(`/settings/config/${key}`, { method: "PUT", body: JSON.stringify({ value }) });
    if (r.ok) loadAll();
  };

  const createConfig = async () => {
    const key = prompt("Setting key:");
    if (!key) return;
    const label = prompt("Label:");
    if (!label) return;
    const raw = prompt("Value (JSON or plain):");
    if (!raw) return;
    let value;
    try { value = JSON.parse(raw!); } catch { value = raw; }
    const r = await fetch(`/settings/config/${key}`, { method: "PUT", body: JSON.stringify({ value, label }) });
    if (r.ok) loadAll();
  };

  const grantRole = async () => {
    const userId = prompt("User ID to grant a platform role to:");
    if (!userId) return;
    const role = prompt("Role (e.g. platform_support_admin):");
    if (!role) return;
    const reason = prompt("Grant reason:");
    const r = await fetch("/settings/roles", {
      method: "POST",
      body: JSON.stringify({ userId, role, grantReason: reason }),
    });
    if (r.ok) loadAll();
    else alert("Error granting role. Check the role name.");
  };

  const revokeRole = async (userId: string, email: string) => {
    if (!confirm(`Revoke all platform roles for ${email}?`)) return;
    const r = await fetch(`/settings/roles/${userId}`, { method: "DELETE" });
    if (r.ok) loadAll();
  };

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Platform Settings</h1>
          <span className="ml-3 text-xs text-[#4A5568]">Super Admin only — all actions are audited</span>
        </header>

        <div className="flex shrink-0 border-b border-[#1E3A5F] bg-[#08111e]">
          {([
            { id: "flags", label: "Feature Flags" },
            { id: "config", label: "Platform Config" },
            { id: "roles", label: "Platform Roles" },
          ] as { id: View; label: string }[]).map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`px-4 py-2.5 text-sm ${view === v.id ? "border-b-2 border-[#00D4FF] text-[#00D4FF]" : "text-[#64748B] hover:text-[#E2E8F0]"}`}>
              {v.label}
            </button>
          ))}
        </div>

        {error && <div className="mx-6 mt-3 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-400">{error}</div>}

        {loading && <div className="flex flex-1 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" /></div>}

        {!loading && (
          <div className="flex-1 overflow-y-auto p-6">
            {/* FEATURE FLAGS */}
            {view === "flags" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#E2E8F0]">Feature Flags</h2>
                  <button onClick={createFlag} className="rounded-lg border border-[#1E3A5F] px-3 py-1.5 text-sm text-[#64748B] hover:text-[#00D4FF]">
                    + New Flag
                  </button>
                </div>

                {flags.length === 0 && (
                  <p className="text-sm text-[#4A5568]">No feature flags defined. Create one to toggle platform capabilities.</p>
                )}

                {flags.map(flag => (
                  <div key={flag.key} className="flex items-center gap-4 rounded-xl border border-[#1E3A5F] bg-[#0B1829] px-4 py-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-[#E2E8F0]">{flag.key}</span>
                        <span className="text-xs text-[#64748B]">{flag.label}</span>
                      </div>
                      {flag.description && <p className="text-xs text-[#4A5568]">{flag.description}</p>}
                      {flag.updatedBy && <p className="text-xs text-[#4A5568]">Last changed by: {flag.updatedBy}</p>}
                    </div>
                    <button
                      onClick={() => toggleFlag(flag.key, flag.isEnabled)}
                      disabled={busy === flag.key}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                        flag.isEnabled ? "bg-[#00D4FF]" : "bg-[#1E3A5F]"
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        flag.isEnabled ? "translate-x-6" : "translate-x-1"
                      }`} />
                    </button>
                    <span className={`text-xs font-medium w-14 text-right ${flag.isEnabled ? "text-emerald-400" : "text-[#4A5568]"}`}>
                      {busy === flag.key ? "…" : flag.isEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* PLATFORM CONFIG */}
            {view === "config" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#E2E8F0]">Platform Configuration</h2>
                  <button onClick={createConfig} className="rounded-lg border border-[#1E3A5F] px-3 py-1.5 text-sm text-[#64748B] hover:text-[#00D4FF]">
                    + New Setting
                  </button>
                </div>

                {config.length === 0 && (
                  <p className="text-sm text-[#4A5568]">No platform settings defined.</p>
                )}

                {config.map(s => (
                  <div key={s.key} className="flex items-center gap-4 rounded-xl border border-[#1E3A5F] bg-[#0B1829] px-4 py-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-[#E2E8F0]">{s.key}</span>
                        <span className="text-xs text-[#64748B]">{s.label}</span>
                      </div>
                      {s.description && <p className="text-xs text-[#4A5568]">{s.description}</p>}
                      <div className="mt-1 font-mono text-xs text-[#00D4FF]">
                        {JSON.stringify(s.value)}
                      </div>
                    </div>
                    <button onClick={() => updateConfig(s.key, s.value)}
                      className="rounded border border-[#1E3A5F] px-2 py-1 text-xs text-[#64748B] hover:text-[#00D4FF]">
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* PLATFORM ROLES */}
            {view === "roles" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#E2E8F0]">Platform Role Grants</h2>
                  <button onClick={grantRole} className="rounded-lg bg-[#00D4FF] px-3 py-1.5 text-sm font-semibold text-[#0B1829]">
                    + Grant Role
                  </button>
                </div>

                {roles.length === 0 && <p className="text-sm text-[#4A5568]">No platform roles granted yet.</p>}

                <div className="overflow-hidden rounded-xl border border-[#1E3A5F]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#1E3A5F] bg-[#0B1829] text-left text-xs text-[#64748B]">
                        <th className="px-4 py-3">User</th>
                        <th className="px-4 py-3">Role</th>
                        <th className="px-4 py-3">Granted</th>
                        <th className="px-4 py-3">Reason</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E3A5F]">
                      {roles.map((item: any, i: number) => (
                        <tr key={i}>
                          <td className="px-4 py-3">
                            <div className="text-[#E2E8F0]">{item.user?.firstName} {item.user?.lastName}</div>
                            <div className="text-xs text-[#4A5568]">{item.user?.email}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-[#00D4FF]">{item.role?.role}</td>
                          <td className="px-4 py-3 text-xs text-[#64748B]">
                            {item.role?.grantedAt ? new Date(item.role.grantedAt).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-[#4A5568]">{item.role?.grantReason ?? "—"}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => revokeRole(item.role?.userId, item.user?.email ?? item.role?.userId)}
                              className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-950/30">
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
