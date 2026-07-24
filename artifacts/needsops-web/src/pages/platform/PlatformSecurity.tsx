/**
 * Platform Security — /platform/security
 * Suspended orgs, flags, recent actions, login activity.
 */
import { useEffect, useState } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

export default function PlatformSecurity() {
  const fetch = usePlatformFetch();
  const [overview, setOverview] = useState<any>(null);
  const [flags, setFlags] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [logins, setLogins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"overview" | "flags" | "actions" | "logins">("overview");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/security/overview").then(r => r.json()),
      fetch("/security/flags").then(r => r.json()),
      fetch("/security/actions?limit=50").then(r => r.json()),
      fetch("/security/logins").then(r => r.json()),
    ]).then(([ov, fl, ac, lo]) => {
      setOverview(ov);
      setFlags(fl.flags ?? []);
      setActions(ac.events ?? []);
      setLogins(lo.logins ?? []);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Security</h1>
          {overview?.suspendedOrganisations > 0 && (
            <span className="rounded-full bg-yellow-950/30 px-2 py-0.5 text-xs font-medium text-yellow-400">
              {overview.suspendedOrganisations} suspended
            </span>
          )}
        </header>

        <div className="flex shrink-0 border-b border-[#1E3A5F] bg-[#08111e]">
          {(["overview", "flags", "actions", "logins"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2.5 text-sm capitalize ${view === v ? "border-b-2 border-[#00D4FF] text-[#00D4FF]" : "text-[#64748B] hover:text-[#E2E8F0]"}`}>
              {v}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
          </div>
        )}

        {!loading && (
          <div className="flex-1 overflow-y-auto p-6">
            {/* OVERVIEW */}
            {view === "overview" && overview && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-yellow-800 bg-yellow-950/10 p-4 text-center">
                    <div className="text-2xl font-bold text-yellow-400">{overview.suspendedOrganisations}</div>
                    <div className="text-xs text-[#64748B]">Suspended Orgs</div>
                  </div>
                  <div className="rounded-xl border border-yellow-800 bg-yellow-950/10 p-4 text-center">
                    <div className="text-2xl font-bold text-yellow-400">{(overview.flaggedNotes ?? []).length}</div>
                    <div className="text-xs text-[#64748B]">Security Flags</div>
                  </div>
                  <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-4 text-center">
                    <div className="text-2xl font-bold text-[#E2E8F0]">{(overview.recentSecurityActions ?? []).length}</div>
                    <div className="text-xs text-[#64748B]">Recent Actions</div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-4">
                  <h3 className="mb-3 text-sm font-semibold text-[#E2E8F0]">Recent Security Actions</h3>
                  <div className="space-y-2">
                    {(overview.recentSecurityActions ?? []).slice(0, 10).map((evt: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00D4FF]" />
                        <span className="text-[#E2E8F0]">{evt.eventType}</span>
                        <span className="ml-auto text-xs text-[#4A5568]">{evt.createdAt ? new Date(evt.createdAt).toLocaleString() : "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-4">
                  <h3 className="mb-2 text-sm font-semibold text-[#E2E8F0]">Pending Integrations</h3>
                  {Object.entries(overview.placeholders ?? {}).map(([k, v]: [string, any]) => (
                    <p key={k} className="text-xs text-[#4A5568]">• {v}</p>
                  ))}
                </div>
              </div>
            )}

            {/* FLAGS */}
            {view === "flags" && (
              <div className="space-y-2">
                {flags.length === 0 && <p className="text-sm text-[#4A5568]">No security flags.</p>}
                {flags.map((item: any, i: number) => (
                  <div key={i} className="rounded-lg border border-yellow-800 bg-yellow-950/10 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-yellow-400">⚑</span>
                      <a href={`/platform/organisations/${item.org?.id}`} className="text-sm font-medium text-[#00D4FF] hover:underline">{item.org?.name}</a>
                      <span className="text-xs text-[#4A5568]">{item.note.createdAt ? new Date(item.note.createdAt).toLocaleString() : "—"}</span>
                    </div>
                    <p className="mt-1 text-sm text-[#E2E8F0]">{item.note.content}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ACTIONS */}
            {view === "actions" && (
              <div className="space-y-2">
                {actions.map((evt: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-3">
                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#00D4FF]" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#E2E8F0]">{evt.eventType}</span>
                        {evt.organizationId && <span className="text-xs text-[#4A5568]">org: {evt.organizationId}</span>}
                      </div>
                      <div className="text-xs text-[#4A5568]">{evt.createdAt ? new Date(evt.createdAt).toLocaleString() : "—"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* LOGINS */}
            {view === "logins" && (
              <div className="space-y-2">
                {logins.length === 0 && <p className="text-sm text-[#4A5568]">No login events recorded.</p>}
                {logins.map((evt: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-3 text-sm">
                    <span className="text-[#E2E8F0]">{evt.eventType}</span>
                    <span className="text-xs text-[#4A5568]">{evt.actorUserId ?? "system"}</span>
                    <span className="ml-auto text-xs text-[#4A5568]">{evt.createdAt ? new Date(evt.createdAt).toLocaleString() : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
