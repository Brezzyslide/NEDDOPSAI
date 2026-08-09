import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

export default function OrgSettings() {
  const { slug } = useParams<{ slug: string }>();
  const apiFetch = useAuthFetch();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["org", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}`).then(r => r.json()),
    enabled: !!slug,
  });
  const org = data?.organisation;
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [primaryContactEmail, setPrimaryContactEmail] = useState("");
  const [abn, setAbn] = useState("");
  const [ndisReg, setNdisReg] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setName(org.name ?? "");
      setDisplayName(org.displayName ?? "");
      setPrimaryContactName(org.primaryContactName ?? "");
      setPrimaryContactEmail(org.primaryContactEmail ?? "");
      setAbn(org.abn ?? "");
      setNdisReg(org.ndisRegistrationNumber ?? "");
    }
  }, [org]);

  const update = useMutation({
    mutationFn: () => apiFetch(`/v1/organisations/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ name, displayName, primaryContactName, primaryContactEmail, abn, ndisRegistrationNumber: ndisReg }),
    }).then(r => {
      if (!r.ok) throw new Error(`Server error ${r.status}`);
      return r.json();
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org", slug] });
      setSaved(true);
      setSaveError(null);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err: any) => {
      setSaveError(err?.message ?? "Failed to save settings — please try again.");
    },
  });

  const inputClass = "w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] text-sm focus:outline-none focus:border-[#00D4FF]";
  const labelClass = "block text-sm text-[#E2E8F0] mb-1";

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8 max-w-2xl">
          <h1 className="text-2xl font-bold text-[#E2E8F0] mb-8">Organisation settings</h1>
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelClass}>Legal name *</label><input className={inputClass} value={name} onChange={e=>setName(e.target.value)}/></div>
              <div><label className={labelClass}>Display name</label><input className={inputClass} value={displayName} onChange={e=>setDisplayName(e.target.value)}/></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelClass}>Primary contact name</label><input className={inputClass} value={primaryContactName} onChange={e=>setPrimaryContactName(e.target.value)}/></div>
              <div><label className={labelClass}>Primary contact email</label><input type="email" className={inputClass} value={primaryContactEmail} onChange={e=>setPrimaryContactEmail(e.target.value)}/></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelClass}>ABN</label><input className={inputClass} value={abn} onChange={e=>setAbn(e.target.value)} placeholder="12 345 678 901"/></div>
              <div><label className={labelClass}>NDIS registration number</label><input className={inputClass} value={ndisReg} onChange={e=>setNdisReg(e.target.value)}/></div>
            </div>
            {saveError && (
              <p className="text-sm text-red-400 bg-red-950/20 border border-red-800/40 rounded-lg px-3 py-2">{saveError}</p>
            )}
            <div className="flex justify-end pt-2">
              <button onClick={() => { setSaveError(null); update.mutate(); }} disabled={update.isPending} className="px-5 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg text-sm hover:bg-[#00B8D9] disabled:opacity-50">
                {saved ? "✓ Saved" : update.isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    </>
  );
}
