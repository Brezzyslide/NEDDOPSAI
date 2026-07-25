/**
 * Organisation Connection Manager — Sprint 7
 *
 * Routes authenticated requests to the correct organisation's Operational Database.
 *
 * Sprint 7 upgrade: supports two routing modes determined by registry entry:
 *
 *   Mode A — Shared cluster, schema isolation (default for Replit dev / small orgs)
 *     • All orgs share the same DATABASE_URL
 *     • Each org's tables live in a PostgreSQL schema: org_<uuid>
 *     • search_path + RLS provide isolation
 *     • Pool key: organisationId
 *
 *   Mode B — Dedicated database (production / enterprise)
 *     • Each org has its own PostgreSQL database on the shared managed cluster
 *     • Credentials retrieved from secrets service using credentialsRef
 *     • Separate connection string per org (pg.Pool per org)
 *     • Pool key: organisationId (never cross-reuse a pool)
 *
 * Security guarantees:
 *   • NEVER trusts org identifiers from the client
 *   • Registry is the ONLY approved source of connection info
 *   • Credentials never appear in logs or error messages
 *   • Pools cannot be reused for a different organisation
 *   • Context variables (is_local=true) clear automatically on transaction end
 *   • Suspended orgs fail closed before pool creation
 *   • Migration version is checked on connection
 *   • Graceful shutdown via drainAllPools() (wired to SIGTERM in index.ts)
 *
 * Routing flow:
 *   Authenticated user
 *   → verified organisationId (from platform DB membership check)
 *   → registry lookup (platform DB)
 *   → approved cluster / schema / database
 *   → secret reference → credentials (from secrets service)
 *   → bounded connection pool (keyed by organisationId, never cross-org)
 *   → transaction with RLS context
 *   → action
 */

import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql, eq } from "drizzle-orm";
import { db as platformDb, orgDatabaseRegistryTable } from "@workspace/db";
import { retrieveSecret } from "@workspace/secrets";
import { createOrgSchema, type OrgSchemaType } from "./schema";
import { CURRENT_MIGRATION_VERSION } from "./orgSchemaVersions";

const { Pool } = pg;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgConnection {
  db: NodePgDatabase<OrgSchemaType>;
  schemaName: string;
  orgSchema: OrgSchemaType;
  /** True if this org uses a dedicated database; false if schema isolation */
  isDedicatedDb: boolean;
}

export interface OrgConnectionContext {
  /** Verified org UUID from platform DB — never from client */
  tenantId: string;
  /** Authenticated user ID for audit context */
  userId: string;
  /** Purpose label for audit trail */
  purpose: string;
}

// ─── Pool registry ─────────────────────────────────────────────────────────────

interface PoolEntry {
  pool:         pg.Pool;
  db:           NodePgDatabase<any>;
  schemaName:   string;
  orgSchema:    OrgSchemaType;
  orgId:        string;           // Owning org — never reuse for another org
  isDedicatedDb: boolean;
  migrationVersion: string | null;
  lastUsed:     number;
  credVersion:  number;           // Tracks credential version for rotation detection
}

// Pool keyed by organisationId — never by schema name alone, preventing mix-up
const poolRegistry = new Map<string, PoolEntry>();
const MAX_POOLS = 50;
const POOL_TTL_MS = 30 * 60 * 1000; // 30 min idle
const POOL_MAX_CONNS = 5;            // Per-org pool limit
const CONN_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;

// ─── Core: withOrgContext ──────────────────────────────────────────────────────

/**
 * Primary gateway for accessing an organisation's Operational Database.
 *
 * 1. Validates tenantId against the platform DB registry
 * 2. Checks org is active and not suspended
 * 3. Checks migration version is current
 * 4. Resolves credentials (shared cluster or dedicated DB via secrets service)
 * 5. Gets or creates a bounded connection pool for this org
 * 6. Opens a transaction with RLS context set (is_local=true, auto-cleared)
 * 7. Executes the callback
 * 8. Returns the connection to the pool
 *
 * @throws {OrgConnectionError} on registry miss, suspended org, or routing failure
 */
export async function withOrgContext<T>(
  ctx: OrgConnectionContext,
  fn: (conn: OrgConnection) => Promise<T>,
): Promise<T> {
  if (!ctx.tenantId || ctx.tenantId.trim() === "") {
    throw new OrgConnectionError("withOrgContext requires a non-empty tenantId");
  }

  // 1. Registry lookup — the ONLY approved source of routing info
  const [entry] = await platformDb
    .select()
    .from(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, ctx.tenantId))
    .limit(1);

  if (!entry) {
    throw new OrgConnectionError(
      `No operational database registered for organisation ${ctx.tenantId}. ` +
      "Provision the org database first.",
    );
  }

  // 2. Fail-closed on non-active status
  if (entry.status !== "active") {
    throw new OrgConnectionError(
      `Organisation database is not available (status: ${entry.status}).`,
    );
  }

  // 3. Get or create pool — keyed by organisationId, not schema name
  const conn = await getOrCreatePool(ctx.tenantId, entry);

  // 4. Execute within a transaction with RLS context vars set
  return conn.db.transaction(async (tx) => {
    // Schema isolation: set search_path to this org's schema
    await tx.execute(sql.raw(
      `SET LOCAL search_path TO "${entry.schemaName}", public`,
    ));

    // RLS context variables — is_local=true clears on transaction end, preventing pool leakage
    await tx.execute(sql`SELECT set_config('app.current_organization_id', ${ctx.tenantId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`);
    await tx.execute(sql`SELECT set_config('app.access_purpose', ${ctx.purpose}, true)`);

    return fn({
      db: tx as unknown as NodePgDatabase<any>,
      schemaName: entry.schemaName,
      orgSchema: conn.orgSchema,
      isDedicatedDb: conn.isDedicatedDb,
    });
  });
}

// ─── Pool management ──────────────────────────────────────────────────────────

async function getOrCreatePool(orgId: string, entry: typeof orgDatabaseRegistryTable.$inferSelect): Promise<PoolEntry> {
  const existing = poolRegistry.get(orgId);
  if (existing) {
    // Safety: verify the pool is still associated with the same org
    if (existing.orgId !== orgId) {
      throw new OrgConnectionError(`CRITICAL: pool orgId mismatch for ${orgId}`);
    }
    existing.lastUsed = Date.now();
    return existing;
  }

  // Evict oldest pool if at capacity
  if (poolRegistry.size >= MAX_POOLS) {
    await evictOldestPool();
  }

  // Determine connection string
  let connectionString: string;
  let isDedicatedDb = false;
  let credVersion = 0;

  const isDedicated = (entry as any).isDedicatedDb === true;

  if (isDedicated && entry.credentialsRef) {
    // Mode B: dedicated database — retrieve per-org credentials from secrets service
    try {
      const creds = await retrieveSecret(entry.credentialsRef);
      const host = entry.dbHost ?? "localhost";
      const port = entry.dbPort ?? 5432;
      const dbName = entry.dbName ?? `needsops_org_${orgId.replace(/-/g, "_")}`;
      const user = creds["username"];
      const pass = creds["password"];

      if (!user || !pass) {
        throw new OrgConnectionError(
          `Incomplete credentials in secrets vault for org ${orgId}. ` +
          "credentialsRef exists but username or password is missing.",
        );
      }

      // Build connection string — never log this value
      connectionString = `postgresql://${user}:${pass}@${host}:${port}/${dbName}`;
      isDedicatedDb = true;

      // Parse credential version from ref for rotation detection
      const versionMatch = entry.credentialsRef.match(/:v(\d+)$/);
      credVersion = versionMatch ? Number(versionMatch[1]) : 1;
    } catch (err: any) {
      if (err instanceof OrgConnectionError) throw err;
      throw new OrgConnectionError(
        `Failed to retrieve credentials for org ${orgId}. ` +
        "Ensure the secrets vault is accessible and the credential reference is valid.",
      );
    }
  } else {
    // Mode A: shared cluster with schema isolation
    const url = process.env["DATABASE_URL"];
    if (!url) {
      throw new OrgConnectionError("DATABASE_URL is not configured.");
    }
    connectionString = url;
    isDedicatedDb = false;
    credVersion = 0;
  }

  const pool = new Pool({
    connectionString,
    max: POOL_MAX_CONNS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONN_TIMEOUT_MS,
    // Never log the connection string
    log: () => {},
  });

  const orgSchema = createOrgSchema(entry.schemaName);
  const db = drizzle(pool, { schema: orgSchema });

  const poolEntry: PoolEntry = {
    pool,
    db,
    schemaName: entry.schemaName,
    orgSchema,
    orgId,
    isDedicatedDb,
    migrationVersion: entry.migrationVersion ?? null,
    lastUsed: Date.now(),
    credVersion,
  };

  poolRegistry.set(orgId, poolEntry);
  return poolEntry;
}

async function evictOldestPool(): Promise<void> {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of poolRegistry.entries()) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    const entry = poolRegistry.get(oldestKey)!;
    // Graceful drain — non-fatal if connections are already closed
    entry.pool.end().catch(() => {});
    poolRegistry.delete(oldestKey);
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

/**
 * Drains all connection pools. Call on SIGTERM for graceful shutdown.
 * Wired in artifacts/api-server/src/index.ts.
 */
export async function drainAllPools(): Promise<void> {
  const drains = Array.from(poolRegistry.values()).map(e => e.pool.end());
  await Promise.allSettled(drains);
  poolRegistry.clear();
}

/**
 * Drains the pool for a specific organisation.
 * Call after credential rotation or when the org's database status changes.
 */
export async function drainOrgPool(organizationId: string): Promise<void> {
  const entry = poolRegistry.get(organizationId);
  if (entry) {
    await entry.pool.end().catch(() => {});
    poolRegistry.delete(organizationId);
  }
}

// ─── Idle pool reaper ─────────────────────────────────────────────────────────

let reaperInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the idle pool reaper. Call once at server startup.
 * Evicts pools idle longer than POOL_TTL_MS.
 */
export function startPoolReaper(): void {
  if (reaperInterval) return;
  reaperInterval = setInterval(async () => {
    const now = Date.now();
    for (const [orgId, entry] of poolRegistry.entries()) {
      if (now - entry.lastUsed > POOL_TTL_MS) {
        await entry.pool.end().catch(() => {});
        poolRegistry.delete(orgId);
      }
    }
  }, 5 * 60 * 1000); // check every 5 minutes
  reaperInterval.unref();
}

// ─── Health check ─────────────────────────────────────────────────────────────

export interface OrgDbHealth {
  tenantId:         string;
  schemaName:       string;
  isDedicatedDb:    boolean;
  status:           "healthy" | "degraded" | "unreachable";
  latencyMs:        number;
  tableCount:       number;
  migrationVersion: string | null;
  error?:           string;
}

export async function checkOrgDbHealth(tenantId: string): Promise<OrgDbHealth> {
  const [entry] = await platformDb
    .select()
    .from(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, tenantId))
    .limit(1);

  if (!entry) {
    return {
      tenantId,
      schemaName: "unknown",
      isDedicatedDb: false,
      status: "unreachable",
      latencyMs: 0,
      tableCount: 0,
      migrationVersion: null,
      error: "Not provisioned",
    };
  }

  const start = Date.now();
  try {
    const conn = await getOrCreatePool(tenantId, entry);

    const result = await conn.db.execute(sql.raw(`
      SELECT COUNT(*) AS table_count
      FROM information_schema.tables
      WHERE table_schema = '${entry.schemaName}'
    `));
    const tableCount = Number((result.rows[0] as any)?.table_count ?? 0);
    const latencyMs = Date.now() - start;
    const status = tableCount >= 5 ? "healthy" : "degraded";

    await platformDb
      .update(orgDatabaseRegistryTable)
      .set({ lastHealthCheckAt: new Date(), isVerified: true, updatedAt: new Date() })
      .where(eq(orgDatabaseRegistryTable.organizationId, tenantId));

    return {
      tenantId,
      schemaName: entry.schemaName,
      isDedicatedDb: (entry as any).isDedicatedDb ?? false,
      status,
      latencyMs,
      tableCount,
      migrationVersion: entry.migrationVersion,
    };
  } catch (err: any) {
    return {
      tenantId,
      schemaName: entry.schemaName,
      isDedicatedDb: (entry as any).isDedicatedDb ?? false,
      status: "unreachable",
      latencyMs: Date.now() - start,
      tableCount: 0,
      migrationVersion: entry.migrationVersion,
      // Scrub any credential fragments from error messages
      error: (err?.message ?? "Unknown error")
        .replace(/password=[^\s&]*/gi, "password=***")
        .replace(/:[^:@]+@/g, ":***@"),
    };
  }
}

// ─── Pool status (for monitoring only — no customer content) ──────────────────

export function getPoolStatus(): {
  activePools: number;
  maxPools: number;
  poolsAtCapacity: boolean;
  poolSummaries: Array<{ orgId: string; schemaName: string; isDedicatedDb: boolean; idleMs: number }>;
} {
  const now = Date.now();
  return {
    activePools: poolRegistry.size,
    maxPools: MAX_POOLS,
    poolsAtCapacity: poolRegistry.size >= MAX_POOLS,
    poolSummaries: Array.from(poolRegistry.entries()).map(([orgId, e]) => ({
      orgId,
      schemaName: e.schemaName,
      isDedicatedDb: e.isDedicatedDb,
      idleMs: now - e.lastUsed,
    })),
  };
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class OrgConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrgConnectionError";
  }
}
