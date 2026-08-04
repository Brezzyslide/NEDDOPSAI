/**
 * Blueprint Detail — /app/:slug/blueprints/:id
 *
 * Sprint 28. Full view of a blueprint with status, metadata, rules,
 * and navigation to editor / test / version history / publish.
 */

import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show }    from "@clerk/react";
import { Redirect } from "wouter";
import AppShell    from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

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
  requiredLibraryKnowledge: string[];
  requiredMemories: string[];
  validationRules: Array<{ rule: string; required: boolean; description: string }>;
  qualityRules: Array<{ dimension: string; weight: number; description: string }>;
  successCriteria: string[];
  outputTypes: string[];
  escalationRules: Array<{ trigger: string; action: string }>;
  mandatoryCitations: string[];
  isBuiltIn: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const STATUS_BADGE: Record<BlueprintStatus, { bg: string; text: string; label: string }> = {
  draft:      { bg: "bg-blue-900/40",    text: "text-blue-300",    label: "Draft" },
  review:     { bg: "bg-amber-900/40",   text: "text-amber-300",   label: "In Review" },
  published:  { bg: "bg-emerald-900/40", text: "text-emerald-300", label: "Published" },
  superseded: { bg: "bg-purple-900/40",  text: "text-purple-300",  label: "Superseded" },
  archived:   { bg: "bg-gray-800/60",    text: "text-gray-400",    label: "Archived" },
};

export default function BlueprintDetailPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["blueprint", slug, id],
    queryFn: () =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}`).then(r => r.json()),
    enabled: !!slug && !!id,
  });

  const bp: WorkBlueprint | undefined = data?.blueprint;

  const submitReviewMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/submit-for-review`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["blueprint", slug, id] }),
  });

  const archiveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/archive`, { method: "PATCH" }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["blueprint", slug, id] }),
  });

  const restoreMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/restore`, { method: "PATCH" }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["blueprint", slug, id] }),
  });

  const cloneMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: bp ? `${bp.title} (Copy)` : "Blueprint Copy" }),
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
        <div className="p-6 max-w-4xl mx-auto">

          {/* Back */}
          <button
            onClick={() => setLocation(`/app/${slug}/blueprints`)}
            className="flex items-center gap-1.5 text-[#64748B] text-sm hover:text-[#E2E8F0] mb-5 transition-colors"
          >
            ← Blueprint Studio
          </button>

          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 border-2 border-[#00D4FF] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-4 text-red-300 text-sm">
              Failed to load blueprint.
            </div>
          )}

          {bp && (
            <div className="space-y-6">

              {/* Header */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h1 className="text-xl font-bold text-[#E2E8F0]">{bp.title}</h1>
                      {bp.isBuiltIn && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1E3A5F] text-[#64748B] font-semibold">BUILT-IN</span>
                      )}
                    </div>
                    <p className="text-[#64748B] text-xs font-mono">{bp.code} · v{bp.version}</p>
                  </div>
                  {(() => { const b = STATUS_BADGE[bp.status]; return (
                    <span className={`shrink-0 text-xs font-semibold px-3 py-1 rounded-full ${b.bg} ${b.text}`}>{b.label}</span>
                  );})()}
                </div>
                <p className="text-[#94A3B8] text-sm mt-3">{bp.objective}</p>

                {/* Action bar */}
                <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[#1E3A5F]">
                  {!bp.isBuiltIn && bp.status !== "archived" && (
                    <button
                      onClick={() => setLocation(`/app/${slug}/blueprints/${id}/edit`)}
                      className="px-3 py-1.5 bg-[#1E3A5F] text-[#E2E8F0] rounded-lg text-sm hover:bg-[#1E3A5F]/80 transition-colors"
                    >
                      Edit
                    </button>
                  )}
                  {!bp.isBuiltIn && bp.status !== "archived" && (
                    <button
                      onClick={() => setLocation(`/app/${slug}/blueprints/${id}/test`)}
                      className="px-3 py-1.5 bg-[#1E3A5F] text-[#E2E8F0] rounded-lg text-sm hover:bg-[#1E3A5F]/80 transition-colors"
                    >
                      Test
                    </button>
                  )}
                  {!bp.isBuiltIn && (
                    <button
                      onClick={() => setLocation(`/app/${slug}/blueprints/${id}/versions`)}
                      className="px-3 py-1.5 bg-[#1E3A5F] text-[#E2E8F0] rounded-lg text-sm hover:bg-[#1E3A5F]/80 transition-colors"
                    >
                      Version History
                    </button>
                  )}
                  {!bp.isBuiltIn && bp.status === "draft" && (
                    <button
                      onClick={() => submitReviewMutation.mutate()}
                      disabled={submitReviewMutation.isPending}
                      className="px-3 py-1.5 bg-amber-900/40 text-amber-300 rounded-lg text-sm hover:bg-amber-900/60 transition-colors"
                    >
                      Submit for Review
                    </button>
                  )}
                  {!bp.isBuiltIn && (bp.status === "draft" || bp.status === "review") && (
                    <button
                      onClick={() => setLocation(`/app/${slug}/blueprints/${id}/publish`)}
                      className="px-3 py-1.5 bg-emerald-900/40 text-emerald-300 rounded-lg text-sm hover:bg-emerald-900/60 transition-colors"
                    >
                      Publish
                    </button>
                  )}
                  <button
                    onClick={() => cloneMutation.mutate()}
                    disabled={cloneMutation.isPending}
                    className="px-3 py-1.5 bg-[#1E3A5F] text-[#E2E8F0] rounded-lg text-sm hover:bg-[#1E3A5F]/80 transition-colors"
                  >
                    Clone
                  </button>
                  {!bp.isBuiltIn && bp.status !== "archived" && (
                    <button
                      onClick={() => archiveMutation.mutate()}
                      disabled={archiveMutation.isPending}
                      className="px-3 py-1.5 bg-red-900/30 text-red-400 rounded-lg text-sm hover:bg-red-900/50 transition-colors"
                    >
                      Archive
                    </button>
                  )}
                  {!bp.isBuiltIn && bp.status === "archived" && (
                    <button
                      onClick={() => restoreMutation.mutate()}
                      disabled={restoreMutation.isPending}
                      className="px-3 py-1.5 bg-[#1E3A5F] text-[#E2E8F0] rounded-lg text-sm hover:bg-[#1E3A5F]/80 transition-colors"
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>

              {/* Two-column detail */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Section title="Specialist Assignment">
                  <Row label="Primary" value={bp.primarySpecialist} />
                  {bp.supportingSpecialists.length > 0 && (
                    <Row label="Supporting" value={bp.supportingSpecialists.join(", ")} />
                  )}
                </Section>

                <Section title="Required Knowledge">
                  {bp.requiredLibraryKnowledge.length > 0
                    ? bp.requiredLibraryKnowledge.map(k => <Tag key={k}>{k}</Tag>)
                    : <span className="text-[#64748B] text-sm">None specified</span>}
                </Section>

                <Section title="Validation Rules">
                  {bp.validationRules.length > 0 ? bp.validationRules.map(r => (
                    <div key={r.rule} className="flex items-start gap-2 text-sm">
                      <span className={r.required ? "text-red-400" : "text-amber-400"}>{r.required ? "●" : "○"}</span>
                      <div>
                        <p className="text-[#E2E8F0] text-xs font-mono">{r.rule}</p>
                        <p className="text-[#64748B] text-xs">{r.description}</p>
                      </div>
                    </div>
                  )) : <span className="text-[#64748B] text-sm">No validation rules</span>}
                </Section>

                <Section title="Quality Dimensions">
                  {bp.qualityRules.length > 0 ? bp.qualityRules.map(r => (
                    <div key={r.dimension} className="flex items-center justify-between text-sm">
                      <span className="text-[#E2E8F0] text-xs">{r.dimension}</span>
                      <span className="text-[#64748B] text-xs">{r.weight}%</span>
                    </div>
                  )) : <span className="text-[#64748B] text-sm">No quality rules</span>}
                </Section>

                <Section title="Success Criteria">
                  {bp.successCriteria.map(c => (
                    <p key={c} className="text-[#E2E8F0] text-sm flex gap-2"><span className="text-emerald-400">✓</span>{c}</p>
                  ))}
                </Section>

                <Section title="Output Types">
                  {bp.outputTypes.length > 0
                    ? bp.outputTypes.map(o => <Tag key={o}>{o}</Tag>)
                    : <span className="text-[#64748B] text-sm">None</span>}
                </Section>

                {bp.escalationRules.length > 0 && (
                  <Section title="Escalation Rules">
                    {bp.escalationRules.map(r => (
                      <div key={r.trigger} className="text-sm">
                        <p className="text-[#E2E8F0] text-xs font-mono">{r.trigger}</p>
                        <p className="text-[#64748B] text-xs">→ {r.action}</p>
                      </div>
                    ))}
                  </Section>
                )}

                {bp.mandatoryCitations.length > 0 && (
                  <Section title="Mandatory Citations">
                    {bp.mandatoryCitations.map(c => <Tag key={c}>{c}</Tag>)}
                  </Section>
                )}
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 space-y-2">
      <h3 className="text-xs uppercase tracking-widest text-[#64748B]/60 font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-[#64748B]">{label}</span>
      <span className="text-[#E2E8F0] font-mono text-xs">{value}</span>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block bg-[#1E3A5F] text-[#94A3B8] text-[11px] font-mono px-2 py-0.5 rounded mr-1 mb-1">
      {children}
    </span>
  );
}
