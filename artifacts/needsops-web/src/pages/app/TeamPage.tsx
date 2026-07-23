import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import AppShell from "@/components/layout/AppShell";

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-[#00D4FF]/10 text-[#00D4FF]",
  administrator: "bg-violet-900/20 text-violet-400",
  manager: "bg-yellow-900/20 text-yellow-400",
  member: "bg-emerald-900/20 text-emerald-400",
  viewer: "bg-[#1E3A5F] text-[#64748B]",
  auditor: "bg-orange-900/20 text-orange-400",
};

export default function TeamPage() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteError, setInviteError] = useState("");

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["org-members", slug],
    queryFn: () => fetch(`/v1/organisations/${slug}/members`, { credentials: "include" }).then(r => r.json()),
    enabled: !!slug,
  });
  const { data: invData } = useQuery({
    queryKey: ["org-invitations", slug],
    queryFn: () => fetch(`/v1/organisations/${slug}/invitations`, { credentials: "include" }).then(r => r.json()),
    enabled: !!slug,
  });

  const invite = useMutation({
    mutationFn: () => fetch(`/v1/organisations/${slug}/invitations`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    }).then(r => r.json()),
    onSuccess: (d) => {
      if (d.error) { setInviteError(d.error.message); return; }
      qc.invalidateQueries({ queryKey: ["org-invitations", slug] });
      setShowInvite(false); setInviteEmail(""); setInviteError("");
    },
  });

  const members = membersData?.members ?? [];
  const invitations = invData?.invitations ?? [];
  const pending = invitations.filter((i: { status: string }) => i.status === "pending");

  return (
    <>
      <Show when="signed-out"><Redirect to="/" /></Show>
      <AppShell orgSlug={slug ?? ""}>
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-[#E2E8F0]">Team</h1>
              <p className="text-[#64748B] text-sm mt-1">{members.length} member{members.length !== 1 ? "s" : ""}</p>
            </div>
            <button onClick={() => setShowInvite(true)} className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg text-sm hover:bg-[#00B8D9] transition-colors">Invite member</button>
          </div>

          {/* Members list */}
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl mb-6 overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1E3A5F]"><h2 className="text-[#E2E8F0] font-medium">Members</h2></div>
            {membersLoading ? (
              <div className="px-6 py-8 text-[#64748B] text-sm">Loading...</div>
            ) : members.map((m: { id: string; role: string; status: string; user: { email: string; firstName: string | null; lastName: string | null; displayName: string | null } }) => (
              <div key={m.id} className="flex items-center justify-between px-6 py-3.5 border-b border-[#1E3A5F] last:border-0">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-[#1E3A5F] flex items-center justify-center text-xs text-[#E2E8F0]">
                    {(m.user.firstName?.[0] ?? m.user.email[0] ?? "U").toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[#E2E8F0] text-sm font-medium">
                      {m.user.displayName ?? ([m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || m.user.email)}
                    </p>
                    <p className="text-[#64748B] text-xs">{m.user.email}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? "bg-[#1E3A5F] text-[#64748B]"}`}>{m.role}</span>
              </div>
            ))}
          </div>

          {/* Pending invitations */}
          {pending.length > 0 && (
            <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#1E3A5F]"><h2 className="text-[#E2E8F0] font-medium">Pending invitations</h2></div>
              {pending.map((inv: { id: string; email: string; role: string; expiresAt: string }) => (
                <div key={inv.id} className="flex items-center justify-between px-6 py-3.5 border-b border-[#1E3A5F] last:border-0">
                  <div>
                    <p className="text-[#E2E8F0] text-sm">{inv.email}</p>
                    <p className="text-[#64748B] text-xs">Expires {new Date(inv.expiresAt).toLocaleDateString("en-AU")}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[inv.role] ?? "bg-[#1E3A5F] text-[#64748B]"}`}>{inv.role}</span>
                </div>
              ))}
            </div>
          )}

          {/* Invite modal */}
          {showInvite && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4" onClick={() => setShowInvite(false)}>
              <div className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <h2 className="text-lg font-semibold text-[#E2E8F0] mb-4">Invite member</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Email address</label>
                    <input type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] text-sm focus:outline-none focus:border-[#00D4FF]" placeholder="colleague@org.com.au"/>
                  </div>
                  <div>
                    <label className="block text-sm text-[#E2E8F0] mb-1">Role</label>
                    <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2.5 text-[#E2E8F0] text-sm focus:outline-none focus:border-[#00D4FF]">
                      {["administrator","manager","member","viewer","auditor"].map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
                    </select>
                  </div>
                  {inviteError && <p className="text-red-400 text-sm">{inviteError}</p>}
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setShowInvite(false)} className="flex-1 px-4 py-2.5 border border-[#1E3A5F] text-[#E2E8F0] rounded-lg text-sm hover:border-[#00D4FF]">Cancel</button>
                  <button onClick={() => invite.mutate()} disabled={invite.isPending || !inviteEmail} className="flex-1 px-4 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg text-sm hover:bg-[#00B8D9] disabled:opacity-50">{invite.isPending ? "Sending..." : "Send invite"}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}
