/**
 * Platform Catalogue Management — /platform/catalogue
 * Task #40: DB-backed specialist catalogue editor.
 *
 * Features:
 *   - Searchable, filterable specialist list with inline status badges
 *   - Edit drawer for commercial fields (display name, description, coming-soon,
 *     display order, pack assignment, icon metadata)
 *   - Archive action with guard (blocked if specialist is active in runtime)
 *   - Unarchive
 *   - Version counter shown for audit awareness
 */

import { useEffect, useState, useCallback } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CatalogueEntry {
  id: string;
  specialistCode: string;
  displayName: string;
  description: string;
  executionStatus: string;
  availability: string;
  category: string;
  iconMetadata: { icon: string; colour: string };
  packMembership: string;
  planVisibility: string[] | null;
  comingSoon: boolean;
  displayOrder: number;
  versionMetadata: { catalogueVersion: string; dnaStatus: string; departmentCode: string };
  isActive: boolean;
  isArchived: boolean;
  versionCounter: number;
  changedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ entry }: { entry: CatalogueEntry }) {
  if (entry.isArchived) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">Archived</span>;
  if (entry.comingSoon) return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300">Coming Soon</span>;
  switch (entry.executionStatus) {
    case "available":    return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300">Active</span>;
    case "dna_pending":  return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300">DNA Pending</span>;
    case "deprecated":   return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-500">Deprecated</span>;
    case "coming_soon":  return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300">Coming Soon</span>;
    default:             return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{entry.executionStatus}</span>;
  }
}

// ─── Edit drawer ──────────────────────────────────────────────────────────────

interface EditDrawerProps {
  entry: CatalogueEntry;
  onClose: () => void;
  onSaved: (updated: CatalogueEntry) => void;
  platformFetch: ReturnType<typeof usePlatformFetch>;
}

function EditDrawer({ entry, onClose, onSaved, platformFetch }: EditDrawerProps) {
  const [displayName,  setDisplayName]  = useState(entry.displayName);
  const [description,  setDescription]  = useState(entry.description);
  const [comingSoon,   setComingSoon]   = useState(entry.comingSoon);
  const [displayOrder, setDisplayOrder] = useState(String(entry.displayOrder));
  const [icon,         setIcon]         = useState(entry.iconMetadata.icon);
  const [colour,       setColour]       = useState(entry.iconMetadata.colour);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");

  // Archive / unarchive
  const [archiving,    setArchiving]    = useState(false);
  const [archiveError, setArchiveError] = useState("");

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const r = await platformFetch(`/catalogue/${entry.specialistCode}`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName:  displayName.trim() || undefined,
          description:  description.trim() || undefined,
          comingSoon,
          displayOrder: parseInt(displayOrder, 10) || entry.displayOrder,
          iconMetadata: { icon: icon.trim() || entry.iconMetadata.icon, colour: colour.trim() || entry.iconMetadata.colour },
        }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data?.error?.message ?? "Save failed"); return; }
      onSaved(data.entry);
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  };

  const toggleArchive = async () => {
    setArchiveError("");
    setArchiving(true);
    const action = entry.isArchived ? "unarchive" : "archive";
    if (!entry.isArchived && !confirm(`Archive "${entry.displayName}"? This will hide it from all org workforce browsers.`)) {
      setArchiving(false);
      return;
    }
    try {
      const r = await platformFetch(`/catalogue/${entry.specialistCode}/${action}`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) { setArchiveError(data?.error?.message ?? `${action} failed`); }
      else { onSaved(data.entry); onClose(); }
    } catch { setArchiveError("Network error"); }
    finally { setArchiving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-[480px] overflow-y-auto bg-[#0B1829] border-l border-[#1E3A5F] shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1E3A5F] px-6 py-4">
          <div>
            <p className="text-xs text-[#64748B] font-mono">{entry.specialistCode}</p>
            <h2 className="text-[#E2E8F0] font-semibold mt-0.5">Edit Specialist</h2>
          </div>
          <button onClick={onClose} className="text-[#475569] hover:text-[#E2E8F0] text-xl">✕</button>
        </div>

        {/* Form */}
        <div className="flex-1 space-y-5 px-6 py-5">
          {/* Read-only runtime info */}
          <div className="rounded-lg bg-[#112033] border border-[#1E3A5F] p-3 space-y-1 text-xs">
            <p className="text-[#64748B] uppercase tracking-widest text-[10px] mb-2">Runtime fields (code-defined — not editable)</p>
            <div className="flex justify-between">
              <span className="text-[#64748B]">Pack</span>
              <span className="text-[#94A3B8] font-mono">{entry.packMembership}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#64748B]">Status</span>
              <StatusBadge entry={entry} />
            </div>
            <div className="flex justify-between">
              <span className="text-[#64748B]">Catalogue version</span>
              <span className="text-[#94A3B8]">v{entry.versionCounter} · {entry.versionMetadata.catalogueVersion === "2" ? "Current" : "Legacy"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#64748B]">DNA status</span>
              <span className="text-[#94A3B8]">{entry.versionMetadata.dnaStatus}</span>
            </div>
          </div>

          {/* Display name */}
          <label className="block">
            <span className="text-[#64748B] text-xs uppercase tracking-widest">Display Name</span>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0] focus:border-[#00D4FF] focus:outline-none"
            />
          </label>

          {/* Description */}
          <label className="block">
            <span className="text-[#64748B] text-xs uppercase tracking-widest">Description</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              className="mt-1.5 w-full rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0] focus:border-[#00D4FF] focus:outline-none resize-none"
            />
          </label>

          {/* Display order */}
          <label className="block">
            <span className="text-[#64748B] text-xs uppercase tracking-widest">Display Order</span>
            <input
              type="number"
              value={displayOrder}
              onChange={e => setDisplayOrder(e.target.value)}
              className="mt-1.5 w-24 rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0] focus:border-[#00D4FF] focus:outline-none"
            />
          </label>

          {/* Icon & colour */}
          <div>
            <span className="text-[#64748B] text-xs uppercase tracking-widest">Icon & Colour</span>
            <div className="mt-1.5 flex gap-3 items-center">
              <input
                value={icon}
                onChange={e => setIcon(e.target.value)}
                placeholder="Emoji icon"
                className="w-20 rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0] focus:border-[#00D4FF] focus:outline-none text-center"
              />
              <input
                value={colour}
                onChange={e => setColour(e.target.value)}
                placeholder="#00D4FF"
                className="flex-1 rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2 text-sm text-[#E2E8F0] focus:border-[#00D4FF] focus:outline-none font-mono"
              />
              <div className="h-8 w-8 rounded-full border border-[#1E3A5F] flex items-center justify-center text-sm" style={{ backgroundColor: colour }}>
                {icon}
              </div>
            </div>
          </div>

          {/* Coming soon toggle */}
          <label className="flex items-center justify-between rounded-lg border border-[#1E3A5F] bg-[#112033] px-4 py-3 cursor-pointer">
            <div>
              <p className="text-[#E2E8F0] text-sm font-medium">Coming Soon</p>
              <p className="text-[#64748B] text-xs">Show a "Coming Soon" badge in the workforce browser</p>
            </div>
            <button
              type="button"
              onClick={() => setComingSoon(!comingSoon)}
              className={`relative h-5 w-9 rounded-full transition-colors ${comingSoon ? "bg-[#00D4FF]" : "bg-[#1E3A5F]"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${comingSoon ? "left-4" : "left-0.5"}`} />
            </button>
          </label>

          {error && <p className="rounded-lg bg-red-900/20 px-3 py-2 text-sm text-red-300">{error}</p>}
        </div>

        {/* Footer actions */}
        <div className="border-t border-[#1E3A5F] px-6 py-4 space-y-3">
          <button
            onClick={save}
            disabled={saving}
            className="w-full rounded-lg bg-[#00D4FF] py-2.5 text-sm font-semibold text-[#0B1829] hover:bg-[#00D4FF]/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>

          <button
            onClick={toggleArchive}
            disabled={archiving}
            className={`w-full rounded-lg border py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              entry.isArchived
                ? "border-emerald-700 text-emerald-400 hover:bg-emerald-900/20"
                : "border-red-800 text-red-400 hover:bg-red-900/20"
            }`}
          >
            {archiving ? "…" : entry.isArchived ? "Unarchive Specialist" : "Archive Specialist"}
          </button>

          {archiveError && (
            <p className="rounded-lg bg-red-900/20 px-3 py-2 text-xs text-red-300">{archiveError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const PACK_LABELS: Record<string, string> = {
  core: "Core", compliance: "Compliance", operations: "Operations",
  finance: "Finance", hr: "People & Culture", marketing: "Marketing",
};

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "available",   label: "Active" },
  { value: "dna_pending", label: "DNA Pending" },
  { value: "deprecated",  label: "Deprecated" },
];

export default function PlatformCataloguePage() {
  const platformFetch = usePlatformFetch();

  const [entries,          setEntries]          = useState<CatalogueEntry[]>([]);
  const [total,            setTotal]            = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [search,           setSearch]           = useState("");
  const [packFilter,       setPackFilter]       = useState("");
  const [statusFilter,     setStatusFilter]     = useState("");
  const [includeArchived,  setIncludeArchived]  = useState(false);
  const [editEntry,        setEditEntry]        = useState<CatalogueEntry | null>(null);
  const [seeding,          setSeeding]          = useState(false);
  const [seedMsg,          setSeedMsg]          = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        includeArchived:   includeArchived ? "true" : "false",
        includeDeprecated: "true",
        limit:             "200",
      });
      if (packFilter)   params.set("packCode", packFilter);
      if (search)       params.set("search",   search);

      const r = await platformFetch(`/catalogue?${params}`);
      const d = await r.json();
      let list: CatalogueEntry[] = d.entries ?? [];
      if (statusFilter) list = list.filter(e => e.executionStatus === statusFilter);
      setEntries(list);
      setTotal(d.total ?? list.length);
    } finally { setLoading(false); }
  }, [includeArchived, packFilter, search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleSeed = async () => {
    setSeeding(true);
    setSeedMsg("");
    const r = await platformFetch("/catalogue/seed", { method: "POST" });
    const d = await r.json();
    setSeedMsg(d.seeded ? `Seeded: ${d.inserted} inserted, ${d.updated} updated` : "Seed failed");
    setSeeding(false);
    load();
  };

  const onSaved = (updated: CatalogueEntry) => {
    setEntries(prev => prev.map(e => e.specialistCode === updated.specialistCode ? updated : e));
    if (editEntry?.specialistCode === updated.specialistCode) setEditEntry(updated);
  };

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Catalogue Management</h1>
          <span className="text-xs text-[#4A5568]">{total} specialist{total !== 1 ? "s" : ""}</span>
          <span className="ml-auto text-xs text-[#4A5568]">Commercial metadata only — runtime config is code-defined</span>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="rounded-lg border border-[#1E3A5F] px-3 py-1.5 text-xs text-[#64748B] hover:text-[#E2E8F0] hover:border-[#00D4FF]/30 disabled:opacity-50"
          >
            {seeding ? "Seeding…" : "Re-seed from Registry"}
          </button>
        </header>

        {seedMsg && (
          <div className="bg-emerald-900/20 border-b border-emerald-800/40 px-6 py-2 text-xs text-emerald-300">{seedMsg}</div>
        )}

        {/* Filter bar */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#1E3A5F] bg-[#0B1829] px-6 py-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, code, description…"
            className="w-64 rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none"
          />
          <select
            value={packFilter}
            onChange={e => setPackFilter(e.target.value)}
            className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] focus:outline-none"
          >
            <option value="">All packs</option>
            {Object.entries(PACK_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] focus:outline-none"
          >
            {STATUS_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-[#64748B] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={e => setIncludeArchived(e.target.checked)}
              className="rounded border-[#1E3A5F] bg-[#08111e] accent-[#00D4FF]"
            />
            Include archived
          </label>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#08111e] border-b border-[#1E3A5F] z-10">
                <tr className="text-left text-xs text-[#64748B]">
                  <th className="px-6 py-3 w-8">#</th>
                  <th className="px-4 py-3">Specialist</th>
                  <th className="px-4 py-3">Pack</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">DNA</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A5F]">
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-[#475569]">
                      No specialists found. Try adjusting filters or re-seed from registry.
                    </td>
                  </tr>
                )}
                {entries.map(entry => (
                  <tr key={entry.specialistCode} className={`hover:bg-[#0B1829] transition-colors ${entry.isArchived ? "opacity-50" : ""}`}>
                    <td className="px-6 py-3 text-lg">{entry.iconMetadata.icon}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-medium text-[#E2E8F0]">{entry.displayName}</p>
                          <p className="font-mono text-xs text-[#4A5568]">{entry.specialistCode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded border border-[#1E3A5F] text-[#94A3B8]">
                        {PACK_LABELS[entry.packMembership] ?? entry.packMembership}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge entry={entry} />
                    </td>
                    <td className="px-4 py-3 text-xs text-[#64748B]">
                      {entry.versionMetadata.dnaStatus === "approved"      ? "✓ Approved"    :
                       entry.versionMetadata.dnaStatus === "pending_design" ? "⏳ Pending"    :
                       "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#64748B]">{entry.displayOrder}</td>
                    <td className="px-4 py-3 text-xs text-[#475569]">v{entry.versionCounter}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setEditEntry(entry)}
                        className="rounded-lg border border-[#1E3A5F] px-3 py-1 text-xs text-[#64748B] hover:text-[#E2E8F0] hover:border-[#00D4FF]/40 transition-colors"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit drawer */}
      {editEntry && (
        <EditDrawer
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={onSaved}
          platformFetch={platformFetch}
        />
      )}
    </PlatformShell>
  );
}
