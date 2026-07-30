/**
 * Devices Page — /app/:slug/devices
 * Sprint 14
 *
 * Lists all registered devices for the org.
 * Allows renaming and revoking devices.
 */
import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useAuthFetch } from "@/lib/api";
import AppShell from "@/components/layout/AppShell";

interface Device {
  id: string;
  displayName: string;
  platform: string;
  arch?: string;
  status: string;
  appVersion?: string;
  brokerVersion?: string;
  lastHeartbeatAt: string | null;
  firstRunCompletedAt: string | null;
  registeredAt: string;
}

const STATUS_LABEL: Record<string, { label: string; colour: string }> = {
  connected: { label: "Connected", colour: "text-green-400 bg-green-900/30" },
  pending: { label: "Pending setup", colour: "text-amber-400 bg-amber-900/30" },
  disconnected: { label: "Offline", colour: "text-[#64748B] bg-[#1E3A5F]/50" },
  revoked: { label: "Revoked", colour: "text-red-400 bg-red-900/30" },
};

export default function DevicesPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const fetchDevices = async () => {
    try {
      const res = await apiFetch(`/v1/organisations/${slug}/devices`);
      const data = await res.json();
      setDevices(data.devices ?? []);
    } catch (e) {
      setError("Failed to load devices.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDevices(); }, [slug]);

  const revokeDevice = async (deviceId: string, deviceName: string) => {
    if (!confirm(`Revoke "${deviceName}"? The AI employees on that device will disconnect immediately.`)) return;
    setRevoking(deviceId);
    try {
      const res = await apiFetch(`/v1/organisations/${slug}/devices/${deviceId}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: "Revoked by user from portal" }),
      });
      if (res.ok) {
        setDevices(ds => ds.map(d => d.id === deviceId ? { ...d, status: "revoked" } : d));
      } else {
        const data = await res.json();
        setError(data.error?.message ?? "Failed to revoke device.");
      }
    } catch { setError("Network error."); }
    finally { setRevoking(null); }
  };

  const renameDevice = async (deviceId: string) => {
    if (!newName.trim()) return;
    try {
      const res = await apiFetch(`/v1/organisations/${slug}/devices/${deviceId}/name`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: newName.trim() }),
      });
      if (res.ok) {
        setDevices(ds => ds.map(d => d.id === deviceId ? { ...d, displayName: newName.trim() } : d));
        setRenaming(null);
        setNewName("");
      }
    } catch { setError("Network error."); }
  };

  const heartbeatAgo = (ts: string | null) => {
    if (!ts) return "Never";
    const secs = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  };

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Connected Devices</h1>
            <p className="text-[#64748B] text-sm mt-1">
              Computers with NeedsOps AI+ installed and connected to this workspace.
            </p>
          </div>
          <button
            onClick={() => setLocation(`/app/${slug}/install`)}
            className="px-4 py-2 bg-[#00D4FF] text-[#0B1829] font-semibold text-sm rounded-lg hover:bg-[#00B8D9] transition-colors"
          >
            + Add device
          </button>
        </div>

        {error && (
          <p className="mb-4 text-red-400 text-sm bg-red-900/10 border border-red-800/30 rounded-lg px-3 py-2">{error}</p>
        )}

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-[#112033] border border-[#1E3A5F] animate-pulse" />
            ))}
          </div>
        ) : devices.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-[#1E3A5F] rounded-xl">
            <div className="text-4xl mb-3">💻</div>
            <p className="text-[#E2E8F0] font-medium mb-2">No devices connected</p>
            <p className="text-[#64748B] text-sm mb-4">Install NeedsOps AI+ on a computer to connect it to your workspace.</p>
            <button
              onClick={() => setLocation(`/app/${slug}/install`)}
              className="px-5 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold text-sm rounded-lg hover:bg-[#00B8D9] transition-colors"
            >
              Install NeedsOps AI+
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {devices.map(device => {
              const statusInfo = STATUS_LABEL[device.status] ?? STATUS_LABEL.disconnected;
              return (
                <div key={device.id} className="p-4 rounded-xl border border-[#1E3A5F] bg-[#112033]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="text-2xl shrink-0 mt-0.5">
                        {device.platform === "macos" ? "🍎" : device.platform === "windows" ? "🪟" : "💻"}
                      </span>
                      <div className="min-w-0">
                        {renaming === device.id ? (
                          <div className="flex gap-2 mb-1">
                            <input
                              value={newName}
                              onChange={e => setNewName(e.target.value)}
                              onKeyDown={e => e.key === "Enter" && renameDevice(device.id)}
                              className="bg-[#0B1829] border border-[#00D4FF] rounded px-2 py-1 text-[#E2E8F0] text-sm focus:outline-none"
                              autoFocus
                            />
                            <button onClick={() => renameDevice(device.id)} className="text-[#00D4FF] text-xs">Save</button>
                            <button onClick={() => { setRenaming(null); setNewName(""); }} className="text-[#64748B] text-xs">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <p className="text-[#E2E8F0] font-medium text-sm truncate">{device.displayName}</p>
                            <button
                              onClick={() => { setRenaming(device.id); setNewName(device.displayName); }}
                              className="text-[#475569] text-xs hover:text-[#64748B] transition-colors shrink-0"
                            >
                              rename
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${statusInfo.colour}`}>
                            {statusInfo.label}
                          </span>
                          <span className="text-[#475569] text-xs">
                            {device.platform === "macos" ? "macOS" : device.platform === "windows" ? "Windows" : device.platform}
                            {device.arch && ` · ${device.arch}`}
                          </span>
                          {device.appVersion && (
                            <span className="text-[#475569] text-xs">v{device.appVersion}</span>
                          )}
                        </div>
                        <p className="text-[#475569] text-xs mt-1">
                          Last seen: {heartbeatAgo(device.lastHeartbeatAt)}
                          {" · "}Registered {new Date(device.registeredAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {device.status !== "revoked" && (
                      <button
                        onClick={() => revokeDevice(device.id, device.displayName)}
                        disabled={revoking === device.id}
                        className="shrink-0 px-3 py-1.5 border border-red-800/30 text-red-400 text-xs rounded-lg hover:border-red-500/50 hover:bg-red-900/10 transition-colors disabled:opacity-50"
                      >
                        {revoking === device.id ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 p-4 rounded-xl bg-[#112033] border border-[#1E3A5F]">
          <p className="text-[#94A3B8] text-xs">
            <strong className="text-[#E2E8F0]">Security tip:</strong>{" "}
            Revoke a device immediately if it's lost or stolen. Revoking disconnects the device and prevents it from running AI tasks.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
