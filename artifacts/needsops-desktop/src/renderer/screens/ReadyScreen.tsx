/**
 * ReadyScreen
 * Main status screen shown while the app runs in the background.
 * Displays broker status and provides quick actions.
 */
import { useState, useEffect } from "react";

interface Props {
  onSettings: () => void;
}

type BrokerStatus = "stopped" | "starting" | "running" | "error";

export default function ReadyScreen({ onSettings }: Props) {
  const [status, setStatus] = useState<BrokerStatus>("stopped");
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    // Load credentials to show org
    window.needsops?.credentials?.load?.().then(creds => {
      setOrgSlug(creds.orgSlug);
    }).catch(() => {});

    // Get current broker status
    window.needsops?.broker?.getStatus?.().then(s => {
      setStatus(s.status);
      setError(s.error);
    }).catch(() => {});

    // Subscribe to status updates
    window.needsops?.broker?.onStatus?.(({ status: s, error: e }) => {
      setStatus(s);
      setError(e);
    });

    window.needsops?.broker?.onLog?.((line) => {
      setLogLines(prev => [...prev.slice(-50), line]);
    });

    return () => {
      window.needsops?.broker?.offAll?.();
    };
  }, []);

  const statusConfig: Record<BrokerStatus, { label: string; colour: string; icon: string }> = {
    stopped: { label: "Disconnected", colour: "text-[#64748B]", icon: "○" },
    starting: { label: "Connecting…", colour: "text-amber-400", icon: "◌" },
    running: { label: "Connected", colour: "text-green-400", icon: "●" },
    error: { label: "Error", colour: "text-red-400", icon: "✕" },
  };

  const { label, colour, icon } = statusConfig[status];

  const handleOpenPortal = () => {
    const url = orgSlug
      ? `https://app.needsops.com/app/${orgSlug}`
      : "https://app.needsops.com";
    window.needsops?.shell?.openExternal?.(url);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="drag-region h-8 shrink-0" />

      <div className="flex-1 flex flex-col px-8 pb-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="text-xl">⬡</span>
            <span className="text-[#E2E8F0] font-bold text-sm">NeedsOps AI+</span>
          </div>
          <button
            onClick={onSettings}
            className="text-[#64748B] hover:text-[#94A3B8] transition-colors text-sm"
          >
            ⚙️ Settings
          </button>
        </div>

        {/* Status card */}
        <div className="p-5 rounded-xl border border-[#1E3A5F] bg-[#112033] mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-sm font-semibold ${colour}`}>
              {icon} {label}
            </span>
            {orgSlug && (
              <span className="text-[#475569] text-xs font-mono">{orgSlug}</span>
            )}
          </div>

          {status === "running" && (
            <p className="text-[#64748B] text-xs">
              Your AI employees are running and ready to receive tasks.
            </p>
          )}
          {status === "stopped" && (
            <p className="text-[#64748B] text-xs">
              NeedsOps AI+ is not connected. Your AI employees cannot receive tasks.
            </p>
          )}
          {status === "error" && error && (
            <p className="text-red-400 text-xs">{error}</p>
          )}
          {status === "starting" && (
            <p className="text-amber-400/80 text-xs">Establishing connection to NeedsOps…</p>
          )}
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={handleOpenPortal}
            className="py-3 px-4 rounded-xl border border-[#1E3A5F] text-[#E2E8F0] text-sm hover:border-[#00D4FF] hover:bg-[#00D4FF]/5 transition-all"
          >
            🌐 Open portal
          </button>
          <button
            onClick={() => setShowLogs(s => !s)}
            className="py-3 px-4 rounded-xl border border-[#1E3A5F] text-[#E2E8F0] text-sm hover:border-[#00D4FF] hover:bg-[#00D4FF]/5 transition-all"
          >
            📋 {showLogs ? "Hide" : "View"} logs
          </button>
        </div>

        {/* Log panel */}
        {showLogs && (
          <div className="flex-1 bg-[#0B1829] rounded-xl border border-[#1E3A5F] p-3 overflow-y-auto min-h-0">
            {logLines.length === 0 ? (
              <p className="text-[#475569] text-xs font-mono">No log output yet…</p>
            ) : (
              logLines.map((line, i) => (
                <p key={i} className="text-[#64748B] text-xs font-mono leading-relaxed">
                  {line}
                </p>
              ))
            )}
          </div>
        )}

        {!showLogs && (
          <div className="flex-1 flex items-end justify-center">
            <p className="text-[#475569] text-xs text-center">
              NeedsOps AI+ runs in the menu bar.{"\n"}You can close this window any time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
