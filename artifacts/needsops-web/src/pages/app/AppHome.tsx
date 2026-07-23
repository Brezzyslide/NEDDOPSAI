import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Redirect } from "wouter";
import { Show } from "@clerk/react";
import { useAuthFetch } from "@/lib/api";

interface OrgMembership { id: string; slug: string; name: string; displayName: string | null; status: string; subscriptionTier: string; role: string; }

export default function AppHome() {
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();
  const { data, isLoading } = useQuery({
    queryKey: ["me-orgs"],
    queryFn: () => apiFetch("/v1/me/organisations").then(r => r.json()),
  });

  const orgs: OrgMembership[] = data?.organisations ?? [];

  useEffect(() => {
    if (!isLoading && orgs.length === 1) setLocation(`/app/${orgs[0]!.slug}`);
    if (!isLoading && orgs.length === 0) setLocation("/onboarding");
  }, [isLoading, orgs, setLocation]);

  if (isLoading || orgs.length <= 1) return (
    <div className="min-h-dvh bg-[#0B1829] flex items-center justify-center">
      <div className="h-8 w-8 border-2 border-[#00D4FF] border-t-transparent rounded-full animate-spin"/>
    </div>
  );

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <div className="min-h-dvh bg-[#0B1829] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-[#E2E8F0] mb-2">Select organisation</h1>
          <p className="text-[#64748B] text-sm mb-6">You belong to multiple organisations.</p>
          <div className="space-y-3">
            {orgs.map(org => (
              <button key={org.id} onClick={() => setLocation(`/app/${org.slug}`)} className="w-full bg-[#112033] border border-[#1E3A5F] rounded-xl p-4 text-left hover:border-[#00D4FF] transition-colors group">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[#E2E8F0] font-medium">{org.displayName ?? org.name}</p>
                    <p className="text-[#64748B] text-xs mt-0.5">{org.role} · {org.subscriptionTier}</p>
                  </div>
                  <span className="text-[#00D4FF] opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => setLocation("/onboarding")} className="mt-4 w-full px-4 py-2.5 border border-dashed border-[#1E3A5F] text-[#64748B] rounded-xl hover:border-[#00D4FF] hover:text-[#00D4FF] transition-colors text-sm">+ Create new organisation</button>
        </div>
      </div>
    </>
  );
}
