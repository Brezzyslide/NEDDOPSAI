#!/usr/bin/env tsx
/**
 * scripts/provision-org.ts — Generic Organisation Provisioning CLI
 *
 * Provisions an organisation's operational database schema without hardcoding
 * any organisation names or UUIDs. All parameters are passed at runtime.
 *
 * Usage:
 *   pnpm run provision-org -- --org-id <uuid>
 *   pnpm run provision-org -- --org-id <uuid> --dry-run
 *   pnpm run provision-org -- --org-id <uuid> --force-reprovision
 *
 * The organisation record must already exist in public.organizations before
 * calling this script. Company creation is a separate deliberate admin action.
 *
 * This script is idempotent — it is safe to run against an already-provisioned
 * organisation (provisionOrgDb() skips steps that are already complete).
 *
 * Arguments:
 *   --org-id <uuid>           Required. The organisation UUID from public.organizations.
 *   --dry-run                 Print what would be done without making changes.
 *   --force-reprovision       Re-run all provisioning steps (use with care in production).
 *   --admin-user-id <id>      Optional. Platform user ID to add as initial owner.
 *
 * Exit codes:
 *   0 — Provisioning complete (or already provisioned)
 *   1 — Missing arguments or org not found
 *   2 — Provisioning failed
 */

import { db, organizationsTable, orgDatabaseRegistryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { provisionOrgDb, deriveSchemaName } from "@workspace/org-db";

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

const orgId = getArg("--org-id");
const dryRun = hasFlag("--dry-run");
const forceReprovision = hasFlag("--force-reprovision");
const adminUserId = getArg("--admin-user-id");

if (!orgId) {
  console.error("Error: --org-id <uuid> is required");
  console.error("Usage: pnpm run provision-org -- --org-id <uuid> [--dry-run] [--admin-user-id <id>]");
  process.exit(1);
}

// Basic UUID format check
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
  console.error(`Error: "${orgId}" is not a valid UUID. org-id must be a UUID from public.organizations.`);
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== NeedsOps AI+ — Organisation Provisioning ===`);
  console.log(`Org ID:      ${orgId}`);
  console.log(`Dry run:     ${dryRun}`);
  console.log(`Admin user:  ${adminUserId ?? "(none)"}`);
  console.log("");

  // 1. Verify org exists in platform DB
  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId!))
    .limit(1);

  if (!org) {
    console.error(`Error: No organisation found with id="${orgId}".`);
    console.error("Create the organisation record first before provisioning.");
    process.exit(1);
  }

  console.log(`Organisation: ${org.name} (${org.slug})`);
  console.log(`Status:       ${org.status}`);
  console.log(`Type:         ${org.type ?? "not set"}`);
  console.log(`Environment:  ${(org as any).environment ?? "production"}`);
  console.log(`Test org:     ${(org as any).isTestOrganisation ?? false}`);
  console.log("");

  if (org.status === "closed") {
    console.error("Error: Cannot provision a closed organisation.");
    process.exit(1);
  }

  // 2. Check existing registry entry
  const [existing] = await db
    .select()
    .from(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, orgId!))
    .limit(1);

  if (existing && !forceReprovision) {
    console.log(`✓ Already provisioned`);
    console.log(`  Schema:      ${existing.schemaName}`);
    console.log(`  Status:      ${existing.status}`);
    console.log(`  Provisioned: ${existing.provisionedAt?.toISOString() ?? "unknown"}`);
    console.log("\nProvisioning is idempotent — re-run with --force-reprovision to re-apply all steps.");
    process.exit(0);
  }

  // 3. Show what will be done
  const schemaName = deriveSchemaName(orgId!);
  console.log(`Derived schema name: ${schemaName}`);
  console.log("");

  if (dryRun) {
    console.log("[DRY RUN] Would perform the following steps:");
    console.log("  1. Register org in org_database_registry");
    console.log("  2. Create PostgreSQL schema:", schemaName);
    console.log("  3. Grant schema permissions to needsops_app");
    console.log("  4. Create all org operational tables");
    console.log("  5. Create RLS policies on org tables");
    console.log("  6. Create SECURITY DEFINER functions");
    console.log("  7. Apply initial schema migrations");
    console.log("  8. Write initial org_settings rows");
    if (adminUserId) {
      console.log(`  9. Add ${adminUserId} as initial org owner`);
    }
    console.log("\n[DRY RUN] No changes made.");
    process.exit(0);
  }

  // 4. Execute provisioning
  console.log("Starting provisioning...\n");

  try {
    const result = await provisionOrgDb({
      organizationId: orgId!,
      organizationName: org.name,
      schemaName,
      adminUserId: adminUserId ?? "cli-provision",
    });

    if (result.success) {
      console.log(`✓ Provisioning complete!`);
      console.log(`  Schema:   ${result.schemaName}`);
      console.log(`  Steps:    ${result.steps.length} completed`);
      console.log(`  Duration: ${result.durationMs}ms`);
      console.log("");
      console.log("Steps completed:");
      for (const step of result.steps) {
        const icon = step.status === "completed" ? "✓" : step.status === "skipped" ? "—" : "✗";
        console.log(`  ${icon} ${step.name}: ${step.status}`);
      }
      console.log("\nOrganisation is ready. Operational data can now be written to its schema.");
    } else {
      const failed = result.steps.filter(s => s.status === "failed");
      console.error(`\n✗ Provisioning failed at step: ${failed[0]?.name ?? "unknown"}`);
      for (const step of failed) {
        console.error(`  ✗ ${step.name}: ${step.error}`);
      }
      process.exit(2);
    }
  } catch (err: any) {
    console.error("\n✗ Provisioning threw an error:", err?.message ?? err);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("Fatal:", err?.message ?? err);
  process.exit(2);
});
