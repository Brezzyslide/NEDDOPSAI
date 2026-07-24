/**
 * Platform Organisations — /platform/organisations
 * Searchable, filterable directory of all organisations.
 */
import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

interface Org {
  id: string; name: string; slug: string; status: string;
  subscriptionTier: string; activeMemberCount: number;
  subscription: { status: string; trialEndAt?: string; planId: string } | null;
  plan: { code: string; name: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400 bg-emerald-950/30",
  suspended: "text-yellow-400 bg-yellow-950/30",
  onboarding: "text-[#00D4FF] bg-[#00D4FF]/10",
  closed: "text-red-400 bg-red-950/30",
  trial: "text-purple-400 bg-purple-950/30",
  trial_expired: "text-red-400 bg-red-950/30",
};

export default function PlatformOrgs() {
  const fetch = usePlatformFetch();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((pg: number, s: string, st: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(pg), limit: "20" });
    if (s) params.set("search", s);
    if (st) params.set("status", st);
    fetch(`/organisations?${params}`)
      .then(r => r.json())
      .then(d => { setOrgs(d.organisations ?? []); setTotal(d.total ?? 0); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [fetch]);

  useEffect(() => { load(page, search, status); }, [page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    load(1, search, status);
  };

  const subStatusLabel = (org: Org) => org.subscription?.status ?? "no subscription";

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Organisations</h1>
          <span className="text-sm text-[#64748B]">{total} total</span>
        </header>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex shrink-0 items-center gap-3 border-b border-[#1E3A5F] bg-[#0B1829] px-6 py-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or slug…"
            className="flex-1 rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:outline-none focus:border-[#00D4FF]"
          />
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0]"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="onboarding">Onboarding</option>
            <option value="closed">Closed</option>
          </select>
          <button type="submit" className="rounded-lg bg-[#00D4FF] px-4 py-1.5 text-sm font-semibold text-[#0B1829]">
            Search
          </button>
          <a
            href="/v1/platform/export/organisations"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[#1E3A5F] px-3 py-1.5 text-sm text-[#64748B] hover:text-[#E2E8F0]"
          >
            CSV
          </a>
        </form>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
            </div>
          )}
          {error && <div className="m-4 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-400">{error}</div>}
          {!loading && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#0B1829]">
                <tr className="border-b border-[#1E3A5F] text-left text-xs font-medium uppercase tracking-wider text-[#64748B]">
                  <th className="px-6 py-3">Organisation</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Subscription</th>
                  <th className="px-4 py-3 text-right">Members</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A5F]">
                {orgs.map(org => (
                  <tr key={org.id} className="group hover:bg-[#0B1829]/50">
                    <td className="px-6 py-3">
                      <div className="font-medium text-[#E2E8F0]">{org.name}</div>
                      <div className="text-xs text-[#4A5568]">/{org.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[org.status] ?? "text-[#94A3B8]"}`}>
                        {org.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#94A3B8]">
                      {org.plan?.name ?? org.subscriptionTier ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs capitalize ${STATUS_COLORS[org.subscription?.status ?? ""] ?? "text-[#4A5568]"}`}>
                        {subStatusLabel(org)}
                      </span>
                      {org.subscription?.trialEndAt && (
                        <div className="text-xs text-[#4A5568]">
                          Trial ends {new Date(org.subscription.trialEndAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[#94A3B8]">{org.activeMemberCount}</td>
                    <td className="px-4 py-3">
                      <Link href={`/platform/organisations/${org.id}`}>
                        <a className="rounded bg-[#1E3A5F] px-2 py-1 text-xs text-[#00D4FF] hover:bg-[#00D4FF]/20">
                          View →
                        </a>
                      </Link>
                    </td>
                  </tr>
                ))}
                {orgs.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-sm text-[#4A5568]">
                      No organisations found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="flex shrink-0 items-center justify-between border-t border-[#1E3A5F] px-6 py-3 text-sm text-[#64748B]">
          <span>Page {page} · {total} total</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="rounded px-3 py-1 hover:bg-[#1E3A5F] disabled:opacity-40">← Prev</button>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}
              className="rounded px-3 py-1 hover:bg-[#1E3A5F] disabled:opacity-40">Next →</button>
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
