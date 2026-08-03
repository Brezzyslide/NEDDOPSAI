/**
 * Governance Timeline — /app/:slug/governance/timeline
 *
 * Sprint 24. Chronological log of governance events (knowledge approvals,
 * memory approvals, proposal creation, retraining, policy updates, readiness changes).
 *
 * Reads from the audit API with governance-relevant event type filters.
 */

import { useState }               from "react";
import { useParams, useLocation } from "wouter";
import { useQuery }               from "@tanstack/react-query";
import { Show }                   from "@clerk/react";
import { Redirect }               from "wouter";
import AppShell                   from "@/components/layout/AppShell";
import { useAuthFetch }           from "@/lib/api";

// ─── Governance event definitions ─────────────────────────────────────────────

const GOVERNANCE_EVENTS = [
  "knowledge.approved",
  "knowledge.rejected",
  "knowledge.source.approved",
  "knowledge.source.rejected",
  "knowledge.source.revoked",
  "knowledge.curation.completed",
  "memory.approved",
  "memory.rejected",
  "memory.proposed",
  "memory.superseded",
  "approval.granted",
  "approval.rejected",
  "approval.requested",
  "specialist.trained",
  "specialist.readiness.changed",
  "work.approved",
  "work.rejected",
  "pack.activated",
  "pack.deactivated",
  "organisation.updated",
  "membership.role_changed",
];

const EVENT_CONFIG: Record<string, { icon: string; label: string; category: string; colour: string }> = {
  "knowledge.approved":          { icon: "✅", label: "Policy approved",              category: "knowledge",  colour: "bg-emerald-400" },
  "knowledge.rejected":          { icon: "✗",  label: "Policy rejected",              category: "knowledge",  colour: "bg-red-400" },
  "knowledge.source.approved":   { icon: "📄", label: "Document approved",            category: "knowledge",  colour: "bg-emerald-400" },
  "knowledge.source.rejected":   { icon: "📄", label: "Document rejected",            category: "knowledge",  colour: "bg-red-400" },
  "knowledge.source.revoked":    { icon: "🚫", label: "Document revoked",             category: "knowledge",  colour: "bg-red-400" },
  "knowledge.curation.completed":{ icon: "🧠", label: "Curation completed",           category: "knowledge",  colour: "bg-cyan-400" },
  "memory.approved":             { icon: "💡", label: "Memory approved",              category: "memory",     colour: "bg-emerald-400" },
  "memory.rejected":             { icon: "💡", label: "Memory rejected",              category: "memory",     colour: "bg-red-400" },
  "memory.proposed":             { icon: "💡", label: "Memory proposed",              category: "memory",     colour: "bg-amber-400" },
  "memory.superseded":           { icon: "💡", label: "Memory superseded",            category: "memory",     colour: "bg-slate-400" },
  "approval.granted":            { icon: "✅", label: "Approval granted",             category: "approvals",  colour: "bg-emerald-400" },
  "approval.rejected":           { icon: "✗",  label: "Approval rejected",            category: "approvals",  colour: "bg-red-400" },
  "approval.requested":          { icon: "⏳", label: "Approval requested",           category: "approvals",  colour: "bg-amber-400" },
  "specialist.trained":          { icon: "🤖", label: "Specialist trained",           category: "specialists",colour: "bg-purple-400" },
  "specialist.readiness.changed":{ icon: "🤖", label: "Specialist readiness changed", category: "specialists",colour: "bg-purple-400" },
  "work.approved":               { icon: "📋", label: "Work approved",               category: "approvals",  colour: "bg-emerald-400" },
  "work.rejected":               { icon: "📋", label: "Work rejected",               category: "approvals",  colour: "bg-red-400" },
  "pack.activated":              { icon: "📦", label: "Pack activated",              category: "policies",   colour: "bg-blue-400" },
  "pack.deactivated":            { icon: "📦", label: "Pack deactivated",            category: "policies",   colour: "bg-slate-400" },
  "organisation.updated":        { icon: "🏢", label: "Organisation updated",        category: "policies",   colour: "bg-blue-400" },
  "membership.role_changed":     { icon: "👤", label: "Role changed",               category: "policies",   colour: "bg-blue-400" },
};

const CATEGORIES = [
  { key: "all",         label: "All" },
  { key: "knowledge",   label: "Knowledge" },
  { key: "memory",      label: "Memory" },
  { key: "approvals",   label: "Approvals" },
  { key: "specialists", label: "Specialists" },
  { key: "policies",    label: "Organisation" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEventDate(str: string) {
  return new Date(str).toLocaleString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function dateGroup(str: string) {
  const d     = new Date(str);
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest  = new Date(today); yest.setDate(yest.getDate() - 1);
  const week  = new Date(today); week.setDate(week.getDate() - 7);
  if (d >= today) return "Today";
  if (d >= yest)  return "Yesterday";
  if (d >= week)  return "This week";
  return "Earlier";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function GovernanceTimelinePage() {
  const { slug }        = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch        = useAuthFetch();

  const [category, setCategory]   = useState("all");
  const [search,   setSearch]     = useState("");
  const [page,     setPage]       = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["gov-timeline", slug, category, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: "30" });
      return apiFetch(`/v1/organisations/${slug}/audit?${params}`).then(r => r.json());
    },
    enabled: !!slug, staleTime: 60_000,
  });

  const rawEvents: any[] = data?.events ?? [];

  // Normalise field names (org schema uses snake_case, legacy uses camelCase)
  const events = rawEvents.map(e => ({
    id:           e.id,
    eventType:    e.event_type    ?? e.eventType    ?? "",
    resourceType: e.resource_type ?? e.resourceType ?? "",
    resourceId:   e.resource_id   ?? e.resourceId   ?? null,
    actorUserId:  e.actor_user_id ?? e.actorUserId  ?? null,
    actorType:    e.actor_type    ?? e.actorType    ?? "system",
    ipAddress:    e.ip_address    ?? e.ipAddress    ?? null,
    accessPurpose:e.access_purpose?? e.accessPurpose?? null,
    metadata:     e.metadata      ?? {},
    occurredAt:   e.occurred_at   ?? e.occurredAt   ?? "",
  }));

  // Filter to governance-relevant events
  const govEvents = events.filter(e => {
    const cfg  = EVENT_CONFIG[e.eventType];
    if (!cfg && !GOVERNANCE_EVENTS.includes(e.eventType)) return false;
    if (category !== "all" && cfg?.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.eventType.includes(q) && !(cfg?.label ?? "").toLowerCase().includes(q) &&
          !(e.resourceType ?? "").includes(q)) return false;
    }
    return true;
  });

  // Group by day
  const groups: Record<string, typeof govEvents> = {};
  for (const e of govEvents) {
    const g = dateGroup(e.occurredAt);
    if (!groups[g]) groups[g] = [];
    groups[g]!.push(e);
  }

  const GROUP_ORDER = ["Today", "Yesterday", "This week", "Earlier"];

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-4xl mx-auto">

          {/* Header */}
          <div className="mb-7">
            <button onClick={() => setLocation(`/app/${slug}/governance`)} className="text-[#64748B] text-xs hover:text-[#E2E8F0] mb-2 block">← Governance Centre</button>
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Governance Timeline</h1>
            <p className="text-[#64748B] text-sm mt-1">Every governance decision, in order</p>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="flex items-center gap-1 p-1 bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-x-auto">
              {CATEGORIES.map(c => (
                <button key={c.key} onClick={() => { setCategory(c.key); setPage(1); }}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    category === c.key ? "bg-[#00D4FF]/10 text-[#00D4FF]" : "text-[#64748B] hover:text-[#E2E8F0]"
                  }`}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-xs">🔍</span>
              <input type="text" placeholder="Search events…" value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#112033] border border-[#1E3A5F] rounded-lg pl-8 pr-4 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50" />
            </div>
          </div>

          {/* Timeline */}
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 animate-pulse h-16" />)}
            </div>
          ) : govEvents.length === 0 ? (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-14 text-center">
              <p className="text-3xl mb-3 opacity-30">🕐</p>
              <p className="text-[#E2E8F0] font-medium mb-1">No governance events</p>
              <p className="text-[#64748B] text-sm">Governance activity will appear here as your AI Workforce operates.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {GROUP_ORDER.map(groupName => {
                const items = groups[groupName];
                if (!items?.length) return null;
                return (
                  <div key={groupName}>
                    <p className="text-[#64748B] text-xs uppercase tracking-widest font-semibold mb-3 px-1">{groupName}</p>
                    <div className="relative pl-5">
                      {/* Timeline spine */}
                      <div className="absolute left-2 top-2 bottom-2 w-px bg-[#1E3A5F]" />
                      <div className="space-y-3">
                        {items.map(e => {
                          const cfg = EVENT_CONFIG[e.eventType] ?? {
                            icon: "◆", label: e.eventType.replace(/_/g, " "), category: "other", colour: "bg-[#64748B]",
                          };
                          return (
                            <div key={e.id} className="relative">
                              {/* Dot */}
                              <div className={`absolute -left-3.5 top-3.5 h-2.5 w-2.5 rounded-full ${cfg.colour} ring-2 ring-[#0B1829]`} />
                              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 hover:border-[#1E3A5F]/80 transition-colors">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-start gap-3">
                                    <span className="text-base shrink-0">{cfg.icon}</span>
                                    <div>
                                      <p className="text-[#E2E8F0] text-sm font-medium">{cfg.label}</p>
                                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        {e.resourceType && (
                                          <span className="text-[#64748B] text-xs capitalize">
                                            {e.resourceType.replace(/_/g, " ")}
                                          </span>
                                        )}
                                        {e.resourceId && (
                                          <>
                                            <span className="text-[#1E3A5F]">·</span>
                                            <span className="text-[#64748B] text-xs font-mono">{e.resourceId.slice(0, 8)}…</span>
                                          </>
                                        )}
                                        {e.actorType && (
                                          <>
                                            <span className="text-[#1E3A5F]">·</span>
                                            <span className="text-[#64748B] text-xs">by {e.actorType}</span>
                                          </>
                                        )}
                                        {e.accessPurpose && (
                                          <>
                                            <span className="text-[#1E3A5F]">·</span>
                                            <span className="text-[#64748B] text-xs">{e.accessPurpose}</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <span className="shrink-0 text-[#64748B] text-xs whitespace-nowrap">
                                    {formatEventDate(e.occurredAt)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Pagination */}
              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-4 py-2 bg-[#112033] border border-[#1E3A5F] text-sm text-[#64748B] rounded-lg hover:text-[#E2E8F0] disabled:opacity-40 transition-colors">
                  ← Previous
                </button>
                <span className="text-[#64748B] text-sm">Page {page}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={govEvents.length < 30}
                  className="px-4 py-2 bg-[#112033] border border-[#1E3A5F] text-sm text-[#64748B] rounded-lg hover:text-[#E2E8F0] disabled:opacity-40 transition-colors">
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}
