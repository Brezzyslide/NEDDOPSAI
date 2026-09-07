/**
 * Platform Shell — staff-only layout wrapper for /platform/* pages.
 * Checks that the current user has platform access through the DB-backed platform role gate.
 * Renders a dark sidebar nav with 10 sections.
 */
import { ReactNode, useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { PLATFORM_NAV } from "@/lib/platformApi";
import { useAuthFetch } from "@/lib/api";

interface Props { children: ReactNode }

export default function PlatformShell({ children }: Props) {
  const { user, isLoaded } = useUser();
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [accessState, setAccessState] = useState<"checking" | "allowed" | "denied">("checking");
  const apiFetch = useAuthFetch();

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;

    async function checkPlatformAccess() {
      try {
        const response = await apiFetch("/v1/platform/dashboard");
        if (!cancelled) setAccessState(response.ok ? "allowed" : "denied");
      } catch {
        if (!cancelled) setAccessState("denied");
      }
    }

    setAccessState("checking");
    void checkPlatformAccess();
    return () => {
      cancelled = true;
    };
  }, [apiFetch, isLoaded]);

  if (!isLoaded || accessState === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-[#08111e]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#00D4FF] border-t-transparent" />
      </div>
    );
  }

  if (accessState !== "allowed") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#08111e] text-[#E2E8F0]">
        <div className="rounded-2xl border border-red-800 bg-[#0f1f30] p-8 text-center">
          <div className="mb-2 text-3xl">🔒</div>
          <h1 className="mb-2 text-xl font-semibold">Platform Access Required</h1>
          <p className="text-sm text-[#64748B]">
            You don't have access to the NeedsOps Platform Console.
          </p>
          <p className="mt-1 text-xs text-[#4A5568]">Contact a Super Admin if you believe this is an error.</p>
          <a href="/app-home" className="mt-4 inline-block rounded-lg bg-[#00D4FF] px-4 py-2 text-sm font-semibold text-[#0B1829]">
            Back to App
          </a>
        </div>
      </div>
    );
  }

  // Strip /platform prefix for matching
  const activePath = location.replace(/^\/platform/, "") || "/";

  return (
    <div className="flex h-screen overflow-hidden bg-[#08111e] text-[#E2E8F0]">
      {/* Sidebar */}
      <aside className={`flex shrink-0 flex-col border-r border-[#1E3A5F] bg-[#0B1829] transition-all duration-200 ${collapsed ? "w-14" : "w-56"}`}>
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-[#1E3A5F] px-3">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <span className="text-lg">⬡</span>
              <span className="text-sm font-bold text-[#00D4FF]">Platform Console</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="ml-auto rounded p-1 text-[#64748B] hover:bg-[#1E3A5F] hover:text-[#E2E8F0]"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "→" : "←"}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {PLATFORM_NAV.map(item => {
            const href = `/platform${item.path}`;
            const isActive = item.path === ""
              ? activePath === "" || activePath === "/"
              : activePath.startsWith(item.path);
            return (
              <Link key={item.path} href={href}>
                <a
                  className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-[#00D4FF]/10 text-[#00D4FF]"
                      : "text-[#94A3B8] hover:bg-[#1E3A5F]/50 hover:text-[#E2E8F0]"
                  }`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="shrink-0 text-base">{item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </a>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-[#1E3A5F] p-3">
          {!collapsed && (
            <div className="mb-2 truncate text-xs text-[#4A5568]">
              {user?.primaryEmailAddress?.emailAddress}
            </div>
          )}
          <a href="/app-home" className={`flex items-center gap-2 rounded px-2 py-1 text-xs text-[#64748B] hover:text-[#00D4FF] ${collapsed ? "justify-center" : ""}`}>
            <span>←</span>
            {!collapsed && <span>Back to App</span>}
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
