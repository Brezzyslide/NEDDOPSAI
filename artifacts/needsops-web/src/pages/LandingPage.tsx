import { useLocation } from "wouter";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-dvh bg-[#0B1829] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-[#1E3A5F]">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#00D4FF]/10 border border-[#00D4FF]/30 flex items-center justify-center">
            <span className="text-[#00D4FF] font-bold text-xs">NO</span>
          </div>
          <span className="text-[#E2E8F0] font-semibold text-lg tracking-tight">NeedsOps <span className="text-[#00D4FF]">AI+</span></span>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setLocation("/sign-in")} className="px-4 py-2 text-sm text-[#E2E8F0] border border-[#1E3A5F] rounded-lg hover:border-[#00D4FF] transition-colors">Sign In</button>
          <button onClick={() => setLocation("/sign-up")} className="px-4 py-2 text-sm bg-[#00D4FF] text-[#0B1829] font-semibold rounded-lg hover:bg-[#00B8D9] transition-colors">Get Started</button>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 text-center py-20">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#00D4FF]/30 bg-[#00D4FF]/5 text-[#00D4FF] text-xs font-medium mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-[#00D4FF] animate-pulse"></span>
          Built for Australian NDIS Providers
        </div>
        <h1 className="text-4xl md:text-6xl font-bold text-[#E2E8F0] max-w-3xl leading-tight mb-6">
          Your AI Operations<br/><span className="text-[#00D4FF]">Workforce</span>
        </h1>
        <p className="text-[#64748B] text-lg max-w-xl mb-10">
          Deploy a team of specialist AI workers coordinated by a Chief of Staff.
          Compliance, HR, Finance — all handled intelligently.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <button onClick={() => setLocation("/sign-up")} className="px-8 py-3.5 bg-[#00D4FF] text-[#0B1829] font-bold rounded-xl hover:bg-[#00B8D9] transition-colors text-base">
            Start Free Trial
          </button>
          <button onClick={() => setLocation("/sign-in")} className="px-8 py-3.5 border border-[#1E3A5F] text-[#E2E8F0] rounded-xl hover:border-[#00D4FF] transition-colors text-base">
            Sign In
          </button>
        </div>
      </main>

      {/* Features */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 px-8 pb-16 max-w-5xl mx-auto w-full">
        {[
          { icon: "🧠", title: "AI Workforce", desc: "Chief of Staff coordinates specialist AI workers across compliance, HR, and operations." },
          { icon: "✅", title: "NDIS Compliance", desc: "Built-in NDIS Pricing, SCHADS Award, and Practice Standards compliance tools." },
          { icon: "🔒", title: "Enterprise Security", desc: "Multi-tenant isolation, full audit logging, and role-based access control." },
        ].map((f) => (
          <div key={f.title} className="bg-[#112033] border border-[#1E3A5F] rounded-xl p-6">
            <div className="text-3xl mb-3">{f.icon}</div>
            <h3 className="text-[#E2E8F0] font-semibold mb-2">{f.title}</h3>
            <p className="text-[#64748B] text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
