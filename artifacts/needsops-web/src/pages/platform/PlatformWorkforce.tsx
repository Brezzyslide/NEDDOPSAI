/**
 * Platform Workforce Designer — /platform/workforce
 * Metadata-only view of all workforce packs and specialists.
 */
import { useEffect, useState } from "react";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

type Tab = "packs" | "specialists" | "stats";

export default function PlatformWorkforce() {
  const fetch = usePlatformFetch();
  const [tab, setTab] = useState<Tab>("packs");
  const [packs, setPacks] = useState<any[]>([]);
  const [specialists, setSpecialists] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/workforce/packs").then(r => r.json()),
      fetch("/workforce/specialists").then(r => r.json()),
      fetch("/workforce/stats").then(r => r.json()),
    ]).then(([p, s, st]) => {
      setPacks(p.packs ?? []);
      setSpecialists(s.specialists ?? []);
      setStats(st);
    }).finally(() => setLoading(false));
  }, []);

  const filteredPacks = packs.filter(p =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.code?.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredSpecialists = specialists.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.code?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Workforce Designer</h1>
          {stats && (
            <span className="text-xs text-[#4A5568]">
              {stats.totalPacks} packs · {stats.totalSpecialists} specialists
            </span>
          )}
          <span className="ml-auto text-xs text-[#4A5568]">Metadata view only — runtime config is code-defined</span>
        </header>

        <div className="flex shrink-0 items-center gap-4 border-b border-[#1E3A5F] bg-[#0B1829] px-6 py-3">
          {(["packs", "specialists", "stats"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm capitalize ${tab === t ? "bg-[#00D4FF]/10 text-[#00D4FF]" : "text-[#64748B] hover:text-[#E2E8F0]"}`}>
              {t}
            </button>
          ))}
          {tab !== "stats" && (
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filter…"
              className="ml-auto rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none" />
          )}
        </div>

        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
          </div>
        )}

        {!loading && (
          <div className="flex-1 overflow-y-auto p-6">
            {/* PACKS */}
            {tab === "packs" && (
              <div className="space-y-3">
                {filteredPacks.map(pack => (
                  <div key={pack.code} className="rounded-xl border border-[#1E3A5F] bg-[#0B1829]">
                    <div className="flex items-center gap-3 p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[#E2E8F0]">{pack.name}</span>
                          <span className="font-mono text-xs text-[#4A5568]">{pack.code}</span>
                        </div>
                        <div className="mt-1 text-xs text-[#64748B]">{pack.description}</div>
                        <div className="mt-1 flex gap-3 text-xs text-[#4A5568]">
                          <span>{pack.specialistCount} specialists</span>
                          <span>{pack.orgGrantCount} orgs granted</span>
                        </div>
                      </div>
                      <button onClick={() => setExpanded(expanded === pack.code ? null : pack.code)}
                        className="rounded border border-[#1E3A5F] px-2 py-1 text-xs text-[#64748B] hover:text-[#E2E8F0]">
                        {expanded === pack.code ? "Hide" : "Specialists"}
                      </button>
                    </div>
                    {expanded === pack.code && (
                      <div className="border-t border-[#1E3A5F] px-4 pb-4">
                        <div className="mt-3 flex flex-wrap gap-2">
                          {specialists.filter(s => s.packCode === pack.code).map(s => (
                            <div key={s.code} className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-2">
                              <div className="text-xs font-mono text-[#00D4FF]">{s.code}</div>
                              <div className="text-xs text-[#94A3B8]">{s.name}</div>
                              <div className="mt-0.5 text-xs text-[#4A5568]">{s.role}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* SPECIALISTS */}
            {tab === "specialists" && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1E3A5F] text-left text-xs text-[#64748B]">
                    <th className="pb-2">Code</th><th className="pb-2">Name</th><th className="pb-2">Pack</th>
                    <th className="pb-2">Role</th><th className="pb-2">Capabilities</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E3A5F]">
                  {filteredSpecialists.map(s => (
                    <tr key={s.code}>
                      <td className="py-2 font-mono text-xs text-[#00D4FF]">{s.code}</td>
                      <td className="py-2 text-[#E2E8F0]">{s.name}</td>
                      <td className="py-2 text-[#64748B]">{s.packCode}</td>
                      <td className="py-2 text-xs text-[#94A3B8] capitalize">{s.role}</td>
                      <td className="py-2 text-xs text-[#4A5568]">{(s.resolvedCapabilities ?? []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* STATS */}
            {tab === "stats" && stats && (
              <div>
                <div className="mb-4 flex gap-4">
                  <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-4 text-center">
                    <div className="text-2xl font-bold text-[#00D4FF]">{stats.totalPacks}</div>
                    <div className="text-xs text-[#64748B]">Workforce Packs</div>
                  </div>
                  <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1829] p-4 text-center">
                    <div className="text-2xl font-bold text-[#E2E8F0]">{stats.totalSpecialists}</div>
                    <div className="text-xs text-[#64748B]">AI Specialists</div>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1E3A5F] text-left text-xs text-[#64748B]">
                      <th className="pb-2">Pack</th><th className="pb-2">Specialists</th><th className="pb-2">Orgs Granted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E3A5F]">
                    {(stats.packStats ?? []).map((ps: any) => (
                      <tr key={ps.code}>
                        <td className="py-2 text-[#E2E8F0]">{ps.name}</td>
                        <td className="py-2 text-[#94A3B8]">{ps.specialistCount}</td>
                        <td className="py-2 text-[#00D4FF]">{ps.orgCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
