/**
 * ActivationScreen
 * Prompts the user for the activation code from the portal.
 * Calls the main process to redeem the code, which saves credentials to keychain.
 */
import { useState, useEffect, useRef } from "react";
import { formatActivationCode, stripCodeFormatting } from "../lib/codeFormat";

const DEFAULT_API_URL = "https://api.needsops.com";

interface Props {
  onSuccess: () => void;
  onBack: () => void;
}

// 4-group format XXXX-XXXX-XXXX-XXXX
const GROUP_SIZE = 4;
const NUM_GROUPS = 4;
const TOTAL_CHARS = GROUP_SIZE * NUM_GROUPS;

export default function ActivationScreen({ onSuccess, onBack }: Props) {
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [platformInfo, setPlatformInfo] = useState<{ platform: string; arch: string; appVersion: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.needsops?.platform?.info?.().then(info => {
      setPlatformInfo(info);
      // Sprint 34: map all three platforms to human-readable display names.
      // Previously only darwin was handled; win32 and linux now get correct names.
      const displayName = { darwin: "Mac", win32: "Windows", linux: "Linux" }[info.platform] ?? info.platform;
      setDeviceName(`${displayName} (${info.arch})`);
    }).catch(() => {});
    inputRef.current?.focus();
  }, []);

  const handleCodeChange = (raw: string) => {
    // Strip all non-alphanumerics and uppercase
    const cleaned = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, TOTAL_CHARS);
    setCode(cleaned);
    setError("");
  };

  const displayCode = formatActivationCode(code);

  const handleSubmit = async () => {
    const stripped = stripCodeFormatting(code);
    if (stripped.length !== TOTAL_CHARS) {
      setError("Please enter the full 16-character activation code.");
      return;
    }
    if (!deviceName.trim()) {
      setError("Please give this device a name.");
      return;
    }
    if (!platformInfo) {
      setError("Platform information unavailable — please restart the app.");
      return;
    }

    setLoading(true); setError("");
    try {
      const result = await window.needsops.activation.redeem({
        activationCode: stripped,
        apiBaseUrl: DEFAULT_API_URL,
        // Sprint 34: map Node platform strings to NeedsOps API platform identifiers.
        // Node uses "darwin"/"win32"/"linux"; the API expects "macos"/"windows"/"linux".
        platform: ({ darwin: "macos", win32: "windows", linux: "linux" } as Record<string, string>)[platformInfo.platform] ?? platformInfo.platform,
        arch: platformInfo.arch,
        displayName: deviceName.trim(),
        appVersion: platformInfo.appVersion,
      });
      if (result.ok) {
        onSuccess();
      } else {
        setError(result.error ?? "Activation failed. Please try again or generate a new code in the portal.");
      }
    } catch (err) {
      setError("Network error. Check your internet connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="drag-region h-8 shrink-0" />

      <div className="flex-1 flex flex-col justify-center px-8 pb-8">
        {/* Back */}
        <button
          onClick={onBack}
          className="self-start text-[#64748B] text-sm mb-6 hover:text-[#94A3B8] transition-colors no-drag"
        >
          ← Back
        </button>

        <h1 className="text-2xl font-bold text-[#E2E8F0] mb-1">Enter activation code</h1>
        <p className="text-[#64748B] text-sm mb-6">
          Open the NeedsOps portal on any browser, sign in, and go to{" "}
          <span className="text-[#E2E8F0]">Install NeedsOps AI+</span> to get your code.
        </p>

        {/* Code input */}
        <div className="mb-4">
          <label className="block text-sm text-[#E2E8F0] mb-1.5">Activation code</label>
          <input
            ref={inputRef}
            value={displayCode}
            onChange={e => handleCodeChange(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !loading && handleSubmit()}
            className="w-full bg-[#0B1829] border border-[#1E3A5F] focus:border-[#00D4FF] rounded-xl px-4 py-3 text-center text-xl font-bold font-mono tracking-[0.18em] text-[#00D4FF] focus:outline-none transition-colors"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {/* Device name */}
        <div className="mb-6">
          <label className="block text-sm text-[#E2E8F0] mb-1.5">Device name</label>
          <input
            value={deviceName}
            onChange={e => { setDeviceName(e.target.value); setError(""); }}
            className="w-full bg-[#0B1829] border border-[#1E3A5F] focus:border-[#00D4FF] rounded-xl px-4 py-3 text-[#E2E8F0] text-sm focus:outline-none transition-colors"
            placeholder={platformInfo?.platform === "darwin" ? "e.g. Sarah's MacBook Pro" : "e.g. Office PC — Sarah"}
          />
          <p className="text-[#475569] text-xs mt-1">
            Helps you identify this device in the portal. Visible to your organisation admins.
          </p>
        </div>

        {error && (
          <p className="text-red-400 text-sm bg-red-900/10 border border-red-800/30 rounded-lg px-3 py-2 mb-4">
            {error}
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || code.length < TOTAL_CHARS || !deviceName.trim()}
          className="w-full py-3 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] disabled:opacity-40 transition-colors"
        >
          {loading ? "Activating…" : "Activate →"}
        </button>
      </div>
    </div>
  );
}
