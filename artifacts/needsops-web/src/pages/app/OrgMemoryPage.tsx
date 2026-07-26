/**
 * Organisation Memory — /app/:slug/memory
 * Sprint 9.2: Browse, propose, approve, and reject organisation-wide AI memory.
 */

import { useState } from "react";
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
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
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
  terminology: "Terminology",
  approval_rule: "Approval Rule",
  reporting_line: "Reporting Line",
  system_information: "System Info",
  workflow: "Workflow",
  policy_reference: "Policy",
  customer_preference: "Participant Pref",
  risk_constraint: "Risk",
  compliance_context: "Compliance",
  other: "Other",
};

const ALL_TYPES: MemoryType[] = [
  "organisation_profile","operating_preference","terminology","approval_rule",
  "reporting_line","system_information","workflow","policy_reference",
  "customer_preference","risk_constraint","compliance_context","other",
];

export default function OrgMemoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const authFetch = useAuthFetch();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<MemoryStatus | "all">("proposed");
  const [typeFilter, setTypeFilter] = useState<MemoryType | "">("");
  const [showPropose, setShowPropose] = useState(false);
  const [form, setForm] = useState({
    title: "", content: "", memoryType: "other" as MemoryType,
    importance: 5, confidence: 0.8,
  });

  const statusParam = activeTab === "all" ? undefined : activeTab;

  const { data, isLoading, error } = useQuery({
    queryKey: ["org-memory", slug, activeTab, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusParam) params.set("status", statusParam);
      if (typeFilter) params.set("memoryType", typeFilter);
      params.set("limit", "100");
      const res = await authFetch(`/api/v1/organisations/${slug}/memory?${params}`);
      if (!res.ok) throw new Error("Failed to load memory");
      return res.json() as Promise<{ items: OrgMemoryItem[]; total: number }>;
    },
    staleTime: 30_000,
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/v1/organisations/${slug}/memory/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error("Approve failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-memory", slug] }),
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/v1/organisations/${slug}/memory/${id}/reject`, { method: "POST" });
      if (!res.ok) throw new Error("Reject failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-memory", slug] }),
  });

  const propose = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/v1/organisations/${slug}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, sourceType: "manual" }),
      });
      if (!res.ok) throw new Error("Propose failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-memory", slug] });
      setShowPropose(false);
      setForm({ title: "", content: "", memoryType: "other", importance: 5, confidence: 0.8 });
    },
  });

  const tabs: Array<{ key: MemoryStatus | "all"; label: string }> = [
    { key: "proposed",   label: "Proposed" },
    { key: "approved",   label: "Approved" },
    { key: "rejected",   label: "Rejected" },
    { key: "superseded", label: "Superseded" },
    { key: "all",        label: "All" },
  ];

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
            onClick={() => setShowPropose(true)}
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

        {/* Content */}
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

      {/* Propose modal */}
      {showPropose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Organisation Memory</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Type</label>
                <select
                  value={form.memoryType}
                  onChange={e => setForm(f => ({ ...f, memoryType: e.target.value as MemoryType }))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                >
                  {ALL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. After-hours escalation threshold"
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Content</label>
                <textarea
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="Describe this memory precisely as you want the Chief of Staff to use it."
                  rows={4}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700">Importance (1–10)</label>
                  <input
                    type="number" min={1} max={10}
                    value={form.importance}
                    onChange={e => setForm(f => ({ ...f, importance: parseInt(e.target.value, 10) }))}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Confidence (0–1)</label>
                  <input
                    type="number" min={0} max={1} step={0.1}
                    value={form.confidence}
                    onChange={e => setForm(f => ({ ...f, confidence: parseFloat(e.target.value) }))}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowPropose(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => propose.mutate()}
                disabled={propose.isPending || !form.title.trim() || !form.content.trim()}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {propose.isPending ? "Saving…" : "Submit for Review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
