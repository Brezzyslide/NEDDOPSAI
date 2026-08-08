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

// Sprint 29M Part F: Governance events shown as a Timeline tab inside the Audit Log.
// The separate /governance/timeline route is preserved for backward compatibility
// but the primary entry point is now this page's "Governance" tab.
const GOV_EVENT_CODES = [
  "knowledge.approved", "knowledge.rejected", "knowledge.source.approved",
  "knowledge.source.rejected", "knowledge.source.revoked", "knowledge.curation.completed",
  "memory.approved", "memory.rejected", "memory.proposed", "memory.superseded",
  "approval.granted", "approval.rejected", "approval.requested",
  "specialist.trained", "specialist.readiness.changed",
  "work.approved", "work.rejected", "pack.activated", "pack.deactivated",
  "organisation.updated", "membership.role_changed",
];

const GOV_EVENT_CONFIG: Record<string, { icon: string; label: string; colour: string }> = {
  "knowledge.approved":          { icon: "✅", label: "Policy approved",    colour: "bg-emerald-400" },
  "knowledge.rejected":          { icon: "✗",  label: "Policy rejected",    colour: "bg-red-400" },
  "knowledge.source.approved":   { icon: "📄", label: "Document approved",  colour: "bg-emerald-400" },
  "knowledge.source.rejected":   { icon: "📄", label: "Document rejected",  colour: "bg-red-400" },
  "knowledge.source.revoked":    { icon: "🚫", label: "Document revoked",   colour: "bg-red-400" },
  "knowledge.curation.completed":{ icon: "🧠", label: "Curation completed", colour: "bg-cyan-400" },
  "memory.approved":             { icon: "💡", label: "Memory approved",    colour: "bg-emerald-400" },
  "memory.rejected":             { icon: "💡", label: "Memory rejected",    colour: "bg-red-400" },
  "memory.proposed":             { icon: "💡", label: "Memory proposed",    colour: "bg-amber-400" },
  "memory.superseded":           { icon: "💡", label: "Memory superseded",  colour: "bg-slate-400" },
  "approval.granted":            { icon: "✅", label: "Approval granted",   colour: "bg-emerald-400" },
  "approval.rejected":           { icon: "✗",  label: "Approval rejected",  colour: "bg-red-400" },
  "approval.requested":          { icon: "⏳", label: "Approval requested", colour: "bg-amber-400" },
  "specialist.trained":          { icon: "🤖", label: "Specialist trained", colour: "bg-purple-400" },
  "work.approved":               { icon: "📋", label: "Work approved",      colour: "bg-emerald-400" },
  "work.rejected":               { icon: "📋", label: "Work rejected",      colour: "bg-red-400" },
  "pack.activated":              { icon: "📦", label: "Pack activated",     colour: "bg-emerald-400" },
  "pack.deactivated":            { icon: "📦", label: "Pack deactivated",   colour: "bg-slate-400" },
  "organisation.updated":        { icon: "🏢", label: "Org updated",        colour: "bg-blue-400" },
  "membership.role_changed":     { icon: "👤", label: "Role changed",       colour: "bg-blue-400" },
};

function TimelineDot({ colour }: { colour: string }) {
  return <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${colour}`} />;
}

export default function AuditPage() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();

  // Sprint 29M Part F: two tabs — All Events (full audit) + Governance (timeline view)
  const [activeTab,  setActiveTab]  = useState<"all" | "governance">("all");
  const [page,       setPage]       = useState(1);
  const [eventType,  setEventType]  = useState("");
  const [fromDate,   setFromDate]   = useState("");
  const [toDate,     setToDate]     = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Governance timeline pagination (separate)
  const [govPage, setGovPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["org-audit-v2", slug, page, eventType, fromDate, toDate],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "30" });
      if (eventType) p.set("eventType", eventType);
      if (fromDate)  p.set("from", new Date(fromDate).toISOString());
      if (toDate)    p.set("to",   new Date(toDate + "T23:59:59").toISOString());
      return apiFetch(`/v1/organisations/${slug}/audit?${p}`).then(r => r.json());
    },
    enabled: !!slug && activeTab === "all", staleTime: 30_000,
  });

  const { data: govData, isLoading: govLoading } = useQuery({
    queryKey: ["org-audit-gov", slug, govPage],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(govPage), limit: "50" });
      return apiFetch(`/v1/organisations/${slug}/audit?${p}`).then(r => r.json());
    },
    enabled: !!slug && activeTab === "governance", staleTime: 60_000,
  });

  // Normalise field names
  const normalise = (e: any) => ({
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
  });

  const events    = (data?.events    ?? []).map(normalise);
  const govEvents = (govData?.events ?? []).map(normalise)
    .filter((e: any) => GOVERNANCE_TYPES.has(e.eventType));

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-6xl mx-auto">

          {/* Header */}
          <div className="mb-6">
            <button onClick={() => setLocation(`/app/${slug}/governance`)}
              className="text-[#64748B] text-xs hover:text-[#E2E8F0] mb-2 block">← Governance Centre</button>
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Audit Log</h1>
            <p className="text-[#64748B] text-sm mt-1">Complete activity record for this organisation</p>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-0.5 p-1 bg-[#112033] border border-[#1E3A5F] rounded-xl mb-6 w-fit">
            {([
              { key: "all",        label: "All Events"  },
              { key: "governance", label: "Governance"  },
            ] as const).map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === t.key
                    ? "bg-[#00D4FF]/10 text-[#00D4FF]"
                    : "text-[#64748B] hover:text-[#E2E8F0]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Governance / Timeline tab ──────────────────────────────────── */}
          {activeTab === "governance" && (
            <div>
              <p className="text-[#64748B] text-sm mb-5">
                Chronological record of knowledge, memory, approval, and specialist governance events.
              </p>
              {govLoading ? (
                <div className="text-center text-[#64748B] text-sm py-10">Loading…</div>
              ) : govEvents.length === 0 ? (
                <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-12 text-center">
                  <p className="text-[#64748B] text-sm">No governance events recorded yet.</p>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-[#1E3A5F]" />
                  <div className="space-y-3 pl-10">
                    {govEvents.map((e: any) => {
                      const cfg = GOV_EVENT_CONFIG[e.eventType] ?? { icon: "•", label: e.eventType, colour: "bg-[#64748B]" };
                      return (
                        <div key={e.id} className="relative">
                          <div className="absolute -left-7 top-1/2 -translate-y-1/2">
                            <TimelineDot colour={cfg.colour} />
                          </div>
                          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 hover:border-[#00D4FF]/20 transition-colors">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <span className="text-base">{cfg.icon}</span>
                                <div>
                                  <p className="text-sm font-medium text-[#E2E8F0]">{cfg.label}</p>
                                  {e.resourceId && (
                                    <p className="text-xs text-[#64748B] font-mono">{e.resourceId.slice(0, 16)}…</p>
                                  )}
                                </div>
                              </div>
                              <p className="text-xs text-[#64748B] whitespace-nowrap shrink-0">{formatTs(e.occurredAt)}</p>
                            </div>
                            {Object.keys(e.metadata ?? {}).length > 0 && (
                              <pre className="text-[#64748B] text-xs bg-[#0B1829] rounded-lg p-2 mt-2 overflow-x-auto">
                                {JSON.stringify(e.metadata, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex justify-between mt-5">
                <button onClick={() => setGovPage(p => Math.max(1, p - 1))} disabled={govPage === 1}
                  className="text-sm text-[#64748B] hover:text-[#E2E8F0] disabled:opacity-40">← Previous</button>
                <span className="text-[#64748B] text-sm">Page {govPage}</span>
                <button onClick={() => setGovPage(p => p + 1)} disabled={govEvents.length < 20}
                  className="text-sm text-[#64748B] hover:text-[#E2E8F0] disabled:opacity-40">Next →</button>
              </div>
            </div>
          )}

          {/* ── All Events tab ─────────────────────────────────────────────── */}
          {activeTab === "all" && (<>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-5 mt-2">
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
          </>)}

        </div>
      </AppShell>
    </>
  );
}
