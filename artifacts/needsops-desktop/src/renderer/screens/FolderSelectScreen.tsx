/**
 * FolderSelectScreen
 * User grants NeedsOps AI+ access to specific folders.
 * In this MVP, the screen is informational — actual folder access
 * will be managed via the OS file picker (Electron dialog) in future sprints.
 */
import { useState } from "react";

interface Props {
  onContinue: () => void;
  onBack: () => void;
}

const SUGGESTED_FOLDERS = [
  { path: "~/Documents", icon: "📄", description: "Company documents and contracts" },
  { path: "~/Downloads", icon: "⬇️", description: "Downloaded files from portals" },
  { path: "~/Desktop", icon: "🖥️", description: "Day-to-day working files" },
];

export default function FolderSelectScreen({ onContinue, onBack }: Props) {
  const [granted, setGranted] = useState<string[]>(["~/Documents"]);

  const toggleFolder = (path: string) => {
    setGranted(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    );
  };

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

        <h1 className="text-2xl font-bold text-[#E2E8F0] mb-1">File access</h1>
        <p className="text-[#64748B] text-sm mb-6">
          Choose which folders your AI employees can read and write.
          You can change this at any time from Settings.
        </p>

        <div className="space-y-2 mb-4">
          {SUGGESTED_FOLDERS.map(f => (
            <button
              key={f.path}
              onClick={() => toggleFolder(f.path)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all"
              style={{
                borderColor: granted.includes(f.path) ? "#00D4FF" : "#1E3A5F",
                background: granted.includes(f.path) ? "#00D4FF10" : "#0B1829",
              }}
            >
              <span className="text-xl">{f.icon}</span>
              <div className="flex-1">
                <p className="text-[#E2E8F0] text-sm font-mono">{f.path}</p>
                <p className="text-[#64748B] text-xs">{f.description}</p>
              </div>
              <div
                className="h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-all"
                style={{
                  borderColor: granted.includes(f.path) ? "#00D4FF" : "#1E3A5F",
                  background: granted.includes(f.path) ? "#00D4FF" : "transparent",
                }}
              >
                {granted.includes(f.path) && <span className="text-[#0B1829] text-[8px] font-bold">✓</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="p-3 rounded-lg bg-[#0B1829] border border-[#1E3A5F] mb-6">
          <p className="text-[#64748B] text-xs">
            <span className="text-[#E2E8F0] font-medium">Privacy guarantee:</span>{" "}
            Your AI employees will only read files when completing a specific task you approve.
            They will never scan, copy, or upload your files without your knowledge.
          </p>
        </div>

        <button
          onClick={onContinue}
          className="w-full py-3 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] transition-colors"
        >
          {granted.length > 0 ? "Grant access and continue →" : "Skip for now →"}
        </button>
      </div>
    </div>
  );
}
