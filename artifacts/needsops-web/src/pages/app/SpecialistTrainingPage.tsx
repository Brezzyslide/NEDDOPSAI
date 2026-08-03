/**
 * Specialist Training Page — /app/:slug/workforce/:specialistId/training
 *
 * 6-tab training experience: Overview, Responsibilities, Language & Style,
 * Knowledge, Test Specialist, Readiness.
 *
 * Customer-facing — never show RAG, embeddings, vectors, or internal labels.
 */

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TrainingStatus {
  id: string;
  specialistId: string;
  status: string;
  configurationComplete: boolean;
  knowledgeSourcesApproved: boolean;
  retrievalTestPassed: boolean;
  sampleTaskPassed: boolean;
  approvedByUserId?: string;
  approvedAt?: string;
  lastTestedAt?: string;
  notes?: string;
  updatedAt: string;
}

interface LanguageProfile {
  id: string;
  locale: string;
  spellingConvention?: string;
  tone?: string;
  formality?: string;
  preferredTerms:  Array<{ term: string; preferred: string; notes?: string }>;
  prohibitedTerms: Array<{ term: string; reason?: string }>;
  dateFormat?: string;
  timeFormat?: string;
  headingPreferences?: string;
  sentenceLengthPreference?: string;
  outputStructure?: string;
  lastConfirmedAt?: string;
}

interface ResponsibilitiesConfig {
  responsibilities:        string[];
  prohibitedActions:       string[];
  approvalRequiredActions: string[];
  escalationConditions:    string[];
  escalationContacts:      Array<{ name: string; role: string }>;
  allowedSystems:          string[];
  firstWeekGoals:          string[];
}

interface SpecialistConfig {
  responsibilities: ResponsibilitiesConfig;
  goals: string[];
  preferredStyle?: string;
  escalationContacts: Array<{ name: string; role: string }>;
  lastConfirmedAt?: string;
}

interface KnowledgeSource {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  authorityLevel: string;
  scopes: Array<{ scopeType: string; scopeId: string }>;
}

interface TestCitation {
  sourceId: string;
  title: string;
  excerpt: string;
  section?: string;
  pageNumber?: number;
  versionLabel?: string;
  authority: string;
  matchLabel: string;
  isApproved: boolean;
  isCurrent: boolean;
  warnings: string[];
}

interface TestResult {
  query: string;
  retrievalMethod: string;
  citations: TestCitation[];
  conflicts: Array<{ type: string; warning: string }>;
  sourcesUsed: number;
  warnings: string[];
  testedAt: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "responsibilities" | "language" | "knowledge" | "test" | "readiness";

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "overview",         label: "Overview",          icon: "⬡" },
  { id: "responsibilities", label: "Responsibilities",  icon: "📋" },
  { id: "language",         label: "Language & Style",  icon: "✍️" },
  { id: "knowledge",        label: "Knowledge",         icon: "📚" },
  { id: "test",             label: "Test Specialist",   icon: "🧪" },
  { id: "readiness",        label: "Readiness",         icon: "✅" },
];

const TRAINING_STATUS_CONFIG: Record<string, { label: string; badge: string; desc: string }> = {
  not_started:          { label: "Not started",          badge: "bg-slate-100 text-slate-500 border-slate-200",  desc: "Training hasn't begun yet." },
  configuring:          { label: "Configuring",          badge: "bg-blue-50 text-blue-600 border-blue-200",      desc: "Setting up responsibilities and style." },
  knowledge_processing: { label: "Processing knowledge", badge: "bg-blue-50 text-blue-600 border-blue-200",      desc: "Documents are being read and organised." },
  review_required:      { label: "Review required",      badge: "bg-amber-50 text-amber-700 border-amber-200",   desc: "Documents are ready to review and approve." },
  testing:              { label: "Testing",              badge: "bg-indigo-50 text-indigo-600 border-indigo-200", desc: "Running retrieval tests." },
  ready:                { label: "Ready",                badge: "bg-green-50 text-green-700 border-green-200",   desc: "This specialist is ready to work using your approved knowledge." },
  needs_attention:      { label: "Needs attention",      badge: "bg-red-50 text-red-600 border-red-200",         desc: "Something needs to be reviewed." },
  suspended:            { label: "Suspended",            badge: "bg-slate-100 text-slate-500 border-slate-200",  desc: "This specialist has been suspended." },
};

const SPECIALIST_LABELS: Record<string, string> = {
  chief_of_staff:            "Chief of Staff",
  operations_manager:        "Operations Manager",
  compliance_quality_manager: "Compliance & Quality Manager",
  incident_manager:          "Incident Manager",
  hr_coordinator:            "HR Coordinator",
  finance_analyst:           "Finance Analyst",
};

const EXAMPLE_PROMPTS: Record<string, string[]> = {
  incident_manager: [
    "How should a moderate-severity incident be escalated?",
    "Draft an incident summary using our approved style.",
    "Which approval is required before external reporting?",
    "What changed between policy versions?",
  ],
  chief_of_staff: [
    "What are our compliance obligations for NDIS providers?",
    "Summarise our escalation procedures.",
    "What is our approved style for external communications?",
  ],
};

const DEFAULT_PROMPTS = [
  "What are the key responsibilities defined in our policies?",
  "What approval is required for this type of action?",
  "What does our organisation's procedure say about this?",
];

const SOURCE_SCOPE_LABELS: Record<string, string> = {
  organisation: "Org-wide",
  workforce:    "AI workforce",
  specialist:   "This specialist",
  department:   "Department",
  task_type:    "Task type",
};

const AUTHORITY_LABELS: Record<string, string> = {
  mandatory: "Required", authoritative: "Authoritative",
  supporting: "Supporting", example_only: "Example", reference_only: "Reference",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  policy: "Policy", procedure: "Procedure", playbook: "Playbook",
  style_guide: "Style Guide", approved_example: "Example",
  template: "Template", legislation_reference: "Legislation",
  manual_note: "Note", care_plan: "Care Plan",
  behaviour_support_plan: "BSP", operational_manual: "Manual",
  compliance_document: "Compliance", hr_manual: "HR", contract: "Contract",
};

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SpecialistTrainingPage() {
  const { slug, specialistId } = useParams<{ slug: string; specialistId: string }>();
  const [, setLocation] = useLocation();
  const authFetch   = useAuthFetch();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [testQuery, setTestQuery] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  // Editing state
  const [editingLang, setEditingLang] = useState(false);
  const [langDraft,   setLangDraft]   = useState<Partial<LanguageProfile>>({});
  const [editingResp, setEditingResp] = useState(false);
  const [respDraft,   setRespDraft]   = useState<Partial<ResponsibilitiesConfig>>({});

  // New term inputs
  const [newPrefTerm,    setNewPrefTerm]    = useState({ term: "", preferred: "" });
  const [newProhibTerm,  setNewProhibTerm]  = useState({ term: "", reason: "" });
  const [newEscContact,  setNewEscContact]  = useState({ name: "", role: "" });

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: trainingData } = useQuery({
    queryKey: ["training-status", slug, specialistId],
    queryFn: async () => {
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/training/${specialistId}`);
      if (!res.ok) throw new Error("Failed to load training status");
      return res.json() as Promise<{ trainingStatus: TrainingStatus }>;
    },
  });

  const { data: langData } = useQuery({
    queryKey: ["training-lang", slug, specialistId],
    queryFn: async () => {
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/training/${specialistId}/language-profile`);
      if (!res.ok) return { languageProfile: null };
      return res.json() as Promise<{ languageProfile: LanguageProfile }>;
    },
    enabled: activeTab === "language" || activeTab === "overview",
  });

  const { data: configData } = useQuery({
    queryKey: ["training-config", slug, specialistId],
    queryFn: async () => {
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/training/${specialistId}/config`);
      if (!res.ok) return { config: null };
      return res.json() as Promise<{ config: SpecialistConfig }>;
    },
    enabled: activeTab === "responsibilities" || activeTab === "overview",
  });

  const { data: knowledgeData } = useQuery({
    queryKey: ["training-knowledge", slug, specialistId],
    queryFn: async () => {
      const res = await authFetch(`/v1/organisations/${slug}/knowledge/training/${specialistId}/knowledge`);
      if (!res.ok) return { sources: [], total: 0 };
      return res.json() as Promise<{ sources: KnowledgeSource[]; total: number }>;
    },
    enabled: activeTab === "knowledge" || activeTab === "overview",
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const saveLangProfile = useMutation({
    mutationFn: async (data: Partial<LanguageProfile> & { confirmProfile?: boolean }) => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/training/${specialistId}/language-profile`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      setEditingLang(false);
      queryClient.invalidateQueries({ queryKey: ["training-lang", slug, specialistId] });
    },
  });

  const saveConfig = useMutation({
    mutationFn: async (data: { responsibilities?: Partial<ResponsibilitiesConfig>; goals?: string[]; confirmConfiguration?: boolean }) => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/training/${specialistId}/config`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      setEditingResp(false);
      queryClient.invalidateQueries({ queryKey: ["training-config", slug, specialistId] });
      queryClient.invalidateQueries({ queryKey: ["training-status", slug, specialistId] });
    },
  });

  const updateStatus = useMutation({
    mutationFn: async (payload: { status?: string; notes?: string; configurationComplete?: boolean; knowledgeSourcesApproved?: boolean; retrievalTestPassed?: boolean; sampleTaskPassed?: boolean }) => {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/training/${specialistId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? "Update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-status", slug, specialistId] });
    },
  });

  // ── Test handler ──────────────────────────────────────────────────────────────

  async function runTest() {
    if (!testQuery.trim()) return;
    setTesting(true);
    setTestError(null);
    setTestResult(null);

    try {
      const res = await authFetch(
        `/v1/organisations/${slug}/knowledge/training/${specialistId}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: testQuery.trim() }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Test failed");
      setTestResult(body as TestResult);

      // Mark retrieval test as passed if we got results
      if ((body as TestResult).citations.length > 0) {
        updateStatus.mutate({ retrievalTestPassed: true });
      }
    } catch (err: any) {
      setTestError(err.message ?? "Test failed");
    } finally {
      setTesting(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const training     = trainingData?.trainingStatus;
  const langProfile  = langData?.languageProfile;
  const config       = configData?.config;
  const resps        = config?.responsibilities;
  const sources      = knowledgeData?.sources ?? [];
  const statusInfo   = TRAINING_STATUS_CONFIG[training?.status ?? "not_started"];
  const specialistLabel = SPECIALIST_LABELS[specialistId ?? ""] ?? (specialistId ?? "Specialist");

  const readinessChecks = [
    { label: "Responsibilities confirmed", done: training?.configurationComplete ?? false },
    { label: "Language & Style confirmed", done: !!(langProfile?.lastConfirmedAt) },
    { label: "Knowledge sources approved", done: training?.knowledgeSourcesApproved ?? false },
    { label: "Retrieval test passed",      done: training?.retrievalTestPassed ?? false },
    { label: "Sample task reviewed",       done: training?.sampleTaskPassed ?? false },
    { label: "Owner approval",             done: training?.status === "ready" },
  ];

  const blockers = readinessChecks.filter(c => !c.done);

  const examplePrompts = EXAMPLE_PROMPTS[specialistId ?? ""] ?? DEFAULT_PROMPTS;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <AppShell orgSlug={slug!}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        {/* Back */}
        <button onClick={() => setLocation(`/app/${slug}/workforce`)}
          className="text-sm text-slate-500 hover:text-indigo-600 flex items-center gap-1 mb-5">
          ← AI Workforce
        </button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{specialistLabel}</h1>
            <p className="text-sm text-slate-500 mt-0.5">Training configuration</p>
          </div>
          {training && (
            <span className={`text-sm font-medium px-3 py-1 rounded-full border flex-shrink-0 ${statusInfo.badge}`}>
              {statusInfo.label}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 border-b border-slate-200 mb-6 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Overview ──────────────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card title="Training status" value={statusInfo.label} sub={statusInfo.desc} />
              <Card title="Documents assigned" value={String(sources.length)} sub={sources.filter(s => s.status === "approved").length + " approved"} />
              <Card title="Last tested" value={training?.lastTestedAt ? new Date(training.lastTestedAt).toLocaleDateString("en-AU") : "Not yet"} sub={training?.retrievalTestPassed ? "Test passed" : "Not tested"} />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
              <h2 className="text-sm font-semibold text-slate-700">Readiness checklist</h2>
              {readinessChecks.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                    c.done ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-400"
                  }`}>
                    {c.done ? "✓" : "○"}
                  </span>
                  <span className={`text-sm ${c.done ? "text-slate-700" : "text-slate-500"}`}>{c.label}</span>
                </div>
              ))}
            </div>

            {training?.notes && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                <p className="font-medium mb-1">Notes</p>
                <p>{training.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Responsibilities ──────────────────────────────────────────────── */}
        {activeTab === "responsibilities" && (
          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-semibold text-slate-800">Responsibilities & Rules</h2>
              {!editingResp && (
                <button
                  onClick={() => {
                    setRespDraft(resps ?? {});
                    setEditingResp(true);
                  }}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                  Edit
                </button>
              )}
            </div>

            {editingResp ? (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-5">
                {(
                  [
                    { key: "responsibilities",        label: "Responsibilities",               placeholder: "e.g. Draft incident reports per NDIS policy" },
                    { key: "prohibitedActions",       label: "Prohibited actions",             placeholder: "e.g. Must not submit reports externally without approval" },
                    { key: "approvalRequiredActions", label: "Approval required before",       placeholder: "e.g. Notifying regulators" },
                    { key: "escalationConditions",    label: "Escalate when",                  placeholder: "e.g. Incident severity is high or critical" },
                    { key: "allowedSystems",          label: "Allowed systems",                placeholder: "e.g. NDIS portal, internal reporting system" },
                    { key: "firstWeekGoals",          label: "First priorities",               placeholder: "e.g. Review all current incident policies" },
                  ] as Array<{ key: keyof ResponsibilitiesConfig; label: string; placeholder: string }>
                ).map(field => (
                  <div key={field.key}>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">{field.label}</label>
                    <StringListEditor
                      items={(respDraft[field.key] as string[] | undefined) ?? (resps?.[field.key] as string[] | undefined) ?? []}
                      onChange={(items) => setRespDraft(p => ({ ...p, [field.key]: items }))}
                      placeholder={field.placeholder}
                    />
                  </div>
                ))}

                <div>
                  <label className="text-xs font-medium text-slate-700 mb-1 block">Escalation contacts</label>
                  <div className="space-y-2">
                    {((respDraft.escalationContacts ?? resps?.escalationContacts ?? []) as Array<{ name: string; role: string }>).map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm bg-slate-50 px-3 py-2 rounded-lg">
                        <span className="flex-1">{c.name} — {c.role}</span>
                        <button
                          onClick={() => setRespDraft(p => ({
                            ...p,
                            escalationContacts: (p.escalationContacts ?? resps?.escalationContacts ?? []).filter((_, j) => j !== i),
                          }))}
                          className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        value={newEscContact.name}
                        onChange={e => setNewEscContact(p => ({ ...p, name: e.target.value }))}
                        placeholder="Name"
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <input
                        value={newEscContact.role}
                        onChange={e => setNewEscContact(p => ({ ...p, role: e.target.value }))}
                        placeholder="Role"
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        onClick={() => {
                          if (!newEscContact.name.trim()) return;
                          setRespDraft(p => ({
                            ...p,
                            escalationContacts: [
                              ...(p.escalationContacts ?? resps?.escalationContacts ?? []),
                              { name: newEscContact.name.trim(), role: newEscContact.role.trim() },
                            ],
                          }));
                          setNewEscContact({ name: "", role: "" });
                        }}
                        className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
                        Add
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setEditingResp(false)} className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">Cancel</button>
                  <button
                    onClick={() => saveConfig.mutate({ responsibilities: respDraft, confirmConfiguration: true })}
                    disabled={saveConfig.isPending}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {saveConfig.isPending ? "Saving…" : "Save & confirm"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {[
                  { label: "Responsibilities",         items: resps?.responsibilities ?? [] },
                  { label: "Prohibited actions",       items: resps?.prohibitedActions ?? [] },
                  { label: "Approval required before", items: resps?.approvalRequiredActions ?? [] },
                  { label: "Escalate when",            items: resps?.escalationConditions ?? [] },
                  { label: "Allowed systems",          items: resps?.allowedSystems ?? [] },
                  { label: "First priorities",         items: resps?.firstWeekGoals ?? [] },
                ].map(section => (
                  <div key={section.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{section.label}</h3>
                    {section.items.length === 0 ? (
                      <p className="text-sm text-slate-400 italic">Not configured yet</p>
                    ) : (
                      <ul className="space-y-1">
                        {section.items.map((item, i) => (
                          <li key={i} className="text-sm text-slate-700 flex gap-2">
                            <span className="text-slate-300 flex-shrink-0">•</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}

                {(resps?.escalationContacts?.length ?? 0) > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Escalation contacts</h3>
                    <div className="space-y-1">
                      {resps!.escalationContacts.map((c, i) => (
                        <p key={i} className="text-sm text-slate-700">{c.name} — {c.role}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Language & Style ──────────────────────────────────────────────── */}
        {activeTab === "language" && (
          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-semibold text-slate-800">Language & Style</h2>
              {!editingLang && (
                <button
                  onClick={() => {
                    setLangDraft({ ...(langProfile ?? {}) });
                    setEditingLang(true);
                  }}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                  Edit
                </button>
              )}
            </div>

            {editingLang ? (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  {([
                    { key: "locale",                    label: "Locale",                    placeholder: "e.g. en-AU" },
                    { key: "spellingConvention",         label: "Spelling",                  placeholder: "e.g. australian" },
                    { key: "tone",                       label: "Tone",                      placeholder: "e.g. professional" },
                    { key: "formality",                  label: "Formality",                 placeholder: "formal / semi-formal / conversational" },
                    { key: "dateFormat",                 label: "Date format",               placeholder: "e.g. DD/MM/YYYY" },
                    { key: "timeFormat",                 label: "Time format",               placeholder: "e.g. 12-hour" },
                    { key: "headingPreferences",         label: "Heading style",             placeholder: "e.g. Title Case" },
                    { key: "sentenceLengthPreference",   label: "Sentence length",           placeholder: "concise / standard / detailed" },
                  ] as Array<{ key: keyof LanguageProfile; label: string; placeholder: string }>).map(f => (
                    <div key={f.key}>
                      <label className="text-xs font-medium text-slate-700">{f.label}</label>
                      <input
                        type="text"
                        value={(langDraft[f.key] as string) ?? ""}
                        onChange={e => setLangDraft(p => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  ))}
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700">Output structure</label>
                  <textarea
                    value={(langDraft.outputStructure as string) ?? ""}
                    onChange={e => setLangDraft(p => ({ ...p, outputStructure: e.target.value }))}
                    placeholder="e.g. Use numbered lists for procedures, bullet points for summaries, bold for key terms."
                    rows={2}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Preferred terms */}
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-2 block">Preferred terms</label>
                  <div className="space-y-1.5 mb-2">
                    {(langDraft.preferredTerms ?? langProfile?.preferredTerms ?? []).map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded-lg">
                        <span className="text-slate-500">"{t.term}"</span>
                        <span className="text-slate-400">→</span>
                        <span className="text-slate-700 font-medium">"{t.preferred}"</span>
                        {t.notes && <span className="text-slate-400 text-xs">({t.notes})</span>}
                        <button
                          onClick={() => setLangDraft(p => ({
                            ...p,
                            preferredTerms: (p.preferredTerms ?? []).filter((_, j) => j !== i),
                          }))}
                          className="ml-auto text-red-400 hover:text-red-600 text-xs">×</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input value={newPrefTerm.term} onChange={e => setNewPrefTerm(p => ({ ...p, term: e.target.value }))} placeholder='Instead of "..."' className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <input value={newPrefTerm.preferred} onChange={e => setNewPrefTerm(p => ({ ...p, preferred: e.target.value }))} placeholder='Use "..."' className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <button onClick={() => {
                      if (!newPrefTerm.term.trim()) return;
                      setLangDraft(p => ({ ...p, preferredTerms: [...(p.preferredTerms ?? []), { term: newPrefTerm.term.trim(), preferred: newPrefTerm.preferred.trim() }] }));
                      setNewPrefTerm({ term: "", preferred: "" });
                    }} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">Add</button>
                  </div>
                </div>

                {/* Prohibited terms */}
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-2 block">Prohibited terms</label>
                  <div className="space-y-1.5 mb-2">
                    {(langDraft.prohibitedTerms ?? langProfile?.prohibitedTerms ?? []).map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded-lg">
                        <span className="text-red-600 font-medium">"{t.term}"</span>
                        {t.reason && <span className="text-slate-400 text-xs">— {t.reason}</span>}
                        <button
                          onClick={() => setLangDraft(p => ({
                            ...p,
                            prohibitedTerms: (p.prohibitedTerms ?? []).filter((_, j) => j !== i),
                          }))}
                          className="ml-auto text-red-400 hover:text-red-600 text-xs">×</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input value={newProhibTerm.term} onChange={e => setNewProhibTerm(p => ({ ...p, term: e.target.value }))} placeholder="Term to avoid" className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <input value={newProhibTerm.reason} onChange={e => setNewProhibTerm(p => ({ ...p, reason: e.target.value }))} placeholder="Reason (optional)" className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <button onClick={() => {
                      if (!newProhibTerm.term.trim()) return;
                      setLangDraft(p => ({ ...p, prohibitedTerms: [...(p.prohibitedTerms ?? []), { term: newProhibTerm.term.trim(), reason: newProhibTerm.reason.trim() || undefined }] }));
                      setNewProhibTerm({ term: "", reason: "" });
                    }} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">Add</button>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setEditingLang(false)} className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">Cancel</button>
                  <button
                    onClick={() => saveLangProfile.mutate({ ...langDraft, confirmProfile: true })}
                    disabled={saveLangProfile.isPending}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {saveLangProfile.isPending ? "Saving…" : "Save & confirm"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    {[
                      ["Locale",            langProfile?.locale],
                      ["Spelling",          langProfile?.spellingConvention],
                      ["Tone",              langProfile?.tone],
                      ["Formality",         langProfile?.formality],
                      ["Date format",       langProfile?.dateFormat],
                      ["Time format",       langProfile?.timeFormat],
                      ["Heading style",     langProfile?.headingPreferences],
                      ["Sentence length",   langProfile?.sentenceLengthPreference],
                    ].map(([label, val]) => (
                      <div key={String(label)}>
                        <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
                        <p className="text-slate-700 font-medium">{val ?? <span className="text-slate-300 font-normal">—</span>}</p>
                      </div>
                    ))}
                  </div>
                  {langProfile?.outputStructure && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Output structure</p>
                      <p className="text-sm text-slate-700">{langProfile.outputStructure}</p>
                    </div>
                  )}
                  {langProfile?.lastConfirmedAt && (
                    <p className="text-xs text-slate-400 mt-3 pt-2 border-t border-slate-100">
                      Confirmed {new Date(langProfile.lastConfirmedAt).toLocaleDateString("en-AU")}
                    </p>
                  )}
                </div>

                {(langProfile?.preferredTerms?.length ?? 0) > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Preferred terms</h3>
                    <div className="space-y-1">
                      {langProfile!.preferredTerms.map((t, i) => (
                        <div key={i} className="text-sm text-slate-700 flex gap-2">
                          <span className="text-slate-500">"{t.term}"</span>
                          <span className="text-slate-400">→</span>
                          <span className="font-medium">"{t.preferred}"</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(langProfile?.prohibitedTerms?.length ?? 0) > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Prohibited terms</h3>
                    <div className="space-y-1">
                      {langProfile!.prohibitedTerms.map((t, i) => (
                        <div key={i} className="text-sm flex gap-2">
                          <span className="text-red-500 font-medium">"{t.term}"</span>
                          {t.reason && <span className="text-slate-400">— {t.reason}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(!langProfile?.lastConfirmedAt) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
                    Language & Style hasn't been confirmed yet. Edit and save to mark this as complete.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Knowledge ────────────────────────────────────────────────────── */}
        {activeTab === "knowledge" && (
          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-semibold text-slate-800">Assigned Knowledge</h2>
              <button
                onClick={() => setLocation(`/app/${slug}/library`)}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                Manage Library
              </button>
            </div>

            {sources.length === 0 ? (
              <div className="text-center py-12 bg-white border border-slate-200 rounded-xl shadow-sm">
                <div className="text-4xl mb-3">📚</div>
                <p className="font-medium text-slate-600 mb-1">No knowledge assigned yet</p>
                <p className="text-sm text-slate-400 max-w-xs mx-auto">
                  This specialist is not yet trained on your organisation's documents.
                  Upload documents to your Organisation Library and assign them to this specialist.
                </p>
                <button
                  onClick={() => setLocation(`/app/${slug}/library`)}
                  className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
                  Go to Organisation Library
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {sources.map(source => (
                  <div
                    key={source.id}
                    className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        {source.scopes.map((s, i) => (
                          <span key={i} className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded-full">
                            {SOURCE_SCOPE_LABELS[s.scopeType] ?? s.scopeType}
                          </span>
                        ))}
                        <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
                          source.status === "approved"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-slate-100 text-slate-500 border-slate-200"
                        }`}>
                          {source.status === "approved" ? "Approved" : source.status}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-900">{source.title}</p>
                      <div className="flex gap-2 mt-0.5 text-xs text-slate-400">
                        <span>{SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType}</span>
                        <span>·</span>
                        <span>{AUTHORITY_LABELS[source.authorityLevel] ?? source.authorityLevel}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setLocation(`/app/${slug}/library/${source.id}`)}
                      className="px-2.5 py-1 border border-slate-200 text-slate-500 text-xs rounded-lg hover:bg-slate-50 flex-shrink-0">
                      View
                    </button>
                  </div>
                ))}
              </div>
            )}

            {sources.length > 0 && (
              <button
                onClick={() => updateStatus.mutate({ knowledgeSourcesApproved: sources.some(s => s.status === "approved") })}
                className="text-sm text-indigo-600 hover:underline">
                Mark knowledge as confirmed
              </button>
            )}
          </div>
        )}

        {/* ── Tab: Test Specialist ──────────────────────────────────────────────── */}
        {activeTab === "test" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-slate-800 mb-1">Test this specialist</h2>
              <p className="text-sm text-slate-500">
                Ask a question to see what knowledge this specialist would use when responding.
              </p>
            </div>

            {/* Query input */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
              <textarea
                value={testQuery}
                onChange={e => setTestQuery(e.target.value)}
                placeholder="Enter a question or scenario to test…"
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex items-center justify-between">
                <div className="flex gap-2 flex-wrap">
                  {examplePrompts.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => setTestQuery(p)}
                      className="text-xs text-indigo-600 border border-indigo-200 bg-indigo-50 px-2 py-1 rounded-full hover:bg-indigo-100">
                      {p.length > 40 ? p.slice(0, 40) + "…" : p}
                    </button>
                  ))}
                </div>
                <button
                  onClick={runTest}
                  disabled={testing || !testQuery.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex-shrink-0">
                  {testing ? "Testing…" : "Run test"}
                </button>
              </div>
            </div>

            {testError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                {testError}
              </div>
            )}

            {/* Test results */}
            {testResult && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">
                    {testResult.sourcesUsed} source{testResult.sourcesUsed !== 1 ? "s" : ""} found
                    <span className="text-slate-400 font-normal ml-2">· {testResult.retrievalMethod}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Tested {new Date(testResult.testedAt).toLocaleTimeString("en-AU")}
                  </p>
                </div>

                {testResult.sourcesUsed === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
                    <div className="text-3xl mb-2">🔍</div>
                    <p className="text-slate-600 font-medium text-sm">No matching knowledge found</p>
                    <p className="text-sm text-slate-400 mt-1">
                      This specialist has no approved documents that match this query.
                      Consider uploading relevant documents to the Organisation Library.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {testResult.citations.map((c, i) => (
                      <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                              c.matchLabel === "Strong match"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : c.matchLabel === "Good match"
                                  ? "bg-blue-50 text-blue-600 border-blue-200"
                                  : "bg-slate-100 text-slate-500 border-slate-200"
                            }`}>
                              {c.matchLabel}
                            </span>
                            <span className="text-xs text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                              {c.authority}
                            </span>
                            {!c.isCurrent && (
                              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                Outdated source
                              </span>
                            )}
                            {!c.isApproved && (
                              <span className="text-xs text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                                Reference only
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 flex-shrink-0 text-right">
                            {c.section && <div>{c.section}</div>}
                            {c.pageNumber && <div>p. {c.pageNumber}</div>}
                            {c.versionLabel && <div>v{c.versionLabel}</div>}
                          </div>
                        </div>
                        <p className="text-sm font-medium text-slate-800">{c.title}</p>
                        <p className="text-sm text-slate-600 mt-1 line-clamp-4">{c.excerpt}</p>
                        {c.warnings.length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            {c.warnings.map((w, wi) => (
                              <p key={wi} className="text-xs text-amber-600">⚠ {w}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {testResult.conflicts.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                    <p className="text-sm font-medium text-amber-800">Possible conflicts detected</p>
                    {testResult.conflicts.map((c, i) => (
                      <div key={i} className="text-sm text-amber-700">
                        <span className="font-medium">{c.type}:</span> {c.warning}
                      </div>
                    ))}
                  </div>
                )}

                {(testResult.warnings?.length ?? 0) > 0 && (
                  <div className="space-y-1">
                    {testResult.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-slate-500">ℹ {w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Readiness ────────────────────────────────────────────────────── */}
        {activeTab === "readiness" && (
          <div className="space-y-5">
            <h2 className="text-base font-semibold text-slate-800">Readiness</h2>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700">Status</h3>
                <span className={`text-sm font-medium px-3 py-1 rounded-full border ${statusInfo.badge}`}>
                  {statusInfo.label}
                </span>
              </div>
              <p className="text-sm text-slate-500">{statusInfo.desc}</p>

              {blockers.length > 0 && training?.status !== "ready" && (
                <div className="pt-2 border-t border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Blocking readiness</p>
                  {blockers.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 py-1">
                      <span className="w-5 h-5 rounded-full bg-red-50 text-red-500 flex items-center justify-center text-xs flex-shrink-0">✗</span>
                      <span className="text-sm text-slate-600">{b.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Checklist */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-2">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Readiness checks</h3>
              {readinessChecks.map((c, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-slate-50 last:border-0">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                    c.done ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
                  }`}>
                    {c.done ? "✓" : "○"}
                  </span>
                  <span className={`text-sm flex-1 ${c.done ? "text-slate-700" : "text-slate-500"}`}>{c.label}</span>
                  {!c.done && c.label === "Retrieval test passed" && (
                    <button onClick={() => setActiveTab("test")} className="text-xs text-indigo-600 hover:underline">Run test</button>
                  )}
                  {!c.done && c.label === "Responsibilities confirmed" && (
                    <button onClick={() => setActiveTab("responsibilities")} className="text-xs text-indigo-600 hover:underline">Configure</button>
                  )}
                  {!c.done && c.label === "Language & Style confirmed" && (
                    <button onClick={() => setActiveTab("language")} className="text-xs text-indigo-600 hover:underline">Configure</button>
                  )}
                </div>
              ))}
            </div>

            {/* Owner/admin approve actions */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Owner / Admin actions</h3>
              <p className="text-xs text-slate-400">Only organisation owners and admins can approve or suspend a specialist.</p>
              <div className="flex gap-3 flex-wrap">
                {training?.status !== "ready" && (
                  <button
                    onClick={() => updateStatus.mutate({ status: "ready", notes: "Approved for live work." })}
                    disabled={updateStatus.isPending || blockers.length > 0}
                    className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed">
                    {updateStatus.isPending ? "Approving…" : "Approve — mark ready"}
                  </button>
                )}
                {training?.status === "ready" && (
                  <button
                    onClick={() => updateStatus.mutate({ status: "needs_attention", notes: "Suspended by admin." })}
                    disabled={updateStatus.isPending}
                    className="px-4 py-2 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50">
                    {updateStatus.isPending ? "Suspending…" : "Suspend specialist"}
                  </button>
                )}
                {training?.status !== "configuring" && training?.status !== "not_started" && (
                  <button
                    onClick={() => updateStatus.mutate({ status: "configuring" })}
                    disabled={updateStatus.isPending}
                    className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50">
                    Reset to configuring
                  </button>
                )}
              </div>
              {blockers.length > 0 && training?.status !== "ready" && (
                <p className="text-xs text-slate-400">
                  Approval requires all readiness checks to be complete.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{title}</p>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

function StringListEditor({
  items, onChange, placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [newItem, setNewItem] = useState("");

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 text-sm bg-slate-50 px-3 py-1.5 rounded-lg">
          <span className="flex-1 text-slate-700">{item}</span>
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-xs">×</button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && newItem.trim()) {
              onChange([...items, newItem.trim()]);
              setNewItem("");
            }
          }}
          placeholder={placeholder}
          className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={() => {
            if (!newItem.trim()) return;
            onChange([...items, newItem.trim()]);
            setNewItem("");
          }}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
          Add
        </button>
      </div>
    </div>
  );
}
