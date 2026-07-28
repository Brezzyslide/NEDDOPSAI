/**
 * Org Onboarding — Sprint 9.6
 * 4-step wizard: org details → location → contact/compliance → choose workforce packs
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import { useAuthFetch } from "@/lib/api";

type Step = 1 | 2 | 3 | 4;

interface FormData {
  name: string; type: string; industry: string;
  country: string; state: string; timezone: string;
  primaryContactName: string; primaryContactEmail: string;
  abn: string; ndisRegistrationNumber: string;
  selectedPacks: string[];
}

interface PackPricing {
  isFree: boolean;
  currency?: string;
  monthlyPriceCents?: number;
  displayMode: "free" | "priced" | "contact_sales" | "coming_soon";
  fallbackText?: string;
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
  pricing: PackPricing;
}

const AU_STATES = ["ACT","NSW","NT","QLD","SA","TAS","VIC","WA"];
const AU_TIMEZONES = ["Australia/Sydney","Australia/Melbourne","Australia/Brisbane","Australia/Perth","Australia/Adelaide","Australia/Darwin","Australia/Hobart"];
const ORG_TYPES = [
  { value: "ndis_provider",       label: "NDIS Provider" },
  { value: "disability_services", label: "Disability Services" },
  { value: "aged_care",           label: "Aged Care" },
  { value: "healthcare",          label: "Healthcare" },
  { value: "other",               label: "Other" },
];

const STEP_LABELS: Record<Step, string> = {
  1: "Organisation details",
  2: "Location",
  3: "Contact & compliance",
  4: "Choose your workforce",
};

const INPUT = "w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm transition-colors";

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
  });
  const [packs, setPacks] = useState<Pack[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const update = (k: keyof FormData, v: any) => setForm(f => ({ ...f, [k]: v }));

  // Load packs when user reaches step 4
  useEffect(() => {
    if (step === 4 && packs.length === 0) {
      setPacksLoading(true);
      fetch("/v1/workforce-packs?status=available")
        .then(r => r.json())
        .then(d => {
          const available: Pack[] = (d.packs ?? []).filter((p: Pack) => p.code !== "core");
          setPacks(available);
          // Pre-select featured packs
          const preSelected = available.filter(p => p.featured).map(p => p.code);
          setForm(f => ({ ...f, selectedPacks: preSelected }));
        })
        .catch(() => setPacks([]))
        .finally(() => setPacksLoading(false));
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

  const handleSubmit = async () => {
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
      if (!res.ok) { setError(data.error?.message ?? "Failed to create organisation"); return; }
      setLocation(`/app/${data.organisation.slug}`);
    } catch { setError("Network error. Please try again."); }
    finally { setSubmitting(false); }
  };

  const canAdvance = (): boolean => {
    if (step === 1) return !!form.name.trim() && !!form.type;
    if (step === 2) return !!form.state && !!form.timezone;
    if (step === 3) return true;
    return true;
  };

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <Show when="signed-in">
        <div className="min-h-dvh bg-[#0B1829] flex flex-col items-center justify-center px-4 py-12">
          <div className={`w-full ${step === 4 ? "max-w-3xl" : "max-w-lg"}`}>
            {/* Progress */}
            <div className="flex gap-2 mb-8">
              {([1,2,3,4] as Step[]).map(s => (
                <div key={s} className={`flex-1 h-1 rounded-full transition-all ${s <= step ? "bg-[#00D4FF]" : "bg-[#1E3A5F]"}`} />
              ))}
            </div>

            <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-8">
              <h1 className="text-2xl font-bold text-[#E2E8F0] mb-1">{STEP_LABELS[step]}</h1>
              <p className="text-[#64748B] text-sm mb-6">Step {step} of 4</p>

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

              {/* ── Step 3: Contact ── */}
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

              {/* ── Step 4: Pack Picker ── */}
              {step === 4 && (
                <div>
                  {/* Core pack — always included */}
                  <div className="flex items-center gap-3 mb-5 p-4 rounded-xl border border-[#00D4FF]/30 bg-[#00D4FF]/5">
                    <span className="text-2xl">⬡</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[#E2E8F0] font-semibold text-sm">Core Workforce</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#00D4FF]/10 text-[#00D4FF]">Always included</span>
                      </div>
                      <p className="text-[#64748B] text-xs mt-0.5">Your Chief of Staff and core AI specialists. Free with every plan.</p>
                    </div>
                    <span className="text-[#00D4FF] font-bold text-sm">Free</span>
                  </div>

                  <p className="text-[#94A3B8] text-sm mb-4">Add specialist workforce packs to your trial:</p>

                  {packsLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-28 rounded-xl bg-[#0B1829] border border-[#1E3A5F] animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {packs.filter(p => p.selectionMode !== "included" && p.publiclySelectable !== false).map(p => {
                        const color = p.colorHex ?? "#00D4FF";
                        const selected = form.selectedPacks.includes(p.code);
                        const pricing = p.pricing;
                        const priceLabel = (() => {
                          if (pricing.displayMode === "free") return "Free";
                          if (pricing.displayMode === "priced" && pricing.monthlyPriceCents != null) {
                            const amt = `A$${Math.round(pricing.monthlyPriceCents / 100).toLocaleString("en-AU")}`;
                            return p.trialEligible ? `${amt}/month after trial` : `${amt}/month`;
                          }
                          if (pricing.displayMode === "coming_soon") return "Coming soon";
                          return "Contact NeedsOps for pricing";
                        })();
                        const selectionLabel = p.trialEligible ? `${p.trialLengthDays ?? 14}-day free trial` : p.selectionMode === "requested" ? "Request access" : "Select";
                        return (
                          <button
                            key={p.code}
                            onClick={() => togglePack(p.code)}
                            className="text-left rounded-xl border p-4 transition-all"
                            style={{
                              borderColor: selected ? color : "#1E3A5F",
                              background: selected ? `${color}08` : "#0B1829",
                            }}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xl">{p.iconEmoji ?? "📦"}</span>
                                <span className="text-[#E2E8F0] font-semibold text-sm">{p.name}</span>
                              </div>
                              <div
                                className="h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all"
                                style={{ borderColor: selected ? color : "#1E3A5F", background: selected ? color : "transparent" }}
                              >
                                {selected && <span className="text-[#0B1829] text-xs font-bold">✓</span>}
                              </div>
                            </div>
                            <p className="text-[#64748B] text-xs leading-snug mb-2">{p.marketingTagline ?? p.description}</p>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-[#475569]">{p.specialistCount} specialists</span>
                              <div className="text-right">
                                <div className="text-xs font-semibold" style={{ color }}>{priceLabel}</div>
                                {p.trialEligible && selected && (
                                  <div className="text-xs text-[#475569]">{selectionLabel}</div>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {form.selectedPacks.length > 0 && (
                    <p className="text-[#64748B] text-xs mt-4 text-center">
                      {form.selectedPacks.length} pack{form.selectedPacks.length !== 1 ? "s" : ""} selected — you can change this any time in your portal.
                    </p>
                  )}

                  {error && (
                    <p className="text-red-400 text-sm mt-4 bg-red-900/10 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>
                  )}
                </div>
              )}

              {/* Navigation */}
              <div className="flex gap-3 mt-8">
                {step > 1 && (
                  <button
                    onClick={() => setStep(s => (s - 1) as Step)}
                    className="px-5 py-2.5 border border-[#1E3A5F] text-[#94A3B8] rounded-lg hover:border-[#00D4FF] transition-colors text-sm"
                  >
                    ← Back
                  </button>
                )}
                <div className="flex-1" />
                {step < 4 ? (
                  <button
                    onClick={() => setStep(s => (s + 1) as Step)}
                    disabled={!canAdvance()}
                    className="px-6 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg hover:bg-[#00B8D9] disabled:opacity-40 transition-colors text-sm"
                  >
                    Continue →
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="px-6 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg hover:bg-[#00B8D9] disabled:opacity-50 transition-colors text-sm"
                  >
                    {submitting ? "Creating…" : "Create Organisation →"}
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
