import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

export default function AuditPage() {
  const { slug } = useParams<{ slug: string }>();
  const apiFetch = useAuthFetch();
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["org-audit", slug, page, eventType],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (eventType) params.set("eventType", eventType);
      return apiFetch(`/v1/organisations/${slug}/audit?${params}`).then(r => r.json());
    },
    enabled: !!slug,
  });

  const events = data?.events ?? [];

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Audit Log</h1>
              <p className="text-[#64748B] text-sm mt-1">All activity in this organisation</p>
            </div>
            <select value={eventType} onChange={e => { setEventType(e.target.value); setPage(1); }} className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-[#E2E8F0] text-sm focus:outline-none focus:border-[#00D4FF]">
              <option value="">All events</option>
              {["user.logged_in","organisation.created","organisation.updated","membership.created","membership.role_changed","invitation.created","invitation.accepted"].map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1E3A5F]">
                  {["Time","Event","Resource","Actor"].map(h => <th key={h} className="px-6 py-3 text-left text-xs font-medium text-[#64748B] uppercase tracking-wider">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4} className="px-6 py-8 text-[#64748B] text-sm text-center">Loading...</td></tr>
                ) : events.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-8 text-[#64748B] text-sm text-center">No events found</td></tr>
                ) : events.map((e: { id: string; eventType: string; resourceType: string; resourceId: string | null; actorType: string; occurredAt: string }) => (
                  <tr key={e.id} className="border-b border-[#1E3A5F] last:border-0 hover:bg-[#0B1829] transition-colors">
                    <td className="px-6 py-3.5 text-[#64748B] text-xs whitespace-nowrap">{new Date(e.occurredAt).toLocaleString("en-AU")}</td>
                    <td className="px-6 py-3.5"><span className="text-[#E2E8F0] text-sm">{e.eventType}</span></td>
                    <td className="px-6 py-3.5 text-[#64748B] text-sm">{e.resourceType}{e.resourceId ? <span className="ml-1 font-mono text-xs">{e.resourceId.slice(0,8)}…</span> : null}</td>
                    <td className="px-6 py-3.5 text-[#64748B] text-sm">{e.actorType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {events.length > 0 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-[#1E3A5F]">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1} className="text-sm text-[#64748B] hover:text-[#E2E8F0] disabled:opacity-40">← Prev</button>
                <span className="text-[#64748B] text-sm">Page {page}</span>
                <button onClick={() => setPage(p => p+1)} disabled={events.length < 20} className="text-sm text-[#64748B] hover:text-[#E2E8F0] disabled:opacity-40">Next →</button>
              </div>
            )}
          </div>
        </div>
      </AppShell>
    </>
  );
}
