/**
 * Platform Audit Log — /platform/audit
 * Full cross-org audit log with filters.
 */
import { useEffect, useState, useCallback } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

export default function PlatformAudit() {
  const fetch = usePlatformFetch();
  const [events, setEvents] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [eventType, setEventType] = useState("");
  const [orgId, setOrgId] = useState("");
  const [actorId, setActorId] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  const load = useCallback((pg: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(pg), limit: "50" });
    if (eventType) params.set("eventType", eventType);
    if (orgId) params.set("orgId", orgId);
    if (actorId) params.set("actorId", actorId);
    if (since) params.set("since", since);
    if (until) params.set("until", until);

    fetch(`/audit?${params}`)
      .then(r => r.json())
      .then(d => { setEvents(d.events ?? []); setTotal(d.total ?? 0); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [eventType, orgId, actorId, since, until]);

  useEffect(() => { load(page); }, [page]);

  // Read orgId from URL query
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("orgId");
    if (q) setOrgId(q);
  }, []);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); load(1); };

  const EVENT_GROUPS: Record<string, string> = {
    "platform.": "Platform",
    "tenant.": "Tenant",
    "usage.": "Usage",
    "user.": "User",
    "task.": "Task",
    "approval.": "Approval",
  };

  const getGroup = (type: string) => {
    for (const [prefix, label] of Object.entries(EVENT_GROUPS)) {
      if (type.startsWith(prefix)) return label;
    }
    return "Other";
  };

  const groupColor: Record<string, string> = {
    Platform: "text-[#00D4FF]",
    Tenant: "text-emerald-400",
    Usage: "text-purple-400",
    User: "text-blue-400",
    Task: "text-yellow-400",
    Approval: "text-orange-400",
    Other: "text-[#94A3B8]",
  };

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Audit Log</h1>
          <span className="text-sm text-[#64748B]">{total.toLocaleString()} total events</span>
        </header>

        {/* Filters */}
        <form onSubmit={handleSearch} className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#1E3A5F] bg-[#0B1829] px-6 py-3">
          <input value={eventType} onChange={e => setEventType(e.target.value)} placeholder="Event type (e.g. platform.org…)"
            className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none w-52" />
          <input value={orgId} onChange={e => setOrgId(e.target.value)} placeholder="Org ID"
            className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none w-40" />
          <input value={actorId} onChange={e => setActorId(e.target.value)} placeholder="Actor ID"
            className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none w-40" />
          <input type="date" value={since} onChange={e => setSince(e.target.value)}
            className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-2 py-1.5 text-sm text-[#E2E8F0]" />
          <span className="text-xs text-[#4A5568]">to</span>
          <input type="date" value={until} onChange={e => setUntil(e.target.value)}
            className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-2 py-1.5 text-sm text-[#E2E8F0]" />
          <button type="submit" className="rounded-lg bg-[#00D4FF] px-3 py-1.5 text-sm font-semibold text-[#0B1829]">Filter</button>
          <button type="button" onClick={() => { setEventType(""); setOrgId(""); setActorId(""); setSince(""); setUntil(""); setPage(1); load(1); }}
            className="rounded-lg border border-[#1E3A5F] px-3 py-1.5 text-sm text-[#64748B] hover:text-[#E2E8F0]">Clear</button>
        </form>

        {/* Events */}
        {loading && <div className="flex flex-1 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" /></div>}
        {error && <div className="m-4 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-400">{error}</div>}

        {!loading && (
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#0B1829]">
                <tr className="border-b border-[#1E3A5F] text-left text-xs text-[#64748B]">
                  <th className="px-6 py-3">Event</th>
                  <th className="px-4 py-3">Org</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A5F]">
                {events.map((evt: any, i: number) => {
                  const group = getGroup(evt.eventType ?? "");
                  return (
                    <tr key={i} className="hover:bg-[#0B1829]/50">
                      <td className="px-6 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${groupColor[group] ?? "text-[#94A3B8]"}`}>{group}</span>
                          <span className="font-mono text-xs text-[#E2E8F0]">{evt.eventType}</span>
                        </div>
                        {evt.metadata && Object.keys(evt.metadata).length > 0 && (
                          <div className="mt-0.5 truncate text-xs text-[#4A5568]">
                            {JSON.stringify(evt.metadata).slice(0, 80)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[#64748B]">
                        {evt.organizationId ? (
                          <a href={`/platform/organisations/${evt.organizationId}`} className="hover:text-[#00D4FF]">
                            {evt.organizationId.slice(0, 8)}…
                          </a>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[#64748B]">
                        {evt.actorUserId ? evt.actorUserId.slice(0, 12) + "…" : evt.actorType ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[#4A5568] whitespace-nowrap">
                        {evt.occurredAt ? new Date(evt.occurredAt).toLocaleString() :
                         evt.createdAt ? new Date(evt.createdAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  );
                })}
                {events.length === 0 && !loading && (
                  <tr><td colSpan={4} className="py-12 text-center text-sm text-[#4A5568]">No audit events match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex shrink-0 items-center justify-between border-t border-[#1E3A5F] px-6 py-3 text-sm text-[#64748B]">
          <span>Page {page} · {total.toLocaleString()} total</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="rounded px-3 py-1 hover:bg-[#1E3A5F] disabled:opacity-40">← Prev</button>
            <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}
              className="rounded px-3 py-1 hover:bg-[#1E3A5F] disabled:opacity-40">Next →</button>
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
