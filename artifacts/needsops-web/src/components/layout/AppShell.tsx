import { useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuthFetch } from "@/lib/api";

interface AppShellProps { orgSlug: string; children: React.ReactNode; }

// ── Primary workspace (all roles) ────────────────────────────────────────────
const WORKSPACE_NAV = [
  { label: "Dashboard",     icon: "⬡",  path: "" },
  { label: "Inbox",         icon: "📥", path: "/inbox" },
  { label: "Active Work",   icon: "⚡", path: "/active-work" },
  { label: "Notifications", icon: "🔔", path: "/notifications", badge: true },
];

// ── Operations (all roles) ────────────────────────────────────────────────────
const OPERATIONS_NAV = [
  { label: "Chat",                icon: "💬", path: "/chat" },
  { label: "Workforce",           icon: "🤖", path: "/workforce" },
  { label: "Operations Centre",   icon: "🖥",  path: "/workforce-ops" },
  { label: "Tasks",               icon: "📌", path: "/tasks" },
  { label: "Completed Work",      icon: "📄", path: "/work" },
];

// ── Library (member, manager, administrator, owner — not viewer/auditor) ──────
const LIBRARY_NAV = [
  { label: "Library", icon: "📚", path: "/library" },
];

// ── Knowledge authority (owner + administrator only) ──────────────────────────
const AUTHORITY_KNOWLEDGE_NAV = [
  { label: "Memory",           icon: "🧠", path: "/memory" },
  { label: "Blueprint Studio", icon: "📐", path: "/blueprints" },
];

// ── Governance main (manager, administrator, owner, auditor) ──────────────────
const GOVERNANCE_MAIN_NAV = [
  { label: "Governance",       icon: "🏛",  path: "/governance" },
  { label: "Approvals",        icon: "✅", path: "/approvals" },
  { label: "Knowledge Health", icon: "❤️", path: "/governance/knowledge-health" },
  { label: "Timeline",         icon: "🕐", path: "/governance/timeline" },
];

// ── Audit Log (owner, administrator, auditor only) ────────────────────────────
const AUDIT_NAV = [
  { label: "Audit Log", icon: "📋", path: "/audit" },
];

// ── Organisation admin (owner + administrator only) ───────────────────────────
const ORG_NAV = [
  { label: "Team",     icon: "👥", path: "/team" },
  { label: "Plan",     icon: "💎", path: "/plan" },
  { label: "Usage",    icon: "📊", path: "/usage" },
  { label: "Settings", icon: "⚙",  path: "/settings" },
];

function NavSection({
  items, base, active, setLocation, label, unreadCount,
}: {
  items: { label: string; icon: string; path: string; badge?: boolean }[];
  base: string;
  active: (p: string) => boolean;
  setLocation: (p: string) => void;
  label?: string;
  unreadCount?: number;
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
          <span className="flex-1 text-left">{n.label}</span>
          {n.badge && unreadCount != null && unreadCount > 0 && (
            <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#00D4FF] text-[#0B1829] text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export default function AppShell({ orgSlug, children }: AppShellProps) {
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const apiFetch = useAuthFetch();
  const isPlatformAdmin =
    (user?.publicMetadata as any)?.platformAdmin === true ||
    (user?.publicMetadata as any)?.platformRole != null;

  const base   = `/app/${orgSlug}`;
  const active = (path: string) => location === base + path;

  // Sprint 29M.3: Fetch org role for role-gated nav.
  // The canonical role strings are: owner, administrator, manager, member, viewer, auditor.
  // "admin" (short form) does not exist — always use "administrator".
  const { data: meOrgsData } = useQuery({
    queryKey:  ["me-orgs"],
    queryFn:   () => apiFetch("/v1/me/organisations").then(r => r.ok ? r.json() : { organisations: [] }),
    staleTime: 5 * 60_000,
  });
  const orgRole: string =
    (meOrgsData?.organisations as Array<{ slug: string; role: string }> | undefined)
      ?.find(o => o.slug === orgSlug)?.role ?? "member";

  // ── Nav visibility matrix ────────────────────────────────────────────────────
  // Library (upload + view sources): member, manager, administrator, owner
  const canUseLibrary      = ["owner", "administrator", "manager", "member"].includes(orgRole);
  // Memory + Blueprint Studio (authority / governance): administrator, owner only
  const isKnowledgeAdmin   = orgRole === "owner" || orgRole === "administrator";
  // Governance pages (Governance Centre, Approvals, Timeline, Health):
  //   manager, administrator, owner, auditor (not plain member or viewer)
  const canViewGovernance  = ["owner", "administrator", "manager", "auditor"].includes(orgRole);
  // Audit Log: owner, administrator, auditor
  const canViewAuditLog    = ["owner", "administrator", "auditor"].includes(orgRole);
  // Org admin pages (Team, Plan, Usage, Settings): owner, administrator
  const isOrgAdmin         = orgRole === "owner" || orgRole === "administrator";

  // Navigation badge — server-derived unread count, refreshed every 60 s
  const { data: unreadData } = useQuery({
    queryKey:       ["nav-notif-badge", orgSlug],
    queryFn:        () =>
      apiFetch(`/v1/organisations/${orgSlug}/notifications/unread-count`)
        .then(r => r.ok ? r.json() : { unreadCount: 0 }),
    enabled:        !!orgSlug,
    refetchInterval: 60_000,
    staleTime:      30_000,
  });
  const navUnreadCount: number = unreadData?.unreadCount ?? 0;

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
          {/* Workspace — all roles */}
          <NavSection
            items={WORKSPACE_NAV}
            base={base}
            active={active}
            setLocation={setLocation}
            unreadCount={navUnreadCount}
          />

          {/* Operations — all roles */}
          <div className="border-t border-[#1E3A5F]/60 pt-3">
            <NavSection items={OPERATIONS_NAV} base={base} active={active} setLocation={setLocation} label="Operations" />
          </div>

          {/* Knowledge — Library visible to member+; Memory+Blueprints admin+ only */}
          {(canUseLibrary || isKnowledgeAdmin) && (
            <div className="border-t border-[#1E3A5F]/60 pt-3">
              <NavSection
                items={[
                  ...(canUseLibrary ? LIBRARY_NAV : []),
                  ...(isKnowledgeAdmin ? AUTHORITY_KNOWLEDGE_NAV : []),
                ]}
                base={base}
                active={active}
                setLocation={setLocation}
                label="Knowledge"
              />
            </div>
          )}

          {/* Governance — manager, administrator, owner, auditor */}
          {canViewGovernance && (
            <div className="border-t border-[#1E3A5F]/60 pt-3">
              <NavSection
                items={[
                  ...GOVERNANCE_MAIN_NAV,
                  ...(canViewAuditLog ? AUDIT_NAV : []),
                ]}
                base={base}
                active={active}
                setLocation={setLocation}
                label="Governance"
              />
            </div>
          )}

          {/* Organisation admin — owner + administrator only */}
          {isOrgAdmin && (
            <div className="border-t border-[#1E3A5F]/60 pt-3">
              <NavSection items={ORG_NAV} base={base} active={active} setLocation={setLocation} label="Organisation" />
            </div>
          )}
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
