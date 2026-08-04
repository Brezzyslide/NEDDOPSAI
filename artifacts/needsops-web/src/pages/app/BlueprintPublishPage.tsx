/**
 * Blueprint Publish — /app/:slug/blueprints/:id/publish
 *
 * Sprint 28. Guided publish flow:
 *   1. Pre-publish validation summary
 *   2. Release notes input
 *   3. Publish confirmation
 *   4. Superseded blueprint notification
 */

import { useState }              from "react";
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
  validationRules: Array<{ rule: string; required: boolean; description: string }>;
  outputTypes: string[];
  successCriteria: string[];
  isBuiltIn: boolean;
}

export default function BlueprintPublishPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const queryClient = useQueryClient();

  const [notes, setNotes]           = useState("");
  const [confirmed, setConfirmed]   = useState(false);
  const [published, setPublished]   = useState(false);
  const [apiError, setApiError]     = useState<string | null>(null);

  const { data: bpData, isLoading } = useQuery({
    queryKey: ["blueprint", slug, id],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}`).then(r => r.json()),
    enabled: !!slug && !!id,
  });
  const bp: WorkBlueprint | undefined = bpData?.blueprint;

  const publishMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || undefined }),
      }).then(async r => {
        if (!r.ok) { const e = await r.json(); throw new Error(e?.error ?? "Publish failed"); }
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blueprint", slug, id] });
      queryClient.invalidateQueries({ queryKey: ["blueprints", slug] });
      queryClient.invalidateQueries({ queryKey: ["blueprint-versions", slug, id] });
      setPublished(true);
      setApiError(null);
    },
    onError: (e: any) => setApiError(e?.message ?? "Publish failed"),
  });

  if (published) {
    return (
      <>
        <Show when="signed-out"><Redirect to="/" /></Show>
        <AppShell orgSlug={slug}>
          <div className="p-6 max-w-2xl mx-auto">
            <div className="text-center py-16 space-y-4">
              <div className="text-6xl">🎉</div>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Blueprint Published</h1>
              <p className="text-[#64748B] text-sm max-w-sm mx-auto">
                The blueprint is now live. It will be preferred over the built-in version
                when your specialists select a matching workflow.
              </p>
              <div className="flex justify-center gap-3 pt-4">
                <button
                  onClick={() => setLocation(`/app/${slug}/blueprints/${id}`)}
                  className="px-5 py-2.5 bg-[#00D4FF] text-[#0B1829] rounded-lg font-semibold text-sm"
                >
                  View Blueprint
                </button>
                <button
                  onClick={() => setLocation(`/app/${slug}/blueprints/${id}/versions`)}
                  className="px-5 py-2.5 bg-[#1E3A5F] text-[#E2E8F0] rounded-lg text-sm"
                >
                  Version History
                </button>
              </div>
            </div>
          </div>
        </AppShell>
      </>
    );
  }

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug}>
        <div className="p-6 max-w-2xl mx-auto">

          <button
            onClick={() => setLocation(`/app/${slug}/blueprints/${id}`)}
            className="flex items-center gap-1.5 text-[#64748B] text-sm hover:text-[#E2E8F0] mb-5 transition-colors"
          >
            ← {bp?.title ?? "Blueprint"}
          </button>

          <h1 className="text-2xl font-bold text-[#E2E8F0] mb-2">Publish Blueprint</h1>
          <p className="text-[#64748B] text-sm mb-6">
            Publishing creates an immutable version snapshot and makes this blueprint
            live for your organisation's AI workforce.
          </p>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 border-2 border-[#00D4FF] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {bp && (
            <div className="space-y-5">

              {/* Pre-publish check */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 space-y-3">
                <h2 className="text-xs uppercase tracking-widest text-[#64748B]/60 font-semibold">Pre-publish Checklist</h2>

                <CheckItem
                  ok={!!bp.title}
                  label="Title set"
                  detail={bp.title || "—"}
                />
                <CheckItem
                  ok={!!bp.objective && bp.objective.length > 20}
                  label="Objective defined"
                  detail={bp.objective?.slice(0, 80) + (bp.objective?.length > 80 ? "…" : "") || "—"}
                />
                <CheckItem
                  ok={!!bp.primarySpecialist}
                  label="Primary specialist assigned"
                  detail={bp.primarySpecialist || "—"}
                />
                <CheckItem
                  ok={bp.outputTypes.length > 0}
                  label="Output types defined"
                  detail={bp.outputTypes.join(", ") || "None"}
                />
                <CheckItem
                  ok={bp.successCriteria.length > 0}
                  label="Success criteria defined"
                  detail={`${bp.successCriteria.length} criteria`}
                />
                <CheckItem
                  ok={bp.status === "draft" || bp.status === "review"}
                  label={`Blueprint status is publishable (${bp.status})`}
                  detail={bp.status === "published" ? "Already published" : bp.status}
                />
              </div>

              {/* Warning — any previous published blueprint of same code will be superseded */}
              <div className="bg-amber-900/10 border border-amber-900/30 rounded-xl p-4">
                <p className="text-amber-300 text-sm font-semibold">⚠ Note on Override</p>
                <p className="text-[#94A3B8] text-xs mt-1">
                  If another published blueprint exists for the code <code className="font-mono text-amber-200">{bp.code}</code>,
                  it will be superseded and replaced by this version.
                  Your organisation's specialists will then use this blueprint for matching requests.
                </p>
              </div>

              {/* Release notes */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 space-y-3">
                <h2 className="text-xs uppercase tracking-widest text-[#64748B]/60 font-semibold">Release Notes (optional)</h2>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Describe what changed in this version…"
                  className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF] resize-none"
                />
              </div>

              {/* Confirmation */}
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={e => setConfirmed(e.target.checked)}
                    className="mt-0.5 rounded"
                  />
                  <p className="text-[#94A3B8] text-sm">
                    I confirm this blueprint is ready to publish and will be used in live execution
                    for this organisation.
                  </p>
                </label>
              </div>

              {apiError && (
                <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-3 text-red-300 text-sm">{apiError}</div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => publishMutation.mutate()}
                  disabled={!confirmed || publishMutation.isPending || bp.status === "published"}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50 hover:bg-emerald-600/90 transition-colors"
                >
                  {publishMutation.isPending ? "Publishing…" : "Publish Blueprint"}
                </button>
                <button
                  onClick={() => setLocation(`/app/${slug}/blueprints/${id}`)}
                  className="px-5 py-2.5 bg-[#1E3A5F] text-[#E2E8F0] rounded-lg text-sm hover:bg-[#1E3A5F]/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}

function CheckItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`shrink-0 mt-0.5 ${ok ? "text-emerald-400" : "text-red-400"}`}>
        {ok ? "✓" : "✗"}
      </span>
      <div>
        <p className={`text-sm ${ok ? "text-[#E2E8F0]" : "text-red-300"}`}>{label}</p>
        <p className="text-[#64748B] text-xs">{detail}</p>
      </div>
    </div>
  );
}
