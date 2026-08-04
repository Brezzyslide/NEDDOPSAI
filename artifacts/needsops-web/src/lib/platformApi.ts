/**
 * Platform API client — authenticated fetch for /v1/platform/* routes.
 * Same pattern as useAuthFetch but prefixes /v1/platform/ automatically.
 */
import { useCallback } from "react";
import { useAuth } from "@clerk/react";

export function usePlatformFetch() {
  const { getToken } = useAuth();

  return useCallback(
    async function platformFetch(path: string, init: RequestInit = {}): Promise<Response> {
      const token = await getToken();
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (init.body !== undefined && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const url = path.startsWith("/v1/") ? path : `/v1/platform${path.startsWith("/") ? "" : "/"}${path}`;
      return fetch(url, { ...init, headers });
    },
    [getToken],
  );
}

export const PLATFORM_NAV = [
  { label: "Dashboard",         icon: "⬡",  path: "" },
  { label: "Organisations",     icon: "🏢", path: "/organisations" },
  { label: "Commercial",        icon: "💼", path: "/commercial" },
  { label: "Trials",            icon: "⏱️", path: "/trials" },
  { label: "Workforce",         icon: "🤖", path: "/workforce" },
  { label: "Usage",             icon: "📊", path: "/usage" },
  { label: "Support",           icon: "🎧", path: "/support" },
  { label: "Security",          icon: "🔒", path: "/security" },
  { label: "Audit",             icon: "📋", path: "/audit" },
  { label: "Runtime",           icon: "⚡", path: "/runtime" },
  { label: "Specialist Ops",    icon: "🧠", path: "/specialist-ops" },
  { label: "Pack Builder",      icon: "📦", path: "/packs" },
  { label: "Staff",             icon: "👤", path: "/staff" },
  { label: "Connector Fleet",   icon: "🖥️", path: "/connector-fleet" },
  { label: "Catalogue",         icon: "📂", path: "/catalogue" },
  { label: "Platform Settings", icon: "⚙️", path: "/settings" },
] as const;
