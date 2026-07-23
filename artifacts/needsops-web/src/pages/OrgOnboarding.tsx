import { useState } from "react";
import { useLocation } from "wouter";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import { useAuthFetch } from "@/lib/api";

type Step = 1 | 2 | 3;

interface FormData {
  name: string; type: string; industry: string;
  country: string; state: string; timezone: string;
  primaryContactName: string; primaryContactEmail: string;
  abn: string; ndisRegistrationNumber: string;
}

const AU_STATES = ["ACT","NSW","NT","QLD","SA","TAS","VIC","WA"];
const AU_TIMEZONES = ["Australia/Sydney","Australia/Melbourne","Australia/Brisbane","Australia/Perth","Australia/Adelaide","Australia/Darwin","Australia/Hobart"];
const ORG_TYPES = [
  { value: "ndis_provider", label: "NDIS Provider" },
  { value: "disability_services", label: "Disability Services" },
  { value: "aged_care", label: "Aged Care" },
  { value: "healthcare", label: "Healthcare" },
  { value: "other", label: "Other" },
];

export default function OrgOnboarding() {
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>({
    name: "", type: "ndis_provider", industry: "",
    country: "AU", state: "", timezone: "Australia/Sydney",
    primaryContactName: "", primaryContactEmail: "",
    abn: "", ndisRegistrationNumber: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const update = (k: keyof FormData, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    setSubmitting(true); setError("");
    try {
      const res = await apiFetch("/v1/organisations", {
        method: "POST",
        body: JSON.stringify({ ...form, industry: form.type }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message ?? "Failed to create organisation"); return; }
      setLocation(`/app/${data.organisation.slug}`);
    } catch { setError("Network error. Please try again."); }
    finally { setSubmitting(false); }
  };

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <Show when="signed-in">
        <div className="min-h-dvh bg-[#0B1829] flex flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-lg">
            {/* Progress */}
            <div className="flex gap-2 mb-8">
              {([1,2,3] as Step[]).map(s => (
                <div key={s} className={`flex-1 h-1 rounded-full ${s <= step ? "bg-[#00D4FF]" : "bg-[#1E3A5F]"}`}/>
              ))}
            </div>
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-8">
              <h1 className="text-2xl font-bold text-[#E2E8F0] mb-1">
                {step === 1 ? "Organisation details" : step === 2 ? "Location" : "Contact & compliance"}
              </h1>
              <p className="text-[#64748B] text-sm mb-6">Step {step} of 3</p>

              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Organisation name *</label>
                    <input value={form.name} onChange={e=>update("name",e.target.value)} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm" placeholder="e.g. Horizon Support Services"/>
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Organisation type *</label>
                    <select value={form.type} onChange={e=>update("type",e.target.value)} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm">
                      {ORG_TYPES.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Country</label>
                    <input value="Australia" readOnly className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#64748B] text-sm cursor-not-allowed"/>
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">State / Territory *</label>
                    <select value={form.state} onChange={e=>update("state",e.target.value)} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm">
                      <option value="">Select state...</option>
                      {AU_STATES.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Timezone</label>
                    <select value={form.timezone} onChange={e=>update("timezone",e.target.value)} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm">
                      {AU_TIMEZONES.map(t=><option key={t} value={t}>{t.replace("Australia/","")}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Contact name</label>
                    <input value={form.primaryContactName} onChange={e=>update("primaryContactName",e.target.value)} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm" placeholder="Jane Smith"/>
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Contact email</label>
                    <input type="email" value={form.primaryContactEmail} onChange={e=>update("primaryContactEmail",e.target.value)} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm" placeholder="jane@org.com.au"/>
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">ABN <span className="text-[#64748B]">(optional)</span></label>
                    <input value={form.abn} onChange={e=>update("abn",e.target.value)} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm" placeholder="12 345 678 901"/>
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">NDIS registration number <span className="text-[#64748B]">(optional)</span></label>
                    <input value={form.ndisRegistrationNumber} onChange={e=>update("ndisRegistrationNumber",e.target.value)} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] focus:outline-none focus:border-[#00D4FF] text-sm" placeholder="4050000000"/>
                  </div>
                  {error && <p className="text-red-400 text-sm">{error}</p>}
                </div>
              )}

              <div className="flex gap-3 mt-8">
                {step > 1 && (
                  <button onClick={()=>setStep(s=>(s-1) as Step)} className="flex-1 px-4 py-2.5 border border-[#1E3A5F] text-[#E2E8F0] rounded-lg hover:border-[#00D4FF] transition-colors text-sm">Back</button>
                )}
                {step < 3 ? (
                  <button onClick={()=>{if(step===1&&!form.name.trim()){setError("Name required");return;}setError("");setStep(s=>(s+1) as Step);}} className="flex-1 px-4 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg hover:bg-[#00B8D9] transition-colors text-sm">Continue</button>
                ) : (
                  <button onClick={handleSubmit} disabled={submitting} className="flex-1 px-4 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg hover:bg-[#00B8D9] transition-colors text-sm disabled:opacity-50">{submitting ? "Creating..." : "Create Organisation"}</button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}
