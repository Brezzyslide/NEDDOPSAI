/**
 * Blueprint Version History — /app/:slug/blueprints/:id/versions
 *
 * Sprint 28. View immutable version snapshots for a blueprint.
 * Supports: view version details, compare versions, roll back.
 */

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show }    from "@clerk/react";
import { Redirect } from "wouter";
import AppShell    from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

interface BlueprintVersion {
  id: string;
  blueprintId: string;
  organizationId: string;
  versionLabel: string;
  status: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  draft:      { bg: "bg-blue-900/40",    text: "text-blue-300" },
  review:     { bg: "bg-amber-900/40",   text: "text-amber-300" },
  published:  { bg: "bg-emerald-900/40", text: "text-emerald-300" },
  superseded: { bg: "bg-purple-900/40",  text: "text-purple-300" },
  archived:   { bg: "bg-gray-800/60",    text: "text-gray-400" },
};

export default function BlueprintVersionHistoryPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const queryClient = useQueryClient();

  const [selected, setSelected]     = useState<string | null>(null);
  const [comparing, setComparing]   = useState<string | null>(null);
  const [rollbackId, setRollbackId] = useState<string | null>(null);

  const { data: bpData } = useQuery({
    queryKey: ["blueprint", slug, id],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}`).then(r => r.json()),
    enabled: !!slug && !!id,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["blueprint-versions", slug, id],
    queryFn: () =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/versions`).then(r => r.json()),
    enabled: !!slug && !!id,
  });

  const versions: BlueprintVersion[] = data?.versions ?? [];
  const bp = bpData?.blueprint;

  const rollbackMutation = useMutation({
    mutationFn: (versionId: string) =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["blueprints", slug] });
      setRollbackId(null);
      const newId = data?.blueprint?.id;
      if (newId) setLocation(`/app/${slug}/blueprints/${newId}/edit`);
    },
  });

  const selectedVersion = versions.find(v => v.id === selected);
  const comparingVersion = versions.find(v => v.id === comparing);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  }

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug}>
        <div className="p-6 max-w-6xl mx-auto">

          <button
            onClick={() => setLocation(`/app/${slug}/blueprints/${id}`)}
            className="flex items-center gap-1.5 text-[#64748B] text-sm hover:text-[#E2E8F0] mb-5 transition-colors"
          >
            ← {bp?.title ?? "Blueprint"}
          </button>

          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Version History</h1>
            {versions.length >= 2 && (
              <p className="text-[#64748B] text-sm">{versions.length} versions · Select two to compare</p>
            )}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 border-2 border-[#00D4FF] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!isLoading && versions.length === 0 && (
            <div className="text-center py-16 text-[#64748B]">
              <p className="text-4xl mb-3">📋</p>
              <p className="font-medium text-[#E2E8F0]">No versions yet</p>
              <p className="text-sm mt-1">Publish the blueprint to create the first version snapshot.</p>
              <button
                onClick={() => setLocation(`/app/${slug}/blueprints/${id}/publish`)}
                className="mt-4 px-4 py-2 bg-emerald-900/40 text-emerald-300 rounded-lg text-sm hover:bg-emerald-900/60 transition-colors"
              >
                Publish Blueprint
              </button>
            </div>
          )}

          {!isLoading && versions.length > 0 && (
            <div className="flex gap-5">

              {/* Version list */}
              <div className="w-72 shrink-0 space-y-2">
                {versions.map(v => {
                  const badge = STATUS_BADGE[v.status] ?? STATUS_BADGE.draft;
                  const isSelected = selected === v.id;
                  const isComparing = comparing === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => {
                        if (selected === v.id) { setSelected(null); setComparing(null); }
                        else if (!selected) setSelected(v.id);
                        else if (comparing === v.id) setComparing(null);
                        else setComparing(v.id);
                      }}
                      className={`w-full text-left bg-[#112033] border rounded-xl p-3 transition-colors ${
                        isSelected ? "border-[#00D4FF]" :
                        isComparing ? "border-amber-500" :
                        "border-[#1E3A5F] hover:border-[#1E3A5F]/80"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[#E2E8F0] font-mono text-sm">v{v.versionLabel}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${badge.bg} ${badge.text}`}>
                          {v.status}
                        </span>
                      </div>
                      <p className="text-[#64748B] text-xs">{formatDate(v.createdAt)}</p>
                      {v.notes && <p className="text-[#94A3B8] text-xs mt-1 line-clamp-2">{v.notes}</p>}
                      {isSelected && <p className="text-[#00D4FF] text-[10px] mt-1">● Selected</p>}
                      {isComparing && <p className="text-amber-400 text-[10px] mt-1">● Comparing</p>}
                    </button>
                  );
                })}
              </div>

              {/* Detail panel */}
              <div className="flex-1 space-y-4">
                {!selected && (
                  <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-8 text-center text-[#64748B]">
                    <p className="text-2xl mb-2">←</p>
                    <p className="text-sm">Select a version to view its snapshot.</p>
                    <p className="text-xs mt-1">Select a second version to compare.</p>
                  </div>
                )}

                {selectedVersion && !comparingVersion && (
                  <VersionDetail version={selectedVersion} onRollback={() => setRollbackId(selectedVersion.id)} />
                )}

                {selectedVersion && comparingVersion && (
                  <VersionCompare a={selectedVersion} b={comparingVersion} />
                )}
              </div>
            </div>
          )}

          {/* Rollback confirmation */}
          {rollbackId && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6 max-w-md w-full">
                <h2 className="text-[#E2E8F0] font-bold mb-2">Roll Back to this Version?</h2>
                <p className="text-[#64748B] text-sm mb-4">
                  A new draft blueprint will be created from this version's snapshot.
                  The current blueprint is unchanged.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => rollbackMutation.mutate(rollbackId)}
                    disabled={rollbackMutation.isPending}
                    className="flex-1 py-2.5 bg-[#00D4FF] text-[#0B1829] rounded-lg font-semibold text-sm"
                  >
                    {rollbackMutation.isPending ? "Rolling back…" : "Confirm Rollback"}
                  </button>
                  <button
                    onClick={() => setRollbackId(null)}
                    className="flex-1 py-2.5 bg-[#1E3A5F] text-[#E2E8F0] rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}

function VersionDetail({ version, onRollback }: { version: BlueprintVersion; onRollback: () => void }) {
  const snap = version.snapshot;
  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[#E2E8F0] font-semibold">v{version.versionLabel}</h2>
          <p className="text-[#64748B] text-xs">{new Date(version.createdAt).toLocaleString("en-AU")}</p>
        </div>
        <button
          onClick={onRollback}
          className="px-3 py-1.5 bg-amber-900/30 text-amber-300 rounded-lg text-sm hover:bg-amber-900/50 transition-colors"
        >
          Roll Back
        </button>
      </div>
      {version.notes && (
        <div className="bg-[#0B1829] rounded-lg p-3 text-[#94A3B8] text-sm italic">{version.notes}</div>
      )}
      <div className="space-y-2 text-sm">
        <SnapRow label="Title"   value={String(snap.title ?? "")} />
        <SnapRow label="Objective" value={String(snap.objective ?? "")} />
        <SnapRow label="Primary Specialist" value={String(snap.primarySpecialist ?? "")} />
        <SnapRow label="Output Types" value={(snap.outputTypes as string[])?.join(", ") ?? ""} />
        <SnapRow label="Success Criteria" value={(snap.successCriteria as string[])?.join(" · ") ?? ""} />
      </div>
    </div>
  );
}

function VersionCompare({ a, b }: { a: BlueprintVersion; b: BlueprintVersion }) {
  const fields = ["title", "objective", "primarySpecialist", "version"];
  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 space-y-4">
      <div className="grid grid-cols-2 gap-4 text-center mb-2">
        <div><p className="text-[#00D4FF] font-semibold text-sm">v{a.versionLabel}</p></div>
        <div><p className="text-amber-400 font-semibold text-sm">v{b.versionLabel}</p></div>
      </div>
      {fields.map(f => {
        const va = String((a.snapshot as any)[f] ?? "");
        const vb = String((b.snapshot as any)[f] ?? "");
        const changed = va !== vb;
        return (
          <div key={f} className={`rounded-lg p-3 ${changed ? "bg-amber-900/10 border border-amber-900/30" : "bg-[#0B1829]"}`}>
            <p className="text-[#64748B] text-xs uppercase tracking-wider mb-2">{f}</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <p className="text-[#E2E8F0]">{va || "—"}</p>
              <p className={changed ? "text-amber-300" : "text-[#E2E8F0]"}>{vb || "—"}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SnapRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[#64748B] text-xs">{label}</p>
      <p className="text-[#E2E8F0] text-sm">{value || "—"}</p>
    </div>
  );
}
