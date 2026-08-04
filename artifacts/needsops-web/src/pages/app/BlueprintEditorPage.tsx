/**
 * Blueprint Editor — /app/:slug/blueprints/new  (create)
 *                    /app/:slug/blueprints/:id/edit  (edit)
 *
 * Sprint 28. Form for creating or editing org blueprints.
 * Built-in blueprints are read-only and cannot be edited here.
 */

import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show }    from "@clerk/react";
import { Redirect } from "wouter";
import AppShell    from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

const OUTPUT_TYPES = [
  "incident_investigation", "risk_assessment", "behaviour_support_plan", "care_plan",
  "meeting_minutes", "operational_procedure", "policy_draft", "executive_brief",
  "investigation_report", "performance_review", "project_plan", "action_plan",
  "customer_response", "business_proposal", "custom",
];

const SPECIALISTS = [
  "chief_of_staff", "executive_assistant", "operations_manager",
  "compliance_quality_manager", "incident_safeguarding_specialist",
  "knowledge_documentation_specialist", "policy_governance_specialist",
  "workforce_compliance_specialist", "finance_officer",
];

const KNOWLEDGE_TYPES = [
  "policy", "procedure", "legislation", "standards", "template", "style_guide",
  "care_plan", "risk_assessment", "behaviour_support_plan", "hr_manual",
  "communication_guide", "style_guide",
];

interface FormState {
  code: string;
  title: string;
  version: string;
  objective: string;
  primarySpecialist: string;
  supportingSpecialists: string;
  requiredLibraryKnowledge: string;
  requiredMemories: string;
  successCriteria: string;
  outputTypes: string[];
  mandatoryCitations: string;
}

export default function BlueprintEditorPage() {
  const { slug, id } = useParams<{ slug: string; id?: string }>();
  const isEdit = !!id && id !== "new";
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>({
    code: "",
    title: "",
    version: "1.0.0",
    objective: "",
    primarySpecialist: "chief_of_staff",
    supportingSpecialists: "",
    requiredLibraryKnowledge: "",
    requiredMemories: "",
    successCriteria: "",
    outputTypes: [],
    mandatoryCitations: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved]   = useState(false);

  const { data: existingData } = useQuery({
    queryKey: ["blueprint", slug, id],
    queryFn: () =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}`).then(r => r.json()),
    enabled: isEdit,
  });

  useEffect(() => {
    const bp = existingData?.blueprint;
    if (!bp) return;
    if (bp.isBuiltIn) {
      setLocation(`/app/${slug}/blueprints/${id}`);
      return;
    }
    setForm({
      code: bp.code,
      title: bp.title,
      version: bp.version,
      objective: bp.objective,
      primarySpecialist: bp.primarySpecialist,
      supportingSpecialists: (bp.supportingSpecialists ?? []).join(", "),
      requiredLibraryKnowledge: (bp.requiredLibraryKnowledge ?? []).join(", "),
      requiredMemories: (bp.requiredMemories ?? []).join(", "),
      successCriteria: (bp.successCriteria ?? []).join("\n"),
      outputTypes: bp.outputTypes ?? [],
      mandatoryCitations: (bp.mandatoryCitations ?? []).join(", "),
    });
  }, [existingData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code.trim().replace(/\s+/g, "_").toLowerCase(),
        title: form.title.trim(),
        version: form.version.trim(),
        objective: form.objective.trim(),
        primarySpecialist: form.primarySpecialist,
        supportingSpecialists: form.supportingSpecialists.split(",").map(s => s.trim()).filter(Boolean),
        requiredLibraryKnowledge: form.requiredLibraryKnowledge.split(",").map(s => s.trim()).filter(Boolean),
        requiredMemories: form.requiredMemories.split(",").map(s => s.trim()).filter(Boolean),
        successCriteria: form.successCriteria.split("\n").map(s => s.trim()).filter(Boolean),
        outputTypes: form.outputTypes,
        mandatoryCitations: form.mandatoryCitations.split(",").map(s => s.trim()).filter(Boolean),
      };

      if (isEdit) {
        return apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(r => r.json());
      } else {
        return apiFetch(`/v1/organisations/${slug}/work-blueprints`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(r => r.json());
      }
    },
    onSuccess: (data) => {
      setError(null);
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["blueprints", slug] });
      const bpId = data?.blueprint?.id ?? id;
      setTimeout(() => setLocation(`/app/${slug}/blueprints/${bpId}`), 800);
    },
    onError: (e: any) => setError(e?.message ?? "Save failed"),
  });

  const set = (k: keyof FormState, v: string | string[]) => setForm(f => ({ ...f, [k]: v }));
  const toggleOutput = (t: string) => {
    set("outputTypes", form.outputTypes.includes(t)
      ? form.outputTypes.filter(x => x !== t)
      : [...form.outputTypes, t]);
  };

  const canSave = form.title && form.code && form.objective && form.primarySpecialist;

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug}>
        <div className="p-6 max-w-3xl mx-auto">

          {/* Back */}
          <button
            onClick={() => setLocation(isEdit ? `/app/${slug}/blueprints/${id}` : `/app/${slug}/blueprints`)}
            className="flex items-center gap-1.5 text-[#64748B] text-sm hover:text-[#E2E8F0] mb-5 transition-colors"
          >
            ← {isEdit ? "Blueprint Detail" : "Blueprint Studio"}
          </button>

          <h1 className="text-2xl font-bold text-[#E2E8F0] mb-6">
            {isEdit ? "Edit Blueprint" : "New Blueprint"}
          </h1>

          <div className="space-y-5">

            {/* Identity */}
            <Card title="Identity">
              <Field label="Blueprint Code" required>
                <input
                  value={form.code}
                  onChange={e => set("code", e.target.value)}
                  placeholder="e.g. incident_investigation"
                  className={input}
                />
                <p className="text-[#64748B] text-xs mt-1">Lowercase, underscores only. Unique per org.</p>
              </Field>
              <Field label="Title" required>
                <input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Incident Investigation" className={input} />
              </Field>
              <Field label="Version">
                <input value={form.version} onChange={e => set("version", e.target.value)} placeholder="1.0.0" className={input} />
              </Field>
            </Card>

            {/* Objective */}
            <Card title="Objective">
              <Field label="What must the specialist achieve?" required>
                <textarea
                  value={form.objective}
                  onChange={e => set("objective", e.target.value)}
                  rows={4}
                  placeholder="Describe the goal of this blueprint in detail…"
                  className={`${input} resize-none`}
                />
              </Field>
            </Card>

            {/* Specialists */}
            <Card title="Specialist Assignment">
              <Field label="Primary Specialist" required>
                <select value={form.primarySpecialist} onChange={e => set("primarySpecialist", e.target.value)} className={input}>
                  {SPECIALISTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Supporting Specialists">
                <input
                  value={form.supportingSpecialists}
                  onChange={e => set("supportingSpecialists", e.target.value)}
                  placeholder="comma-separated specialist codes"
                  className={input}
                />
              </Field>
            </Card>

            {/* Knowledge */}
            <Card title="Knowledge Requirements">
              <Field label="Required Library Knowledge">
                <input
                  value={form.requiredLibraryKnowledge}
                  onChange={e => set("requiredLibraryKnowledge", e.target.value)}
                  placeholder="policy, procedure, legislation"
                  className={input}
                />
              </Field>
              <Field label="Required Memory Types">
                <input
                  value={form.requiredMemories}
                  onChange={e => set("requiredMemories", e.target.value)}
                  placeholder="operating_preference, terminology"
                  className={input}
                />
              </Field>
              <Field label="Mandatory Citations">
                <input
                  value={form.mandatoryCitations}
                  onChange={e => set("mandatoryCitations", e.target.value)}
                  placeholder="legislation, policy"
                  className={input}
                />
              </Field>
            </Card>

            {/* Success criteria */}
            <Card title="Success Criteria">
              <Field label="One criterion per line">
                <textarea
                  value={form.successCriteria}
                  onChange={e => set("successCriteria", e.target.value)}
                  rows={4}
                  placeholder={"Root cause identified\nCorrective actions recommended"}
                  className={`${input} resize-none`}
                />
              </Field>
            </Card>

            {/* Output types */}
            <Card title="Output Types">
              <div className="flex flex-wrap gap-2">
                {OUTPUT_TYPES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleOutput(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                      form.outputTypes.includes(t)
                        ? "bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40"
                        : "bg-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0]"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Card>

            {/* Actions */}
            {error && (
              <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-3 text-red-300 text-sm">{error}</div>
            )}
            {saved && (
              <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-xl p-3 text-emerald-300 text-sm">
                Saved! Redirecting…
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!canSave || saveMutation.isPending}
                className="px-5 py-2.5 bg-[#00D4FF] text-[#0B1829] rounded-lg font-semibold text-sm disabled:opacity-50 hover:bg-[#00D4FF]/90 transition-colors"
              >
                {saveMutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Blueprint"}
              </button>
              <button
                onClick={() => setLocation(isEdit ? `/app/${slug}/blueprints/${id}` : `/app/${slug}/blueprints`)}
                className="px-5 py-2.5 bg-[#1E3A5F] text-[#E2E8F0] rounded-lg text-sm hover:bg-[#1E3A5F]/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    </>
  );
}

const input = "w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 space-y-4">
      <h2 className="text-xs uppercase tracking-widest text-[#64748B]/60 font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[#94A3B8] text-xs font-medium">
        {label}{required && <span className="text-red-400 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
