/**
 * Organisation Library — /app/:slug/library
 * Browse, upload, and manage knowledge sources for the Organisation Library.
 * The Chief of Staff draws on approved sources during conversations.
 */

import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type SourceStatus =
  | "uploaded" | "processing" | "review_required"
  | "approved" | "revoked" | "archived";

interface KnowledgeSource {
  id: string;
  name: string;
  description?: string;
  sourceType: string;
  mimeType?: string;
  status: SourceStatus;
  fileSizeBytes?: number;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
}

interface UploadUrlResponse {
  uploadUrl: string;
  sourceId: string;
  versionId: string;
  storageKey: string;
  expiresAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<SourceStatus, { badge: string; label: string }> = {
  uploaded:        { badge: "bg-slate-100 text-slate-500 border-slate-200",    label: "Uploaded" },
  processing:      { badge: "bg-blue-50 text-blue-600 border-blue-200",        label: "Processing" },
  review_required: { badge: "bg-amber-50 text-amber-700 border-amber-200",     label: "Needs Review" },
  approved:        { badge: "bg-green-50 text-green-700 border-green-200",     label: "Approved" },
  revoked:         { badge: "bg-red-50 text-red-600 border-red-200",           label: "Revoked" },
  archived:        { badge: "bg-slate-50 text-slate-400 border-slate-200",     label: "Archived" },
};

const ACCEPTED_TYPES = ".pdf,.docx,.doc,.txt,.md";

function mimeIcon(mimeType?: string): string {
  if (!mimeType) return "📎";
  if (mimeType.includes("pdf")) return "📄";
  if (mimeType.includes("word") || mimeType.includes("docx")) return "📝";
  if (mimeType.includes("markdown")) return "📋";
  if (mimeType.includes("text")) return "📃";
  return "📎";
}

function friendlySize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_FILTERS: Array<{ key: SourceStatus | "all"; label: string }> = [
  { key: "all",             label: "All" },
  { key: "approved",        label: "Approved" },
  { key: "review_required", label: "Needs Review" },
  { key: "processing",      label: "Processing" },
  { key: "uploaded",        label: "Uploaded" },
  { key: "revoked",         label: "Revoked" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrgLibraryPage() {
  const { slug } = useParams<{ slug: string }>();
  const authFetch = useAuthFetch();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<SourceStatus | "all">("all");
  const [uploading, setUploading]       = useState(false);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const [showUpload, setShowUpload]     = useState(false);
  const [uploadForm, setUploadForm]     = useState({ name: "", description: "" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // ── List sources ─────────────────────────────────────────────────────────────

  const { data, isLoading, error } = useQuery({
    queryKey: ["library-sources", slug, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/sources?${params}`);
      if (!res.ok) throw new Error("Failed to load library");
      return res.json() as Promise<{ sources: KnowledgeSource[]; total: number }>;
    },
    staleTime: 30_000,
  });

  // ── Approve source ───────────────────────────────────────────────────────────

  const approveSource = useMutation({
    mutationFn: async (sourceId: string) => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}/approve`,
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
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Revoke failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library-sources", slug] }),
  });

  // ── Upload flow ───────────────────────────────────────────────────────────────
  // 1. POST /knowledge/sources/request-upload  → signed upload URL
  // 2. PUT signed URL with raw file bytes
  // 3. POST /knowledge/sources/:id/complete-upload

  async function handleUpload() {
    if (!selectedFile || !uploadForm.name.trim()) return;
    setUploading(true);
    setUploadError(null);

    try {
      // Step 1 — request upload URL
      const reqRes = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/request-upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name:        uploadForm.name.trim(),
            description: uploadForm.description.trim() || undefined,
            mimeType:    selectedFile.type || "application/octet-stream",
            fileSizeBytes: selectedFile.size,
          }),
        },
      );
      if (!reqRes.ok) {
        const errBody = await reqRes.json().catch(() => ({}));
        throw new Error(errBody?.error?.message ?? errBody?.error ?? "Upload request failed");
      }
      const { uploadUrl, sourceId }: UploadUrlResponse = await reqRes.json();

      // Step 2 — upload file directly to signed URL
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": selectedFile.type || "application/octet-stream" },
        body: selectedFile,
      });
      if (!putRes.ok) throw new Error("File upload to storage failed");

      // Step 3 — confirm upload
      const completeRes = await authFetch(
        `/v1/organisations/${slug}/knowledge/sources/${sourceId}/complete-upload`,
        { method: "POST" },
      );
      if (!completeRes.ok) throw new Error("Failed to confirm upload");

      queryClient.invalidateQueries({ queryKey: ["library-sources", slug] });
      setShowUpload(false);
      setUploadForm({ name: "", description: "" });
      setSelectedFile(null);
    } catch (err: any) {
      setUploadError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function openUpload() {
    setUploadForm({ name: "", description: "" });
    setSelectedFile(null);
    setUploadError(null);
    setShowUpload(true);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setSelectedFile(f);
    if (f && !uploadForm.name.trim()) {
      // Auto-fill name from filename (strip extension)
      setUploadForm(prev => ({
        ...prev,
        name: f.name.replace(/\.[^.]+$/, ""),
      }));
    }
  }

  const canUpload =
    !!selectedFile && uploadForm.name.trim().length > 0 && !uploading;

  const sources = data?.sources ?? [];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <AppShell orgSlug={slug!}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Organisation Library</h1>
            <p className="text-sm text-slate-500 mt-1">
              Upload policies, procedures, and reference documents. Approved sources are
              read by the Chief of Staff during conversations.
            </p>
          </div>
          <button
            onClick={openUpload}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex-shrink-0"
          >
            <span className="text-lg leading-none">+</span>
            Upload Document
          </button>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                statusFilter === f.key
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
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
            <div className="text-4xl mb-3">📚</div>
            <p className="text-slate-600 font-medium mb-1">No documents yet</p>
            <p className="text-sm text-slate-400">
              {statusFilter === "all"
                ? "Upload your first policy or procedure to get started."
                : `No documents with "${STATUS_STYLES[statusFilter as SourceStatus]?.label ?? statusFilter}" status.`}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {sources.map(source => (
            <div
              key={source.id}
              className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-start gap-4"
            >
              {/* File icon */}
              <div className="text-2xl flex-shrink-0 mt-0.5">
                {mimeIcon(source.mimeType)}
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLES[source.status].badge}`}>
                    {STATUS_STYLES[source.status].label}
                  </span>
                  {source.mimeType && (
                    <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                      {source.mimeType.split("/").pop()?.toUpperCase()}
                    </span>
                  )}
                  {source.fileSizeBytes && (
                    <span className="text-xs text-slate-400">{friendlySize(source.fileSizeBytes)}</span>
                  )}
                </div>
                <h3 className="font-medium text-slate-900 text-sm truncate">{source.name}</h3>
                {source.description && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{source.description}</p>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  Added {new Date(source.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                  {source.approvedAt && ` · Approved ${new Date(source.approvedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 flex-shrink-0">
                {source.status === "review_required" && (
                  <button
                    onClick={() => approveSource.mutate(source.id)}
                    disabled={approveSource.isPending}
                    className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    Approve
                  </button>
                )}
                {source.status === "approved" && (
                  <button
                    onClick={() => revokeSource.mutate(source.id)}
                    disabled={revokeSource.isPending}
                    className="px-3 py-1.5 border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Upload modal ──────────────────────────────────────────────────────── */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">

            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">Upload Document</h2>
              <p className="text-xs text-slate-500 mt-0.5">PDF, Word, or plain text. Max 20 MB.</p>
            </div>

            <div className="px-6 py-5 space-y-4">

              {uploadError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
                  <span className="mt-0.5">⚠</span>
                  <span>{uploadError}</span>
                </div>
              )}

              {/* File picker */}
              <div>
                <label className="text-xs font-medium text-slate-700">
                  File <span className="text-red-400">*</span>
                </label>
                <label className="mt-1 flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors">
                  {selectedFile ? (
                    <div className="text-center px-4">
                      <p className="text-lg">{mimeIcon(selectedFile.type)}</p>
                      <p className="text-sm font-medium text-slate-700 truncate max-w-xs">{selectedFile.name}</p>
                      <p className="text-xs text-slate-400">{friendlySize(selectedFile.size)}</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-2xl mb-1">📁</p>
                      <p className="text-sm text-slate-500">Click to choose a file</p>
                      <p className="text-xs text-slate-400 mt-0.5">PDF, DOCX, TXT, MD</p>
                    </div>
                  )}
                  <input
                    type="file"
                    accept={ACCEPTED_TYPES}
                    className="hidden"
                    onChange={onFileChange}
                  />
                </label>
              </div>

              {/* Name */}
              <div>
                <label className="text-xs font-medium text-slate-700">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={uploadForm.name}
                  onChange={e => setUploadForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. NDIS Restrictive Practices Policy"
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-medium text-slate-700">Description <span className="text-slate-400 font-normal">(optional)</span></label>
                <textarea
                  value={uploadForm.description}
                  onChange={e => setUploadForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief summary of what this document covers…"
                  rows={2}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setShowUpload(false)}
                disabled={uploading}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={!canUpload}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
