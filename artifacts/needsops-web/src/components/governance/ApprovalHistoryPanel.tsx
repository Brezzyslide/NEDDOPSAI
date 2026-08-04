/**
 * ApprovalHistoryPanel — Sprint 29
 *
 * Reusable per-approval history drilldown.
 * Fetches GET /v1/organisations/:slug/approvals/:approvalId
 * and renders the immutable history log.
 */

import { useQuery }    from "@tanstack/react-query";
import { useAuthFetch } from "@/lib/api";

interface HistoryEntry {
  id:          string;
  action:      string;
  actorUserId: string | null;
  notes:       string | null;
  metadata:    Record<string, unknown>;
  occurredAt:  string;
}

const ACTION_META: Record<string, { label: string; icon: string; cls: string }> = {
  requested:        { label: "Requested",         icon: "📨", cls: "text-[#94A3B8]" },
  approved:         { label: "Approved",           icon: "✅", cls: "text-emerald-400" },
  rejected:         { label: "Rejected",           icon: "✗",  cls: "text-red-400" },
  request_changes:  { label: "Changes requested",  icon: "💬", cls: "text-amber-400" },
  expired:          { label: "Expired",            icon: "⏱",  cls: "text-slate-400" },
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function ApprovalHistoryPanel({
  approvalId,
  orgSlug,
  onClose,
}: {
  approvalId: string;
  orgSlug:    string;
  onClose:    () => void;
}) {
  const apiFetch = useAuthFetch();

  const { data, isLoading } = useQuery({
    queryKey: ["approval-history", orgSlug, approvalId],
    queryFn:  () =>
      apiFetch(`/v1/organisations/${orgSlug}/approvals/${approvalId}`)
        .then(r => r.json()),
    staleTime: 30_000,
  });

  const approval = data?.approval;
  const history: HistoryEntry[] = data?.history ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="bg-[#0B1829] border border-[#1E3A5F] rounded-2xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-[#1E3A5F] flex items-center justify-between shrink-0">
          <div>
            <p className="text-[#E2E8F0] font-semibold text-sm">Approval History</p>
            {approval && (
              <p className="text-[#64748B] text-xs mt-0.5 font-mono">
                {approval.approvalType?.replace(/_/g, " ")} · {approval.state}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#64748B] hover:text-[#E2E8F0] text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 flex-1">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="h-14 bg-[#112033] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-3xl mb-2 opacity-30">📋</p>
              <p className="text-[#64748B] text-sm">No history available for this approval.</p>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline spine */}
              <div className="absolute left-4 top-0 bottom-0 w-px bg-[#1E3A5F]" />

              <div className="space-y-4">
                {history.map((entry, idx) => {
                  const meta = ACTION_META[entry.action] ?? { label: entry.action, icon: "•", cls: "text-[#94A3B8]" };
                  return (
                    <div key={entry.id} className="flex items-start gap-4 relative">
                      {/* Dot */}
                      <div className={`h-8 w-8 rounded-full border-2 border-[#1E3A5F] bg-[#0B1829] flex items-center justify-center shrink-0 z-10 text-sm ${meta.cls}`}>
                        {meta.icon}
                      </div>
                      {/* Content */}
                      <div className="flex-1 bg-[#112033] rounded-xl p-3 border border-[#1E3A5F]">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className={`text-xs font-semibold ${meta.cls}`}>{meta.label}</p>
                          <span className="text-[#64748B] text-xs">{timeAgo(entry.occurredAt)}</span>
                        </div>
                        {entry.actorUserId && (
                          <p className="text-[#94A3B8] text-xs font-mono truncate">
                            Actor: {entry.actorUserId}
                          </p>
                        )}
                        {entry.notes && (
                          <p className="text-[#94A3B8] text-xs mt-1 leading-relaxed">
                            &ldquo;{entry.notes}&rdquo;
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Approval detail */}
          {approval && (
            <div className="mt-5 pt-4 border-t border-[#1E3A5F]">
              <p className="text-[#64748B] text-xs uppercase tracking-widest font-semibold mb-3">
                Approval details
              </p>
              <div className="space-y-1.5">
                {[
                  ["ID",         approval.id],
                  ["Type",       approval.approvalType?.replace(/_/g, " ")],
                  ["State",      approval.state],
                  ["Task",       approval.taskId ?? "—"],
                  ["Requested",  approval.requestedAt ? new Date(approval.requestedAt).toLocaleString("en-AU") : "—"],
                  ["Resolved",   approval.resolvedAt  ? new Date(approval.resolvedAt).toLocaleString("en-AU") : "—"],
                  ["Resolved by",approval.resolvedBy ?? "—"],
                  ["Notes",      approval.notes ?? "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-start gap-3">
                    <span className="text-[#64748B] text-xs w-28 shrink-0">{k}</span>
                    <span className="text-[#94A3B8] text-xs font-mono break-all">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
