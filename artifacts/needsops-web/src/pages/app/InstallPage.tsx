/**
 * Install Page — /app/:slug/install
 * Sprint 14
 *
 * Shown after successful payment/trial activation.
 * - Detects Windows or macOS from User-Agent
 * - Generates and displays a short-lived activation code
 * - Links to installer download for each platform
 * - Tracks connection status after installation
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useAuthFetch } from "@/lib/api";
import AppShell from "@/components/layout/AppShell";

// ── OS detection ──────────────────────────────────────────────────────────────

function detectOS(): "macos" | "windows" | "other" {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad/.test(ua)) return "macos";
  if (/Win/.test(ua)) return "windows";
  return "other";
}

function detectArch(): "arm64" | "x64" {
  // Best-effort — navigator.platform is deprecated but still works
  const p = (navigator as any).userAgentData?.platform ?? navigator.platform ?? "";
  if (p.toLowerCase().includes("arm") || p.toLowerCase().includes("apple")) return "arm64";
  return "x64";
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface InstallerRelease {
  id: string;
  version: string;
  platform: string;
  arch: string;
  downloadUrl: string;
  sha256?: string;
  releaseNotes?: string;
}

interface ActivationCode {
  id: string;
  code: string;
  expiresAt: string;
  expiresInMinutes: number;
}

interface Device {
  id: string;
  displayName: string;
  platform: string;
  status: string;
  lastHeartbeatAt: string | null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

const WIN_STEPS = [
  "Download the NeedsOps AI+ installer above",
  "Open the downloaded .exe file",
  "Click Install — no administrator rights needed",
  "NeedsOps AI+ will launch automatically",
  "Enter your activation code when prompted",
];
const MAC_STEPS = [
  "Download the NeedsOps AI+ .dmg file above",
  "Open the .dmg and drag NeedsOps AI+ to Applications",
  "Open NeedsOps AI+ from your Applications folder",
  "If macOS shows a warning, right-click then Open to proceed (development builds only)",
  "Enter your activation code when prompted",
];

function InstallSteps({ selectedOS }: { selectedOS: "macos" | "windows" }) {
  const steps = selectedOS === "windows" ? WIN_STEPS : MAC_STEPS;
  return (
    <div className="mb-6 p-5 rounded-xl border border-[#1E3A5F] bg-[#112033]">
      <p className="text-[#E2E8F0] font-semibold text-sm mb-4">How to install</p>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className="shrink-0 w-5 h-5 rounded-full bg-[#1E3A5F] text-[#94A3B8] text-xs flex items-center justify-center font-medium">{i + 1}</span>
            <span className="text-[#94A3B8]">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function InstallPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const apiFetch = useAuthFetch();

  const [detectedOS] = useState(detectOS);
  const [selectedOS, setSelectedOS] = useState<"macos" | "windows">(detectedOS === "windows" ? "windows" : "macos");
  const [selectedArch, setSelectedArch] = useState<"arm64" | "x64">(detectArch());

  const [activationCode, setActivationCode] = useState<ActivationCode | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeTimeLeft, setCodeTimeLeft] = useState<number>(0);

  const [releases, setReleases] = useState<Record<string, InstallerRelease>>({});
  const [releasesLoading, setReleasesLoading] = useState(true);

  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  // ── Load installer releases ────────────────────────────────────────────────

  useEffect(() => {
    setReleasesLoading(true);
    fetch("/v1/installer/latest.json?channel=stable")
      .then(r => r.json())
      .then(d => {
        const map: Record<string, InstallerRelease> = {};
        for (const release of (d.releases ?? [])) {
          map[`${release.platform}-${release.arch}`] = release;
        }
        setReleases(map);
      })
      .catch(() => {})
      .finally(() => setReleasesLoading(false));
  }, []);

  // ── Generate activation code ───────────────────────────────────────────────

  const generateCode = useCallback(async () => {
    if (!slug) return;
    setCodeLoading(true);
    try {
      const res = await apiFetch(`/v1/organisations/${slug}/activation-codes`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setActivationCode(data.activationCode);
        const expiresAt = new Date(data.activationCode.expiresAt).getTime();
        setCodeTimeLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
      }
    } catch { }
    finally { setCodeLoading(false); }
  }, [slug, apiFetch]);

  useEffect(() => {
    generateCode();
  }, [generateCode]);

  // Countdown timer
  useEffect(() => {
    if (codeTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setCodeTimeLeft(t => {
        if (t <= 1) { clearInterval(timer); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [codeTimeLeft]);

  // ── Poll device status ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!slug) return;
    let interval: ReturnType<typeof setInterval>;

    const fetchDevices = async () => {
      setDevicesLoading(true);
      try {
        const res = await apiFetch(`/v1/organisations/${slug}/devices`);
        const data = await res.json();
        setDevices(data.devices ?? []);
      } catch { }
      finally { setDevicesLoading(false); }
    };

    fetchDevices();
    interval = setInterval(fetchDevices, 15000); // poll every 15s
    return () => clearInterval(interval);
  }, [slug, apiFetch]);

  // ── Derived values ─────────────────────────────────────────────────────────

  const connectedDevices = devices.filter(d => d.status === "connected");
  const hasConnectedDevice = connectedDevices.length > 0;

  const currentRelease = releases[`${selectedOS}-${selectedArch}`]
    ?? releases[`${selectedOS}-arm64`]
    ?? releases[`${selectedOS}-x64`]
    ?? null;

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ── Mobile warning ─────────────────────────────────────────────────────────

  const isMobile = /Android|iPhone|iPad/.test(navigator.userAgent);

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">💻</span>
            <h1 className="text-2xl font-bold text-[#E2E8F0]">Install NeedsOps AI+</h1>
          </div>
          <p className="text-[#64748B]">
            Connect this computer to your NeedsOps workspace to run your AI employees locally.
          </p>
        </div>

        {/* Connected device banner */}
        {hasConnectedDevice && (
          <div className="mb-6 p-4 rounded-xl border border-green-500/30 bg-green-900/10">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-green-400">✓</span>
              <span className="text-green-400 font-semibold text-sm">Device connected</span>
            </div>
            {connectedDevices.map(d => (
              <p key={d.id} className="text-[#94A3B8] text-sm">
                {d.displayName} ({d.platform}) — connected
              </p>
            ))}
            <button
              onClick={() => setLocation(`/app/${slug}`)}
              className="mt-3 px-4 py-2 bg-[#00D4FF] text-[#0B1829] text-sm font-semibold rounded-lg hover:bg-[#00B8D9] transition-colors"
            >
              Open dashboard →
            </button>
          </div>
        )}

        {/* Mobile notice */}
        {isMobile && (
          <div className="mb-6 p-4 rounded-xl border border-[#1E3A5F] bg-[#112033]">
            <p className="text-[#E2E8F0] text-sm font-medium mb-1">📱 Install on a computer</p>
            <p className="text-[#64748B] text-sm">
              NeedsOps AI+ needs to be installed on a Windows PC or Mac. Open this page on your computer to download and install.
            </p>
          </div>
        )}

        {/* OS selector */}
        <div className="mb-6">
          <p className="text-[#94A3B8] text-sm mb-3">Select your operating system:</p>
          <div className="flex gap-3">
            {(["macos", "windows"] as const).map(os => (
              <button
                key={os}
                onClick={() => {
                  setSelectedOS(os);
                  setSelectedArch(os === "macos" ? "arm64" : "x64");
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all"
                style={{
                  borderColor: selectedOS === os ? "#00D4FF" : "#1E3A5F",
                  background: selectedOS === os ? "#00D4FF10" : "#0B1829",
                  color: selectedOS === os ? "#00D4FF" : "#64748B",
                }}
              >
                <span>{os === "macos" ? "🍎" : "🪟"}</span>
                {os === "macos" ? "macOS" : "Windows"}
                {detectedOS === os && <span className="text-xs opacity-70">(detected)</span>}
              </button>
            ))}
          </div>
          {selectedOS === "macos" && (
            <div className="flex gap-2 mt-2">
              {(["arm64", "x64"] as const).map(arch => (
                <button
                  key={arch}
                  onClick={() => setSelectedArch(arch)}
                  className="text-xs px-3 py-1 rounded-lg border transition-all"
                  style={{
                    borderColor: selectedArch === arch ? "#00D4FF" : "#1E3A5F",
                    color: selectedArch === arch ? "#00D4FF" : "#64748B",
                  }}
                >
                  {arch === "arm64" ? "Apple Silicon (M1/M2/M3)" : "Intel"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Download card */}
        <div className="mb-6 p-5 rounded-xl border border-[#1E3A5F] bg-[#112033]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[#E2E8F0] font-semibold mb-1">
                NeedsOps AI+ for {selectedOS === "macos" ? "macOS" : "Windows"}
                {selectedOS === "macos" && ` (${selectedArch === "arm64" ? "Apple Silicon" : "Intel"})`}
              </p>
              {currentRelease ? (
                <>
                  <p className="text-[#64748B] text-xs">Version {currentRelease.version}</p>
                  {currentRelease.sha256 && (
                    <p className="text-[#475569] text-xs mt-1 font-mono">SHA-256: {currentRelease.sha256.slice(0, 16)}…</p>
                  )}
                </>
              ) : releasesLoading ? (
                <p className="text-[#64748B] text-xs">Loading release info…</p>
              ) : (
                <p className="text-[#64748B] text-xs">Release not yet published — check back soon</p>
              )}
            </div>
            {currentRelease ? (
              <a
                href={currentRelease.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 px-4 py-2.5 bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg hover:bg-[#00B8D9] transition-colors text-sm whitespace-nowrap"
              >
                Download ↓
              </a>
            ) : (
              <button disabled className="shrink-0 px-4 py-2.5 bg-[#1E3A5F] text-[#475569] font-semibold rounded-lg text-sm cursor-not-allowed">
                Not available
              </button>
            )}
          </div>

          {/* Development build warning */}
          {currentRelease?.releaseNotes?.toLowerCase().includes("development") && (
            <div className="mt-3 p-3 rounded-lg bg-amber-900/10 border border-amber-500/20">
              <p className="text-amber-400 text-xs font-medium">Development build</p>
              <p className="text-amber-400/70 text-xs mt-0.5">{currentRelease.releaseNotes}</p>
            </div>
          )}
        </div>

        {/* Activation code */}
        <div className="mb-6 p-5 rounded-xl border border-[#1E3A5F] bg-[#112033]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[#E2E8F0] font-semibold text-sm">Activation code</p>
            {codeTimeLeft > 0 && (
              <span className={`text-xs font-mono ${codeTimeLeft < 120 ? "text-amber-400" : "text-[#64748B]"}`}>
                Expires in {formatTime(codeTimeLeft)}
              </span>
            )}
            {codeTimeLeft === 0 && activationCode && (
              <span className="text-xs text-red-400">Expired</span>
            )}
          </div>

          {codeLoading ? (
            <div className="h-12 bg-[#0B1829] rounded-lg animate-pulse" />
          ) : activationCode && codeTimeLeft > 0 ? (
            <div className="flex items-center gap-3">
              <code className="flex-1 text-center text-xl font-bold font-mono tracking-[0.2em] text-[#00D4FF] bg-[#00D4FF]/5 border border-[#00D4FF]/20 rounded-lg py-3 px-4">
                {activationCode.code}
              </code>
              <button
                onClick={() => navigator.clipboard?.writeText(activationCode.code)}
                className="shrink-0 p-2 rounded-lg border border-[#1E3A5F] text-[#64748B] hover:text-[#E2E8F0] hover:border-[#00D4FF] transition-colors"
                title="Copy code"
              >
                📋
              </button>
            </div>
          ) : (
            <button
              onClick={generateCode}
              disabled={codeLoading}
              className="w-full py-3 border border-[#1E3A5F] text-[#64748B] rounded-lg hover:border-[#00D4FF] hover:text-[#E2E8F0] transition-colors text-sm"
            >
              {codeLoading ? "Generating…" : "Generate a new activation code"}
            </button>
          )}

          <p className="text-[#475569] text-xs mt-3">
            Enter this code in the NeedsOps AI+ app after installation. Codes expire after 15 minutes and can only be used once.
          </p>

          {codeTimeLeft === 0 && activationCode && (
            <button
              onClick={generateCode}
              className="mt-2 text-[#00D4FF] text-xs hover:underline"
            >
              Generate a new code
            </button>
          )}
        </div>

        {/* Installation steps */}
        <InstallSteps selectedOS={selectedOS} />

        {/* Device status */}
        {devices.length > 0 && (
          <div className="mb-6 p-5 rounded-xl border border-[#1E3A5F] bg-[#112033]">
            <p className="text-[#E2E8F0] font-semibold text-sm mb-3">Registered devices</p>
            <div className="space-y-2">
              {devices.map(d => (
                <div key={d.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{d.platform === "macos" ? "🍎" : "🪟"}</span>
                    <span className="text-[#E2E8F0] text-sm">{d.displayName}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    d.status === "connected" ? "bg-green-900/30 text-green-400" :
                    d.status === "pending" ? "bg-amber-900/30 text-amber-400" :
                    "bg-[#1E3A5F] text-[#64748B]"
                  }`}>
                    {d.status === "connected" ? "● Connected" : d.status === "pending" ? "● Pending" : "○ Offline"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skip link */}
        <div className="text-center">
          <button
            onClick={() => setLocation(`/app/${slug}`)}
            className="text-[#475569] text-sm hover:text-[#64748B] transition-colors"
          >
            Skip for now — I'll install later
          </button>
          <p className="text-[#475569] text-xs mt-1">You can return to this page from your dashboard at any time.</p>
        </div>
      </div>
    </AppShell>
  );
}
