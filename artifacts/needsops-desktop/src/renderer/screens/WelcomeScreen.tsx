interface Props { onContinue: () => void; }

export default function WelcomeScreen({ onContinue }: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Drag region / titlebar spacer for macOS */}
      <div className="drag-region h-8 shrink-0" />

      <div className="flex flex-col flex-1 items-center justify-center px-8 pb-8 text-center">
        <div className="text-6xl mb-6">⬡</div>
        <h1 className="text-3xl font-bold text-[#E2E8F0] mb-2">NeedsOps AI+</h1>
        <p className="text-[#64748B] text-sm mb-2 max-w-xs">
          Your AI workforce runs here, on this computer.
        </p>
        <p className="text-[#475569] text-xs mb-10 max-w-xs">
          Your AI employees use your browser, files, and business systems to get work done —
          all under your direct control.
        </p>

        <button
          onClick={onContinue}
          className="w-full max-w-xs py-3 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] transition-colors"
        >
          Get started →
        </button>

        <p className="mt-4 text-[#475569] text-xs">
          You'll need your activation code from the NeedsOps portal.
        </p>
      </div>
    </div>
  );
}
