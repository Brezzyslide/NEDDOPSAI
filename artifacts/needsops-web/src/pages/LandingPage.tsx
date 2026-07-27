/**
 * Landing Page — Sprint 9.6
 * Full marketing page with pack showcase.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";

interface Pack {
  code: string;
  name: string;
  marketingTagline: string | null;
  description: string | null;
  iconEmoji: string | null;
  colorHex: string | null;
  tier: string;
  status: string;
  priceMonthlyAud: string | null;
  priceMonthly: number | null;
  featured: boolean;
  specialistCount: number;
}

const FEATURES = [
  { icon: "🧠", title: "AI Workforce", desc: "Chief of Staff coordinates specialist AI workers across compliance, HR, and operations." },
  { icon: "✅", title: "NDIS Compliance", desc: "Built-in NDIS Pricing, SCHADS Award, and Practice Standards compliance tools." },
  { icon: "🔒", title: "Enterprise Security", desc: "Multi-tenant isolation, full audit logging, and role-based access control." },
  { icon: "⚡", title: "Fast Setup", desc: "Go live in minutes. Choose your workforce packs during onboarding." },
  { icon: "📊", title: "Full Visibility", desc: "Track every specialist run, decision, and recommendation in a detailed audit trail." },
  { icon: "🌏", title: "Australian-Built", desc: "Purpose-built for Australian disability and aged care providers." },
];

const TIER_BADGE: Record<string, string> = {
  starter:      "bg-[#00D4FF]/10 text-[#00D4FF]",
  professional: "bg-amber-900/30 text-amber-400",
  enterprise:   "bg-purple-900/30 text-purple-400",
};

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);

  useEffect(() => {
    fetch("/v1/workforce-packs?status=available")
      .then(r => r.json())
      .then(d => setPacks(d.packs ?? []))
      .catch(() => setPacks([]))
      .finally(() => setPacksLoading(false));
  }, []);

  const featuredPacks = packs.filter(p => p.featured);
  const otherPacks = packs.filter(p => !p.featured);

  return (
    <div className="min-h-dvh bg-[#0B1829] flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-8 py-4 border-b border-[#1E3A5F] bg-[#0B1829]/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#00D4FF]/10 border border-[#00D4FF]/30 flex items-center justify-center">
            <span className="text-[#00D4FF] font-bold text-xs">NO</span>
          </div>
          <span className="text-[#E2E8F0] font-semibold text-lg tracking-tight">
            NeedsOps <span className="text-[#00D4FF]">AI+</span>
          </span>
        </div>
        <nav className="hidden md:flex items-center gap-6">
          <a href="#packs" className="text-[#94A3B8] text-sm hover:text-[#E2E8F0] transition-colors">Workforce Packs</a>
          <a href="#features" className="text-[#94A3B8] text-sm hover:text-[#E2E8F0] transition-colors">Features</a>
        </nav>
        <div className="flex gap-3">
          <button
            onClick={() => setLocation("/sign-in")}
            className="px-4 py-2 text-sm text-[#E2E8F0] border border-[#1E3A5F] rounded-lg hover:border-[#00D4FF] transition-colors"
          >
            Sign In
          </button>
          <button
            onClick={() => setLocation("/sign-up")}
            className="px-4 py-2 text-sm bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg hover:bg-[#00B8D9] transition-colors"
          >
            Get Started
          </button>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <main className="flex flex-col items-center text-center px-4 pt-24 pb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#00D4FF]/30 bg-[#00D4FF]/5 text-[#00D4FF] text-xs font-medium mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-[#00D4FF] animate-pulse" />
          Built for Australian NDIS Providers
        </div>
        <h1 className="text-4xl md:text-6xl font-bold text-[#E2E8F0] max-w-4xl leading-tight mb-6">
          Your AI Operations<br />
          <span className="text-[#00D4FF]">Workforce</span>
        </h1>
        <p className="text-[#64748B] text-lg max-w-2xl mb-10 leading-relaxed">
          Deploy a team of specialist AI workers coordinated by a Chief of Staff.
          Choose the workforce packs that fit your organisation — compliance,
          finance, operations, HR, and more.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <button
            onClick={() => setLocation("/sign-up")}
            className="px-8 py-3.5 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] transition-colors text-base"
          >
            Start Free Trial
          </button>
          <a
            href="#packs"
            className="px-8 py-3.5 border border-[#1E3A5F] text-[#E2E8F0] rounded-xl hover:border-[#00D4FF] transition-colors text-base"
          >
            Browse Workforce Packs
          </a>
        </div>
        <p className="text-[#475569] text-xs">No credit card required · 14-day free trial</p>
      </main>

      {/* ── Pack Showcase ──────────────────────────────────────────────────── */}
      <section id="packs" className="px-6 md:px-16 py-20 bg-[#080F1A]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-[#E2E8F0] mb-3">Workforce Packs</h2>
            <p className="text-[#64748B] text-base max-w-xl mx-auto">
              Each pack adds a group of specialist AI workers to your organisation.
              Start with Core — always included — then add the packs you need.
            </p>
          </div>

          {packsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-52 rounded-2xl bg-[#0B1829] border border-[#1E3A5F] animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {/* Featured packs */}
              {featuredPacks.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                  {featuredPacks.map(p => (
                    <PackCard key={p.code} pack={p} large onCta={() => setLocation("/sign-up")} />
                  ))}
                </div>
              )}
              {/* Standard packs */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {otherPacks.map(p => (
                  <PackCard key={p.code} pack={p} onCta={() => setLocation("/sign-up")} />
                ))}
              </div>
            </>
          )}

          <div className="text-center mt-10">
            <p className="text-[#475569] text-sm mb-4">
              You choose your packs during onboarding. Add or remove them any time from your portal.
            </p>
            <button
              onClick={() => setLocation("/sign-up")}
              className="px-7 py-3 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] transition-colors"
            >
              Choose Your Packs →
            </button>
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section id="features" className="px-6 md:px-16 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-[#E2E8F0] mb-3">Everything you need to run smarter</h2>
            <p className="text-[#64748B] text-base">Designed for NDIS providers from the ground up.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-[#112033] border border-[#1E3A5F] rounded-2xl p-6">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="text-[#E2E8F0] font-semibold mb-2">{f.title}</h3>
                <p className="text-[#64748B] text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA strip ──────────────────────────────────────────────────────── */}
      <section className="px-6 py-16 bg-[#00D4FF]/5 border-t border-[#00D4FF]/10">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-[#E2E8F0] mb-3">Ready to transform your operations?</h2>
          <p className="text-[#64748B] mb-6">Set up your organisation and pick your workforce packs in under 5 minutes.</p>
          <button
            onClick={() => setLocation("/sign-up")}
            className="px-8 py-3.5 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] transition-colors"
          >
            Start Free Trial
          </button>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#1E3A5F] px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[#00D4FF] font-bold text-sm">NeedsOps AI+</span>
          <span className="text-[#475569] text-xs">Built for Australian NDIS Providers</span>
        </div>
        <p className="text-[#475569] text-xs">© {new Date().getFullYear()} NeedsOps. All rights reserved.</p>
      </footer>
    </div>
  );
}

function PackCard({ pack, large, onCta }: { pack: Pack; large?: boolean; onCta: () => void }) {
  const color = pack.colorHex ?? "#00D4FF";
  const isFree = pack.priceMonthly === 0;
  const tierCls = TIER_BADGE[pack.tier] ?? TIER_BADGE.starter;

  return (
    <div
      className={`relative rounded-2xl border bg-[#0B1829] flex flex-col overflow-hidden transition-all hover:shadow-lg ${large ? "p-7" : "p-6"}`}
      style={{ borderColor: `${color}30` }}
    >
      {/* Subtle color band */}
      <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl" style={{ background: color }} />

      <div className="flex items-start gap-4 mb-4">
        <div
          className={`${large ? "h-14 w-14 text-3xl" : "h-12 w-12 text-2xl"} rounded-xl flex items-center justify-center shrink-0`}
          style={{ background: `${color}15`, border: `1px solid ${color}30` }}
        >
          {pack.iconEmoji ?? "📦"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className={`font-bold text-[#E2E8F0] ${large ? "text-xl" : "text-base"}`}>{pack.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${tierCls}`}>{pack.tier}</span>
          </div>
          <p className="text-xs text-[#64748B]">{pack.specialistCount} specialist{pack.specialistCount !== 1 ? "s" : ""} included</p>
        </div>
      </div>

      <p className={`text-[#94A3B8] ${large ? "text-sm" : "text-xs"} leading-relaxed mb-5 flex-1`}>
        {pack.marketingTagline ?? pack.description}
      </p>

      <div className="flex items-center justify-between mt-auto">
        <div>
          {isFree ? (
            <span className="text-[#00D4FF] font-bold text-lg">Free</span>
          ) : pack.priceMonthlyAud ? (
            <div>
              <span className="text-[#E2E8F0] font-bold text-lg">${pack.priceMonthlyAud}</span>
              <span className="text-[#64748B] text-xs">/month AUD</span>
            </div>
          ) : (
            <span className="text-[#64748B] text-sm">Contact for pricing</span>
          )}
        </div>
        <button
          onClick={onCta}
          className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
          style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}
        >
          Get started →
        </button>
      </div>
    </div>
  );
}
