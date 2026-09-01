/**
 * Organisation Library — /app/:slug/library
 *
 * Browse, upload, and manage knowledge sources.
 * Customer-facing name: "Organisation Library"
 *
 * Never expose: RAG, embeddings, vectors, chunks, pgvector, token budget.
 */

import { useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";
import { resolveMimeType, ACCEPTED_UPLOAD_TYPES } from "@/lib/uploadUtils";

// ─── Types ────────────────────────────────────────────────────────────────────

type SourceStatus =
  | "uploaded" | "processing" | "review_required" | "approved"
  | "failed" | "revoked" | "superseded" | "archived";

interface KnowledgeSource {
  id: string;
  title: string;
  description?: string;
  sourceType: string;
  mimeType?: string;
  status: SourceStatus;
  authorityLevel: string;
  sensitivityClassification: string;
  versionLabel?: string;
  effectiveFrom?: string;
  fileSizeBytes?: number;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  latestIngestionJob?: IngestionJobSummary | null;
}

interface IngestionJobSummary {
  id: string;
  status: string;
  attemptCount?: number;
  maxAttempts?: number;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  chunkCount?: number | null;
  embeddingCount?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastAttemptAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface ScopeRecord {
  scopeType: string;
  scopeId:   string;
}

interface UploadUrlResponse {
  uploadUrl:       string | null;
  sourceId:        string;
  storageKey:      string;
  storageProvider: string;
  expiresInSeconds: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<SourceStatus, { label: string; badge: string }> = {
  uploaded:        { label: "Uploaded",         badge: "bg-slate-100 text-slate-500 border-slate-200" },
  processing:      { label: "Reading document", badge: "bg-blue-50 text-blue-600 border-blue-200" },
  review_required: { label: "Ready for review", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  approved:        { label: "Approved",         badge: "bg-green-50 text-green-700 border-green-200" },
  failed:          { label: "Needs attention",  badge: "bg-red-50 text-red-600 border-red-200" },
  revoked:         { label: "Revoked",          badge: "bg-red-50 text-red-400 border-red-100" },
  superseded:      { label: "Superseded",       badge: "bg-slate-100 text-slate-400 border-slate-200" },
  archived:        { label: "Archived",         badge: "bg-slate-50 text-slate-400 border-slate-200" },
};

const ACTIVE_JOB_STATUSES = new Set(["queued", "fetching", "extracting", "normalising", "chunking", "embedding", "cancelling"]);
const STALLED_JOB_THRESHOLD_MS = 10 * 60 * 1000;

function isIngestionJobStalled(job?: IngestionJobSummary | null): boolean {
  if (!job || job.status !== "queued" || (job.attemptCount ?? 0) !== 0 || !job.createdAt) return false;
  return Date.now() - new Date(job.createdAt).getTime() > STALLED_JOB_THRESHOLD_MS;
}

function ingestionJobBadge(job?: IngestionJobSummary | null): { label: string; cls: string } | null {
  if (!job) return null;
  if (isIngestionJobStalled(job)) {
    return { label: "Processing stalled", cls: "bg-red-50 text-red-700 border-red-200" };
  }
  const labels: Record<string, string> = {
    queued: "Queued",
    fetching: "Fetching",
    extracting: "Extracting",
    normalising: "Organising",
    chunking: "Sectioning",
    embedding: "Indexing",
    review_required: "Ready",
    approved: "Indexed",
    failed: "Processing failed",
    dead_lettered: "Processing failed",
    cancelled: "Cancelled",
  };
  const failed = job.status === "failed" || job.status === "dead_lettered";
  const ready = job.status === "review_required" || job.status === "approved";
  return {
    label: labels[job.status] ?? job.status,
    cls: failed
      ? "bg-red-50 text-red-700 border-red-200"
      : ready
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-blue-50 text-blue-700 border-blue-200",
  };
}

const STATUS_FILTERS: Array<{ key: SourceStatus | "all"; label: string }> = [
  { key: "all",             label: "All" },
  { key: "approved",        label: "Approved" },
  { key: "review_required", label: "Needs Review" },
  { key: "processing",      label: "Processing" },
  { key: "uploaded",        label: "Uploaded" },
  { key: "failed",          label: "Needs Attention" },
  { key: "revoked",         label: "Revoked" },
];

const DOCUMENT_CATEGORIES = [
  { value: "policy",                  label: "Policy" },
  { value: "procedure",               label: "Procedure" },
  { value: "playbook",                label: "Playbook" },
  { value: "style_guide",             label: "Style Guide" },
  { value: "approved_example",        label: "Approved Example" },
  { value: "template",                label: "Template" },
  { value: "legislation_reference",   label: "Legislation Reference" },
  { value: "manual_note",             label: "Manual Note" },
  { value: "care_plan",               label: "Care Plan" },
  { value: "behaviour_support_plan",  label: "Behaviour Support Plan" },
  { value: "participant_document",    label: "Participant Document" },
  { value: "hr_manual",               label: "HR Document" },
  { value: "finance_procedure",       label: "Finance Document" },
  { value: "contract",                label: "Contract" },
  { value: "risk_assessment",         label: "Risk Assessment" },
  { value: "compliance_document",     label: "Compliance Document" },
  { value: "operational_manual",      label: "Operational Manual" },
] as const;

const AUTHORITY_OPTIONS = [
  { value: "mandatory",       label: "Required reading — all specialists must follow" },
  { value: "authoritative",   label: "Authoritative — primary reference" },
  { value: "supporting",      label: "Supporting — additional context" },
  { value: "example_only",    label: "Approved example — for reference" },
  { value: "reference_only",  label: "Reference only — background information" },
];

const SENSITIVITY_OPTIONS = [
  { value: "public",       label: "Public — no restrictions" },
  { value: "internal",     label: "Internal — staff only" },
  { value: "confidential", label: "Confidential — limited access" },
  { value: "restricted",   label: "Restricted — explicit permission required" },
];

const SCOPE_OPTIONS = [
  { value: "organisation:all",  label: "All specialists — available to everyone" },
  { value: "workforce:all",     label: "AI workforce — all AI employees" },
];

const AUTHORITY_SHORT: Record<string, string> = {
  mandatory: "Required", authoritative: "Authoritative",
  supporting: "Supporting", example_only: "Example", reference_only: "Reference",
};

const SENSITIVITY_SHORT: Record<string, string> = {
  public: "Public", internal: "Internal", confidential: "Confidential", restricted: "Restricted",
};

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_CATEGORIES.map(c => [c.value, c.label]),
);


// ─── Helpers ──────────────────────────────────────────────────────────────────

async function computeChecksum(file: File): Promise<string> {
  const buf  = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function mimeIcon(mimeType?: string): string {
  if (!mimeType) return "📎";
  if (mimeType.includes("pdf"))    return "📄";
  if (mimeType.includes("word") || mimeType.includes("officedocument")) return "📝";
  if (mimeType.includes("markdown") || mimeType.includes("text")) return "📃";
  return "📎";
}

function friendlySize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024)    return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function friendlyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Upload Wizard Steps ──────────────────────────────────────────────────────

interface UploadState {
  file:         File | null;
  title:        string;
  description:  string;
  category:     string;
  scope:        string;  // "organisation:all" | "workforce:all"
  authorityLevel:           string;
  sensitivityClassification: string;
  versionLabel: string;
  effectiveFrom: string;
}

const INITIAL_UPLOAD: UploadState = {
  file: null, title: "", description: "",
  category: "policy", scope: "organisation:all",
  authorityLevel: "supporting", sensitivityClassification: "internal",
  versionLabel: "", effectiveFrom: "",
};

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrgLibraryPage() {
  const { slug }      = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const authFetch     = useAuthFetch();
  const queryClient   = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<SourceStatus | "all">("all");
  const [search,       setSearch]       = useState("");
  const [showUpload,   setShowUpload]   = useState(false);
  const [step,         setStep]         = useState<WizardStep>(1);
  const [upload,       setUpload]       = useState<UploadState>(INITIAL_UPLOAD);
  const [uploading,    setUploading]    = useState(false);
  const [uploadError,  setUploadError]  = useState<string | null>(null);

  // ── List sources ─────────────────────────────────────────────────────────────

  const { data, isLoading, error } = useQuery({
    queryKey: ["library-sources", slug, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/sources?${params}`);
      if (!res.ok) throw new Error("Failed to load library");
      return res.json() as Promise<{ sources: KnowledgeSource[]; total: number }>;
    },
    enabled: !!slug && slug !== "undefined",
    staleTime: 30_000,
    refetchInterval: (qdata) => {
      const hasProcessing = qdata?.state?.data?.sources?.some(
        (s: KnowledgeSource) =>
          s.status === "processing" || ACTIVE_JOB_STATUSES.has(s.latestIngestionJob?.status ?? ""),
      );
      return hasProcessing ? 8000 : false;
    },
  });

  // ── Source mutations ──────────────────────────────────────────────────────────
  // Sprint 29M Part G: approveSource (POST /approve) removed — no longer called
  // from this page. The backend route remains for any other callers. Auto-approval
  // for low-risk uploads is handled server-side in ingestionPipelineService.ts.

  const approveIngestion = useMutation({
    mutationFn: async (sourceId: string) => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}/approve-ingestion`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Approve failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library-sources", slug] }),
  });

  const revokeSource = useMutation({
    mutationFn: async (sourceId: string) => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}/revoke`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      );
      if (!res.ok) throw new Error("Revoke failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library-sources", slug] }),
  });

  // ── Upload flow ───────────────────────────────────────────────────────────────

  function openUpload() {
    setUpload(INITIAL_UPLOAD);
    setStep(1);
    setUploadError(null);
    setShowUpload(true);
  }

  function closeUpload() {
    setShowUpload(false);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    setUpload(prev => ({
      ...prev,
      file: f,
      title: prev.title || f.name.replace(/\.[^.]+$/, ""),
    }));
  }

  function nextStep() {
    setStep(s => Math.min(s + 1, 6) as WizardStep);
  }

  function prevStep() {
    setStep(s => Math.max(s - 1, 1) as WizardStep);
  }

  const canProceed: Record<WizardStep, boolean> = {
    1: !!upload.file,
    2: upload.title.trim().length > 0,
    3: upload.category.length > 0,
    4: upload.scope.length > 0,
    5: true,
    6: true,
  };

  async function handleUpload() {
    if (!upload.file) return;
    setUploading(true);
    setUploadError(null);

    try {
      const mimeType         = resolveMimeType(upload.file);
      const fileSize         = upload.file.size;
      const originalFileName = upload.file.name;
      const checksum         = await computeChecksum(upload.file);

      // Step 1 — get signed URL
      const reqRes = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/request-upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ originalFileName, mimeType, fileSize, checksum, sourceScope: "library" }),
        },
      );
      if (!reqRes.ok) {
        const err = await reqRes.json().catch(() => ({}));
        if (err?.error?.code === "DUPLICATE_CHECKSUM") {
          throw new Error("This file has already been uploaded to your library.");
        }
        throw new Error(err?.error?.message ?? "Upload request failed");
      }
      const { uploadUrl, sourceId, storageKey, storageProvider }: UploadUrlResponse = await reqRes.json();

      // Step 2 — proxy the file through our own API (Replit credentials cannot
      // sign GCS URLs, so we always upload server-side via /file route)
      const putRes = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}/file`,
        {
          method: "PUT",
          headers: {
            "Content-Type": mimeType,
            "X-Storage-Key": storageKey,
          },
          body: upload.file,
        },
      );
      if (!putRes.ok) {
        const err = await putRes.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? "File upload failed");
      }

      // Step 3 — confirm with metadata
      const [scopeType, scopeId] = upload.scope.split(":");
      const completeRes = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}/complete-upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title:                    upload.title.trim(),
            description:              upload.description.trim() || undefined,
            sourceType:               upload.category,
            storageKey,
            storageProvider,
            originalFileName,
            mimeType,
            fileSize,
            checksum,
            sourceScope:              "library",
            authorityLevel:           upload.authorityLevel,
            sensitivityClassification: upload.sensitivityClassification,
            versionLabel:             upload.versionLabel.trim() || undefined,
            effectiveFrom:            upload.effectiveFrom || undefined,
          }),
        },
      );
      if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? "Upload confirmation failed");
      }
      const { source: newSource } = await completeRes.json();

      // Step 4 — assign scope
      if (scopeType && scopeId) {
        await authFetch(
          `/v1/organisations/${slug}/knowledge/sources/${newSource.id}/scopes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scopeType, scopeId }),
          },
        ).catch(() => {}); // Non-fatal if scope assignment fails
      }

      queryClient.invalidateQueries({ queryKey: ["library-sources", slug] });
      closeUpload();
    } catch (err: any) {
      setUploadError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ── Filtered sources ──────────────────────────────────────────────────────────

  const allSources = data?.sources ?? [];
  const sources = allSources.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (CATEGORY_LABELS[s.sourceType] ?? s.sourceType).toLowerCase().includes(q)
    );
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <AppShell orgSlug={slug!}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Organisation Library</h1>
            <p className="text-sm text-slate-500 mt-1">
              Approved documents are read by your AI workforce. Upload policies, procedures,
              and reference documents to train your specialists.
            </p>
          </div>
          <button
            onClick={openUpload}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex-shrink-0">
            <span className="text-lg leading-none">+</span>
            Upload Document
          </button>
        </div>

        {/* Search + filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search documents…"
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                statusFilter === f.key
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading && (
          <div className="flex justify-center py-16 text-slate-400 text-sm">Loading…</div>
        )}
        {error && (
          <div className="text-red-600 text-sm py-4">Failed to load library documents.</div>
        )}
        {!isLoading && !error && sources.length === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📚</div>
            <p className="text-slate-600 font-medium mb-2">
              {search
                ? `No documents matching "${search}"`
                : statusFilter === "all"
                  ? "Your library is empty"
                  : `No documents with this status`}
            </p>
            <p className="text-sm text-slate-400 max-w-sm mx-auto">
              {statusFilter === "all" && !search
                ? "Add your policies, procedures, templates and examples so your AI workforce can work the way your organisation works."
                : "Try a different filter or search term."}
            </p>
            {statusFilter === "all" && !search && (
              <button onClick={openUpload} className="mt-5 px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
                Upload your first document
              </button>
            )}
          </div>
        )}

        <div className="space-y-3">
          {sources.map(source => {
            const sc = STATUS_CONFIG[source.status] ?? STATUS_CONFIG.uploaded;
            const jobBadge = ingestionJobBadge(source.latestIngestionJob);
            return (
              <div
                key={source.id}
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-indigo-200 transition-colors">
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="text-2xl flex-shrink-0 mt-0.5">{mimeIcon(source.mimeType)}</div>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    {/* Badges */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${sc.badge}`}>
                        {sc.label}
                      </span>
                      {jobBadge && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${jobBadge.cls}`}>
                          {jobBadge.label}
                        </span>
                      )}
                      <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                        {CATEGORY_LABELS[source.sourceType] ?? source.sourceType}
                      </span>
                      <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                        {AUTHORITY_SHORT[source.authorityLevel] ?? source.authorityLevel}
                      </span>
                      <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                        {SENSITIVITY_SHORT[source.sensitivityClassification] ?? source.sensitivityClassification}
                      </span>
                    </div>

                    {/* Title */}
                    <button
                      onClick={() => setLocation(`/app/${slug}/library/${source.id}`)}
                      className="font-medium text-slate-900 text-sm hover:text-indigo-700 text-left">
                      {source.title}
                    </button>

                    {source.description && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{source.description}</p>
                    )}

                    {/* Meta row */}
                    <div className="flex gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                      {source.versionLabel && <span>v{source.versionLabel}</span>}
                      {source.effectiveFrom && (
                        <span>Effective {friendlyDate(source.effectiveFrom)}</span>
                      )}
                      {source.fileSizeBytes && <span>{friendlySize(source.fileSizeBytes)}</span>}
                      <span>Added {friendlyDate(source.createdAt)}</span>
                      {source.approvedAt && <span>· Approved {friendlyDate(source.approvedAt)}</span>}
                    </div>
                    {isIngestionJobStalled(source.latestIngestionJob) && (
                      <p className="text-xs text-red-600 mt-1">
                        No worker has claimed this document for processing for more than 10 minutes.
                      </p>
                    )}
                    {source.latestIngestionJob?.lastErrorMessage && (
                      <p className="text-xs text-red-600 mt-1">{source.latestIngestionJob.lastErrorMessage}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 flex-shrink-0 items-start">
                    <button
                      onClick={() => setLocation(`/app/${slug}/library/${source.id}`)}
                      className="px-3 py-1.5 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors">
                      View
                    </button>
                    {source.status === "review_required" && (
                      <button
                        onClick={() => approveIngestion.mutate(source.id)}
                        disabled={approveIngestion.isPending}
                        className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                        Approve
                      </button>
                    )}
                    {source.status === "approved" && (
                      <button
                        onClick={() => revokeSource.mutate(source.id)}
                        disabled={revokeSource.isPending}
                        className="px-3 py-1.5 border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Upload Wizard ──────────────────────────────────────────────────────── */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

            {/* Wizard header */}
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Upload Document</h2>
                <button onClick={closeUpload} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
              </div>
              {/* Progress steps */}
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5, 6].map(s => (
                  <div
                    key={s}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      s <= step ? "bg-indigo-600" : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {step === 1 && "Choose a file to upload"}
                {step === 2 && "Give this document a name"}
                {step === 3 && "Choose a category"}
                {step === 4 && "Choose who can access it"}
                {step === 5 && "Set authority and sensitivity"}
                {step === 6 && "Review and confirm"}
              </p>
            </div>

            {/* Wizard body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

              {uploadError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
                  <span className="mt-0.5">⚠</span>
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Step 1 — File */}
              {step === 1 && (
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-2 block">
                    Select a file <span className="text-red-400">*</span>
                  </label>
                  <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors">
                    {upload.file ? (
                      <div className="text-center px-4">
                        <p className="text-2xl">{mimeIcon(upload.file.type)}</p>
                        <p className="text-sm font-medium text-slate-700 truncate max-w-xs mt-1">{upload.file.name}</p>
                        <p className="text-xs text-slate-400">{friendlySize(upload.file.size)}</p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-3xl mb-2">📁</p>
                        <p className="text-sm text-slate-500">Click to choose a file</p>
                        <p className="text-xs text-slate-400 mt-0.5">PDF, DOCX, TXT, MD — max 20 MB</p>
                      </div>
                    )}
                    <input type="file" accept={ACCEPTED_UPLOAD_TYPES} className="hidden" onChange={onFileChange} />
                  </label>
                  <p className="text-xs text-slate-400 mt-2">
                    Task uploads — where a document is for one task only — are kept separate.
                    This wizard saves to your Organisation Library.
                  </p>
                </div>
              )}

              {/* Step 2 — Title / Description */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      Document name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={upload.title}
                      onChange={e => setUpload(p => ({ ...p, title: e.target.value }))}
                      placeholder="e.g. NDIS Restrictive Practices Policy"
                      className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">
                      Description <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                      value={upload.description}
                      onChange={e => setUpload(p => ({ ...p, description: e.target.value }))}
                      placeholder="Brief summary of what this document covers…"
                      rows={3}
                      className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-slate-700">Version <span className="text-slate-400 font-normal">(optional)</span></label>
                      <input
                        type="text"
                        value={upload.versionLabel}
                        onChange={e => setUpload(p => ({ ...p, versionLabel: e.target.value }))}
                        placeholder="e.g. 2.1"
                        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-slate-700">Effective date <span className="text-slate-400 font-normal">(optional)</span></label>
                      <input
                        type="date"
                        value={upload.effectiveFrom}
                        onChange={e => setUpload(p => ({ ...p, effectiveFrom: e.target.value }))}
                        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3 — Category */}
              {step === 3 && (
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-2 block">
                    Document category <span className="text-red-400">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {DOCUMENT_CATEGORIES.map(cat => (
                      <button
                        key={cat.value}
                        onClick={() => setUpload(p => ({ ...p, category: cat.value }))}
                        className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                          upload.category === cat.value
                            ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium"
                            : "border-slate-200 text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/30"
                        }`}>
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 4 — Scope */}
              {step === 4 && (
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block">
                    Who should be able to use this document? <span className="text-red-400">*</span>
                  </label>
                  <p className="text-xs text-slate-400 mb-3">
                    You can assign to specific specialists later from the document detail page.
                  </p>
                  <div className="space-y-2">
                    {SCOPE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setUpload(p => ({ ...p, scope: opt.value }))}
                        className={`w-full px-4 py-3 rounded-xl border text-sm text-left transition-colors ${
                          upload.scope === opt.value
                            ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                            : "border-slate-200 text-slate-700 hover:border-indigo-200 hover:bg-indigo-50/30"
                        }`}>
                        <p className="font-medium">{opt.label}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 5 — Authority & Sensitivity */}
              {step === 5 && (
                <div className="space-y-5">
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Authority level</label>
                    <div className="space-y-2">
                      {AUTHORITY_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setUpload(p => ({ ...p, authorityLevel: opt.value }))}
                          className={`w-full px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                            upload.authorityLevel === opt.value
                              ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                              : "border-slate-200 text-slate-600 hover:border-indigo-200"
                          }`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Sensitivity</label>
                    <div className="space-y-2">
                      {SENSITIVITY_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setUpload(p => ({ ...p, sensitivityClassification: opt.value }))}
                          className={`w-full px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                            upload.sensitivityClassification === opt.value
                              ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                              : "border-slate-200 text-slate-600 hover:border-indigo-200"
                          }`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 6 — Confirm */}
              {step === 6 && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">Review before uploading:</p>
                  <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">File</span>
                      <span className="text-slate-900 font-medium truncate max-w-[200px]">{upload.file?.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Name</span>
                      <span className="text-slate-900 font-medium truncate max-w-[200px]">{upload.title}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Category</span>
                      <span className="text-slate-900 font-medium">{CATEGORY_LABELS[upload.category] ?? upload.category}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Scope</span>
                      <span className="text-slate-900 font-medium">
                        {SCOPE_OPTIONS.find(o => o.value === upload.scope)?.label?.split(" — ")[0] ?? upload.scope}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Authority</span>
                      <span className="text-slate-900 font-medium">
                        {AUTHORITY_OPTIONS.find(o => o.value === upload.authorityLevel)?.label?.split(" — ")[0] ?? upload.authorityLevel}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Sensitivity</span>
                      <span className="text-slate-900 font-medium">
                        {SENSITIVITY_OPTIONS.find(o => o.value === upload.sensitivityClassification)?.label?.split(" — ")[0] ?? upload.sensitivityClassification}
                      </span>
                    </div>
                    {upload.versionLabel && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Version</span>
                        <span className="text-slate-900 font-medium">{upload.versionLabel}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    After uploading, NeedsOps will read and organise the document.
                    You'll be asked to review and approve it before specialists can use it.
                  </p>
                </div>
              )}
            </div>

            {/* Wizard footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center gap-3">
              <button
                onClick={step === 1 ? closeUpload : prevStep}
                disabled={uploading}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 disabled:opacity-50">
                {step === 1 ? "Cancel" : "Back"}
              </button>

              {step < 6 ? (
                <button
                  onClick={nextStep}
                  disabled={!canProceed[step]}
                  className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  Continue
                </button>
              ) : (
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {uploading ? "Uploading…" : "Upload document"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
