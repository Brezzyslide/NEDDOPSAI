/**
 * Source Detail & Review Page — /app/:slug/library/:sourceId
 *
 * Shows full metadata, processing status, extracted sections,
 * and review/approval actions for a single Organisation Library source.
 *
 * Customer-facing — never show RAG, embeddings, vectors, or chunk internals.
 */

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface KnowledgeSource {
  id: string;
  title: string;
  description?: string;
  sourceType: string;
  mimeType?: string;
  status: string;
  authorityLevel: string;
  sensitivityClassification: string;
  language: string;
  versionLabel?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  fileSizeBytes?: number;
  originalFileName?: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  revokedAt?: string;
  uploadedByUserId?: string;
}

interface IngestionJob {
  id: string;
  status: string;
  requiresHumanReview: boolean;
  promptInjectionFlags: unknown[];
  chunkCount?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  completedAt?: string;
}

interface Chunk {
  id: string;
  chunkIndex: number;
  sectionTitle?: string;
  headingPath?: string;
  pageNumber?: number;
  text: string;
  tokenCount?: number;
  hasEmbedding: boolean;
}

interface WarningsResponse {
  sourceId: string;
  requiresHumanReview: boolean;
  promptInjectionFlags: Array<{ type: string; description: string }>;
  pipelineWarnings:     Array<{ code: string; message: string }>;
}

interface ScopeRecord {
  scopeType: string;
  scopeId:   string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; badge: string; stage: string }> = {
  uploaded:        { label: "Uploaded",            badge: "bg-slate-100 text-slate-500 border-slate-200",  stage: "Waiting to process" },
  processing:      { label: "Reading document",    badge: "bg-blue-50 text-blue-600 border-blue-200",      stage: "NeedsOps is reading and organising this document." },
  review_required: { label: "Ready for review",    badge: "bg-amber-50 text-amber-700 border-amber-200",   stage: "Document has been read. Review the sections below, then approve or reject." },
  approved:        { label: "Approved",            badge: "bg-green-50 text-green-700 border-green-200",   stage: "This source is approved and available to your AI workforce." },
  failed:          { label: "Needs attention",     badge: "bg-red-50 text-red-600 border-red-200",         stage: "Processing could not be completed. See details below." },
  revoked:         { label: "Revoked",             badge: "bg-red-50 text-red-600 border-red-200",         stage: "This source has been revoked and is no longer used." },
  superseded:      { label: "Superseded",          badge: "bg-slate-100 text-slate-400 border-slate-200",  stage: "A newer version of this source is in use." },
  archived:        { label: "Archived",            badge: "bg-slate-50 text-slate-400 border-slate-200",   stage: "This source has been archived." },
};

const AUTHORITY_LABELS: Record<string, string> = {
  mandatory:      "Required reading",
  authoritative:  "Authoritative",
  supporting:     "Supporting",
  example_only:   "Example only",
  reference_only: "Reference only",
};

const SENSITIVITY_LABELS: Record<string, string> = {
  public:       "Public",
  internal:     "Internal",
  confidential: "Confidential",
  restricted:   "Restricted",
};

const SCOPE_LABELS: Record<string, string> = {
  organisation: "All specialists",
  workforce:    "AI workforce",
  specialist:   "Specialist",
  department:   "Department",
  location:     "Location",
  task_type:    "Task type",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  policy: "Policy", procedure: "Procedure", playbook: "Playbook",
  style_guide: "Style Guide", approved_example: "Approved Example",
  template: "Template", legislation_reference: "Legislation Reference",
  manual_note: "Manual Note", care_plan: "Care Plan",
  behaviour_support_plan: "Behaviour Support Plan", risk_assessment: "Risk Assessment",
  compliance_document: "Compliance Document", hr_manual: "HR Document",
  onboarding_guide: "Onboarding Guide", operational_manual: "Operational Manual",
  contract: "Contract", participant_document: "Participant Document",
  finance_procedure: "Finance Document",
};

function friendlySize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SourceDetailPage() {
  const { slug, sourceId } = useParams<{ slug: string; sourceId: string }>();
  const [, setLocation] = useLocation();
  const authFetch    = useAuthFetch();
  const queryClient  = useQueryClient();

  const [rejectReason, setRejectReason]       = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showEditMeta, setShowEditMeta]       = useState(false);
  const [editFields, setEditFields]           = useState<Record<string, string>>({});

  // ── Fetch source ─────────────────────────────────────────────────────────────

  const { data: sourceData, isLoading } = useQuery({
    queryKey: ["source-detail", slug, sourceId],
    queryFn: async () => {
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/sources/${sourceId}`);
      if (!res.ok) throw new Error("Failed to load source");
      return res.json() as Promise<{ source: KnowledgeSource; scopes: ScopeRecord[] }>;
    },
  });

  // ── Fetch ingestion job ───────────────────────────────────────────────────────

  const { data: jobsData } = useQuery({
    queryKey: ["source-jobs", slug, sourceId],
    queryFn: async () => {
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/ingestion?sourceId=${sourceId}&limit=1`);
      if (!res.ok) return { jobs: [] };
      return res.json() as Promise<{ jobs: IngestionJob[] }>;
    },
    refetchInterval: (data) => {
      const status = data?.state?.data?.jobs?.[0]?.status;
      return status === "processing" || status === "pending" ? 5000 : false;
    },
  });

  // ── Fetch chunks ─────────────────────────────────────────────────────────────

  const { data: chunksData } = useQuery({
    queryKey: ["source-chunks", slug, sourceId],
    queryFn: async () => {
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/sources/${sourceId}/chunks?limit=50`);
      if (!res.ok) return { chunks: [], total: 0 };
      return res.json() as Promise<{ chunks: Chunk[]; total: number }>;
    },
    enabled: !!sourceData,
  });

  // ── Fetch warnings ───────────────────────────────────────────────────────────

  const { data: warningsData } = useQuery({
    queryKey: ["source-warnings", slug, sourceId],
    queryFn: async () => {
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/sources/${sourceId}/warnings`);
      if (!res.ok) return null;
      return res.json() as Promise<WarningsResponse>;
    },
    enabled: !!sourceData,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const approveSource = useMutation({
    mutationFn: async () => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}/approve`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Approve failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["source-detail", slug, sourceId] });
      queryClient.invalidateQueries({ queryKey: ["library-sources", slug] });
    },
  });

  const rejectSource = useMutation({
    mutationFn: async (reason: string) => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}/reject-ingestion`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (!res.ok) throw new Error("Reject failed");
    },
    onSuccess: () => {
      setShowRejectModal(false);
      queryClient.invalidateQueries({ queryKey: ["source-detail", slug, sourceId] });
      queryClient.invalidateQueries({ queryKey: ["library-sources", slug] });
    },
  });

  const approveIngestion = useMutation({
    mutationFn: async () => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}/approve-ingestion`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Approve failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["source-detail", slug, sourceId] });
      queryClient.invalidateQueries({ queryKey: ["source-jobs", slug, sourceId] });
      queryClient.invalidateQueries({ queryKey: ["library-sources", slug] });
    },
  });

  const revokeSource = useMutation({
    mutationFn: async () => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}/revoke`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      );
      if (!res.ok) throw new Error("Revoke failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["source-detail", slug, sourceId] });
      queryClient.invalidateQueries({ queryKey: ["library-sources", slug] });
    },
  });

  const retryIngestion = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/ingestion/${jobId}/retry`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Retry failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["source-jobs", slug, sourceId] });
      queryClient.invalidateQueries({ queryKey: ["source-detail", slug, sourceId] });
    },
  });

  const saveMetadata = useMutation({
    mutationFn: async () => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editFields),
        },
      );
      if (!res.ok) throw new Error("Save failed");
    },
    onSuccess: () => {
      setShowEditMeta(false);
      queryClient.invalidateQueries({ queryKey: ["source-detail", slug, sourceId] });
      queryClient.invalidateQueries({ queryKey: ["library-sources", slug] });
    },
  });

  // ── Derived state ─────────────────────────────────────────────────────────────

  const source  = sourceData?.source;
  const scopes  = sourceData?.scopes ?? [];
  const job     = jobsData?.jobs?.[0];
  const chunks  = chunksData?.chunks ?? [];
  const warnings = warningsData;

  const statusInfo = STATUS_LABELS[source?.status ?? "uploaded"] ?? STATUS_LABELS.uploaded;

  const isScannedPdf =
    warnings?.pipelineWarnings?.some(w =>
      w.code === "SCANNED_PDF" || w.message?.toLowerCase().includes("scanned"),
    ) || false;

  const hasHighRiskWarning =
    (warnings?.promptInjectionFlags?.length ?? 0) > 0 ||
    (warnings?.pipelineWarnings?.some(w => w.code?.startsWith("CRITICAL")) ?? false);

  // ── Render ────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <AppShell orgSlug={slug ?? ""}>
        <div className="flex justify-center items-center h-64 text-slate-400 text-sm">Loading…</div>
      </AppShell>
    );
  }

  if (!source) {
    return (
      <AppShell orgSlug={slug ?? ""}>
        <div className="max-w-3xl mx-auto px-4 py-12 text-center text-slate-500">
          <p className="text-4xl mb-3">📄</p>
          <p className="font-medium">Source not found</p>
          <button onClick={() => setLocation(`/app/${slug}/library`)} className="mt-4 text-indigo-600 text-sm hover:underline">
            ← Back to Library
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell orgSlug={slug ?? ""}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Back */}
        <button onClick={() => setLocation(`/app/${slug}/library`)}
          className="text-sm text-slate-500 hover:text-indigo-600 flex items-center gap-1">
          ← Organisation Library
        </button>

        {/* Header */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusInfo.badge}`}>
                  {statusInfo.label}
                </span>
                <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                  {SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType}
                </span>
                <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                  {AUTHORITY_LABELS[source.authorityLevel] ?? source.authorityLevel}
                </span>
                <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                  {SENSITIVITY_LABELS[source.sensitivityClassification] ?? source.sensitivityClassification}
                </span>
              </div>
              <h1 className="text-xl font-semibold text-slate-900">{source.title}</h1>
              {source.description && (
                <p className="text-sm text-slate-500 mt-1">{source.description}</p>
              )}
              <div className="flex gap-4 flex-wrap mt-2 text-xs text-slate-400">
                {source.versionLabel && <span>Version {source.versionLabel}</span>}
                {source.effectiveFrom && (
                  <span>Effective {new Date(source.effectiveFrom).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</span>
                )}
                {source.originalFileName && <span>{source.originalFileName}</span>}
                {source.fileSizeBytes && <span>{friendlySize(source.fileSizeBytes)}</span>}
                <span>Added {new Date(source.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap flex-shrink-0">
              {source.status === "review_required" && (
                <>
                  {hasHighRiskWarning ? (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 max-w-xs">
                      ⚠ Review warnings below before approving.
                    </div>
                  ) : (
                    <button
                      onClick={() => approveIngestion.mutate()}
                      disabled={approveIngestion.isPending}
                      className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
                      {approveIngestion.isPending ? "Approving…" : "Approve"}
                    </button>
                  )}
                  <button
                    onClick={() => setShowRejectModal(true)}
                    className="px-3 py-1.5 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50">
                    Reject
                  </button>
                </>
              )}
              {source.status === "approved" && (
                <button
                  onClick={() => revokeSource.mutate()}
                  disabled={revokeSource.isPending}
                  className="px-3 py-1.5 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50">
                  Revoke
                </button>
              )}
              {source.status === "failed" && job && (
                <button
                  onClick={() => retryIngestion.mutate(job.id)}
                  disabled={retryIngestion.isPending}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {retryIngestion.isPending ? "Retrying…" : "Retry processing"}
                </button>
              )}
              <button
                onClick={() => {
                  setEditFields({
                    title:                    source.title,
                    description:              source.description ?? "",
                    versionLabel:             source.versionLabel ?? "",
                    authorityLevel:           source.authorityLevel,
                    sensitivityClassification: source.sensitivityClassification,
                  });
                  setShowEditMeta(true);
                }}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50">
                Edit details
              </button>
            </div>
          </div>

          {/* Status stage message */}
          {statusInfo.stage && (
            <p className="mt-3 text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              {statusInfo.stage}
            </p>
          )}
        </div>

        {/* Scoped to */}
        {scopes.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Available to</h2>
            <div className="flex gap-2 flex-wrap">
              {scopes.map((s, i) => (
                <span key={i} className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-1 rounded-full">
                  {SCOPE_LABELS[s.scopeType] ?? s.scopeType}
                  {s.scopeId !== "all" ? `: ${s.scopeId}` : ""}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Scanned PDF notice */}
        {isScannedPdf && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🖨</span>
              <div>
                <p className="font-medium text-amber-800 text-sm">Scanned document detected</p>
                <p className="text-sm text-amber-700 mt-0.5">
                  This document appears to be scanned and cannot yet be read automatically. 
                  You can manually review and approve it, or replace it with a text-based version.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Prompt injection warning */}
        {(warnings?.promptInjectionFlags?.length ?? 0) > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠</span>
              <div>
                <p className="font-medium text-red-800 text-sm">Security review required</p>
                <p className="text-sm text-red-700 mt-0.5">
                  This document contains content that requires human review before it can be approved.
                  Do not approve until you have reviewed the full document.
                </p>
                {(warnings?.promptInjectionFlags as any[])?.map((f, i) => (
                  <p key={i} className="text-xs text-red-600 mt-1">• {f.description ?? f.type ?? String(f)}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Other pipeline warnings */}
        {(warnings?.pipelineWarnings?.filter(w => w.code !== "SCANNED_PDF").length ?? 0) > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1">
            <p className="font-medium text-amber-800 text-sm">Processing notes</p>
            {warnings!.pipelineWarnings.filter(w => w.code !== "SCANNED_PDF").map((w, i) => (
              <p key={i} className="text-sm text-amber-700">• {w.message}</p>
            ))}
          </div>
        )}

        {/* Extracted sections */}
        {chunks.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                Extracted content
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {chunksData?.total ?? chunks.length} section{(chunksData?.total ?? chunks.length) !== 1 ? "s" : ""}
                </span>
              </h2>
            </div>
            <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
              {chunks.map(chunk => (
                <div key={chunk.id} className="px-5 py-3">
                  <div className="flex items-start gap-3">
                    <span className="text-xs text-slate-400 w-6 text-right mt-0.5 flex-shrink-0">
                      {chunk.pageNumber ?? chunk.chunkIndex + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      {chunk.sectionTitle && (
                        <p className="text-xs font-medium text-slate-600 mb-1">
                          {chunk.headingPath ? chunk.headingPath.split(" > ").pop() : chunk.sectionTitle}
                        </p>
                      )}
                      <p className="text-sm text-slate-700 line-clamp-3">{chunk.text}</p>
                      <div className="flex gap-3 mt-1 text-xs text-slate-400">
                        {chunk.tokenCount && <span>{chunk.tokenCount} words</span>}
                        {chunk.hasEmbedding && (
                          <span className="text-green-600">✓ Indexed</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No sections yet */}
        {chunks.length === 0 && (source.status === "uploaded" || source.status === "processing") && (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
            <div className="text-3xl mb-3">⏳</div>
            <p className="text-slate-600 font-medium text-sm">
              {source.status === "processing"
                ? "NeedsOps is reading and organising this document."
                : "This document is queued for processing."}
            </p>
          </div>
        )}

        {/* Empty after failure */}
        {chunks.length === 0 && source.status === "failed" && !isScannedPdf && (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
            <div className="text-3xl mb-3">⚠</div>
            <p className="text-slate-600 font-medium text-sm">Processing could not be completed.</p>
            {job?.lastErrorMessage && (
              <p className="text-xs text-slate-400 mt-1">{job.lastErrorMessage}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Reject modal ─────────────────────────────────────────────────────── */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-2">Reject this document?</h2>
            <p className="text-sm text-slate-500 mb-4">
              The document will be removed from processing. You can upload a corrected version later.
            </p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Optional: reason for rejection"
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => rejectSource.mutate(rejectReason)}
                disabled={rejectSource.isPending}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
                {rejectSource.isPending ? "Rejecting…" : "Reject document"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit metadata modal ──────────────────────────────────────────────── */}
      {showEditMeta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Edit document details</h2>

            {[
              { key: "title",        label: "Title",   type: "text" },
              { key: "description",  label: "Description", type: "textarea" },
              { key: "versionLabel", label: "Version",     type: "text" },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs font-medium text-slate-700">{f.label}</label>
                {f.type === "textarea" ? (
                  <textarea
                    value={editFields[f.key] ?? ""}
                    onChange={e => setEditFields(p => ({ ...p, [f.key]: e.target.value }))}
                    rows={2}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <input
                    type="text"
                    value={editFields[f.key] ?? ""}
                    onChange={e => setEditFields(p => ({ ...p, [f.key]: e.target.value }))}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                )}
              </div>
            ))}

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-700">Authority level</label>
                <select
                  value={editFields.authorityLevel ?? ""}
                  onChange={e => setEditFields(p => ({ ...p, authorityLevel: e.target.value }))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  {Object.entries(AUTHORITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-700">Sensitivity</label>
                <select
                  value={editFields.sensitivityClassification ?? ""}
                  onChange={e => setEditFields(p => ({ ...p, sensitivityClassification: e.target.value }))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  {Object.entries(SENSITIVITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setShowEditMeta(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => saveMetadata.mutate()}
                disabled={saveMetadata.isPending}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saveMetadata.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
