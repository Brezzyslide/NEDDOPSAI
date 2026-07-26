import { useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";

interface AppShellProps { orgSlug: string; children: React.ReactNode; }

const NAV = [
  { label: "Dashboard",  icon: "⬡",  path: "" },
  { label: "Chat",       icon: "💬", path: "/chat" },
  { label: "Workforce",  icon: "🤖", path: "/workforce" },
  { label: "Tasks",      icon: "📌", path: "/tasks" },
  { label: "Approvals",  icon: "✅", path: "/approvals" },
  { label: "Team",       icon: "👥", path: "/team" },
  { label: "Plan",       icon: "💎", path: "/plan" },
  { label: "Usage",      icon: "📊", path: "/usage" },
  { label: "Audit",      icon: "📋", path: "/audit" },
  { label: "Memory",     icon: "🧠", path: "/memory" },
  { label: "Settings",   icon: "⚙",  path: "/settings" },
];

export default function AppShell({ orgSlug, children }: AppShellProps) {
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();

  const base = `/app/${orgSlug}`;
  const active = (path: string) => location === base + path;

  return (
    <div className="flex h-dvh bg-[#0B1829] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 flex flex-col bg-[#0A1628] border-r border-[#1E3A5F]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[#1E3A5F]">
          <div className="h-7 w-7 rounded-md bg-[#00D4FF]/10 border border-[#00D4FF]/30 flex items-center justify-center">
            <span className="text-[#00D4FF] font-bold text-xs">NO</span>
          </div>
          <span className="text-[#E2E8F0] font-semibold text-sm">NeedsOps <span className="text-[#00D4FF]">AI+</span></span>
        </div>

        {/* Org name */}
        <div className="px-5 py-3 border-b border-[#1E3A5F]">
          <p className="text-[#64748B] text-xs uppercase tracking-widest mb-1">Organisation</p>
          <p className="text-[#E2E8F0] text-sm font-medium truncate">{orgSlug}</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(n => (
            <button key={n.label} onClick={() => setLocation(base + n.path)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${active(n.path) ? "bg-[#00D4FF]/10 text-[#00D4FF] font-medium" : "text-[#64748B] hover:text-[#E2E8F0] hover:bg-[#112033]"}`}>
              <span>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>

        {/* Bottom: user + sign out */}
        <div className="px-3 pb-4 space-y-2">
          <button onClick={() => setLocation("/account")} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#64748B] hover:text-[#E2E8F0] hover:bg-[#112033] transition-colors">
            <span className="h-6 w-6 rounded-full bg-[#1E3A5F] flex items-center justify-center text-xs text-[#E2E8F0] shrink-0">
              {user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "U"}
            </span>
            <span className="truncate">{user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress ?? "Account"}</span>
          </button>
          <button onClick={() => setLocation("/app-home")} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#64748B] hover:text-[#E2E8F0] hover:bg-[#112033] transition-colors">
            <span>↔</span>Switch org
          </button>
          <button onClick={() => signOut()} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#64748B] hover:text-red-400 hover:bg-red-900/10 transition-colors">
            <span>→</span>Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
