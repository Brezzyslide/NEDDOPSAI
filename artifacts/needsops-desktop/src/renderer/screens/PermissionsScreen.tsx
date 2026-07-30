/**
 * PermissionsScreen
 * Explains what local permissions NeedsOps AI+ needs and why.
 * On macOS: Accessibility, Screen Recording (for browser automation)
 * On Windows: No extra permissions needed
 */
import { useState, useEffect } from "react";

interface Props {
  onContinue: () => void;
  onBack: () => void;
}

interface Permission {
  id: string;
  icon: string;
  title: string;
  description: string;
  required: boolean;
  macOnly?: boolean;
}

const PERMISSIONS: Permission[] = [
  {
    id: "accessibility",
    icon: "♿",
    title: "Accessibility",
    description: "Allows NeedsOps AI+ to control your browser to complete web-based tasks on your behalf.",
    required: true,
    macOnly: true,
  },
  {
    id: "screen_recording",
    icon: "📸",
    title: "Screen Recording",
    description: "Allows NeedsOps AI+ to see the screen when navigating websites. Nothing is recorded or stored.",
    required: false,
    macOnly: true,
  },
  {
    id: "file_access",
    icon: "📁",
    title: "File Access",
    description: "You'll choose which specific folders NeedsOps AI+ can read and write. You're always in control.",
    required: false,
  },
];

export default function PermissionsScreen({ onContinue, onBack }: Props) {
  const [platform, setPlatform] = useState<string>("unknown");

  useEffect(() => {
    window.needsops?.platform?.info?.().then(info => setPlatform(info.platform)).catch(() => {});
  }, []);

  const isMac = platform === "darwin";
  const visiblePerms = PERMISSIONS.filter(p => !p.macOnly || isMac);

  return (
    <div className="flex flex-col h-full">
      <div className="drag-region h-8 shrink-0" />

      <div className="flex-1 flex flex-col justify-center px-8 pb-8 overflow-y-auto">
        <button
          onClick={onBack}
          className="self-start text-[#64748B] text-sm mb-6 hover:text-[#94A3B8] transition-colors no-drag"
        >
          ← Back
        </button>

        <h1 className="text-2xl font-bold text-[#E2E8F0] mb-1">Permissions</h1>
        <p className="text-[#64748B] text-sm mb-6">
          NeedsOps AI+ needs a few permissions to operate on your behalf. You choose exactly what it can access.
        </p>

        <div className="space-y-3 mb-6">
          {visiblePerms.map(p => (
            <div key={p.id} className="p-4 rounded-xl border border-[#1E3A5F] bg-[#112033]">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{p.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[#E2E8F0] font-semibold text-sm">{p.title}</span>
                    {p.required && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#00D4FF]/10 text-[#00D4FF]">Required</span>
                    )}
                  </div>
                  <p className="text-[#64748B] text-xs mt-0.5">{p.description}</p>
                </div>
              </div>
              {isMac && (p.id === "accessibility" || p.id === "screen_recording") && (
                <button
                  onClick={() => {
                    window.needsops?.shell?.openExternal?.(
                      p.id === "accessibility"
                        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
                        : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
                    );
                  }}
                  className="mt-3 text-xs text-[#00D4FF] hover:underline"
                >
                  Open System Settings →
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="p-3 rounded-xl bg-[#0B1829] border border-[#1E3A5F] mb-6">
          <p className="text-[#64748B] text-xs">
            <span className="text-[#E2E8F0] font-medium">Your data stays on your device.</span>{" "}
            NeedsOps AI+ only communicates with the NeedsOps platform to receive task instructions.
            Your documents, files, and business data never leave your computer unless a task explicitly requires it and you approve.
          </p>
        </div>

        <button
          onClick={onContinue}
          className="w-full py-3 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
