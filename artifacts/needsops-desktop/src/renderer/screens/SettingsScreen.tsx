/**
 * SettingsScreen
 * Device settings: startup, disconnect/sign-out
 */
import { useState, useEffect } from "react";

interface Props {
  onBack: () => void;
  onSignOut: () => Promise<void>;
}

export default function SettingsScreen({ onBack, onSignOut }: Props) {
  const [info, setInfo] = useState<{ platform: string; arch: string; appVersion: string; electronVersion: string; nodeVersion: string; isDev: boolean } | null>(null);
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    window.needsops?.platform?.info?.().then(setInfo).catch(() => {});
    window.needsops?.credentials?.load?.().then(c => {
      setOrgSlug(c.orgSlug);
      setDeviceId(c.deviceId);
    }).catch(() => {});
  }, []);

  const handleSignOut = async () => {
    if (!confirm("Disconnect this device from NeedsOps? Your AI employees will stop running on this computer.")) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  const ROW = "flex items-center justify-between py-3 border-b border-[#1E3A5F]";
  const LABEL = "text-[#64748B] text-sm";
  const VALUE = "text-[#E2E8F0] text-sm font-mono";

  return (
    <div className="flex flex-col h-full">
      <div className="drag-region h-8 shrink-0" />

      <div className="flex-1 flex flex-col px-8 pb-8 overflow-y-auto">
        <button
          onClick={onBack}
          className="self-start text-[#64748B] text-sm mb-6 hover:text-[#94A3B8] transition-colors no-drag"
        >
          ← Back
        </button>

        <h1 className="text-2xl font-bold text-[#E2E8F0] mb-6">Settings</h1>

        {/* Device info */}
        <div className="bg-[#112033] rounded-xl border border-[#1E3A5F] px-4 mb-6">
          {orgSlug && (
            <div className={ROW}>
              <span className={LABEL}>Organisation</span>
              <span className={VALUE}>{orgSlug}</span>
            </div>
          )}
          {deviceId && (
            <div className={ROW}>
              <span className={LABEL}>Device ID</span>
              <span className="text-[#475569] text-xs font-mono truncate max-w-[180px]">{deviceId}</span>
            </div>
          )}
          {info && (
            <>
              <div className={ROW}>
                <span className={LABEL}>Platform</span>
                <span className={VALUE}>{info.platform} ({info.arch})</span>
              </div>
              <div className={ROW}>
                <span className={LABEL}>App version</span>
                <span className={VALUE}>{info.appVersion}{info.isDev ? " (dev)" : ""}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className={LABEL}>Electron</span>
                <span className={VALUE}>{info.electronVersion}</span>
              </div>
            </>
          )}
        </div>

        {/* Open portal */}
        <button
          onClick={() => window.needsops?.shell?.openExternal?.("https://app.needsops.com")}
          className="w-full py-3 mb-3 border border-[#1E3A5F] text-[#E2E8F0] text-sm rounded-xl hover:border-[#00D4FF] hover:bg-[#00D4FF]/5 transition-all"
        >
          🌐 Open NeedsOps portal
        </button>

        {/* Disconnect */}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full py-3 border border-red-800/30 text-red-400 text-sm rounded-xl hover:border-red-500/50 hover:bg-red-900/10 transition-all disabled:opacity-50"
        >
          {signingOut ? "Disconnecting…" : "Disconnect this device"}
        </button>

        <p className="text-[#475569] text-xs text-center mt-4">
          Disconnecting removes this device from your workspace.
          You'll need to re-activate with a new code.
        </p>
      </div>
    </div>
  );
}
