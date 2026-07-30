/**
 * DiscoveryScreen (Desktop)
 * Lightweight first-run business discovery — 3 quick questions to personalise
 * the AI employee experience immediately. Full discovery is available in the portal.
 */
import { useState } from "react";

interface Props {
  onContinue: () => void;
  onSkip: () => void;
}

export default function DiscoveryScreen({ onContinue, onSkip }: Props) {
  const [q1, setQ1] = useState("");
  const [q2, setQ2] = useState("");
  const [q3, setQ3] = useState("");

  const INPUT = "w-full bg-[#0B1829] border border-[#1E3A5F] focus:border-[#00D4FF] rounded-lg px-3 py-2.5 text-[#E2E8F0] text-sm focus:outline-none transition-colors";

  const hasAnyAnswer = q1 || q2 || q3;

  return (
    <div className="flex flex-col h-full">
      <div className="drag-region h-8 shrink-0" />

      <div className="flex-1 flex flex-col justify-center px-8 pb-8 overflow-y-auto">
        <h1 className="text-2xl font-bold text-[#E2E8F0] mb-1">Quick intro</h1>
        <p className="text-[#64748B] text-sm mb-6">
          Three quick questions to help your AI employees understand your business from day one.
          You can skip this and complete it in the portal later.
        </p>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm text-[#E2E8F0] mb-1.5">
              What does your company do? <span className="text-[#475569]">(optional)</span>
            </label>
            <input
              value={q1}
              onChange={e => setQ1(e.target.value)}
              className={INPUT}
              placeholder="e.g. We provide NDIS disability support to participants in Melbourne"
            />
          </div>

          <div>
            <label className="block text-sm text-[#E2E8F0] mb-1.5">
              Who approves purchases in your company? <span className="text-[#475569]">(optional)</span>
            </label>
            <input
              value={q2}
              onChange={e => setQ2(e.target.value)}
              className={INPUT}
              placeholder="e.g. Sarah Johnson, Finance Manager"
            />
          </div>

          <div>
            <label className="block text-sm text-[#E2E8F0] mb-1.5">
              What should your AI Chief of Staff focus on this week? <span className="text-[#475569]">(optional)</span>
            </label>
            <textarea
              value={q3}
              onChange={e => setQ3(e.target.value)}
              className={`${INPUT} min-h-[72px] resize-none`}
              placeholder="e.g. Review our compliance calendar and flag any upcoming NDIS audit deadlines…"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onSkip}
            className="flex-1 py-3 border border-[#1E3A5F] text-[#64748B] font-medium rounded-xl hover:border-[#475569] hover:text-[#94A3B8] transition-colors text-sm"
          >
            Skip for now
          </button>
          <button
            onClick={onContinue}
            className="flex-1 py-3 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] transition-colors"
          >
            {hasAnyAnswer ? "Save and continue →" : "Continue →"}
          </button>
        </div>

        <p className="text-center text-[#475569] text-xs mt-3">
          Complete the full Business Discovery in the NeedsOps portal for the best results.
        </p>
      </div>
    </div>
  );
}
