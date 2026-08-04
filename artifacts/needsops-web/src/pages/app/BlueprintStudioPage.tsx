/**
 * Blueprint Studio — /app/:slug/blueprints
 *
 * Sprint 28. Organisation Blueprint Library with full management controls:
 *   - View built-in and org blueprints
 *   - Search, filter (status, specialist), sort
 *   - Create, clone, archive, restore
 *   - Navigate to detail / editor / version history / test
 */

import { useState, useMemo }      from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show }    from "@clerk/react";
import { Redirect } from "wouter";
import AppShell    from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type BlueprintStatus = "draft" | "review" | "published" | "superseded" | "archived";

interface WorkBlueprint {
  id: string;
  organizationId: string | null;
  code: string;
  title: string;
  version: string;
  status: BlueprintStatus;
  objective: string;
  primarySpecialist: string;
  supportingSpecialists: string[];
  outputTypes: string[];
  isBuiltIn: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<BlueprintStatus, { bg: string; text: string; label: string }> = {
  draft:      { bg: "bg-blue-900/40",    text: "text-blue-300",    label: "Draft" },
  review:     { bg: "bg-amber-900/40",   text: "text-amber-300",   label: "In Review" },
  published:  { bg: "bg-emerald-900/40", text: "text-emerald-300", label: "Published" },
  superseded: { bg: "bg-purple-900/40",  text: "text-purple-300",  label: "Superseded" },
  archived:   { bg: "bg-gray-800/60",    text: "text-gray-400",    label: "Archived" },
};

const SPECIALIST_LABELS: Record<string, string> = {
  chief_of_staff:                   "Chief of Staff",
  executive_assistant:              "Executive Assistant",
  operations_manager:               "Operations Manager",
  compliance_quality_manager:       "Compliance & Quality Manager",
  incident_safeguarding_specialist: "Incident & Safeguarding Specialist",
  knowledge_documentation_specialist: "Knowledge & Documentation Specialist",
  policy_governance_specialist:     "Policy & Governance Specialist",
  workforce_compliance_specialist:  "Workforce Compliance Specialist",
  finance_officer:                  "Finance Officer",
};

const STATUS_TABS = [
  { key: "all",       label: "All" },
  { key: "published", label: "Published" },
  { key: "draft",     label: "Draft" },
  { key: "review",    label: "In Review" },
  { key: "archived",  label: "Archived" },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function BlueprintStudioPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab]       = useState<string>("all");
  const [search, setSearch]             = useState("");
  const [specialist, setSpecialist]     = useState("");
  const [sort, setSort]                 = useState("newest");
  const [includeArchived, setArchived]  = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["blueprints", slug, includeArchived],
    queryFn: () =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints?includeArchived=${includeArchived}`)
        .then(r => r.json()),
    enabled: !!slug,
  });

  const all: WorkBlueprint[] = data?.blueprints ?? [];

  // Client-side search + filter
  const filtered = useMemo(() => {
    let list = all;
    if (activeTab !== "all") list = list.filter(b => b.status === activeTab);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(b =>
        b.title.toLowerCase().includes(q) ||
        b.code.toLowerCase().includes(q) ||
        b.objective.toLowerCase().includes(q)
      );
    }
    if (specialist) list = list.filter(b => b.primarySpecialist === specialist);
    switch (sort) {
      case "title_asc":  list = [...list].sort((a, b) => a.title.localeCompare(b.title)); break;
      case "title_desc": list = [...list].sort((a, b) => b.title.localeCompare(a.title)); break;
      case "oldest":     list = [...list].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()); break;
      default:           list = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); break;
    }
    return list;
  }, [all, activeTab, search, specialist, sort]);

  const builtIns = filtered.filter(b => b.isBuiltIn);
  const orgOwned = filtered.filter(b => !b.isBuiltIn);

  const archiveMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/archive`, { method: "PATCH" }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["blueprints", slug] }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/restore`, { method: "PATCH" }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["blueprints", slug] }),
  });

  const cloneMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["blueprints", slug] });
      if (data?.blueprint?.id) setLocation(`/app/${slug}/blueprints/${data.blueprint.id}/edit`);
    },
  });

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug}>
        <div className="p-6 max-w-7xl mx-auto">

          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Blueprint Studio</h1>
              <p className="text-[#64748B] text-sm mt-1">
                Design, manage and publish your organisation's professional workflow blueprints.
              </p>
            </div>
            <button
              onClick={() => setLocation(`/app/${slug}/blueprints/new`)}
              className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] rounded-lg font-semibold text-sm hover:bg-[#00D4FF]/90 transition-colors"
            >
              + New Blueprint
            </button>
          </div>

          {/* Status tabs */}
          <div className="flex gap-1 mb-4 border-b border-[#1E3A5F]">
            {STATUS_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === t.key
                    ? "border-[#00D4FF] text-[#00D4FF]"
                    : "border-transparent text-[#64748B] hover:text-[#E2E8F0]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Search + filters */}
          <div className="flex flex-wrap gap-3 mb-6">
            <input
              type="text"
              placeholder="Search blueprints…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-[200px] bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]"
            />
            <select
              value={specialist}
              onChange={e => setSpecialist(e.target.value)}
              className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]"
            >
              <option value="">All Specialists</option>
              {Object.entries(SPECIALIST_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF]"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title_asc">Title A–Z</option>
              <option value="title_desc">Title Z–A</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-[#64748B] cursor-pointer">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={e => setArchived(e.target.checked)}
                className="rounded"
              />
              Show archived
            </label>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 border-2 border-[#00D4FF] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-4 text-red-300 text-sm">
              Failed to load blueprints. Please refresh.
            </div>
          )}

          {!isLoading && !error && (
            <div className="space-y-8">

              {/* Organisation blueprints */}
              {orgOwned.length > 0 && (
                <section>
                  <h2 className="text-xs uppercase tracking-widest text-[#64748B]/60 font-semibold mb-3">
                    Organisation Blueprints
                  </h2>
                  <BlueprintGrid
                    blueprints={orgOwned}
                    slug={slug}
                    setLocation={setLocation}
                    onArchive={id => archiveMutation.mutate(id)}
                    onRestore={id => restoreMutation.mutate(id)}
                    onClone={id => {
                      const bp = orgOwned.find(b => b.id === id);
                      cloneMutation.mutate({ id, title: bp ? `${bp.title} (Copy)` : "Blueprint Copy" });
                    }}
                  />
                </section>
              )}

              {/* Built-in blueprints */}
              {builtIns.length > 0 && (
                <section>
                  <h2 className="text-xs uppercase tracking-widest text-[#64748B]/60 font-semibold mb-3">
                    Built-in Blueprints <span className="normal-case text-[#64748B] font-normal tracking-normal">(read-only)</span>
                  </h2>
                  <BlueprintGrid
                    blueprints={builtIns}
                    slug={slug}
                    setLocation={setLocation}
                    onArchive={() => {}}
                    onRestore={() => {}}
                    onClone={id => {
                      const bp = builtIns.find(b => b.id === id);
                      cloneMutation.mutate({ id, title: bp ? `${bp.title} (Copy)` : "Blueprint Copy" });
                    }}
                    readOnly
                  />
                </section>
              )}

              {filtered.length === 0 && (
                <div className="text-center py-16 text-[#64748B]">
                  <p className="text-4xl mb-3">📐</p>
                  <p className="font-medium text-[#E2E8F0]">No blueprints found</p>
                  <p className="text-sm mt-1">Adjust your filters or create a new blueprint.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}

// ─── Blueprint grid ───────────────────────────────────────────────────────────

function BlueprintGrid({
  blueprints, slug, setLocation, onArchive, onRestore, onClone, readOnly,
}: {
  blueprints: WorkBlueprint[];
  slug: string;
  setLocation: (p: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onClone: (id: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {blueprints.map(bp => (
        <BlueprintCard
          key={bp.id}
          bp={bp}
          slug={slug}
          setLocation={setLocation}
          onArchive={onArchive}
          onRestore={onRestore}
          onClone={onClone}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

function BlueprintCard({
  bp, slug, setLocation, onArchive, onRestore, onClone, readOnly,
}: {
  bp: WorkBlueprint;
  slug: string;
  setLocation: (p: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onClone: (id: string) => void;
  readOnly?: boolean;
}) {
  const badge = STATUS_BADGE[bp.status] ?? STATUS_BADGE.draft;

  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 flex flex-col gap-3 hover:border-[#00D4FF]/40 transition-colors">
      {/* Title + status */}
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => setLocation(`/app/${slug}/blueprints/${bp.id}`)}
          className="text-[#E2E8F0] font-semibold text-sm text-left hover:text-[#00D4FF] transition-colors"
        >
          {bp.title}
        </button>
        <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
          {badge.label}
        </span>
      </div>

      {/* Objective excerpt */}
      <p className="text-[#64748B] text-xs line-clamp-2">{bp.objective}</p>

      {/* Meta */}
      <div className="flex items-center justify-between text-[10px] text-[#64748B]">
        <span>v{bp.version}</span>
        <span>{SPECIALIST_LABELS[bp.primarySpecialist] ?? bp.primarySpecialist}</span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[#1E3A5F]">
        <ActionBtn onClick={() => setLocation(`/app/${slug}/blueprints/${bp.id}`)}>View</ActionBtn>
        {!readOnly && bp.status !== "archived" && (
          <ActionBtn onClick={() => setLocation(`/app/${slug}/blueprints/${bp.id}/edit`)}>Edit</ActionBtn>
        )}
        {!readOnly && bp.status !== "archived" && (
          <ActionBtn onClick={() => setLocation(`/app/${slug}/blueprints/${bp.id}/test`)}>Test</ActionBtn>
        )}
        <ActionBtn onClick={() => onClone(bp.id)}>Clone</ActionBtn>
        {!readOnly && bp.status !== "archived" && (
          <ActionBtn danger onClick={() => onArchive(bp.id)}>Archive</ActionBtn>
        )}
        {!readOnly && bp.status === "archived" && (
          <ActionBtn onClick={() => onRestore(bp.id)}>Restore</ActionBtn>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ onClick, danger, children }: {
  onClick: () => void; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${
        danger
          ? "bg-red-900/30 text-red-400 hover:bg-red-900/50"
          : "bg-[#1E3A5F] text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#1E3A5F]/80"
      }`}
    >
      {children}
    </button>
  );
}
