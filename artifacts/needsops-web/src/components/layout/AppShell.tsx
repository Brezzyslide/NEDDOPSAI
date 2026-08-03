import { useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { Link } from "wouter";

interface AppShellProps { orgSlug: string; children: React.ReactNode; }

// ── Primary workspace (top of nav) ───────────────────────────────────────────
const WORKSPACE_NAV = [
  { label: "Dashboard",     icon: "⬡",  path: "" },
  { label: "Inbox",         icon: "📥", path: "/inbox" },
  { label: "Active Work",   icon: "⚡", path: "/active-work" },
  { label: "Notifications", icon: "🔔", path: "/notifications" },
];

// ── Operations ────────────────────────────────────────────────────────────────
const OPERATIONS_NAV = [
  { label: "Chat",       icon: "💬", path: "/chat" },
  { label: "Workforce",  icon: "🤖", path: "/workforce" },
  { label: "Tasks",      icon: "📌", path: "/tasks" },
  { label: "Approvals",  icon: "✅", path: "/approvals" },
];

// ── Knowledge ─────────────────────────────────────────────────────────────────
const KNOWLEDGE_NAV = [
  { label: "Library", icon: "📚", path: "/library" },
  { label: "Memory",  icon: "🧠", path: "/memory" },
];

// ── Governance ────────────────────────────────────────────────────────────────
const GOVERNANCE_NAV = [
  { label: "Governance",       icon: "🏛",  path: "/governance" },
  { label: "Approvals",        icon: "✅", path: "/approvals" },
  { label: "Memory",           icon: "💡", path: "/memory" },
  { label: "Knowledge Health", icon: "❤️", path: "/governance/knowledge-health" },
  { label: "Timeline",         icon: "🕐", path: "/governance/timeline" },
  { label: "Audit Log",        icon: "📋", path: "/audit" },
];

// ── Organisation ──────────────────────────────────────────────────────────────
const ORG_NAV = [
  { label: "Team",     icon: "👥", path: "/team" },
  { label: "Plan",     icon: "💎", path: "/plan" },
  { label: "Usage",    icon: "📊", path: "/usage" },
  { label: "Settings", icon: "⚙",  path: "/settings" },
];

function NavSection({
  items, base, active, setLocation, label,
}: {
  items: { label: string; icon: string; path: string }[];
  base: string;
  active: (p: string) => boolean;
  setLocation: (p: string) => void;
  label?: string;
}) {
  return (
    <div>
      {label && (
        <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-[#64748B]/60 font-semibold select-none">
          {label}
        </p>
      )}
      {items.map(n => (
        <button
          key={n.label}
          onClick={() => setLocation(base + n.path)}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
            active(n.path)
              ? "bg-[#00D4FF]/10 text-[#00D4FF] font-medium"
              : "text-[#64748B] hover:text-[#E2E8F0] hover:bg-[#112033]"
          }`}
        >
          <span className="shrink-0">{n.icon}</span>
          {n.label}
        </button>
      ))}
    </div>
  );
}

export default function AppShell({ orgSlug, children }: AppShellProps) {
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const isPlatformAdmin =
    (user?.publicMetadata as any)?.platformAdmin === true ||
    (user?.publicMetadata as any)?.platformRole != null;

  const base   = `/app/${orgSlug}`;
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
          <span className="text-[#E2E8F0] font-semibold text-sm">
            NeedsOps <span className="text-[#00D4FF]">AI+</span>
          </span>
        </div>

        {/* Org name */}
        <div className="px-5 py-3 border-b border-[#1E3A5F]">
          <p className="text-[#64748B] text-xs uppercase tracking-widest mb-1">Organisation</p>
          <p className="text-[#E2E8F0] text-sm font-medium truncate">{orgSlug}</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          <NavSection items={WORKSPACE_NAV}   base={base} active={active} setLocation={setLocation} />
          <div className="border-t border-[#1E3A5F]/60 pt-3">
            <NavSection items={OPERATIONS_NAV} base={base} active={active} setLocation={setLocation} label="Operations" />
          </div>
          <div className="border-t border-[#1E3A5F]/60 pt-3">
            <NavSection items={KNOWLEDGE_NAV}   base={base} active={active} setLocation={setLocation} label="Knowledge" />
          </div>
          <div className="border-t border-[#1E3A5F]/60 pt-3">
            <NavSection items={GOVERNANCE_NAV}  base={base} active={active} setLocation={setLocation} label="Governance" />
          </div>
          <div className="border-t border-[#1E3A5F]/60 pt-3">
            <NavSection items={ORG_NAV}          base={base} active={active} setLocation={setLocation} label="Organisation" />
          </div>
        </nav>

        {/* Bottom */}
        <div className="px-3 pb-4 space-y-1 border-t border-[#1E3A5F]">
          {isPlatformAdmin && (
            <Link href="/platform">
              <div className={`mt-3 w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                location.startsWith("/platform")
                  ? "bg-violet-500/10 text-violet-300 font-medium"
                  : "text-[#64748B] hover:text-violet-300 hover:bg-violet-900/10"
              }`}>
                <span>⬡</span>
                <span>Platform Console</span>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-400 font-semibold tracking-wide">STAFF</span>
              </div>
            </Link>
          )}
          <button
            onClick={() => setLocation("/account")}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#64748B] hover:text-[#E2E8F0] hover:bg-[#112033] transition-colors mt-2"
          >
            <span className="h-6 w-6 rounded-full bg-[#1E3A5F] flex items-center justify-center text-xs text-[#E2E8F0] shrink-0">
              {user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "U"}
            </span>
            <span className="truncate">{user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress ?? "Account"}</span>
          </button>
          <button
            onClick={() => setLocation("/app-home")}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#64748B] hover:text-[#E2E8F0] hover:bg-[#112033] transition-colors"
          >
            <span>↔</span>Switch org
          </button>
          <button
            onClick={() => signOut()}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#64748B] hover:text-red-400 hover:bg-red-900/10 transition-colors"
          >
            <span>→</span>Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
