/**
 * ConnectingScreen
 * Starts the broker and shows connection progress.
 */
import { useState, useEffect } from "react";

interface Props {
  onSuccess: () => void;
  onError: () => void;
}

type Phase = "loading-creds" | "starting-broker" | "connected" | "error";

export default function ConnectingScreen({ onSuccess, onError }: Props) {
  const [phase, setPhase] = useState<Phase>("loading-creds");
  const [error, setError] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);

  useEffect(() => {
    // Subscribe to broker events
    window.needsops?.broker?.onStatus?.(({ status, error: brokerError }) => {
      if (status === "running") {
        setPhase("connected");
        setTimeout(onSuccess, 1500);
      } else if (status === "error") {
        setPhase("error");
        setError(brokerError ?? "Unknown error");
      }
    });

    window.needsops?.broker?.onLog?.((line) => {
      setLogLines(prev => [...prev.slice(-20), line]);
    });

    // Start the flow
    const run = async () => {
      // Load credentials
      const creds = await window.needsops?.credentials?.load?.();
      if (!creds?.deviceToken || !creds?.deviceId || !creds?.orgSlug) {
        setPhase("error");
        setError("Credentials not found. Please restart and activate again.");
        return;
      }

      setPhase("starting-broker");
      const result = await window.needsops?.broker?.start?.({
        orgSlug: creds.orgSlug,
        deviceId: creds.deviceId,
        deviceToken: creds.deviceToken,
        apiBaseUrl: creds.apiBaseUrl ?? "https://api.needsops.com",
      });

      if (result && !result.ok) {
        setPhase("error");
        setError(result.error ?? "Broker failed to start");
      }
    };

    run().catch(err => {
      setPhase("error");
      setError(String(err));
    });

    return () => {
      window.needsops?.broker?.offAll?.();
    };
  }, []);

  const phaseMessages: Record<Phase, string> = {
    "loading-creds": "Loading your credentials…",
    "starting-broker": "Starting your AI workforce…",
    "connected": "Connected! Starting dashboard…",
    "error": "Connection failed",
  };

  const steps = [
    { id: "loading-creds", label: "Loading credentials" },
    { id: "starting-broker", label: "Starting AI workforce engine" },
    { id: "connected", label: "Connected to NeedsOps" },
  ];

  const phaseOrder: Phase[] = ["loading-creds", "starting-broker", "connected"];
  const currentIdx = phaseOrder.indexOf(phase);

  return (
    <div className="flex flex-col h-full items-center justify-center px-8 pb-8">
      {phase !== "error" ? (
        <>
          <div className="relative mb-8">
            <div className="text-5xl animate-pulse">⬡</div>
          </div>

          <h1 className="text-xl font-bold text-[#E2E8F0] mb-2">{phaseMessages[phase]}</h1>
          <p className="text-[#64748B] text-sm mb-8 text-center max-w-xs">
            Your AI employees are getting ready. This usually takes under 10 seconds.
          </p>

          {/* Steps */}
          <div className="space-y-3 w-full max-w-xs mb-6">
            {steps.map((step, i) => {
              const stepPhase = step.id as Phase;
              const done = phaseOrder.indexOf(stepPhase) < currentIdx;
              const active = phase === stepPhase;
              return (
                <div key={step.id} className="flex items-center gap-3">
                  <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                    done ? "border-[#00D4FF] bg-[#00D4FF]" :
                    active ? "border-[#00D4FF] animate-pulse" :
                    "border-[#1E3A5F]"
                  }`}>
                    {done && <span className="text-[#0B1829] text-[8px] font-bold">✓</span>}
                  </div>
                  <span className={`text-sm ${done || active ? "text-[#E2E8F0]" : "text-[#475569]"}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Log preview */}
          {logLines.length > 0 && (
            <div className="w-full max-w-xs bg-[#0B1829] rounded-lg p-2 max-h-20 overflow-hidden">
              {logLines.slice(-3).map((l, i) => (
                <p key={i} className="text-[#475569] text-xs font-mono truncate">{l}</p>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="text-5xl mb-6">⚠️</div>
          <h1 className="text-xl font-bold text-[#E2E8F0] mb-2">Connection failed</h1>
          <p className="text-red-400 text-sm mb-6 text-center max-w-xs">{error}</p>
          <button
            onClick={() => {
              setPhase("loading-creds");
              setError("");
              onError();
            }}
            className="px-6 py-2.5 bg-[#1E3A5F] text-[#E2E8F0] rounded-xl hover:bg-[#263F6F] transition-colors text-sm"
          >
            Continue anyway
          </button>
        </>
      )}
    </div>
  );
}
