/**
 * Org Onboarding — Sprint 14
 * 6-step wizard:
 *   1. Organisation details
 *   2. Location
 *   3. Contact & compliance
 *   4. Choose your AI employees (packs with specialist detail)
 *   5. Select your plan
 *   6. Review & activate (simulated checkout with payment bypass)
 */
import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import { useAuthFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5 | 6;

interface FormData {
  name: string; type: string; industry: string;
  country: string; state: string; timezone: string;
  primaryContactName: string; primaryContactEmail: string;
  abn: string; ndisRegistrationNumber: string;
  selectedPacks: string[];
  selectedPlanCode: string;
  billingCycle: "monthly" | "annual";
  termsAccepted: boolean;
}

interface Specialist {
  code: string;
  displayName: string;
  description: string | null;
  icon: string | null;
}

interface Pack {
  code: string;
  name: string;
  marketingTagline: string | null;
  description: string | null;
  iconEmoji: string | null;
  colorHex: string | null;
  tier: string;
  specialistCount: number;
  featured: boolean;
  trialEligible: boolean;
  trialLengthDays: number | null;
  selectionMode: string;
  pricing: { isFree: boolean; currency?: string; monthlyPriceCents?: number; displayMode: string; fallbackText?: string; };
  specialists?: Specialist[];
}

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  featureBullets: string | null;
  displayOrder: number;
  isActive: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const AU_STATES = ["ACT","NSW","NT","QLD","SA","TAS","VIC","WA"];
const AU_TIMEZONES = ["Australia/Sydney","Australia/Melbourne","Australia/Brisbane","Australia/Perth","Australia/Adelaide","Australia/Darwin","Australia/Hobart"];
const ORG_TYPES = [
  { value: "ndis_provider", label: "NDIS Provider" },
  { value: "disability_services", label: "Disability Services" },
  { value: "aged_care", label: "Aged Care" },
  { value: "healthcare", label: "Healthcare" },
  { value: "other", label: "Other" },
];

const STEP_LABELS: Record<Step, string> = {
  1: "Organisation details",
  2: "Location",
  3: "Contact & compliance",
  4: "Choose your AI employees",
  5: "Select your plan",
  6: "Review & activate",
};

// Default feature bullets for plans when not yet in DB
const PLAN_FEATURES: Record<string, string[]> = {
  foundation: ["Chief of Staff AI employee", "Up to 5 staff users", "14-day free trial", "Core workforce pack included"],
  professional: ["All Foundation features", "Up to 20 staff users", "All workforce packs", "Priority support"],
  business: ["All Professional features", "Unlimited users", "Custom AI employee configuration", "Dedicated account manager"],
  enterprise: ["Everything in Business", "Custom integrations", "On-premise option", "SLA guarantee"],
};

const PLAN_COLOURS: Record<string, string> = {
  foundation: "#64748B",
  professional: "#00D4FF",
  business: "#FF8C00",
  enterprise: "#A855F7",
};

const INPUT = "w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm transition-colors";

// ── Component ──────────────────────────────────────────────────────────────────

export default function OrgOnboarding() {
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>({
    name: "", type: "ndis_provider", industry: "",
    country: "AU", state: "", timezone: "Australia/Sydney",
    primaryContactName: "", primaryContactEmail: "",
    abn: "", ndisRegistrationNumber: "",
    selectedPacks: [],
    selectedPlanCode: "foundation",
    billingCycle: "monthly",
    termsAccepted: false,
  });
  const [packs, setPacks] = useState<Pack[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [plansLoading, setPlansLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [expandedPack, setExpandedPack] = useState<string | null>(null);
  const [bypassEnabled, setBypassEnabled] = useState(false);
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const update = (k: keyof FormData, v: any) => setForm(f => ({ ...f, [k]: v }));

  // Check if payment bypass is enabled
  useEffect(() => {
    fetch("/v1/payment/bypass/status")
      .then(r => r.json())
      .then(d => setBypassEnabled(d.enabled === true))
      .catch(() => setBypassEnabled(false));
  }, []);

  // Load packs when user reaches step 4
  useEffect(() => {
    if (step === 4 && packs.length === 0) {
      setPacksLoading(true);
      fetch("/v1/workforce-packs?status=available&includeSpecialists=true")
        .then(r => r.json())
        .then(d => {
          const available: Pack[] = (d.packs ?? []).filter((p: Pack) => p.code !== "core");
          setPacks(available);
          const preSelected = available.filter(p => p.featured).map(p => p.code);
          setForm(f => ({ ...f, selectedPacks: preSelected }));
        })
        .catch(() => setPacks([]))
        .finally(() => setPacksLoading(false));
    }
  }, [step]);

  // Load plans when user reaches step 5
  useEffect(() => {
    if (step === 5 && plans.length === 0) {
      setPlansLoading(true);
      fetch("/v1/plans")
        .then(r => r.json())
        .then(d => setPlans(d.plans ?? []))
        .catch(() => setPlans([]))
        .finally(() => setPlansLoading(false));
    }
  }, [step]);

  const togglePack = (code: string) => {
    setForm(f => ({
      ...f,
      selectedPacks: f.selectedPacks.includes(code)
        ? f.selectedPacks.filter(c => c !== code)
        : [...f.selectedPacks, code],
    }));
  };

  // Step 1–4: create org + provision packs
  const handleCreateOrg = async (): Promise<boolean> => {
    setSubmitting(true); setError("");
    try {
      const res = await apiFetch("/v1/organisations", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          industry: form.type,
          initialWorkforcePacks: ["core", ...form.selectedPacks],
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message ?? "Failed to create organisation"); return false; }
      setOrgSlug(data.organisation.slug);
      setOrgId(data.organisation.id);
      return true;
    } catch { setError("Network error. Please try again."); return false; }
    finally { setSubmitting(false); }
  };

  // Step 6: activate payment bypass
  const handlePaymentBypass = async () => {
    if (!orgSlug) return;
    setSubmitting(true); setError("");
    try {
      const res = await apiFetch(`/v1/organisations/${orgSlug}/payment/bypass`, {
        method: "POST",
        body: JSON.stringify({
          planCode: form.selectedPlanCode,
          billingCycle: form.billingCycle,
          selectedPackCodes: form.selectedPacks,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message ?? "Failed to activate subscription"); return; }
      setPaymentSuccess(true);
    } catch { setError("Network error. Please try again."); }
    finally { setSubmitting(false); }
  };

  const canAdvance = (): boolean => {
    if (step === 1) return !!form.name.trim() && !!form.type;
    if (step === 2) return !!form.state && !!form.timezone;
    if (step === 3) return true;
    if (step === 4) return true;
    if (step === 5) return !!form.selectedPlanCode;
    return form.termsAccepted;
  };

  const handleNext = async () => {
    if (step === 4) {
      // Create the org before advancing to plan selection
      const ok = await handleCreateOrg();
      if (!ok) return;
    }
    setStep(s => Math.min(s + 1, 6) as Step);
  };

  const selectedPlan = plans.find(p => p.code === form.selectedPlanCode);

  // Payment success → redirect to install page
  if (paymentSuccess && orgSlug) {
    return (
      <div className="min-h-dvh bg-[#0B1829] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-lg text-center">
          <div className="text-5xl mb-6">🎉</div>
          <h1 className="text-3xl font-bold text-[#E2E8F0] mb-3">
            Your NeedsOps AI+ subscription is ready.
          </h1>
          <p className="text-[#64748B] mb-8">
            Your account is set up. Now install NeedsOps AI+ on your computer to connect your AI employees.
          </p>
          <button
            onClick={() => setLocation(`/app/${orgSlug}/install`)}
            className="w-full py-3 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] transition-colors text-lg"
          >
            Install NeedsOps AI+ →
          </button>
          <button
            onClick={() => setLocation(`/app/${orgSlug}`)}
            className="mt-4 text-[#64748B] text-sm hover:text-[#94A3B8] transition-colors"
          >
            Skip for now — go to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <Show when="signed-in">
        <div className="min-h-dvh bg-[#0B1829] flex flex-col items-center justify-center px-4 py-12">
          <div className={`w-full ${step >= 4 ? "max-w-3xl" : "max-w-lg"}`}>
            {/* Progress bar */}
            <div className="flex gap-1.5 mb-8">
              {([1,2,3,4,5,6] as Step[]).map(s => (
                <div key={s} className={`flex-1 h-1 rounded-full transition-all ${s <= step ? "bg-[#00D4FF]" : "bg-[#1E3A5F]"}`} />
              ))}
            </div>

            <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-8">
              <h1 className="text-2xl font-bold text-[#E2E8F0] mb-1">{STEP_LABELS[step]}</h1>
              <p className="text-[#64748B] text-sm mb-6">Step {step} of 6</p>

              {/* ── Step 1: Org details ── */}
              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Organisation name *</label>
                    <input value={form.name} onChange={e => update("name", e.target.value)} className={INPUT} placeholder="e.g. Horizon Support Services" />
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Organisation type *</label>
                    <select value={form.type} onChange={e => update("type", e.target.value)} className={INPUT}>
                      {ORG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* ── Step 2: Location ── */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">State</label>
                    <select value={form.state} onChange={e => update("state", e.target.value)} className={INPUT}>
                      <option value="">Select state…</option>
                      {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Timezone</label>
                    <select value={form.timezone} onChange={e => update("timezone", e.target.value)} className={INPUT}>
                      {AU_TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* ── Step 3: Contact & compliance ── */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Primary contact name</label>
                    <input value={form.primaryContactName} onChange={e => update("primaryContactName", e.target.value)} className={INPUT} placeholder="Full name" />
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Primary contact email</label>
                    <input type="email" value={form.primaryContactEmail} onChange={e => update("primaryContactEmail", e.target.value)} className={INPUT} placeholder="email@example.com" />
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">ABN</label>
                    <input value={form.abn} onChange={e => update("abn", e.target.value)} className={INPUT} placeholder="11 digits" />
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">NDIS registration number</label>
                    <input value={form.ndisRegistrationNumber} onChange={e => update("ndisRegistrationNumber", e.target.value)} className={INPUT} placeholder="Optional" />
                  </div>
                </div>
              )}

              {/* ── Step 4: AI Employee selection ── */}
              {step === 4 && (
                <div>
                  {/* Core — always included */}
                  <div className="flex items-center gap-3 mb-5 p-4 rounded-xl border border-[#00D4FF]/30 bg-[#00D4FF]/5">
                    <span className="text-2xl">⬡</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[#E2E8F0] font-semibold text-sm">Core Workforce</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#00D4FF]/10 text-[#00D4FF]">Always included</span>
                      </div>
                      <p className="text-[#64748B] text-xs mt-0.5">Your Chief of Staff and core AI specialists. Included with every plan.</p>
                    </div>
                    <span className="text-[#00D4FF] font-bold text-sm shrink-0">Free</span>
                  </div>

                  <p className="text-[#94A3B8] text-sm mb-4">Add specialist AI employees to your trial:</p>

                  {packsLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-36 rounded-xl bg-[#0B1829] border border-[#1E3A5F] animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {packs.filter(p => p.selectionMode !== "included").map(p => {
                        const color = p.colorHex ?? "#00D4FF";
                        const selected = form.selectedPacks.includes(p.code);
                        const isExpanded = expandedPack === p.code;
                        const priceLabel = (() => {
                          if (p.pricing.displayMode === "free") return "Free";
                          if (p.pricing.displayMode === "priced" && p.pricing.monthlyPriceCents != null)
                            return `A$${Math.round(p.pricing.monthlyPriceCents / 100).toLocaleString("en-AU")}/mo`;
                          if (p.pricing.displayMode === "coming_soon") return "Coming soon";
                          return "Contact us";
                        })();
                        return (
                          <div
                            key={p.code}
                            className="rounded-xl border transition-all"
                            style={{ borderColor: selected ? color : "#1E3A5F", background: selected ? `${color}08` : "#0B1829" }}
                          >
                            <div className="flex items-start gap-3 p-4">
                              <button
                                onClick={() => togglePack(p.code)}
                                className="flex items-start gap-3 flex-1 text-left"
                              >
                                <span className="text-xl shrink-0 mt-0.5">{p.iconEmoji ?? "📦"}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[#E2E8F0] font-semibold text-sm">{p.name}</span>
                                    {p.trialEligible && <span className="text-xs px-2 py-0.5 rounded-full bg-[#00D4FF]/10 text-[#00D4FF]">{p.trialLengthDays ?? 14}-day trial</span>}
                                  </div>
                                  <p className="text-[#64748B] text-xs mt-0.5 line-clamp-2">{p.marketingTagline ?? p.description}</p>
                                  <div className="flex items-center gap-3 mt-1">
                                    <span className="text-xs text-[#475569]">{p.specialistCount} AI employees</span>
                                    <span className="text-xs font-semibold" style={{ color }}>{priceLabel}</span>
                                  </div>
                                </div>
                              </button>
                              <div className="flex items-center gap-2 shrink-0">
                                {p.specialists && p.specialists.length > 0 && (
                                  <button
                                    onClick={() => setExpandedPack(isExpanded ? null : p.code)}
                                    className="text-xs text-[#64748B] hover:text-[#94A3B8] transition-colors"
                                  >
                                    {isExpanded ? "Hide ↑" : "Details ↓"}
                                  </button>
                                )}
                                <div
                                  onClick={() => togglePack(p.code)}
                                  className="h-5 w-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all"
                                  style={{ borderColor: selected ? color : "#1E3A5F", background: selected ? color : "transparent" }}
                                >
                                  {selected && <span className="text-[#0B1829] text-xs font-bold">✓</span>}
                                </div>
                              </div>
                            </div>
                            {/* Expanded specialist list */}
                            {isExpanded && p.specialists && (
                              <div className="px-4 pb-4 border-t border-[#1E3A5F]/50 pt-3 space-y-2">
                                <p className="text-[#64748B] text-xs uppercase tracking-wide mb-2">AI employees included</p>
                                {p.specialists.map(s => (
                                  <div key={s.code} className="flex items-start gap-2">
                                    <span className="text-sm">{s.icon ?? "🤖"}</span>
                                    <div>
                                      <span className="text-[#E2E8F0] text-xs font-medium">{s.displayName}</span>
                                      {s.description && <p className="text-[#64748B] text-xs">{s.description}</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {error && <p className="text-red-400 text-sm mt-4 bg-red-900/10 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>}
                </div>
              )}

              {/* ── Step 5: Plan selection ── */}
              {step === 5 && (
                <div>
                  {plansLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[...Array(4)].map((_, i) => <div key={i} className="h-48 rounded-xl bg-[#0B1829] border border-[#1E3A5F] animate-pulse" />)}
                    </div>
                  ) : (
                    <>
                      {/* Billing cycle toggle */}
                      <div className="flex gap-2 mb-5 p-1 bg-[#0B1829] rounded-lg border border-[#1E3A5F] w-fit">
                        {(["monthly", "annual"] as const).map(cycle => (
                          <button
                            key={cycle}
                            onClick={() => update("billingCycle", cycle)}
                            className="px-4 py-1.5 rounded-md text-sm font-medium transition-all"
                            style={{
                              background: form.billingCycle === cycle ? "#00D4FF" : "transparent",
                              color: form.billingCycle === cycle ? "#0B1829" : "#64748B",
                            }}
                          >
                            {cycle === "monthly" ? "Monthly" : "Annual (save 20%)"}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* If no plans in DB, show fallback plan cards */}
                        {(plans.length > 0 ? plans : [
                          { id: "foundation", code: "foundation", name: "Foundation", description: "Start your AI journey", monthlyPriceCents: 0, annualPriceCents: 0, featureBullets: null, displayOrder: 1, isActive: true },
                          { id: "professional", code: "professional", name: "Professional", description: "For growing teams", monthlyPriceCents: 29900, annualPriceCents: 28700, featureBullets: null, displayOrder: 2, isActive: true },
                          { id: "business", code: "business", name: "Business", description: "For larger operations", monthlyPriceCents: 79900, annualPriceCents: 76700, featureBullets: null, displayOrder: 3, isActive: true },
                          { id: "enterprise", code: "enterprise", name: "Enterprise", description: "Tailored for your needs", monthlyPriceCents: null, annualPriceCents: null, featureBullets: null, displayOrder: 4, isActive: true },
                        ] as Plan[]).map(plan => {
                          const selected = form.selectedPlanCode === plan.code;
                          const color = PLAN_COLOURS[plan.code] ?? "#64748B";
                          const priceCents = form.billingCycle === "annual" ? plan.annualPriceCents : plan.monthlyPriceCents;
                          const priceLabel = plan.code === "enterprise"
                            ? "Contact us"
                            : priceCents === 0 || priceCents === null && plan.code === "foundation"
                            ? "Free trial"
                            : priceCents == null
                            ? "Contact us"
                            : `A$${Math.round(priceCents / 100)}/mo`;
                          const bullets: string[] = (() => {
                            try { return JSON.parse(plan.featureBullets ?? "[]"); } catch { return PLAN_FEATURES[plan.code] ?? []; }
                          })();

                          return (
                            <button
                              key={plan.code}
                              onClick={() => {
                                if (plan.code !== "enterprise") update("selectedPlanCode", plan.code);
                              }}
                              disabled={plan.code === "enterprise"}
                              className="text-left rounded-xl border p-4 transition-all disabled:opacity-60"
                              style={{ borderColor: selected ? color : "#1E3A5F", background: selected ? `${color}10` : "#0B1829" }}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[#E2E8F0] font-bold text-sm">{plan.name}</span>
                                <div
                                  className="h-4 w-4 rounded-full border-2 flex items-center justify-center transition-all"
                                  style={{ borderColor: selected ? color : "#1E3A5F", background: selected ? color : "transparent" }}
                                >
                                  {selected && <span className="text-[#0B1829] text-[8px] font-bold">✓</span>}
                                </div>
                              </div>
                              <div className="text-xl font-bold mb-2" style={{ color }}>{priceLabel}</div>
                              {plan.description && <p className="text-[#64748B] text-xs mb-3">{plan.description}</p>}
                              <ul className="space-y-1">
                                {(bullets.length > 0 ? bullets : PLAN_FEATURES[plan.code] ?? []).slice(0, 4).map((f, i) => (
                                  <li key={i} className="text-xs text-[#94A3B8] flex items-center gap-1.5">
                                    <span style={{ color }}>✓</span> {f}
                                  </li>
                                ))}
                              </ul>
                              {plan.code === "enterprise" && (
                                <p className="text-xs text-[#64748B] mt-2">Call us to configure Enterprise</p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Step 6: Review & activate ── */}
              {step === 6 && (
                <div className="space-y-5">
                  {/* Order summary */}
                  <div className="bg-[#0B1829] rounded-xl border border-[#1E3A5F] p-4 space-y-3">
                    <h3 className="text-[#E2E8F0] font-semibold text-sm">Order summary</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-[#64748B]">Company</span>
                        <span className="text-[#E2E8F0]">{form.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#64748B]">Plan</span>
                        <span className="text-[#E2E8F0] capitalize">{form.selectedPlanCode}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#64748B]">Billing</span>
                        <span className="text-[#E2E8F0] capitalize">{form.billingCycle}</span>
                      </div>
                      {form.selectedPacks.length > 0 && (
                        <div className="flex justify-between">
                          <span className="text-[#64748B]">AI employee packs</span>
                          <span className="text-[#E2E8F0]">{form.selectedPacks.length} selected + Core</span>
                        </div>
                      )}
                      <div className="flex justify-between pt-2 border-t border-[#1E3A5F]">
                        <span className="text-[#E2E8F0] font-medium">Today's charge</span>
                        <span className="text-[#00D4FF] font-bold">
                          {form.selectedPlanCode === "foundation" ? "Free — 14-day trial" : "A$0 — trial included"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Terms */}
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.termsAccepted}
                      onChange={e => update("termsAccepted", e.target.checked)}
                      className="mt-0.5 accent-[#00D4FF]"
                    />
                    <span className="text-[#64748B] text-sm">
                      I agree to the{" "}
                      <a href="#" className="text-[#00D4FF] hover:underline">Terms of Service</a>
                      {" "}and{" "}
                      <a href="#" className="text-[#00D4FF] hover:underline">Privacy Policy</a>
                    </span>
                  </label>

                  {/* Payment bypass button */}
                  {bypassEnabled ? (
                    <div className="border border-amber-500/30 bg-amber-900/10 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-amber-400 text-sm font-bold">⚠️ DEVELOPMENT MODE</span>
                      </div>
                      <p className="text-amber-400/80 text-xs mb-3">
                        Payment provider not yet configured. Use the bypass below to test the full onboarding flow.
                        This will not charge your card.
                      </p>
                      <button
                        onClick={handlePaymentBypass}
                        disabled={submitting || !form.termsAccepted}
                        className="w-full py-3 bg-amber-500 text-[#0B1829] font-bold rounded-lg hover:bg-amber-400 disabled:opacity-50 transition-colors text-sm"
                      >
                        {submitting ? "Activating…" : "Mark as paid and continue →"}
                      </button>
                    </div>
                  ) : (
                    <div className="border border-[#1E3A5F] bg-[#0B1829] rounded-xl p-4 text-center">
                      <p className="text-[#64748B] text-sm">Payment not yet available in this build.</p>
                      <p className="text-[#475569] text-xs mt-1">Contact support to activate your account.</p>
                    </div>
                  )}

                  {error && <p className="text-red-400 text-sm bg-red-900/10 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>}
                </div>
              )}

              {/* Navigation */}
              <div className="flex gap-3 mt-8">
                {step > 1 && !paymentSuccess && (
                  <button
                    onClick={() => setStep(s => (s - 1) as Step)}
                    className="px-5 py-2.5 border border-[#1E3A5F] text-[#94A3B8] rounded-lg hover:border-[#00D4FF] transition-colors text-sm"
                  >
                    ← Back
                  </button>
                )}
                <div className="flex-1" />
                {step < 6 && (
                  <button
                    onClick={handleNext}
                    disabled={!canAdvance() || submitting}
                    className="px-6 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg hover:bg-[#00B8D9] disabled:opacity-40 transition-colors text-sm"
                  >
                    {submitting ? "Creating…" : step === 4 ? "Continue →" : "Continue →"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}
