/**
 * Blueprint Test (Sandbox) — /app/:slug/blueprints/:id/test
 *
 * Sprint 28. Dry-run a blueprint against a sample task request.
 * Does NOT create completed work. Does NOT dispatch specialists permanently.
 * Shows: selected specialist, validation outcome, missing assets, expected outputs.
 */

import { useState }             from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Show }    from "@clerk/react";
import { Redirect } from "wouter";
import AppShell    from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

interface SandboxResult {
  blueprintId: string;
  blueprintTitle: string;
  blueprintCode: string;
  selectedSpecialist: string;
  supportingSpecialists: string[];
  validationOutcome: "passed" | "failed" | "warnings";
  validationIssues: Array<{ rule: string; level: "error" | "warning"; message: string }>;
  missingAssets: string[];
  expectedOutputs: string[];
  knowledgeRequired: string[];
  successCriteria: string[];
  sandboxOnly: true;
}

const OUTCOME_STYLE = {
  passed:   { bg: "bg-emerald-900/20", border: "border-emerald-800/40", text: "text-emerald-300", label: "✓ Validation Passed" },
  warnings: { bg: "bg-amber-900/20",   border: "border-amber-800/40",   text: "text-amber-300",   label: "⚠ Passed with Warnings" },
  failed:   { bg: "bg-red-900/20",     border: "border-red-800/40",     text: "text-red-300",     label: "✗ Validation Failed" },
};

const DOC_TYPES = [
  "policy", "procedure", "legislation", "template", "context",
  "participant_info", "staff_info", "risk_assessment",
];

export default function BlueprintTestPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();

  const [testRequest, setTestRequest]         = useState("");
  const [selectedDocs, setSelectedDocs]       = useState<string[]>([]);
  const [result, setResult]                   = useState<SandboxResult | null>(null);
  const [apiError, setApiError]               = useState<string | null>(null);

  const { data: bpData } = useQuery({
    queryKey: ["blueprint", slug, id],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}`).then(r => r.json()),
    enabled: !!slug && !!id,
  });
  const bp = bpData?.blueprint;

  const testMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/organisations/${slug}/work-blueprints/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testRequest,
          uploadedDocumentTypes: selectedDocs,
        }),
      }).then(async r => {
        if (!r.ok) { const e = await r.json(); throw new Error(e?.error ?? "Test failed"); }
        return r.json() as Promise<SandboxResult>;
      }),
    onSuccess: (data) => { setResult(data); setApiError(null); },
    onError: (e: any) => setApiError(e?.message ?? "Test failed"),
  });

  const toggleDoc = (t: string) =>
    setSelectedDocs(d => d.includes(t) ? d.filter(x => x !== t) : [...d, t]);

  const outcome = result ? OUTCOME_STYLE[result.validationOutcome] : null;

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug}>
        <div className="p-6 max-w-4xl mx-auto">

          <button
            onClick={() => setLocation(`/app/${slug}/blueprints/${id}`)}
            className="flex items-center gap-1.5 text-[#64748B] text-sm hover:text-[#E2E8F0] mb-5 transition-colors"
          >
            ← {bp?.title ?? "Blueprint"}
          </button>

          <div className="flex items-center gap-3 mb-6">
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Blueprint Test</h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300 font-semibold">Sandbox Only</span>
          </div>

          <p className="text-[#64748B] text-sm mb-6">
            Test this blueprint against a sample task request. No work will be created or dispatched.
            The result shows exactly how the execution engine would respond.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">

            {/* Input panel */}
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 space-y-4">
              <h2 className="text-xs uppercase tracking-widest text-[#64748B]/60 font-semibold">Sample Task Request</h2>

              <div className="space-y-1.5">
                <label className="text-[#94A3B8] text-xs font-medium">Describe the work task</label>
                <textarea
                  value={testRequest}
                  onChange={e => setTestRequest(e.target.value)}
                  rows={6}
                  placeholder="e.g. Investigate the incident that occurred on 15 January involving a participant fall in the bathroom. Identify root causes and recommend corrective actions."
                  className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF] resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[#94A3B8] text-xs font-medium">Simulate uploaded documents</label>
                <div className="flex flex-wrap gap-2">
                  {DOC_TYPES.map(t => (
                    <button
                      key={t}
                      onClick={() => toggleDoc(t)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors ${
                        selectedDocs.includes(t)
                          ? "bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40"
                          : "bg-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0]"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {apiError && (
                <div className="bg-red-900/20 border border-red-800/40 rounded-lg p-3 text-red-300 text-xs">{apiError}</div>
              )}

              <button
                onClick={() => testMutation.mutate()}
                disabled={!testRequest.trim() || testMutation.isPending}
                className="w-full py-2.5 bg-[#00D4FF] text-[#0B1829] rounded-lg font-semibold text-sm disabled:opacity-50 hover:bg-[#00D4FF]/90 transition-colors"
              >
                {testMutation.isPending ? "Running sandbox…" : "Run Sandbox Test"}
              </button>
            </div>

            {/* Blueprint summary */}
            {bp && (
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 space-y-3">
                <h2 className="text-xs uppercase tracking-widest text-[#64748B]/60 font-semibold">Blueprint</h2>
                <p className="text-[#E2E8F0] font-semibold">{bp.title}</p>
                <p className="text-[#64748B] text-xs">{bp.objective}</p>
                <div className="space-y-1.5 pt-2 border-t border-[#1E3A5F]">
                  <SmallRow label="Primary Specialist" value={bp.primarySpecialist} />
                  <SmallRow label="Output Types" value={(bp.outputTypes ?? []).join(", ") || "—"} />
                  <SmallRow label="Required Knowledge" value={(bp.requiredLibraryKnowledge ?? []).join(", ") || "—"} />
                  <SmallRow label="Validation Rules" value={`${(bp.validationRules ?? []).length} rules`} />
                </div>
              </div>
            )}
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-4">
              <div className={`${outcome!.bg} border ${outcome!.border} rounded-xl p-4`}>
                <p className={`font-bold ${outcome!.text} text-base`}>{outcome!.label}</p>
                <p className="text-[#64748B] text-xs mt-1">Blueprint: {result.blueprintTitle}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                <ResultSection title="Specialist Assignment">
                  <SmallRow label="Primary" value={result.selectedSpecialist} />
                  {result.supportingSpecialists.length > 0 && (
                    <SmallRow label="Supporting" value={result.supportingSpecialists.join(", ")} />
                  )}
                </ResultSection>

                <ResultSection title="Expected Outputs">
                  {result.expectedOutputs.length > 0
                    ? result.expectedOutputs.map(o => <Tag key={o}>{o}</Tag>)
                    : <span className="text-[#64748B] text-xs">None defined</span>}
                </ResultSection>

                <ResultSection title="Validation Issues">
                  {result.validationIssues.length === 0 && (
                    <p className="text-emerald-300 text-xs">No issues — all rules passed.</p>
                  )}
                  {result.validationIssues.map((issue, i) => (
                    <div key={i} className={`flex gap-2 text-xs ${issue.level === "error" ? "text-red-300" : "text-amber-300"}`}>
                      <span>{issue.level === "error" ? "✗" : "⚠"}</span>
                      <div>
                        <p className="font-mono">{issue.rule}</p>
                        <p className="text-[#64748B]">{issue.message}</p>
                      </div>
                    </div>
                  ))}
                </ResultSection>

                <ResultSection title="Missing Assets">
                  {result.missingAssets.length === 0
                    ? <p className="text-emerald-300 text-xs">No missing assets.</p>
                    : result.missingAssets.map((a, i) => (
                        <p key={i} className="text-red-300 text-xs flex gap-2"><span>✗</span>{a}</p>
                      ))}
                </ResultSection>

                <ResultSection title="Knowledge Required">
                  {result.knowledgeRequired.length > 0
                    ? result.knowledgeRequired.map(k => <Tag key={k}>{k}</Tag>)
                    : <span className="text-[#64748B] text-xs">None specified</span>}
                </ResultSection>

                <ResultSection title="Success Criteria">
                  {result.successCriteria.map((c, i) => (
                    <p key={i} className="text-[#E2E8F0] text-xs flex gap-2"><span className="text-emerald-400">✓</span>{c}</p>
                  ))}
                </ResultSection>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}

function ResultSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 space-y-2">
      <h3 className="text-xs uppercase tracking-widest text-[#64748B]/60 font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function SmallRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-[#64748B] shrink-0">{label}</span>
      <span className="text-[#E2E8F0] font-mono text-right">{value}</span>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block bg-[#1E3A5F] text-[#94A3B8] text-[11px] font-mono px-2 py-0.5 rounded mr-1 mb-1">
      {children}
    </span>
  );
}
