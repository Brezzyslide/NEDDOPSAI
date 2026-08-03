/**
 * Organisation Memory — /app/:slug/memory
 * Sprint 9.2: Browse, propose, approve, and reject organisation-wide AI memory.
 * Fixed: Submit error display, Attach Policy from Organisation Library section.
 */

import { useState, useMemo } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

type MemoryStatus = "proposed" | "approved" | "rejected" | "superseded" | "expired";
type MemoryType =
  | "organisation_profile" | "operating_preference" | "terminology"
  | "approval_rule" | "reporting_line" | "system_information" | "workflow"
  | "policy_reference" | "customer_preference" | "risk_constraint"
  | "compliance_context" | "other";

interface OrgMemoryItem {
  id: string;
  memoryType: MemoryType;
  title: string;
  content: string;
  status: MemoryStatus;
  confidence: number;
  importance: number;
  sourceType: string;
  sourceId?: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

interface KnowledgeSource {
  id: string;
  name: string;
  description?: string;
  sourceType: string;
  status: string;
  mimeType?: string;
}

const STATUS_COLOURS: Record<MemoryStatus, string> = {
  proposed:   "bg-amber-50 text-amber-700 border-amber-200",
  approved:   "bg-green-50 text-green-700 border-green-200",
  rejected:   "bg-red-50 text-red-700 border-red-200",
  superseded: "bg-slate-50 text-slate-500 border-slate-200",
  expired:    "bg-slate-50 text-slate-400 border-slate-200",
};

const TYPE_LABELS: Record<MemoryType, string> = {
  organisation_profile: "Profile",
  operating_preference: "Preference",
  terminology:          "Terminology",
  approval_rule:        "Approval Rule",
  reporting_line:       "Reporting Line",
  system_information:   "System Info",
  workflow:             "Workflow",
  policy_reference:     "Policy",
  customer_preference:  "Participant Pref",
  risk_constraint:      "Risk",
  compliance_context:   "Compliance",
  other:                "Other",
};

const ALL_TYPES: MemoryType[] = [
  "organisation_profile","operating_preference","terminology","approval_rule",
  "reporting_line","system_information","workflow","policy_reference",
  "customer_preference","risk_constraint","compliance_context","other",
];

const SOURCE_TYPE_ICONS: Record<string, string> = {
  pdf:      "📄",
  docx:     "📝",
  txt:      "📃",
  markdown: "📋",
  default:  "📎",
};

function sourceIcon(mimeType?: string): string {
  if (!mimeType) return SOURCE_TYPE_ICONS.default;
  if (mimeType.includes("pdf"))      return SOURCE_TYPE_ICONS.pdf;
  if (mimeType.includes("word") || mimeType.includes("docx")) return SOURCE_TYPE_ICONS.docx;
  if (mimeType.includes("markdown")) return SOURCE_TYPE_ICONS.markdown;
  if (mimeType.includes("text"))     return SOURCE_TYPE_ICONS.txt;
  return SOURCE_TYPE_ICONS.default;
}

// ─── Empty form state ─────────────────────────────────────────────────────────

function emptyForm() {
  return {
    title: "",
    content: "",
    memoryType: "policy_reference" as MemoryType,
    importance: 8,
    confidence: 0.9,
    attachedSourceId: "" as string,
    attachedSourceName: "" as string,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrgMemoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const authFetch = useAuthFetch();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab]     = useState<MemoryStatus | "all">("proposed");
  const [typeFilter, setTypeFilter]   = useState<MemoryType | "">("");
  const [showPropose, setShowPropose] = useState(false);
  const [form, setForm]               = useState(emptyForm());
  const [sourceSearch, setSourceSearch] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Memory list ─────────────────────────────────────────────────────────────

  const statusParam = activeTab === "all" ? undefined : activeTab;

  const { data, isLoading, error } = useQuery({
    queryKey: ["org-memory", slug, activeTab, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusParam) params.set("status", statusParam);
      if (typeFilter)  params.set("memoryType", typeFilter);
      params.set("limit", "100");
      const res = await authFetch(`/v1/organisations/${slug}/memory?${params}`);
      if (!res.ok) throw new Error("Failed to load memory");
      return res.json() as Promise<{ items: OrgMemoryItem[]; total: number }>;
    },
    staleTime: 30_000,
  });

  // ── Organisation Library sources (for policy attachment) ────────────────────

  const { data: sourcesData } = useQuery({
    queryKey: ["knowledge-sources", slug, "approved"],
    queryFn: async () => {
      const params = new URLSearchParams({ status: "approved", limit: "200" });
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/sources?${params}`);
      if (!res.ok) return { sources: [] };
      return res.json() as Promise<{ sources: KnowledgeSource[] }>;
    },
    staleTime: 60_000,
    enabled: showPropose, // only load when modal is open
  });

  const approvedSources: KnowledgeSource[] = sourcesData?.sources ?? [];

  const filteredSources = useMemo(() => {
    const q = sourceSearch.toLowerCase().trim();
    if (!q) return approvedSources;
    return approvedSources.filter(
      s => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q),
    );
  }, [approvedSources, sourceSearch]);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(
        `/v1/organisations/${slug}/memory/${id}/approve`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Approve failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-memory", slug] }),
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(
        `/v1/organisations/${slug}/memory/${id}/reject`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Reject failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-memory", slug] }),
  });

  const propose = useMutation({
    mutationFn: async () => {
      setSubmitError(null);
      const payload: Record<string, unknown> = {
        title:      form.title.trim(),
        content:    form.content.trim(),
        memoryType: form.memoryType,
        importance: form.importance,
        confidence: form.confidence,
        sourceType: form.attachedSourceId ? "knowledge_source" : "manual",
      };
      if (form.attachedSourceId) {
        payload.sourceId = form.attachedSourceId;
      }

      const res = await authFetch(`/v1/organisations/${slug}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errMsg = "Submission failed. Please try again.";
        try {
          const errBody = await res.json();
          errMsg = errBody?.error?.message ?? errBody?.error ?? errMsg;
        } catch {}
        throw new Error(errMsg);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-memory", slug] });
      setShowPropose(false);
      setForm(emptyForm());
      setSourceSearch("");
      setSubmitError(null);
    },
    onError: (err: Error) => {
      setSubmitError(err.message);
    },
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function openModal() {
    setForm(emptyForm());
    setSourceSearch("");
    setSubmitError(null);
    setShowPropose(true);
  }

  function closeModal() {
    setShowPropose(false);
    setSubmitError(null);
  }

  function attachSource(source: KnowledgeSource) {
    setForm(f => ({
      ...f,
      attachedSourceId:   source.id,
      attachedSourceName: source.name,
      // Pre-fill title if empty
      title: f.title.trim() ? f.title : source.name,
      // Pre-fill a reference in content if empty
      content: f.content.trim()
        ? f.content
        : `Refer to the organisation library policy: "${source.name}". ${source.description ?? ""}`.trim(),
    }));
  }

  function clearAttachment() {
    setForm(f => ({ ...f, attachedSourceId: "", attachedSourceName: "" }));
  }

  const canSubmit =
    form.title.trim().length > 0 &&
    form.content.trim().length > 0 &&
    !propose.isPending;

  // ── Tabs ─────────────────────────────────────────────────────────────────────

  const tabs: Array<{ key: MemoryStatus | "all"; label: string }> = [
    { key: "proposed",   label: "Proposed" },
    { key: "approved",   label: "Approved" },
    { key: "rejected",   label: "Rejected" },
    { key: "superseded", label: "Superseded" },
    { key: "all",        label: "All" },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Organisation Memory</h1>
            <p className="text-sm text-slate-500 mt-1">
              Chief of Staff uses approved entries as authoritative context in every conversation.
            </p>
          </div>
          <button
            onClick={openModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            Add Memory
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200 mb-4">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t.key
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 pb-1">
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as any)}
              className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600"
            >
              <option value="">All types</option>
              {ALL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>
        </div>

        {/* Memory list */}
        {isLoading && (
          <div className="flex justify-center py-16 text-slate-400 text-sm">Loading…</div>
        )}
        {error && (
          <div className="text-red-600 text-sm py-4">Failed to load organisation memory.</div>
        )}
        {!isLoading && !error && data?.items.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-sm">
            {activeTab === "proposed"
              ? "No pending memory items — the Chief of Staff will propose entries as conversations progress."
              : "No records match this filter."}
          </div>
        )}

        <div className="space-y-3">
          {data?.items.map(item => (
            <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_COLOURS[item.status]}`}>
                      {item.status}
                    </span>
                    <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                      {TYPE_LABELS[item.memoryType]}
                    </span>
                    <span className="text-xs text-slate-400">
                      Importance {item.importance}/10 · Confidence {Math.round(item.confidence * 100)}%
                    </span>
                    {item.sourceType === "knowledge_source" && (
                      <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                        📎 Library policy
                      </span>
                    )}
                  </div>
                  <h3 className="font-medium text-slate-900 text-sm">{item.title}</h3>
                  <p className="text-xs text-slate-600 mt-1 line-clamp-3">{item.content}</p>
                  {item.approvedBy && (
                    <p className="text-xs text-slate-400 mt-1">
                      Approved · {item.sourceType} source
                    </p>
                  )}
                </div>
                {item.status === "proposed" && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => approve.mutate(item.id)}
                      disabled={approve.isPending}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => reject.mutate(item.id)}
                      disabled={reject.isPending}
                      className="px-3 py-1.5 border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Add Memory modal ─────────────────────────────────────────────────── */}
      {showPropose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col">

            {/* Modal header */}
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">Add Organisation Memory</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Approved entries are used by the Chief of Staff in every conversation.
              </p>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

              {/* Error banner */}
              {submitError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
                  <span className="mt-0.5 text-red-500">⚠</span>
                  <span>{submitError}</span>
                </div>
              )}

              {/* Type */}
              <div>
                <label className="text-xs font-medium text-slate-700">Type</label>
                <select
                  value={form.memoryType}
                  onChange={e => setForm(f => ({ ...f, memoryType: e.target.value as MemoryType }))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  {ALL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>

              {/* ── Attach Policy from Organisation Library ─────────────────── */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Attach Policy from Organisation Library</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Link an approved policy so the Chief of Staff can read it directly.
                    </p>
                  </div>
                  {form.attachedSourceId && (
                    <button
                      onClick={clearAttachment}
                      className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                      title="Remove attachment"
                    >
                      ✕ Remove
                    </button>
                  )}
                </div>

                {/* Attached source pill */}
                {form.attachedSourceId ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <span className="text-sm">📎</span>
                    <span className="text-xs font-medium text-indigo-700 truncate flex-1">
                      {form.attachedSourceName}
                    </span>
                    <span className="text-xs text-indigo-400 flex-shrink-0">Attached</span>
                  </div>
                ) : (
                  <>
                    {/* Search box */}
                    <input
                      type="text"
                      placeholder="Search approved policies…"
                      value={sourceSearch}
                      onChange={e => setSourceSearch(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white mb-2"
                    />

                    {/* Source list */}
                    {approvedSources.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-3">
                        No approved policies in the Organisation Library yet.
                      </p>
                    ) : filteredSources.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-3">No policies match "{sourceSearch}"</p>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                        {filteredSources.map(source => (
                          <button
                            key={source.id}
                            onClick={() => attachSource(source)}
                            className="w-full text-left px-3 py-2 rounded-lg border border-transparent hover:bg-white hover:border-slate-200 hover:shadow-sm transition-all group"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm flex-shrink-0">
                                {sourceIcon(source.mimeType)}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-slate-800 truncate group-hover:text-indigo-700">
                                  {source.name}
                                </p>
                                {source.description && (
                                  <p className="text-xs text-slate-400 truncate">{source.description}</p>
                                )}
                              </div>
                              <span className="text-xs text-slate-300 group-hover:text-indigo-400 flex-shrink-0">
                                Attach →
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Title */}
              <div>
                <label className="text-xs font-medium text-slate-700">
                  Title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. NDIS Restrictive Practices Policy"
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              {/* Content */}
              <div>
                <label className="text-xs font-medium text-slate-700">
                  Content <span className="text-red-400">*</span>
                </label>
                <p className="text-xs text-slate-400 mt-0.5 mb-1">
                  Describe how the Chief of Staff should interpret and apply this memory.
                </p>
                <textarea
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="This policy governs the use of regulated restrictive practices. Staff must document and apply least-restrictive alternatives in accordance with NDIS legislation…"
                  rows={4}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              {/* Importance + Confidence */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700">Importance (1–10)</label>
                  <input
                    type="number" min={1} max={10}
                    value={form.importance}
                    onChange={e => setForm(f => ({ ...f, importance: parseInt(e.target.value, 10) || 5 }))}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Confidence (0–1)</label>
                  <input
                    type="number" min={0} max={1} step={0.1}
                    value={form.confidence}
                    onChange={e => setForm(f => ({ ...f, confidence: parseFloat(e.target.value) || 0.8 }))}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                {!form.title.trim() || !form.content.trim()
                  ? "Title and content are required."
                  : form.attachedSourceId
                  ? `Will link to library policy: ${form.attachedSourceName}`
                  : "No policy attached — manual entry."}
              </p>
              <div className="flex gap-3 flex-shrink-0">
                <button
                  onClick={closeModal}
                  disabled={propose.isPending}
                  className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => propose.mutate()}
                  disabled={!canSubmit}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {propose.isPending ? "Saving…" : "Submit for Review"}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </AppShell>
  );
}
