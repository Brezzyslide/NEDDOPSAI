/**
 * BrowserSelectScreen
 * User selects which browser NeedsOps AI+ should use for web automation tasks.
 */
import { useState } from "react";

interface Props {
  onContinue: () => void;
  onBack: () => void;
}

const BROWSERS = [
  { value: "chrome", label: "Google Chrome", icon: "🌐", description: "Best compatibility — recommended" },
  { value: "edge", label: "Microsoft Edge", icon: "🔵", description: "Great for Microsoft 365 workflows" },
  { value: "firefox", label: "Firefox", icon: "🦊", description: "Privacy-focused" },
  { value: "safari", label: "Safari", icon: "🧭", description: "macOS only" },
];

export default function BrowserSelectScreen({ onContinue, onBack }: Props) {
  const [selected, setSelected] = useState("chrome");

  return (
    <div className="flex flex-col h-full">
      <div className="drag-region h-8 shrink-0" />

      <div className="flex-1 flex flex-col justify-center px-8 pb-8">
        <button
          onClick={onBack}
          className="self-start text-[#64748B] text-sm mb-6 hover:text-[#94A3B8] transition-colors no-drag"
        >
          ← Back
        </button>

        <h1 className="text-2xl font-bold text-[#E2E8F0] mb-1">Choose your work browser</h1>
        <p className="text-[#64748B] text-sm mb-6">
          Your AI employees will use this browser for web-based tasks like filling forms,
          accessing portals, and navigating business systems.
        </p>

        <div className="space-y-2 mb-6">
          {BROWSERS.map(b => (
            <button
              key={b.value}
              onClick={() => setSelected(b.value)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all"
              style={{
                borderColor: selected === b.value ? "#00D4FF" : "#1E3A5F",
                background: selected === b.value ? "#00D4FF10" : "#0B1829",
              }}
            >
              <span className="text-2xl">{b.icon}</span>
              <div className="flex-1">
                <p className="text-[#E2E8F0] text-sm font-medium">{b.label}</p>
                <p className="text-[#64748B] text-xs">{b.description}</p>
              </div>
              <div
                className="h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                style={{
                  borderColor: selected === b.value ? "#00D4FF" : "#1E3A5F",
                  background: selected === b.value ? "#00D4FF" : "transparent",
                }}
              >
                {selected === b.value && <span className="text-[#0B1829] text-[8px] font-bold">✓</span>}
              </div>
            </button>
          ))}
        </div>

        <p className="text-[#475569] text-xs mb-6">
          You can change this in Settings at any time. Make sure your chosen browser is installed.
        </p>

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
