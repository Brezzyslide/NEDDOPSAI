/**
 * Platform Connector Fleet — /platform/connector-fleet
 * Task #34: Shows all devices across all organisations.
 */
import { useEffect, useState, useCallback, Fragment } from "react";
import { Link } from "wouter";
import { usePlatformFetch } from "@/lib/platformApi";
import PlatformShell from "@/components/layout/PlatformShell";

interface FleetDevice {
  id: string;
  organizationId: string;
  orgName: string | null;
  displayName: string;
  platform: string;
  arch?: string;
  hostname?: string;
  osVersion?: string;
  appVersion?: string;
  brokerVersion?: string;
  status: string;
  onlineStatus: "online" | "offline" | "never_connected";
  isPlatformDisabled: boolean;
  platformDisabledReason?: string | null;
  lastHeartbeatAt: string | null;
  firstRunCompletedAt: string | null;
  registeredAt: string;
  revokedAt: string | null;
  tunnelUrl?: string | null;
}

const PLATFORM_ICON: Record<string, string> = {
  macos: "🍎", windows: "🪟", linux: "🐧",
};

const ONLINE_COLORS: Record<string, string> = {
  online:          "bg-emerald-950/30 text-emerald-400",
  offline:         "bg-[#1E3A5F] text-[#64748B]",
  never_connected: "bg-amber-950/30 text-amber-400",
};

const ONLINE_LABELS: Record<string, string> = {
  online:          "Online",
  offline:         "Offline",
  never_connected: "Never connected",
};

function heartbeatAgo(ts: string | null): string {
  if (!ts) return "Never";
  const secs = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function DeviceActionBar({
  device, fetch, onRefresh,
}: {
  device: FleetDevice;
  fetch: ReturnType<typeof usePlatformFetch>;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const doAction = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await fetch(`/devices/${device.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error?.message ?? "Action failed."); }
      else { onRefresh(); }
    } finally { setBusy(false); }
  };

  if (device.status === "revoked") {
    return <span className="text-xs text-[#4A5568]">Revoked</span>;
  }

  return (
    <div className="flex items-center gap-2">
      {device.isPlatformDisabled ? (
        <button
          onClick={() => doAction("enable")}
          disabled={busy}
          className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
        >
          Enable
        </button>
      ) : (
        <button
          onClick={() => {
            const r = window.prompt("Reason for disabling this device:");
            if (!r) return;
            doAction("disable", { reason: r });
          }}
          disabled={busy}
          className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50"
        >
          Disable
        </button>
      )}
      <span className="text-[#1E3A5F]">·</span>
      <button
        onClick={() => {
          const r = window.prompt("Rotate credentials? The device will need to be re-activated. Reason:");
          if (!r) return;
          doAction("rotate-credentials", { reason: r });
        }}
        disabled={busy}
        className="text-xs text-[#00D4FF] hover:text-[#00B8D9] disabled:opacity-50"
      >
        Rotate creds
      </button>
      <span className="text-[#1E3A5F]">·</span>
      <button
        onClick={() => {
          const r = window.prompt("Permanently revoke this device? This cannot be undone. Reason:");
          if (!r) return;
          if (!window.confirm("Confirm permanent revocation?")) return;
          doAction("revoke", { reason: r });
        }}
        disabled={busy}
        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
      >
        Revoke
      </button>
    </div>
  );
}

export default function PlatformConnectorFleet() {
  const fetch = usePlatformFetch();
  const [devices, setDevices] = useState<FleetDevice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [orgFilter, setOrgFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expandable row state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedData, setExpandedData] = useState<Record<string, { errors: any[]; history: any[] }>>({});

  const load = useCallback((pg: number, org: string, status: string, s: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(pg), limit: "50" });
    if (org)    params.set("orgId", org);
    if (status) params.set("status", status);
    if (s)      params.set("search", s);
    fetch(`/devices?${params}`)
      .then(r => r.json())
      .then(d => { setDevices(d.devices ?? []); setTotal(d.total ?? 0); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [fetch]);

  useEffect(() => { load(page, orgFilter, statusFilter, search); }, [page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    load(1, orgFilter, statusFilter, search);
  };

  const toggleExpand = async (deviceId: string) => {
    if (expandedId === deviceId) { setExpandedId(null); return; }
    setExpandedId(deviceId);
    if (expandedData[deviceId]) return;

    const [errRes, histRes] = await Promise.all([
      fetch(`/devices/${deviceId}/errors`).then(r => r.json()).catch(() => ({ errors: [] })),
      fetch(`/devices/${deviceId}/history`).then(r => r.json()).catch(() => ({ events: [] })),
    ]);
    setExpandedData(prev => ({
      ...prev,
      [deviceId]: { errors: errRes.errors ?? [], history: histRes.events ?? [] },
    }));
  };

  return (
    <PlatformShell>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1E3A5F] px-6">
          <h1 className="text-lg font-semibold text-[#E2E8F0]">Connector Fleet</h1>
          <span className="text-sm text-[#64748B]">{total} device{total !== 1 ? "s" : ""}</span>
        </header>

        {/* Filters */}
        <form
          onSubmit={handleSearch}
          className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#1E3A5F] bg-[#0B1829] px-6 py-3"
        >
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search device name, org, hostname…"
            className="flex-1 min-w-48 rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0] placeholder-[#4A5568] focus:border-[#00D4FF] focus:outline-none"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#1E3A5F] bg-[#08111e] px-3 py-1.5 text-sm text-[#E2E8F0]"
          >
            <option value="">All statuses</option>
            <option value="connected">Connected</option>
            <option value="pending">Pending</option>
            <option value="disconnected">Disconnected</option>
            <option value="revoked">Revoked</option>
          </select>
          <button type="submit" className="rounded-lg bg-[#00D4FF] px-4 py-1.5 text-sm font-semibold text-[#0B1829]">
            Search
          </button>
        </form>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
            </div>
          )}
          {error && (
            <div className="m-4 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-400">{error}</div>
          )}
          {!loading && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#0B1829]">
                <tr className="border-b border-[#1E3A5F] text-left text-xs font-medium uppercase tracking-wider text-[#64748B]">
                  <th className="px-4 py-3">Device</th>
                  <th className="px-4 py-3">Organisation</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last seen</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Actions</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E3A5F]">
                {devices.map(dev => (
                  <Fragment key={dev.id}>
                  <tr
                    className={`group hover:bg-[#0B1829]/50 ${dev.isPlatformDisabled ? "opacity-60" : ""}`}
                  >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{PLATFORM_ICON[dev.platform] ?? "💻"}</span>
                          <div>
                            <div className="font-medium text-[#E2E8F0]">{dev.displayName}</div>
                            <div className="text-xs text-[#4A5568]">
                              {dev.hostname && `${dev.hostname} · `}
                              {dev.platform}{dev.arch && ` ${dev.arch}`}
                            </div>
                          </div>
                        </div>
                        {dev.isPlatformDisabled && (
                          <span className="mt-0.5 block text-xs text-amber-400">⚠ Disabled by platform</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/platform/organisations/${dev.organizationId}`}>
                          <a className="text-[#00D4FF] hover:underline">{dev.orgName ?? dev.organizationId}</a>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ONLINE_COLORS[dev.onlineStatus]}`}>
                          {ONLINE_LABELS[dev.onlineStatus]}
                        </span>
                        {dev.revokedAt && (
                          <div className="mt-0.5 text-xs text-red-400">Revoked</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#94A3B8]">
                        {heartbeatAgo(dev.lastHeartbeatAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#64748B]">
                        {dev.appVersion ? `app v${dev.appVersion}` : "—"}
                        {dev.brokerVersion && (
                          <div className="text-[10px] text-[#4A5568]">broker v{dev.brokerVersion}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <DeviceActionBar
                          device={dev}
                          fetch={fetch}
                          onRefresh={() => load(page, orgFilter, statusFilter, search)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleExpand(dev.id)}
                          className="text-xs text-[#64748B] hover:text-[#E2E8F0]"
                        >
                          {expandedId === dev.id ? "▲" : "▼"}
                        </button>
                      </td>
                    </tr>
                    {expandedId === dev.id && (
                      <tr className="bg-[#08111e]">
                        <td colSpan={7} className="px-8 py-4">
                          <div className="grid grid-cols-2 gap-6">
                            {/* Error history */}
                            <div>
                              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-[#64748B]">Recent Errors</h4>
                              {!expandedData[dev.id] ? (
                                <div className="text-xs text-[#4A5568]">Loading…</div>
                              ) : expandedData[dev.id].errors.length === 0 ? (
                                <div className="text-xs text-[#4A5568]">No errors recorded.</div>
                              ) : (
                                expandedData[dev.id].errors.slice(0, 5).map((e: any, i: number) => (
                                  <div key={i} className="mb-1 rounded bg-red-950/20 px-2 py-1 text-xs text-red-400">
                                    <span className="text-[#4A5568]">{e.reportedAt ? new Date(e.reportedAt).toLocaleString() : "—"}</span>
                                    {" · "}{e.errorMessage}
                                  </div>
                                ))
                              )}
                            </div>
                            {/* Audit history */}
                            <div>
                              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-[#64748B]">Device History</h4>
                              {!expandedData[dev.id] ? (
                                <div className="text-xs text-[#4A5568]">Loading…</div>
                              ) : expandedData[dev.id].history.length === 0 ? (
                                <div className="text-xs text-[#4A5568]">No platform events recorded.</div>
                              ) : (
                                expandedData[dev.id].history.slice(0, 5).map((ev: any, i: number) => (
                                  <div key={i} className="mb-1 text-xs text-[#94A3B8]">
                                    <span className="text-[#4A5568]">{ev.occurredAt ? new Date(ev.occurredAt).toLocaleString() : "—"}</span>
                                    {" · "}<span className="font-mono">{ev.eventType}</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                          <div className="mt-3 text-xs text-[#4A5568]">
                            Device ID: <code className="text-[#64748B]">{dev.id}</code>
                            {" · "}Registered {new Date(dev.registeredAt).toLocaleDateString("en-AU")}
                            {dev.tunnelUrl && <> · Tunnel: <code className="text-[#64748B]">{dev.tunnelUrl}</code></>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {devices.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-[#4A5568]">
                      No devices found.
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
            <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}
              className="rounded px-3 py-1 hover:bg-[#1E3A5F] disabled:opacity-40">Next →</button>
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
