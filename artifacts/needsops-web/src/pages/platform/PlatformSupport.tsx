/**
 * Platform Support Centre — /platform/support
 * All internal notes, flagged orgs, override timeline.
 */
import { useEffect, useState, useCallback } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

type View = "notes" | "flagged" | "overrides" | "timeline";

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-950/30",
  high: "text-orange-400 bg-orange-950/30",
  medium: "text-yellow-400 bg-yellow-950/30",
  low: "text-[#94A3B8] bg-[#1E3A5F]",
};

export default function PlatformSupport() {
  const fetch = usePlatformFetch();
  const [view, setView] = useState<View>("notes");
  const [notes, setNotes] = useState<any[]>([]);
  const [flagged, setFlagged] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");

  const loadNotes = useCallback((s: string, c: string, p: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (s) params.set("search", s);
    if (c) params.set("category", c);
    if (p) params.set("priority", p);
    fetch(`/support/notes?${params}`).then(r => r.json()).then(d => setNotes(d.notes ?? [])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/support/flagged").then(r => r.json()),
      fetch("/support/overrides").then(r => r.json()),
      fetch("/support/timeline").then(r => r.json()),
    ]).then(([f, o, t]) => {
      setFlagged(f.flaggedNotes ?? []);
      setOverrides(o.overrides ?? []);
      setTimeline(t.events ?? []);
    });
    loadNotes("", "", "");
  }, []);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); loadNotes(search, category, priority); };

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Support Centre</h1>
          {flagged.length > 0 && (
            <span className="rounded-full bg-yellow-950/30 px-2 py-0.5 text-xs font-medium text-yellow-400">
              {flagged.length} flagged
            </span>
          )}
          <a href="/v1/platform/export/support" target="_blank" className="ml-2 text-xs text-[#00D4FF]">CSV Export</a>
        </header>

        <div className="flex shrink-0 border-b border-[#1E3A5F] bg-[#08111e]">
          {([
            { id: "notes", label: `Notes (${notes.length})` },
            { id: "flagged", label: `Flagged (${flagged.length})` },
            { id: "overrides", label: "Active Overrides" },
            { id: "timeline", label: "Timeline" },
          ] as { id: View; label: string }[]).map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
              className={`px-4 py-2.5 text-sm ${view === v.id ? "border-b-2 border-[#00D4FF] text-[#00D4FF]" : "text-[#64748B] hover:text-[#E2E8F0]"}`}>
              {v.label}
            </button>
          ))}
        </div>

        {/* Filters for notes */}
        {view === "notes" && (
          <form onSubmit={handleSearch} className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#1E3A5F] bg-[#0B1829] px-6 py-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes…"
              className="flex-1 rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none" />
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-2 py-1.5 text-sm text-[#E2E8F0]">
              <option value="">All categories</option>
              <option value="support">Support</option><option value="billing">Billing</option>
              <option value="security">Security</option><option value="technical">Technical</option><option value="general">General</option>
            </select>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-2 py-1.5 text-sm text-[#E2E8F0]">
              <option value="">All priorities</option>
              <option value="critical">Critical</option><option value="high">High</option>
              <option value="medium">Medium</option><option value="low">Low</option>
            </select>
            <button type="submit" className="rounded-lg bg-[#00D4FF] px-3 py-1.5 text-sm font-semibold text-[#0B1829]">Filter</button>
          </form>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {loading && view === "notes" && (
            <div className="flex items-center justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" /></div>
          )}

          {/* NOTES */}
          {view === "notes" && !loading && (
            <div className="space-y-2">
              {notes.length === 0 && <p className="text-sm text-[#4A5568]">No notes found.</p>}
              {notes.map((item: any, i: number) => {
                const n = item.note;
                const org = item.org;
                return (
                  <div key={i} className={`rounded-lg border px-4 py-3 ${n.isFlagged ? "border-yellow-800 bg-yellow-950/10" : "border-[#1E3A5F] bg-[#0B1829]"}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-1.5 py-0.5 text-xs capitalize ${PRIORITY_COLORS[n.priority] ?? ""}`}>{n.priority}</span>
                      <span className="text-xs capitalize text-[#64748B]">{n.category}</span>
                      {n.isFlagged && <span className="text-xs text-yellow-400">⚑ Flagged</span>}
                      <a href={`/platform/organisations/${org?.id}`} className="ml-auto text-xs text-[#00D4FF] hover:underline">{org?.name ?? "Unknown org"}</a>
                      <span className="text-xs text-[#4A5568]">{n.createdAt ? new Date(n.createdAt).toLocaleString() : "—"}</span>
                    </div>
                    <p className="text-sm text-[#E2E8F0] line-clamp-3">{n.content}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* FLAGGED */}
          {view === "flagged" && (
            <div className="space-y-2">
              {flagged.length === 0 && <p className="text-sm text-[#4A5568]">No flagged notes.</p>}
              {flagged.map((item: any, i: number) => {
                const n = item.note;
                const org = item.org;
                return (
                  <div key={i} className="rounded-lg border border-yellow-800 bg-yellow-950/10 px-4 py-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-yellow-400">⚑</span>
                      <a href={`/platform/organisations/${org?.id}`} className="text-sm font-medium text-[#00D4FF] hover:underline">{org?.name}</a>
                      <span className="text-xs text-[#4A5568]">{n.createdAt ? new Date(n.createdAt).toLocaleString() : "—"}</span>
                    </div>
                    <p className="text-sm text-[#E2E8F0]">{n.content}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* OVERRIDES */}
          {view === "overrides" && (
            <div className="space-y-2">
              {overrides.length === 0 && <p className="text-sm text-[#4A5568]">No active overrides.</p>}
              {overrides.map((item: any, i: number) => {
                const o = item.override;
                const org = item.org;
                return (
                  <div key={i} className="rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-xs text-[#00D4FF]">{o.overrideType}</span>
                      <span className="text-[#94A3B8]">{org?.name ?? o.organizationId}</span>
                      <span className="ml-auto text-xs text-[#4A5568]">{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "—"}</span>
                    </div>
                    <p className="mt-1 text-xs text-[#64748B]">{o.reason}</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* TIMELINE */}
          {view === "timeline" && (
            <div className="space-y-2">
              {timeline.length === 0 && <p className="text-sm text-[#4A5568]">No support events yet.</p>}
              {timeline.map((evt: any, i: number) => (
                <div key={i} className="flex items-start gap-3 rounded-lg border border-[#1E3A5F] bg-[#0B1829] px-4 py-3">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#00D4FF]" />
                  <div>
                    <div className="text-sm font-medium text-[#E2E8F0]">{evt.eventType}</div>
                    <div className="text-xs text-[#4A5568]">
                      {evt.organizationId && <span>Org: {evt.organizationId} · </span>}
                      {evt.createdAt ? new Date(evt.createdAt).toLocaleString() : "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PlatformShell>
  );
}
