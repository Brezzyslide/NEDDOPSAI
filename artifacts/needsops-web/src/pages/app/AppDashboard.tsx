import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

export default function AppDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const apiFetch = useAuthFetch();

  const { data: orgData } = useQuery({
    queryKey: ["org", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}`).then(r => r.json()),
    enabled: !!slug,
  });
  const { data: membersData } = useQuery({
    queryKey: ["org-members", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/members`).then(r => r.json()),
    enabled: !!slug,
  });
  const { data: auditData } = useQuery({
    queryKey: ["org-audit-recent", slug],
    queryFn: () => apiFetch(`/v1/organisations/${slug}/audit?limit=5`).then(r => r.json()),
    enabled: !!slug,
  });

  const org = orgData?.organisation;
  const members = membersData?.members ?? [];
  const events = auditData?.events ?? [];

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#E2E8F0]">{org?.displayName ?? org?.name ?? "Dashboard"}</h1>
            <div className="flex items-center gap-3 mt-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${org?.status === "active" ? "bg-emerald-900/30 text-emerald-400" : "bg-[#1E3A5F] text-[#64748B]"}`}>{org?.status ?? "—"}</span>
              <span className="text-[#64748B] text-sm">{org?.subscriptionTier} plan</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
            {[
              { label: "Members", value: members.length, icon: "👥" },
              { label: "Audit Events", value: auditData?.events?.length ?? 0, icon: "📋" },
              { label: "Status", value: org?.status ?? "—", icon: "✅" },
            ].map(s => (
              <div key={s.label} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5">
                <p className="text-[#64748B] text-xs mb-1">{s.icon} {s.label}</p>
                <p className="text-2xl font-bold text-[#E2E8F0]">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6">
            <h2 className="text-[#E2E8F0] font-semibold mb-4">Recent Activity</h2>
            {events.length === 0 ? (
              <p className="text-[#64748B] text-sm">No recent events</p>
            ) : (
              <div className="space-y-3">
                {events.map((e: { id: string; eventType: string; actorType: string; occurredAt: string }) => (
                  <div key={e.id} className="flex items-center gap-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-[#00D4FF] shrink-0"/>
                    <span className="text-[#64748B] text-xs">{new Date(e.occurredAt).toLocaleString("en-AU")}</span>
                    <span className="text-[#E2E8F0] text-sm">{e.eventType.replace(".", " ").replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AppShell>
    </>
  );
}
