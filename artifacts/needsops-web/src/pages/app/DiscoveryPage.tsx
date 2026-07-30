/**
 * Business Discovery Page — /app/:slug/discover
 * Sprint 14
 *
 * Conversational, one-screen-at-a-time business discovery wizard.
 * Shares API + data with the desktop app's discovery flow.
 */
import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useAuthFetch } from "@/lib/api";
import AppShell from "@/components/layout/AppShell";

// ── Screen definitions ─────────────────────────────────────────────────────────

interface Question {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "multi" | "time";
  placeholder?: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
}

interface Screen {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  questions: Question[];
}

const SCREENS: Screen[] = [
  {
    key: "company_overview",
    title: "Tell us about your company",
    subtitle: "Help your AI employees understand what you do.",
    icon: "🏢",
    questions: [
      { key: "description", label: "What does your company do?", type: "textarea", placeholder: "We provide disability support services to..." },
      { key: "primary_services", label: "Primary services", type: "multi", options: [
        { value: "daily_living", label: "Daily living support" },
        { value: "community_participation", label: "Community participation" },
        { value: "plan_management", label: "Plan management" },
        { value: "support_coordination", label: "Support coordination" },
        { value: "short_term_accommodation", label: "Short-term accommodation" },
        { value: "employment", label: "Supported employment" },
        { value: "other", label: "Other" },
      ]},
      { key: "staff_count", label: "Approximate number of staff", type: "select", options: [
        { value: "1-5", label: "1–5 staff" }, { value: "6-20", label: "6–20 staff" },
        { value: "21-50", label: "21–50 staff" }, { value: "51-100", label: "51–100 staff" },
        { value: "100+", label: "100+ staff" },
      ]},
      { key: "client_count", label: "Approximate number of clients", type: "select", options: [
        { value: "1-20", label: "1–20" }, { value: "21-100", label: "21–100" },
        { value: "101-500", label: "101–500" }, { value: "500+", label: "500+" },
      ]},
    ],
  },
  {
    key: "work_systems",
    title: "How does your team work?",
    subtitle: "Your AI employees will work with the systems you already use.",
    icon: "⚙️",
    questions: [
      { key: "primary_browser", label: "Which browser does your team mainly use for work?", type: "select", options: [
        { value: "chrome", label: "Google Chrome" }, { value: "edge", label: "Microsoft Edge" },
        { value: "safari", label: "Safari" }, { value: "firefox", label: "Firefox" }, { value: "other", label: "Other" },
      ]},
      { key: "crm_name", label: "Which CRM does your team use?", type: "select", options: [
        { value: "salesforce", label: "Salesforce" }, { value: "hubspot", label: "HubSpot" },
        { value: "clinical_software", label: "Clinical Software" }, { value: "careview", label: "CareView" },
        { value: "ndia_portal", label: "NDIA Portal" }, { value: "none", label: "None / Not sure" }, { value: "other", label: "Other" },
      ]},
      { key: "email_platform", label: "Which email platform do you use?", type: "select", options: [
        { value: "google_workspace", label: "Google Workspace (Gmail)" }, { value: "microsoft_365", label: "Microsoft 365 (Outlook)" },
        { value: "other", label: "Other" },
      ]},
      { key: "accounting_system", label: "Accounting system", type: "select", options: [
        { value: "xero", label: "Xero" }, { value: "myob", label: "MYOB" }, { value: "quickbooks", label: "QuickBooks" },
        { value: "sage", label: "Sage" }, { value: "other", label: "Other" }, { value: "none", label: "None" },
      ]},
    ],
  },
  {
    key: "company_information",
    title: "Where does your company store things?",
    subtitle: "Your AI employees will know where to look for policies and documents.",
    icon: "📁",
    questions: [
      { key: "policy_location", label: "Where are company policies stored?", type: "select", options: [
        { value: "sharepoint", label: "SharePoint" }, { value: "google_drive", label: "Google Drive" },
        { value: "dropbox", label: "Dropbox" }, { value: "local_folders", label: "Local folders" },
        { value: "intranet", label: "Intranet / Wiki" }, { value: "other", label: "Other" },
      ]},
      { key: "contracts_location", label: "Where are contracts stored?", type: "select", options: [
        { value: "sharepoint", label: "SharePoint" }, { value: "google_drive", label: "Google Drive" },
        { value: "docusign", label: "DocuSign" }, { value: "local_folders", label: "Local folders" },
        { value: "other", label: "Other" },
      ]},
      { key: "hr_docs_location", label: "Where are HR documents stored?", type: "select", options: [
        { value: "bamboohr", label: "BambooHR" }, { value: "employment_hero", label: "Employment Hero" },
        { value: "sharepoint", label: "SharePoint" }, { value: "google_drive", label: "Google Drive" },
        { value: "local_folders", label: "Local folders" }, { value: "other", label: "Other" },
      ]},
      { key: "knowledge_source", label: "Where does the team normally find company information?", type: "select", options: [
        { value: "intranet", label: "Company intranet / wiki" }, { value: "sharepoint", label: "SharePoint" },
        { value: "google_drive", label: "Google Drive" }, { value: "slack_notion", label: "Slack / Notion" },
        { value: "ask_person", label: "They ask a colleague" }, { value: "other", label: "Other" },
      ]},
    ],
  },
  {
    key: "approvals",
    title: "How do approvals work at your company?",
    subtitle: "Your AI employees will always check before doing anything that requires approval.",
    icon: "✅",
    questions: [
      { key: "purchase_approver_name", label: "Who approves purchases?", type: "text", placeholder: "e.g. Sarah Johnson, Finance Manager" },
      { key: "purchase_threshold", label: "Purchases above this amount always require approval", type: "select", options: [
        { value: "0", label: "Every purchase" }, { value: "5000", label: "Over A$50" }, { value: "10000", label: "Over A$100" },
        { value: "50000", label: "Over A$500" }, { value: "100000", label: "Over A$1,000" }, { value: "always_manual", label: "Always manual" },
      ]},
      { key: "leave_approver_name", label: "Who approves leave?", type: "text", placeholder: "e.g. Team manager" },
      { key: "contract_approver_name", label: "Who approves contracts?", type: "text", placeholder: "e.g. CEO / Director" },
      { key: "always_require_approval", label: "Which actions always require a human to approve?", type: "multi", options: [
        { value: "send_email_external", label: "Sending email outside the company" },
        { value: "create_documents", label: "Creating documents on behalf of clients" },
        { value: "financial_transactions", label: "Any financial transactions" },
        { value: "client_communications", label: "Client communications" },
        { value: "hr_actions", label: "HR actions (hiring, firing, leave)" },
        { value: "all_ai_actions", label: "All AI actions" },
      ]},
    ],
  },
  {
    key: "operations",
    title: "When and where do you operate?",
    subtitle: "Your AI employees will respect your business hours and locations.",
    icon: "🕐",
    questions: [
      { key: "business_hours_start", label: "What time does your business day start?", type: "select", options: [
        "07:00","08:00","08:30","09:00","09:30","10:00"
      ].map(v => ({ value: v, label: v }))},
      { key: "business_hours_end", label: "What time does your business day end?", type: "select", options: [
        "15:30","16:00","16:30","17:00","17:30","18:00","18:30"
      ].map(v => ({ value: v, label: v }))},
      { key: "locations", label: "Where do you operate?", type: "text", placeholder: "e.g. Melbourne CBD, Geelong, online" },
      { key: "key_managers", label: "Important managers or leaders to know about", type: "textarea", placeholder: "e.g. John Smith (CEO), Sarah Lee (Operations Manager)…", optional: true },
    ],
  },
  {
    key: "agent_goals",
    title: "What do you want your AI employees to achieve?",
    subtitle: "Give your AI team their first-week goals so they can hit the ground running.",
    icon: "🎯",
    questions: [
      { key: "chief_of_staff_goals", label: "What should your Chief of Staff focus on first?", type: "textarea", placeholder: "e.g. Review our NDIS participant files and flag any overdue reviews…", optional: true },
      { key: "operations_goals", label: "What should the Operations team focus on first?", type: "textarea", placeholder: "e.g. Audit our shift scheduling for the next fortnight…", optional: true },
      { key: "general_goals", label: "Anything else your AI team should know about your first week?", type: "textarea", placeholder: "e.g. We're preparing for an audit next month, so compliance is top priority…", optional: true },
    ],
  },
];

const INPUT = "w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm transition-colors";

// ── Component ──────────────────────────────────────────────────────────────────

export default function DiscoveryPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();

  const [currentScreenIdx, setCurrentScreenIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [completionPct, setCompletionPct] = useState(0);
  const [completed, setCompleted] = useState(false);

  // Load existing progress
  useEffect(() => {
    if (!slug) return;
    apiFetch(`/v1/organisations/${slug}/discovery`)
      .then(r => r.json())
      .then(d => {
        if (d.answers) setAnswers(d.answers);
        if (d.status?.currentScreen) setCurrentScreenIdx(d.status.currentScreen);
        if (d.completionPercentage !== undefined) setCompletionPct(d.completionPercentage);
        if (d.status?.completedAt) setCompleted(true);
      })
      .catch(() => {});
  }, [slug]);

  const currentScreen = SCREENS[currentScreenIdx];
  if (!currentScreen) return null;

  const screenAnswers = answers[currentScreen.key] ?? {};

  const setAnswer = (questionKey: string, value: unknown) => {
    setAnswers(prev => ({
      ...prev,
      [currentScreen!.key]: {
        ...prev[currentScreen!.key],
        [questionKey]: value,
      },
    }));
  };

  const toggleMultiAnswer = (questionKey: string, value: string) => {
    const current = (screenAnswers[questionKey] as string[] | undefined) ?? [];
    const updated = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    setAnswer(questionKey, updated);
  };

  const saveAndAdvance = async (skip = false) => {
    if (!slug || !currentScreen) return;
    setSaving(true); setSaveError("");
    try {
      const answerPayload = currentScreen.questions.map(q => ({
        questionKey: q.key,
        answerValue: screenAnswers[q.key] ?? null,
        skipped: skip || screenAnswers[q.key] == null,
      }));

      const res = await apiFetch(`/v1/organisations/${slug}/discovery/screens/${currentScreen.key}`, {
        method: "POST",
        body: JSON.stringify({ answers: answerPayload }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error?.message ?? "Save failed."); return; }
      setCompletionPct(data.completionPercentage ?? completionPct);

      if (currentScreenIdx < SCREENS.length - 1) {
        setCurrentScreenIdx(i => i + 1);
      } else {
        // Complete discovery
        const agentGoals: Record<string, string> = {};
        const goalAnswers = answers["agent_goals"] ?? {};
        if (goalAnswers.chief_of_staff_goals) agentGoals.chief_of_staff = String(goalAnswers.chief_of_staff_goals);
        if (goalAnswers.operations_goals) agentGoals.operations_manager = String(goalAnswers.operations_goals);

        await apiFetch(`/v1/organisations/${slug}/discovery/complete`, {
          method: "POST",
          body: JSON.stringify({ agentGoals }),
        });
        setCompleted(true);
        setCompletionPct(100);
      }
    } catch { setSaveError("Network error. Please try again."); }
    finally { setSaving(false); }
  };

  if (completed) {
    return (
      <AppShell>
        <div className="max-w-lg mx-auto px-4 py-16 text-center">
          <div className="text-5xl mb-6">🎯</div>
          <h1 className="text-2xl font-bold text-[#E2E8F0] mb-3">Business Discovery complete!</h1>
          <p className="text-[#64748B] mb-6">
            Your AI employees now know how your company works. They're ready to help.
          </p>
          <button
            onClick={() => setLocation(`/app/${slug}`)}
            className="w-full py-3 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] transition-colors"
          >
            Back to dashboard →
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-xl mx-auto px-4 py-8">
        {/* Progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[#64748B] text-sm">Business Discovery · {currentScreenIdx + 1} of {SCREENS.length}</p>
            <p className="text-[#00D4FF] text-sm font-medium">{completionPct}% complete</p>
          </div>
          <div className="h-1.5 bg-[#1E3A5F] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#00D4FF] rounded-full transition-all duration-500"
              style={{ width: `${((currentScreenIdx + 1) / SCREENS.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-8">
          {/* Screen header */}
          <div className="flex items-start gap-3 mb-6">
            <span className="text-3xl">{currentScreen.icon}</span>
            <div>
              <h1 className="text-xl font-bold text-[#E2E8F0]">{currentScreen.title}</h1>
              <p className="text-[#64748B] text-sm mt-0.5">{currentScreen.subtitle}</p>
            </div>
          </div>

          {/* Questions */}
          <div className="space-y-5">
            {currentScreen.questions.map(q => (
              <div key={q.key}>
                <label className="block text-sm text-[#E2E8F0] mb-1.5">
                  {q.label}
                  {q.optional && <span className="text-[#475569] ml-1">(optional)</span>}
                </label>

                {q.type === "text" && (
                  <input
                    value={String(screenAnswers[q.key] ?? "")}
                    onChange={e => setAnswer(q.key, e.target.value)}
                    className={INPUT}
                    placeholder={q.placeholder}
                  />
                )}

                {q.type === "textarea" && (
                  <textarea
                    value={String(screenAnswers[q.key] ?? "")}
                    onChange={e => setAnswer(q.key, e.target.value)}
                    className={`${INPUT} min-h-[80px] resize-y`}
                    placeholder={q.placeholder}
                  />
                )}

                {q.type === "select" && (
                  <select
                    value={String(screenAnswers[q.key] ?? "")}
                    onChange={e => setAnswer(q.key, e.target.value)}
                    className={INPUT}
                  >
                    <option value="">Select…</option>
                    {q.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}

                {q.type === "multi" && (
                  <div className="grid grid-cols-2 gap-2">
                    {q.options?.map(o => {
                      const selected = ((screenAnswers[q.key] as string[]) ?? []).includes(o.value);
                      return (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => toggleMultiAnswer(q.key, o.value)}
                          className="text-left px-3 py-2 rounded-lg border text-sm transition-all"
                          style={{
                            borderColor: selected ? "#00D4FF" : "#1E3A5F",
                            background: selected ? "#00D4FF10" : "#0B1829",
                            color: selected ? "#00D4FF" : "#64748B",
                          }}
                        >
                          {selected && <span className="mr-1">✓</span>}
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {saveError && (
            <p className="mt-4 text-red-400 text-sm bg-red-900/10 border border-red-800/30 rounded-lg px-3 py-2">{saveError}</p>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-8">
            {currentScreenIdx > 0 && (
              <button
                onClick={() => setCurrentScreenIdx(i => i - 1)}
                className="px-5 py-2.5 border border-[#1E3A5F] text-[#94A3B8] rounded-lg hover:border-[#00D4FF] transition-colors text-sm"
              >
                ← Back
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={() => saveAndAdvance(true)}
              disabled={saving}
              className="px-4 py-2.5 border border-[#1E3A5F] text-[#64748B] rounded-lg hover:text-[#94A3B8] hover:border-[#475569] transition-colors text-sm"
            >
              Skip
            </button>
            <button
              onClick={() => saveAndAdvance(false)}
              disabled={saving}
              className="px-6 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg hover:bg-[#00B8D9] disabled:opacity-50 transition-colors text-sm"
            >
              {saving ? "Saving…" : currentScreenIdx < SCREENS.length - 1 ? "Next →" : "Complete Discovery →"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
