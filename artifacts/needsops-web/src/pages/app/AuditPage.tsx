/**
 * Audit Log — /app/:slug/audit
 *
 * Sprint 24 improvement. Rich display of org audit events with:
 *   - Expanded event type filter (governance-aware)
 *   - Date range filter
 *   - Who / When / Why / Source / Affected resource columns
 *   - Expandable row for metadata and IP context
 *   - Link to Governance Timeline for governance-specific events
 */

import { useState }               from "react";
import { useParams, useLocation } from "wouter";
import { useQuery }               from "@tanstack/react-query";
import { Show }                   from "@clerk/react";
import { Redirect }               from "wouter";
import AppShell                   from "@/components/layout/AppShell";
import { useAuthFetch }           from "@/lib/api";

const EVENT_GROUPS: { label: string; types: string[] }[] = [
  {
    label: "Knowledge",
    types: [
      "knowledge.approved","knowledge.rejected","knowledge.source.approved",
      "knowledge.source.rejected","knowledge.source.revoked",
      "knowledge.curation.completed",
    ],
  },
  {
    label: "Memory",
    types: ["memory.approved","memory.rejected","memory.proposed","memory.superseded"],
  },
  {
    label: "Approvals",
    types: ["approval.granted","approval.rejected","approval.requested"],
  },
  {
    label: "Specialist",
    types: ["specialist.trained","specialist.readiness.changed"],
  },
  {
    label: "Work",
    types: ["work.approved","work.rejected","work.completed"],
  },
  {
    label: "Organisation",
    types: [
      "organisation.created","organisation.updated",
      "membership.created","membership.role_changed",
      "invitation.created","invitation.accepted",
    ],
  },
  {
    label: "Access",
    types: ["user.logged_in","user.session_started","access.denied"],
  },
];

const GOVERNANCE_TYPES = new Set([
  "knowledge.approved","knowledge.rejected","knowledge.source.approved",
  "knowledge.source.rejected","knowledge.source.revoked",
  "knowledge.curation.completed","memory.approved","memory.rejected",
  "memory.proposed","memory.superseded","approval.granted","approval.rejected",
  "approval.requested","specialist.trained","work.approved","work.rejected",
]);

function eventBulletColour(type: string): string {
  if (type.includes("approved") || type.includes("granted") || type.includes("completed")) return "bg-emerald-400";
  if (type.includes("rejected") || type.includes("denied") || type.includes("revoked"))    return "bg-red-400";
  if (type.includes("proposed") || type.includes("requested") || type.includes("created")) return "bg-amber-400";
  if (type.includes("role") || type.includes("updated"))                                   return "bg-blue-400";
  return "bg-[#64748B]";
}

function formatTs(s: string) {
  return new Date(s).toLocaleString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function AuditPage() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();

  const [page,       setPage]       = useState(1);
  const [eventType,  setEventType]  = useState("");
  const [fromDate,   setFromDate]   = useState("");
  const [toDate,     setToDate]     = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["org-audit-v2", slug, page, eventType, fromDate, toDate],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "30" });
      if (eventType) p.set("eventType", eventType);
      if (fromDate)  p.set("from", new Date(fromDate).toISOString());
      if (toDate)    p.set("to",   new Date(toDate + "T23:59:59").toISOString());
      return apiFetch(`/v1/organisations/${slug}/audit?${p}`).then(r => r.json());
    },
    enabled: !!slug, staleTime: 30_000,
  });

  // Normalise field names
  const events = (data?.events ?? []).map((e: any) => ({
    id:            e.id,
    eventType:     e.event_type     ?? e.eventType     ?? "",
    resourceType:  e.resource_type  ?? e.resourceType  ?? "",
    resourceId:    e.resource_id    ?? e.resourceId    ?? null,
    actorUserId:   e.actor_user_id  ?? e.actorUserId   ?? null,
    actorType:     e.actor_type     ?? e.actorType     ?? "system",
    ipAddress:     e.ip_address     ?? e.ipAddress     ?? null,
    userAgent:     e.user_agent     ?? e.userAgent     ?? null,
    accessPurpose: e.access_purpose ?? e.accessPurpose ?? null,
    isSensitive:   e.is_sensitive   ?? e.isSensitive   ?? false,
    metadata:      e.metadata       ?? {},
    occurredAt:    e.occurred_at    ?? e.occurredAt    ?? "",
  }));

  const govCount = events.filter((e: any) => GOVERNANCE_TYPES.has(e.eventType)).length;

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-6xl mx-auto">

          {/* Header */}
          <div className="mb-7 flex items-start justify-between gap-4">
            <div>
              <button onClick={() => setLocation(`/app/${slug}/governance`)}
                className="text-[#64748B] text-xs hover:text-[#E2E8F0] mb-2 block">← Governance Centre</button>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Audit Log</h1>
              <p className="text-[#64748B] text-sm mt-1">Complete activity record for this organisation</p>
            </div>
            {govCount > 0 && (
              <button onClick={() => setLocation(`/app/${slug}/governance/timeline`)}
                className="px-4 py-2 bg-[#112033] border border-[#1E3A5F] text-[#64748B] text-sm rounded-lg hover:text-[#E2E8F0] transition-colors shrink-0">
                Governance timeline →
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            {/* Event type */}
            <select value={eventType}
              onChange={e => { setEventType(e.target.value); setPage(1); }}
              className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50">
              <option value="">All event types</option>
              {EVENT_GROUPS.map(g => (
                <optgroup key={g.label} label={g.label}>
                  {g.types.map(t => <option key={t} value={t}>{t}</option>)}
                </optgroup>
              ))}
            </select>

            {/* Date range */}
            <div className="flex items-center gap-2">
              <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }}
                className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50" />
              <span className="text-[#64748B] text-xs">to</span>
              <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1); }}
                className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]/50" />
            </div>

            {(eventType || fromDate || toDate) && (
              <button onClick={() => { setEventType(""); setFromDate(""); setToDate(""); setPage(1); }}
                className="px-3 py-2 text-[#64748B] text-sm hover:text-[#E2E8F0] border border-[#1E3A5F] rounded-lg">
                Clear filters
              </button>
            )}
          </div>

          {/* Table */}
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl overflow-hidden">
            {/* Desktop table header */}
            <div className="hidden md:grid grid-cols-[1fr_1.5fr_1fr_1fr_auto] gap-4 px-5 py-3 border-b border-[#1E3A5F]">
              {["When", "Event", "Resource", "Actor", ""].map(h => (
                <span key={h} className="text-[#64748B] text-xs font-semibold uppercase tracking-wider">{h}</span>
              ))}
            </div>

            {isLoading ? (
              <div className="px-5 py-10 text-center text-[#64748B] text-sm">Loading…</div>
            ) : events.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-[#64748B] text-sm">No events match the current filter.</p>
              </div>
            ) : (
              <div>
                {events.map((e: any) => {
                  const isExpanded = expandedId === e.id;
                  const isGov = GOVERNANCE_TYPES.has(e.eventType);
                  return (
                    <div key={e.id} className={`border-b border-[#1E3A5F] last:border-0 ${isGov ? "hover:bg-[#1E3A5F]/20" : "hover:bg-[#0B1829]/40"} transition-colors`}>
                      <div className="md:grid md:grid-cols-[1fr_1.5fr_1fr_1fr_auto] gap-4 px-5 py-3.5 flex flex-col gap-y-1">

                        {/* When */}
                        <div className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${eventBulletColour(e.eventType)}`} />
                          <span className="text-[#64748B] text-xs whitespace-nowrap">{formatTs(e.occurredAt)}</span>
                        </div>

                        {/* Event */}
                        <div>
                          <span className={`text-sm ${isGov ? "text-[#E2E8F0] font-medium" : "text-[#94A3B8]"}`}>
                            {e.eventType}
                          </span>
                          {e.accessPurpose && (
                            <p className="text-[#64748B] text-xs mt-0.5">{e.accessPurpose}</p>
                          )}
                        </div>

                        {/* Resource */}
                        <div>
                          <span className="text-[#64748B] text-sm capitalize">
                            {(e.resourceType ?? "").replace(/_/g, " ") || "—"}
                          </span>
                          {e.resourceId && (
                            <p className="text-[#64748B]/60 text-xs font-mono mt-0.5">{e.resourceId.slice(0, 12)}…</p>
                          )}
                        </div>

                        {/* Actor */}
                        <div>
                          <span className="text-[#64748B] text-sm capitalize">{e.actorType ?? "system"}</span>
                          {e.actorUserId && (
                            <p className="text-[#64748B]/60 text-xs font-mono mt-0.5">{e.actorUserId.slice(0, 12)}…</p>
                          )}
                        </div>

                        {/* Expand */}
                        <button onClick={() => setExpandedId(isExpanded ? null : e.id)}
                          className="text-[#64748B] text-xs hover:text-[#E2E8F0] transition-colors whitespace-nowrap">
                          {isExpanded ? "▲" : "▼"}
                        </button>
                      </div>

                      {/* Expanded row */}
                      {isExpanded && (
                        <div className="px-5 pb-4 border-t border-[#1E3A5F] pt-3 bg-[#0B1829]/40">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            {[
                              ["Event type",     e.eventType],
                              ["Resource type",  e.resourceType ?? "—"],
                              ["Resource ID",    e.resourceId ?? "—"],
                              ["Actor type",     e.actorType ?? "—"],
                              ["Actor user ID",  e.actorUserId ?? "—"],
                              ["IP address",     e.ipAddress ?? "—"],
                              ["Access purpose", e.accessPurpose ?? "—"],
                              ["Sensitive",      e.isSensitive ? "Yes" : "No"],
                            ].map(([k, v]) => (
                              <div key={k}>
                                <p className="text-[#64748B] mb-0.5">{k}</p>
                                <p className="text-[#94A3B8] font-mono truncate">{v}</p>
                              </div>
                            ))}
                            {Object.keys(e.metadata ?? {}).length > 0 && (
                              <div className="col-span-2 md:col-span-4">
                                <p className="text-[#64748B] mb-0.5">Metadata</p>
                                <pre className="text-[#94A3B8] text-xs bg-[#112033] rounded-lg p-2 overflow-x-auto">
                                  {JSON.stringify(e.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {(events.length > 0 || page > 1) && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-[#1E3A5F]">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="text-sm text-[#64748B] hover:text-[#E2E8F0] disabled:opacity-40 transition-colors">← Previous</button>
                <span className="text-[#64748B] text-sm">Page {page}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={events.length < 30}
                  className="text-sm text-[#64748B] hover:text-[#E2E8F0] disabled:opacity-40 transition-colors">Next →</button>
              </div>
            )}
          </div>
        </div>
      </AppShell>
    </>
  );
}
