/**
 * Approvals Centre — /app/:slug/approvals
 * Review and resolve pending approvals.
 */

import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

const APPROVAL_TABS = [
  { label: "Pending", state: "pending" },
  { label: "Approved", state: "approved" },
  { label: "Rejected", state: "rejected" },
  { label: "Expired", state: "expired" },
];

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  pending:  { label: "Pending",  cls: "bg-amber-900/30 text-amber-400" },
  approved: { label: "Approved", cls: "bg-emerald-900/30 text-emerald-400" },
  rejected: { label: "Rejected", cls: "bg-red-900/30 text-red-400" },
  expired:  { label: "Expired",  cls: "bg-[#1E3A5F] text-[#64748B]" },
};

export default function ApprovalsPage() {
  const { slug } = useParams<{ slug: string }>();
  const apiFetch = useAuthFetch();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const currentState = APPROVAL_TABS[activeTab]!.state;

  const { data, isLoading } = useQuery({
    queryKey: ["approvals", slug, currentState],
    queryFn: () =>
      apiFetch(`/v1/organisations/${slug}/approvals?state=${currentState}`).then(r => r.json()),
    enabled: !!slug,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ approvalId, action }: { approvalId: string; action: "approved" | "rejected" }) =>
      apiFetch(`/v1/organisations/${slug}/approvals/${approvalId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes }),
      }).then(r => r.json()),
    onSuccess: () => {
      setResolvingId(null);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["approvals", slug] });
    },
  });

  const approvals: any[] = data?.approvals ?? [];

  return (
    <AppShell orgSlug={slug ?? ""}>
      <div className="p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#E2E8F0]">Approvals Centre</h1>
          <p className="text-[#64748B] text-sm mt-1">Review and resolve approvals required by your AI workforce</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-5 bg-[#112033] rounded-lg p-1 w-fit">
          {APPROVAL_TABS.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                i === activeTab
                  ? "bg-[#00D4FF]/10 text-[#00D4FF] font-medium"
                  : "text-[#64748B] hover:text-[#E2E8F0]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <p className="text-[#64748B] text-sm">Loading approvals…</p>
        ) : approvals.length === 0 ? (
          <div className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-10 text-center">
            <p className="text-[#64748B] text-sm">
              {currentState === "pending"
                ? "No pending approvals — your workforce is running smoothly."
                : `No ${currentState} approvals`}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {approvals.map((approval: any) => {
              const badge = STATE_BADGE[approval.state] ?? STATE_BADGE.pending!;
              const isExpanding = resolvingId === approval.id;
              return (
                <div
                  key={approval.id}
                  className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                        <span className="text-[#64748B] text-xs">
                          {approval.approvalType?.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="text-[#E2E8F0] text-sm font-medium">Task: {approval.taskId}</p>
                      {approval.notes && (
                        <p className="text-[#64748B] text-xs mt-1">{approval.notes}</p>
                      )}
                      <p className="text-[#64748B] text-xs mt-1.5">
                        Requested {new Date(approval.requestedAt).toLocaleString("en-AU")}
                        {approval.resolvedAt && (
                          <> · Resolved {new Date(approval.resolvedAt).toLocaleString("en-AU")}</>
                        )}
                      </p>
                    </div>

                    {approval.state === "pending" && (
                      <button
                        onClick={() => setResolvingId(isExpanding ? null : approval.id)}
                        className="shrink-0 text-xs px-3 py-1.5 border border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0] hover:border-[#00D4FF]/40 rounded-lg transition-colors"
                      >
                        {isExpanding ? "Cancel" : "Review"}
                      </button>
                    )}
                  </div>

                  {/* Resolve panel */}
                  {isExpanding && (
                    <div className="mt-4 border-t border-[#1E3A5F] pt-4 space-y-3">
                      <div>
                        <label className="text-[#64748B] text-xs mb-1 block">Notes (optional)</label>
                        <textarea
                          value={notes}
                          onChange={e => setNotes(e.target.value)}
                          placeholder="Add notes for the audit trail…"
                          rows={2}
                          className="w-full bg-[#0B1829] border border-[#1E3A5F] rounded-lg px-3 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50 resize-none"
                        />
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => resolveMutation.mutate({ approvalId: approval.id, action: "approved" })}
                          disabled={resolveMutation.isPending}
                          className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                        >
                          ✓ Approve
                        </button>
                        <button
                          onClick={() => resolveMutation.mutate({ approvalId: approval.id, action: "rejected" })}
                          disabled={resolveMutation.isPending}
                          className="px-4 py-2 bg-red-800/60 text-red-300 text-sm font-semibold rounded-lg hover:bg-red-700/60 disabled:opacity-50 transition-colors"
                        >
                          ✗ Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
