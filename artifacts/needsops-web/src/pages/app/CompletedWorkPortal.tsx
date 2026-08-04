/**
 * Completed Work Portal — /app/:slug/work
 *
 * Sprint 25. Flagship listing experience for all completed work produced
 * by the AI Workforce.
 *
 * Features:
 *   - Status tabs (All / Draft / Awaiting Approval / Approved / Rejected /
 *                  Archived / Superseded)
 *   - Search (client-side against title + outputType + specialist)
 *   - Filters: specialist · outputType · date range
 *   - Sort: Newest / Oldest / Title A–Z / Title Z–A
 *   - Pinned items  (localStorage)
 *   - Recent items  (localStorage — last 8 viewed)
 *   - Pagination (20 per page)
 */

import { useState, useMemo }      from "react";
import { useParams, useLocation } from "wouter";
import { useQuery }               from "@tanstack/react-query";
import { Show }                   from "@clerk/react";
import { Redirect }               from "wouter";
import AppShell                   from "@/components/layout/AppShell";
import { useAuthFetch }           from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkStatus = "draft" | "awaiting_approval" | "approved" | "rejected"
                | "archived" | "superseded" | "reopened";

interface CompletedWorkItem {
  id:               string;
  title:            string;
  outputType:       string;
  primarySpecialist:string;
  status:           WorkStatus;
  createdAt:        string;
  updatedAt:        string;
  blueprintId:      string | null;
  conversationId:   string | null;
  createdByUserId:  string | null;
  approvedByUserId: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_TABS: { key: WorkStatus | "all"; label: string; colour: string }[] = [
  { key: "all",               label: "All",               colour: "text-[#64748B]" },
  { key: "approved",          label: "Approved",          colour: "text-emerald-400" },
  { key: "awaiting_approval", label: "Awaiting Approval", colour: "text-amber-400" },
  { key: "draft",             label: "Draft",             colour: "text-blue-400" },
  { key: "rejected",          label: "Rejected",          colour: "text-red-400" },
  { key: "archived",          label: "Archived",          colour: "text-[#64748B]" },
  { key: "superseded",        label: "Superseded",        colour: "text-purple-400" },
];

const STATUS_BADGE: Record<WorkStatus, { bg: string; text: string; label: string }> = {
  draft:             { bg: "bg-blue-900/40",    text: "text-blue-300",    label: "Draft" },
  awaiting_approval: { bg: "bg-amber-900/40",   text: "text-amber-300",   label: "Awaiting Approval" },
  approved:          { bg: "bg-emerald-900/40", text: "text-emerald-300", label: "Approved" },
  rejected:          { bg: "bg-red-900/40",     text: "text-red-300",     label: "Rejected" },
  archived:          { bg: "bg-gray-800/60",    text: "text-gray-400",    label: "Archived" },
  superseded:        { bg: "bg-purple-900/40",  text: "text-purple-300",  label: "Superseded" },
  reopened:          { bg: "bg-orange-900/40",  text: "text-orange-300",  label: "Reopened" },
};

const SPECIALIST_LABELS: Record<string, string> = {
  chief_of_staff:                   "Chief of Staff",
  operations_manager:               "Operations Manager",
  compliance_manager:               "Compliance Manager",
  hr_manager:                       "HR Manager",
  finance_manager:                  "Finance Manager",
  incident_safeguarding_specialist: "Incident & Safeguarding Specialist",
};

const OUTPUT_TYPE_LABELS: Record<string, string> = {
  report:                  "Report",
  policy:                  "Policy",
  procedure:               "Procedure",
  template:                "Template",
  investigation_report:    "Investigation Report",
  compliance_report:       "Compliance Report",
  incident_report:         "Incident Report",
  training_material:       "Training Material",
  correspondence:          "Correspondence",
  analysis:                "Analysis",
  plan:                    "Plan",
};

function specLabel(s: string) {
  return SPECIALIST_LABELS[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
function outLabel(o: string) {
  return OUTPUT_TYPE_LABELS[o] ?? o.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function timeAgo(d: string) {
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60_000)  return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 604_800_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function specIcon(s: string) {
  const icons: Record<string, string> = {
    chief_of_staff: "🎯", operations_manager: "⚙", compliance_manager: "📋",
    hr_manager: "👥", finance_manager: "💰", incident_safeguarding_specialist: "🛡",
  };
  return icons[s] ?? "🤖";
}

const PINNED_KEY  = (slug: string) => `needsops-pinned-work-${slug}`;
const RECENT_KEY  = (slug: string) => `needsops-recent-work-${slug}`;

function getPinnedIds(slug: string): string[] {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY(slug)) ?? "[]"); } catch { return []; }
}
function togglePin(slug: string, id: string) {
  const pins = getPinnedIds(slug);
  const next = pins.includes(id) ? pins.filter(p => p !== id) : [...pins, id];
  localStorage.setItem(PINNED_KEY(slug), JSON.stringify(next));
}
function getRecentIds(slug: string): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY(slug)) ?? "[]"); } catch { return []; }
}
function recordRecent(slug: string, id: string) {
  const recent = getRecentIds(slug).filter(r => r !== id);
  localStorage.setItem(RECENT_KEY(slug), JSON.stringify([id, ...recent].slice(0, 8)));
}

// ─── Work Card ────────────────────────────────────────────────────────────────

function WorkCard({
  item, pinned, onPin, onOpen,
}: {
  item: CompletedWorkItem;
  pinned: boolean;
  onPin: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.draft;
  return (
    <div
      onClick={() => onOpen(item.id)}
      className="group relative bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 cursor-pointer
                 hover:border-[#00D4FF]/40 hover:bg-[#152840] transition-all duration-200"
    >
      {/* pin button */}
      <button
        onClick={e => { e.stopPropagation(); onPin(item.id); }}
        title={pinned ? "Unpin" : "Pin"}
        className={`absolute top-3 right-3 text-sm transition-opacity ${
          pinned ? "opacity-100 text-[#00D4FF]" : "opacity-0 group-hover:opacity-60 text-[#64748B]"
        }`}
      >
        {pinned ? "📌" : "📍"}
      </button>

      {/* header row */}
      <div className="flex items-start gap-3 mb-3">
        <div className="h-9 w-9 rounded-lg bg-[#0B1829] border border-[#1E3A5F] flex items-center justify-center text-lg shrink-0 mt-0.5">
          {specIcon(item.primarySpecialist)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[#E2E8F0] font-semibold text-sm leading-tight mb-1 line-clamp-2 pr-6">
            {item.title}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.bg} ${badge.text}`}>
              {badge.label}
            </span>
            <span className="text-[#64748B] text-xs">{outLabel(item.outputType)}</span>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#1E3A5F]/60">
        <span className="text-[#64748B] text-xs">{specLabel(item.primarySpecialist)}</span>
        <span className="text-[#64748B] text-xs">{timeAgo(item.updatedAt ?? item.createdAt)}</span>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CompletedWorkPortal() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();

  const [activeTab,  setActiveTab]  = useState<WorkStatus | "all">("all");
  const [search,     setSearch]     = useState("");
  const [filterSpec, setFilterSpec] = useState("");
  const [filterType, setFilterType] = useState("");
  const [sort,       setSort]       = useState<"newest" | "oldest" | "az" | "za">("newest");
  const [page,       setPage]       = useState(0);
  const [pinnedIds,  setPinnedIds]  = useState<string[]>(() => getPinnedIds(slug!));
  const [showFilters,setShowFilters]= useState(false);

  const PAGE_SIZE = 20;

  // fetch all work (large limit — server already caps at sensible levels)
  const { data, isLoading } = useQuery({
    queryKey: ["completed-work-portal", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/completed-work?limit=200`),
    select: (d: any) => (d?.completedWork ?? []) as CompletedWorkItem[],
    enabled: !!slug,
  });

  const items = data ?? [];

  // collect unique specialists / output types for filter dropdowns
  const allSpecs  = useMemo(() => [...new Set(items.map(i => i.primarySpecialist))], [items]);
  const allTypes  = useMemo(() => [...new Set(items.map(i => i.outputType))], [items]);

  // ── filter + sort ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let arr = [...items];
    if (activeTab !== "all") arr = arr.filter(i => i.status === activeTab);
    if (filterSpec)          arr = arr.filter(i => i.primarySpecialist === filterSpec);
    if (filterType)          arr = arr.filter(i => i.outputType === filterType);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(i =>
        i.title.toLowerCase().includes(q) ||
        specLabel(i.primarySpecialist).toLowerCase().includes(q) ||
        outLabel(i.outputType).toLowerCase().includes(q),
      );
    }
    switch (sort) {
      case "newest": arr.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()); break;
      case "oldest": arr.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()); break;
      case "az":     arr.sort((a, b) => a.title.localeCompare(b.title)); break;
      case "za":     arr.sort((a, b) => b.title.localeCompare(a.title)); break;
    }
    return arr;
  }, [items, activeTab, filterSpec, filterType, search, sort]);

  const pinned   = useMemo(() => items.filter(i => pinnedIds.includes(i.id)), [items, pinnedIds]);
  const recent   = useMemo(() => {
    const rIds = getRecentIds(slug!);
    return rIds.map(id => items.find(i => i.id === id)).filter(Boolean) as CompletedWorkItem[];
  }, [items, slug]);

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // tab counts
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    STATUS_TABS.slice(1).forEach(t => { c[t.key] = items.filter(i => i.status === t.key).length; });
    return c;
  }, [items]);

  function openWork(id: string) {
    recordRecent(slug!, id);
    setLocation(`/app/${slug}/work/${id}`);
  }

  function handlePin(id: string) {
    togglePin(slug!, id);
    setPinnedIds(getPinnedIds(slug!));
  }

  return (
    <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
      <AppShell>
        <div className="min-h-full bg-[#0B1829] text-[#E2E8F0]">
          {/* ── Header ── */}
          <div className="sticky top-0 z-20 bg-[#0B1829] border-b border-[#1E3A5F] px-8 pt-6 pb-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-[#E2E8F0]">Completed Work</h1>
                <p className="text-[#64748B] text-sm mt-0.5">
                  {items.length} documents produced by your AI Workforce
                </p>
              </div>
              <button
                onClick={() => setShowFilters(f => !f)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  showFilters
                    ? "border-[#00D4FF]/40 bg-[#00D4FF]/10 text-[#00D4FF]"
                    : "border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0]"
                }`}
              >
                <span>⚙</span> Filters {(filterSpec || filterType) ? "●" : ""}
              </button>
            </div>

            {/* ── Status tabs ── */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0">
              {STATUS_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key as any); setPage(0); }}
                  className={`shrink-0 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? "border-[#00D4FF] text-[#00D4FF]"
                      : "border-transparent text-[#64748B] hover:text-[#E2E8F0]"
                  }`}
                >
                  {tab.label}
                  {counts[tab.key] > 0 && (
                    <span className="ml-1.5 text-xs opacity-60">{counts[tab.key]}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="px-8 py-6 space-y-6">
            {/* ── Search + Filter row ── */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-sm">🔍</span>
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0); }}
                  placeholder="Search by title, specialist or type…"
                  className="w-full bg-[#112033] border border-[#1E3A5F] rounded-lg pl-9 pr-4 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50"
                />
              </div>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as any)}
                className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="az">Title A–Z</option>
                <option value="za">Title Z–A</option>
              </select>
            </div>

            {/* ── Expanded filters ── */}
            {showFilters && (
              <div className="flex items-center gap-4 p-4 bg-[#112033] border border-[#1E3A5F] rounded-xl">
                <div className="flex-1">
                  <label className="text-[#64748B] text-xs mb-1 block">Specialist</label>
                  <select
                    value={filterSpec}
                    onChange={e => { setFilterSpec(e.target.value); setPage(0); }}
                    className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none"
                  >
                    <option value="">All specialists</option>
                    {allSpecs.map(s => (
                      <option key={s} value={s}>{specLabel(s)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[#64748B] text-xs mb-1 block">Document type</label>
                  <select
                    value={filterType}
                    onChange={e => { setFilterType(e.target.value); setPage(0); }}
                    className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none"
                  >
                    <option value="">All types</option>
                    {allTypes.map(t => (
                      <option key={t} value={t}>{outLabel(t)}</option>
                    ))}
                  </select>
                </div>
                {(filterSpec || filterType) && (
                  <button
                    onClick={() => { setFilterSpec(""); setFilterType(""); setPage(0); }}
                    className="text-[#64748B] hover:text-red-400 text-sm mt-4"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {/* ── Pinned ── */}
            {pinned.length > 0 && (
              <section>
                <h2 className="text-[#64748B] text-xs uppercase tracking-widest mb-3">📌 Pinned</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {pinned.map(item => (
                    <WorkCard key={item.id} item={item} pinned onPin={handlePin} onOpen={openWork} />
                  ))}
                </div>
              </section>
            )}

            {/* ── Recent (only on All tab with no search) ── */}
            {recent.length > 0 && activeTab === "all" && !search && !filterSpec && !filterType && (
              <section>
                <h2 className="text-[#64748B] text-xs uppercase tracking-widest mb-3">🕐 Recently Viewed</h2>
                <div className="flex gap-4 overflow-x-auto pb-1">
                  {recent.slice(0, 4).map(item => (
                    <div key={item.id} className="shrink-0 w-64">
                      <WorkCard item={item} pinned={pinnedIds.includes(item.id)} onPin={handlePin} onOpen={openWork} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Main grid ── */}
            <section>
              {(pinned.length > 0 || (recent.length > 0 && activeTab === "all" && !search)) && (
                <h2 className="text-[#64748B] text-xs uppercase tracking-widest mb-3">
                  {activeTab === "all" ? "All Work" : STATUS_TABS.find(t => t.key === activeTab)?.label}
                  <span className="ml-2 text-[#64748B]">({filtered.length})</span>
                </h2>
              )}

              {isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 animate-pulse h-36" />
                  ))}
                </div>
              ) : paginated.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="text-4xl mb-4">📄</div>
                  <p className="text-[#E2E8F0] font-medium mb-1">
                    {search || filterSpec || filterType ? "No matching work found" : "No completed work yet"}
                  </p>
                  <p className="text-[#64748B] text-sm">
                    {search || filterSpec || filterType
                      ? "Try adjusting your search or filters"
                      : "Your AI Workforce will produce documents here as tasks are completed"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {paginated.map(item => (
                    <WorkCard
                      key={item.id}
                      item={item}
                      pinned={pinnedIds.includes(item.id)}
                      onPin={handlePin}
                      onOpen={openWork}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-sm border border-[#1E3A5F] rounded-lg text-[#64748B] hover:text-[#E2E8F0] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← Prev
                </button>
                <span className="text-[#64748B] text-sm">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 text-sm border border-[#1E3A5F] rounded-lg text-[#64748B] hover:text-[#E2E8F0] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      </AppShell>
    </Show>
  );
}
