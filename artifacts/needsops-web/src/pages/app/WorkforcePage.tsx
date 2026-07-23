/**
 * Workforce Explorer — /app/:slug/workforce
 * Browse every workforce pack and specialist.
 */

import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import AppShell from "@/components/layout/AppShell";
import { useAuthFetch } from "@/lib/api";

const PACK_COLOURS: Record<string, string> = {
  core: "#00D4FF",
  compliance: "#FF8C00",
  operations: "#1E90FF",
  finance: "#32CD32",
  hr: "#FF69B4",
  marketing: "#FF1493",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  available: { label: "Available", cls: "bg-emerald-900/30 text-emerald-400" },
  beta: { label: "Beta", cls: "bg-blue-900/30 text-blue-400" },
  coming_soon: { label: "Coming Soon", cls: "bg-[#1E3A5F] text-[#64748B]" },
  deprecated: { label: "Deprecated", cls: "bg-red-900/20 text-red-400" },
};

export default function WorkforcePage() {
  const { slug } = useParams<{ slug: string }>();
  const apiFetch = useAuthFetch();
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: packsData, isLoading: packsLoading } = useQuery({
    queryKey: ["workforce-packs"],
    queryFn: () => apiFetch("/v1/workforce/packs").then(r => r.json()),
  });

  const { data: specialistsData, isLoading: specialistsLoading } = useQuery({
    queryKey: ["workforce-specialists", selectedPack],
    queryFn: () =>
      apiFetch(`/v1/workforce/specialists${selectedPack ? `?pack=${selectedPack}` : ""}`).then(r => r.json()),
  });

  const packs: any[] = packsData?.packs ?? [];
  const allSpecialists: any[] = specialistsData?.specialists ?? [];

  const filtered = allSpecialists.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.displayName?.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q) ||
      s.capabilities?.some((c: string) => c.toLowerCase().includes(q))
    );
  });

  return (
    <AppShell orgSlug={slug ?? ""}>
      <div className="p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#E2E8F0]">AI Workforce</h1>
          <p className="text-[#64748B] text-sm mt-1">Browse your available specialists and workforce packs</p>
        </div>

        {/* Pack selector */}
        <div className="mb-6">
          <h2 className="text-[#E2E8F0] font-semibold mb-3 text-sm uppercase tracking-widest">Workforce Packs</h2>
          {packsLoading ? (
            <div className="text-[#64748B] text-sm">Loading packs…</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <button
                onClick={() => setSelectedPack(null)}
                className={`flex flex-col items-center p-3 rounded-xl border text-center transition-colors ${
                  selectedPack === null
                    ? "border-[#00D4FF] bg-[#00D4FF]/10"
                    : "border-[#1E3A5F] bg-[#112033] hover:border-[#00D4FF]/40"
                }`}
              >
                <span className="text-2xl mb-1">🌐</span>
                <span className="text-[#E2E8F0] text-xs font-medium">All Packs</span>
                <span className="text-[#64748B] text-xs">{packs.length} packs</span>
              </button>
              {packs.map((pack: any) => (
                <button
                  key={pack.code}
                  onClick={() => setSelectedPack(pack.code === selectedPack ? null : pack.code)}
                  className={`flex flex-col items-center p-3 rounded-xl border text-center transition-colors ${
                    selectedPack === pack.code
                      ? "border-[#00D4FF] bg-[#00D4FF]/10"
                      : "border-[#1E3A5F] bg-[#112033] hover:border-[#00D4FF]/40"
                  }`}
                >
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center mb-1 text-sm font-bold"
                    style={{ backgroundColor: (PACK_COLOURS[pack.code] ?? "#00D4FF") + "22", color: PACK_COLOURS[pack.code] ?? "#00D4FF" }}
                  >
                    {pack.name.charAt(0)}
                  </div>
                  <span className="text-[#E2E8F0] text-xs font-medium leading-tight">{pack.name.replace(" Workforce", "")}</span>
                  <span className="text-[#64748B] text-xs">{pack.specialists?.length ?? 0} specialists</span>
                  {pack.status === "coming_soon" && (
                    <span className="mt-1 text-[10px] bg-[#1E3A5F] text-[#64748B] px-1.5 py-0.5 rounded-full">Soon</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="mb-5">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search specialists or capabilities…"
            className="w-full md:w-80 bg-[#112033] border border-[#1E3A5F] rounded-lg px-4 py-2 text-sm text-[#E2E8F0] placeholder-[#64748B] focus:outline-none focus:border-[#00D4FF]/50"
          />
        </div>

        {/* Specialists grid */}
        {specialistsLoading ? (
          <div className="text-[#64748B] text-sm">Loading specialists…</div>
        ) : (
          <>
            <p className="text-[#64748B] text-xs mb-3">{filtered.length} specialist{filtered.length !== 1 ? "s" : ""}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((s: any) => {
                const badge = STATUS_BADGE[s.executionStatus] ?? STATUS_BADGE.coming_soon!;
                const packColour = PACK_COLOURS[s.packCode] ?? "#00D4FF";
                return (
                  <div
                    key={s.code}
                    className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-5 flex flex-col gap-3 hover:border-[#00D4FF]/30 transition-colors"
                  >
                    {/* Top row */}
                    <div className="flex items-start gap-3">
                      <div
                        className="h-10 w-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                        style={{ backgroundColor: packColour + "22" }}
                      >
                        {s.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[#E2E8F0] font-semibold text-sm">{s.displayName}</p>
                        <p className="text-[#64748B] text-xs capitalize">{s.packCode} workforce</p>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-[#94A3B8] text-xs leading-relaxed line-clamp-2">{s.description}</p>

                    {/* Capabilities */}
                    <div className="flex flex-wrap gap-1.5">
                      {(s.capabilities ?? []).slice(0, 4).map((cap: string) => (
                        <span
                          key={cap}
                          className="text-[10px] px-2 py-0.5 rounded-full border border-[#1E3A5F] text-[#64748B]"
                        >
                          {cap.replace(/_/g, " ")}
                        </span>
                      ))}
                      {s.capabilities?.length > 4 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#1E3A5F] text-[#64748B]">
                          +{s.capabilities.length - 4} more
                        </span>
                      )}
                    </div>

                    {/* Approval requirement */}
                    {s.approvalRequirements && s.approvalRequirements !== "no_approval" && (
                      <p className="text-[10px] text-amber-400/80">
                        ⚠ Requires {s.approvalRequirements.replace(/_/g, " ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
