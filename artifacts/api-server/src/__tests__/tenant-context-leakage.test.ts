import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

type Context = Record<string, string | null>;

const mockDb = vi.hoisted(() => {
  const sessionContext: Context = {};
  const committedContexts: Context[] = [];
  const rolledBackContexts: Context[] = [];

  function queryText(query: unknown): string {
    if (typeof query === "string") return query;
    const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
    return chunks.map((chunk) => {
      if (typeof chunk === "string") return "$";
      const value = (chunk as { value?: string[] })?.value;
      return Array.isArray(value) ? value.join("") : "";
    }).join("");
  }

  function queryParams(query: unknown): string[] {
    return ((query as { queryChunks?: unknown[] })?.queryChunks ?? [])
      .filter((chunk): chunk is string => typeof chunk === "string");
  }

  function executeWithContext(context: Context, rowsByOrg: Map<string, unknown[]>) {
    return async (query: unknown) => {
      const text = queryText(query);
      const params = queryParams(query);

      if (text.includes("set_config('app.current_organization_id'")) {
        context["app.current_organization_id"] = params[0] ?? "";
        return { rows: [{ set_config: params[0] ?? "" }] };
      }
      if (text.includes("set_config('app.current_user_id'")) {
        context["app.current_user_id"] = params[0] ?? "";
        return { rows: [{ set_config: params[0] ?? "" }] };
      }
      if (text.includes("set_config('app.access_purpose'")) {
        context["app.access_purpose"] = params[0] ?? "";
        return { rows: [{ set_config: params[0] ?? "" }] };
      }
      if (text.includes("set_config('app.actor_type'")) {
        context["app.actor_type"] = text.includes("platform_staff") ? "platform_staff" : "system";
        return { rows: [{ set_config: context["app.actor_type"] }] };
      }
      if (text.includes("current_setting('app.current_organization_id'")) {
        const orgId = context["app.current_organization_id"] || null;
        return { rows: [{ org_id: orgId, organization_id: orgId }] };
      }
      if (text.includes("fake_visible_rows")) {
        const orgId = context["app.current_organization_id"] ?? "";
        return { rows: rowsByOrg.get(orgId) ?? [] };
      }

      return { rows: [] };
    };
  }

  const rowsByOrg = new Map<string, unknown[]>([
    ["org-alpha", [{ id: "alpha-row", organization_id: "org-alpha" }]],
    ["org-beta", [{ id: "beta-row", organization_id: "org-beta" }]],
  ]);

  const db = {
    transaction: vi.fn(async (fn: (tx: { execute: (query: unknown) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => {
      const localContext: Context = {};
      const tx = { execute: executeWithContext(localContext, rowsByOrg) };
      try {
        const result = await fn(tx);
        committedContexts.push({ ...localContext });
        return result;
      } catch (error) {
        rolledBackContexts.push({ ...localContext });
        throw error;
      }
    }),
    execute: vi.fn(async (query: unknown) => executeWithContext(sessionContext, rowsByOrg)(query)),
    __testState: {
      sessionContext,
      committedContexts,
      rolledBackContexts,
      rowsByOrg,
    },
  };

  return db;
});

vi.mock("../../../../lib/db/src/index.js", () => ({
  db: mockDb,
}));

import {
  getCurrentTenantContext,
  withPlatformContext,
  withTenantContext,
} from "../../../../lib/db/src/tenantAccess";

const tenantAccessSource = readFileSync(
  resolve(__dirname, "../../../../lib/db/src/tenantAccess.ts"),
  "utf8",
);
const platformDbSource = readFileSync(
  resolve(__dirname, "../../../../lib/db/src/platform.ts"),
  "utf8",
);

describe("A3 tenant context pooled-connection leakage guard", () => {
  it("sets app.current_organization_id inside db.transaction with LOCAL scope", () => {
    expect(tenantAccessSource).toContain("return db.transaction(async (tx) =>");
    expect(tenantAccessSource).toContain("SELECT set_config('app.current_organization_id'");
    expect(tenantAccessSource).toContain("${ctx.tenantId}, true");
  });

  it("keeps concurrent tenant requests isolated on the shared pool wrapper", async () => {
    const [alphaRows, betaRows] = await Promise.all([
      withTenantContext(
        { tenantId: "org-alpha", userId: "user-alpha", purpose: "test.concurrent_alpha" },
        async (tx) => {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
          return (await tx.execute("SELECT * FROM fake_visible_rows" as never)).rows;
        },
      ),
      withTenantContext(
        { tenantId: "org-beta", userId: "user-beta", purpose: "test.concurrent_beta" },
        async (tx) => (await tx.execute("SELECT * FROM fake_visible_rows" as never)).rows,
      ),
    ]);

    expect(alphaRows).toEqual([{ id: "alpha-row", organization_id: "org-alpha" }]);
    expect(betaRows).toEqual([{ id: "beta-row", organization_id: "org-beta" }]);
  });

  it("leaves no tenant context on the returned connection after a mid-transaction throw", async () => {
    await expect(
      withTenantContext(
        { tenantId: "org-alpha", userId: "user-alpha", purpose: "test.throw" },
        async () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");

    const context = await getCurrentTenantContext();
    expect(context?.organizationId).toBeNull();
    expect(mockDb.__testState.rolledBackContexts.at(-1)?.["app.current_organization_id"]).toBe("org-alpha");
    expect(mockDb.__testState.sessionContext["app.current_organization_id"]).toBeUndefined();
  });

  it("platform context clears org context locally and leaves no inherited tenant state", async () => {
    mockDb.__testState.sessionContext["app.current_organization_id"] = "org-alpha";

    let insidePlatformContext: string | null = "not-read";
    await withPlatformContext(
      { userId: "platform-user", purpose: "platform.test" },
      async (tx) => {
        const result = await tx.execute(
          "SELECT NULLIF(current_setting('app.current_organization_id', TRUE), '') AS org_id" as never,
        );
        insidePlatformContext = (result.rows[0] as { org_id?: string | null } | undefined)?.org_id ?? null;
      },
    );

    expect(insidePlatformContext).toBeNull();
    expect(mockDb.__testState.sessionContext["app.current_organization_id"]).toBe("org-alpha");
  });

  it("platform pool is a separate client and never sets tenant org context", () => {
    expect(platformDbSource).toContain("export const platformPool = new Pool");
    expect(platformDbSource).toContain("export const platformDb = drizzle(platformPool");
    expect(platformDbSource).not.toContain("set_config('app.current_organization_id'");
    expect(platformDbSource).not.toContain("current_organization_id");
  });
});
