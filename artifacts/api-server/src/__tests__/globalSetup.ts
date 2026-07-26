/**
 * Vitest Global Setup — Sprint 7.1
 *
 * Runs once before the entire test suite. Verifies that the persistent
 * organisations have been provisioned in org_database_registry.
 *
 * If org_database_registry has zero active rows, the test suite aborts with
 * a clear error message instructing the operator to run the provisioning script.
 *
 * This ensures:
 *   1. The test environment is not a bare database.
 *   2. Persistent org provisioning is a deliberate prerequisite.
 *   3. Tests that reference persistent org data have a stable foundation.
 */

const MIN_ACTIVE_ORGS = 1; // At least 1 required; provision-persistent-orgs creates 4

export async function setup(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      "[GlobalSetup] DATABASE_URL is not set. " +
      "The test suite requires a live PostgreSQL connection.",
    );
  }

  // Use @workspace/db to avoid CJS/ESM resolution issues with pg
  const { db, orgDatabaseRegistryTable } = await import("@workspace/db");
  const { sql, eq } = await import("drizzle-orm");

  // Check if the table exists (fresh environments may not have run migrations)
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'org_database_registry'
    ) AS exists
  `);

  const tableExists = (tableCheck.rows[0] as any)?.exists === true;

  if (!tableExists) {
    throw new Error(
      "[GlobalSetup] org_database_registry table does not exist. " +
      "Run the platform database migrations first:\n" +
      "  psql $DATABASE_URL < lib/db/migrations/sprint7-platform-boundary.sql",
    );
  }

  // Count active orgs
  const result = await db.execute(sql`
    SELECT COUNT(*) AS active_count
    FROM org_database_registry
    WHERE status = 'active'
  `);

  const activeCount = Number((result.rows[0] as any)?.active_count ?? 0);

  if (activeCount < MIN_ACTIVE_ORGS) {
    throw new Error(
      `[GlobalSetup] org_database_registry has ${activeCount} active row(s). ` +
      `At least ${MIN_ACTIVE_ORGS} required.\n\n` +
      "Run the persistent org provisioning script before running the test suite:\n\n" +
      "  pnpm --filter @workspace/scripts run provision-persistent-orgs\n\n" +
      "This creates four stable organisations that survive across all test runs.",
    );
  }

  console.log(
    `[GlobalSetup] ✓ org_database_registry check passed — ${activeCount} active organisation(s)`,
  );
}

export async function teardown(): Promise<void> {
  // No global teardown — persistent orgs must survive test runs
}
