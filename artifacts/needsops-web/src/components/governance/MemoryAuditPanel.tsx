/**
 * MemoryAuditPanel — Sprint 29
 *
 * Reusable per-memory audit history drilldown.
 * Fetches GET /v1/organisations/:slug/memory/:memoryId/audit
 */

import { useQuery } from "@tanstack/react-query";
import { useAuthFetch } from "@/lib/api";

interface AuditEvent {
  id:          string;
  eventType:   string;
  actorUserId: string | null;
  metadata:    Record<string, unknown>;
  occurredAt:  string;
}

const EVENT_META: Record<string, { label: string; icon: string; cls: string }> = {
  "memory.proposed":   { label: "Proposed",       icon: "💡", cls: "text-amber-400" },
  "memory.approved":   { label: "Approved",       icon: "✅", cls: "text-emerald-400" },
  "memory.rejected":   { label: "Archived",       icon: "✗",  cls: "text-red-400" },
  "memory.superseded": { label: "Superseded",     icon: "🔄", cls: "text-slate-400" },
  "memory.updated":    { label: "Updated",        icon: "✏️",  cls: "text-[#00D4FF]" },
  "memory.merged":     { label: "Merged",         icon: "🔀", cls: "text-purple-400" },
};

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MemoryAuditPanel({
  memoryId,
  orgSlug,
  memoryTitle,
  onClose,
}: {
  memoryId:    string;
  orgSlug:     string;
  memoryTitle: string;
  onClose:     () => void;
}) {
  const apiFetch = useAuthFetch();

  const { data, isLoading } = useQuery({
    queryKey: ["memory-audit", orgSlug, memoryId],
    queryFn:  () =>
      apiFetch(`/v1/organisations/${orgSlug}/memory/${memoryId}/audit`)
        .then(r => r.json()),
    staleTime: 30_000,
  });

  const events: AuditEvent[] = data?.events ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="bg-[#0B1829] border border-[#1E3A5F] rounded-2xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-[#1E3A5F] flex items-center justify-between shrink-0">
          <div>
            <p className="text-[#E2E8F0] font-semibold text-sm">Memory Audit History</p>
            <p className="text-[#64748B] text-xs mt-0.5 truncate max-w-xs">{memoryTitle}</p>
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
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 bg-[#112033] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-3xl mb-2 opacity-30">📋</p>
              <p className="text-[#64748B] text-sm">No audit history available for this memory entry.</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-px bg-[#1E3A5F]" />
              <div className="space-y-3">
                {events.map(event => {
                  const meta = EVENT_META[event.eventType] ?? {
                    label: event.eventType.replace("memory.", "").replace(/_/g, " "),
                    icon: "•",
                    cls: "text-[#94A3B8]",
                  };
                  return (
                    <div key={event.id} className="flex items-start gap-4 relative">
                      <div className={`h-8 w-8 rounded-full border-2 border-[#1E3A5F] bg-[#0B1829] flex items-center justify-center shrink-0 z-10 text-sm ${meta.cls}`}>
                        {meta.icon}
                      </div>
                      <div className="flex-1 bg-[#112033] rounded-xl p-3 border border-[#1E3A5F]">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className={`text-xs font-semibold ${meta.cls}`}>{meta.label}</p>
                          <span className="text-[#64748B] text-xs">{timeAgo(event.occurredAt)}</span>
                        </div>
                        {event.actorUserId && (
                          <p className="text-[#94A3B8] text-xs font-mono truncate">
                            Actor: {event.actorUserId}
                          </p>
                        )}
                        {event.metadata && Object.keys(event.metadata).length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {Object.entries(event.metadata).slice(0, 3).map(([k, v]) => (
                              <p key={k} className="text-[#64748B] text-xs">
                                <span className="capitalize">{k.replace(/_/g, " ")}:</span>{" "}
                                <span className="text-[#94A3B8]">{String(v)}</span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
