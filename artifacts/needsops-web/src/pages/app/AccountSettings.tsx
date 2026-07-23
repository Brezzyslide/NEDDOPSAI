import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useClerk, useUser, Show } from "@clerk/react";
import { Redirect, useLocation } from "wouter";
import { useAuthFetch } from "@/lib/api";

export default function AccountSettings() {
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const apiFetch = useAuthFetch();
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => apiFetch("/v1/me").then(r => r.json()) });
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saved, setSaved] = useState(false);
  const dbUser = data?.user;
  useEffect(() => { if (dbUser) { setFirstName(dbUser.firstName ?? ""); setLastName(dbUser.lastName ?? ""); setDisplayName(dbUser.displayName ?? ""); } }, [dbUser]);
  const update = useMutation({
    mutationFn: () => apiFetch("/v1/me", {
      method: "PATCH",
      body: JSON.stringify({ firstName, lastName, displayName }),
    }).then(r => r.json()),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); },
  });
  const inputClass = "w-full bg-[#112033] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] text-sm focus:outline-none focus:border-[#00D4FF]";

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <div className="min-h-dvh bg-[#0B1829]">
        <header className="border-b border-[#1E3A5F] px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => history.back()} className="text-[#64748B] hover:text-[#E2E8F0] text-sm">← Back</button>
            <span className="text-[#E2E8F0] font-semibold">Account settings</span>
          </div>
          <button onClick={() => signOut()} className="text-sm text-[#64748B] hover:text-red-400">Sign out</button>
        </header>
        <div className="max-w-lg mx-auto px-4 py-10">
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6 space-y-4">
            <div>
              <label className="block text-sm text-[#64748B] mb-1">Email</label>
              <input readOnly value={clerkUser?.emailAddresses?.[0]?.emailAddress ?? ""} className={`${inputClass} opacity-60 cursor-not-allowed`}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm text-[#E2E8F0] mb-1">First name</label><input className={inputClass} value={firstName} onChange={e=>setFirstName(e.target.value)}/></div>
              <div><label className="block text-sm text-[#E2E8F0] mb-1">Last name</label><input className={inputClass} value={lastName} onChange={e=>setLastName(e.target.value)}/></div>
            </div>
            <div><label className="block text-sm text-[#E2E8F0] mb-1">Display name</label><input className={inputClass} value={displayName} onChange={e=>setDisplayName(e.target.value)}/></div>
            <div className="flex justify-end pt-2">
              <button onClick={() => update.mutate()} disabled={update.isPending} className="px-5 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg text-sm hover:bg-[#00B8D9] disabled:opacity-50">{saved ? "✓ Saved" : "Save changes"}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
