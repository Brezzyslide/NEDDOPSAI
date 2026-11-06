import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppShell from "../AppShell";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  location: "/app/blaze-pty/tasks",
  setLocation: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  useAuthFetch: () => mocks.apiFetch,
}));

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: { fullName: "Test User", publicMetadata: {} } }),
}));

vi.mock("wouter", () => ({
  useLocation: () => [mocks.location, mocks.setLocation] as const,
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.setLocation.mockReset();
});

describe("AppShell organisation context", () => {
  it("does not poll organisation routes for a stale active organisation slug", async () => {
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/me/organisations") {
        return jsonResponse({ organisations: [{ slug: "mhr-holdings-pty-ltd", role: "owner" }] });
      }
      return jsonResponse({ unreadCount: 0 });
    });

    renderWithClient(<AppShell orgSlug="blaze-pty"><div>body</div></AppShell>);

    await waitFor(() => expect(mocks.setLocation).toHaveBeenCalledWith("/app/mhr-holdings-pty-ltd"));
    expect(mocks.apiFetch).not.toHaveBeenCalledWith(
      "/v1/organisations/blaze-pty/notifications/unread-count",
    );
  });
});
