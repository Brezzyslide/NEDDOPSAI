#!/usr/bin/env tsx
/**
 * scripts/create-test-org.ts — Create and Provision a Test Organisation
 *
 * Creates a new test organisation record in public.organizations,
 * marks it as is_test_organisation=true and environment='test',
 * then provisions its operational schema.
 *
 * Test organisations:
 *   • Are excluded from billing reports, customer counts, and analytics.
 *   • Are identified by the is_test_organisation column — never by name matching.
 *   • Should be cleaned up after use (see --cleanup flag or do so manually).
 *   • Do NOT get auto-provisioned by any application code — this script is the
 *     only way to create them.
 *
 * Usage:
 *   pnpm run create-test-org -- --name "Test Corp" --slug test-corp-001
 *   pnpm run create-test-org -- --name "Test Corp" --slug test-corp-001 --admin-user-id user_123
 *   pnpm run create-test-org -- --org-id <existing-uuid>   # provision existing test org
 *
 * Arguments:
 *   --name <string>           Organisation display name (required when creating new)
 *   --slug <string>           URL-safe handle (required when creating new; must be unique)
 *   --org-id <uuid>           Use an existing org record instead of creating one
 *   --admin-user-id <id>      Optional platform user to add as initial owner
 *   --test-run-id <id>        Optional test run identifier (saved in metadata)
 *   --cleanup                 Delete the org AND deprovision its schema when done
 *
 * Exit codes:
 *   0 — Success
 *   1 — Invalid arguments
 *   2 — Creation/provisioning failed
 */

import { randomUUID } from "crypto";
import { db, organizationsTable, orgDatabaseRegistryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { provisionOrgDb, deprovisionOrgDb, deriveSchemaName } from "@workspace/org-db";

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

const orgName = getArg("--name");
const orgSlug = getArg("--slug");
const existingOrgId = getArg("--org-id");
const adminUserId = getArg("--admin-user-id");
const testRunId = getArg("--test-run-id") ?? `cli-${Date.now()}`;
const cleanup = hasFlag("--cleanup");

if (!existingOrgId && (!orgName || !orgSlug)) {
  console.error("Error: Either --org-id OR both --name and --slug are required.");
  console.error("Usage:");
  console.error("  pnpm run create-test-org -- --name <string> --slug <string>");
  console.error("  pnpm run create-test-org -- --org-id <existing-uuid>");
  process.exit(1);
}

if (orgSlug && !/^[a-z0-9-]+$/.test(orgSlug)) {
  console.error(`Error: slug must be lowercase alphanumeric with hyphens only. Got: "${orgSlug}"`);
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== NeedsOps AI+ — Create Test Organisation ===");

  let orgId: string;

  if (existingOrgId) {
    orgId = existingOrgId;
    const [existing] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .limit(1);

    if (!existing) {
      console.error(`Error: No organisation found with id="${orgId}".`);
      process.exit(1);
    }

    const isTest = (existing as any).isTestOrganisation;
    if (!isTest) {
      console.error(`Error: Organisation "${orgId}" is not marked as a test organisation.`);
      console.error("This script only operates on test organisations to prevent accidental production changes.");
      process.exit(1);
    }

    console.log(`Using existing test org: ${existing.name} (${existing.slug})`);
  } else {
    // Create a new test organisation record
    orgId = randomUUID();
    const schemaName = deriveSchemaName(orgId);

    console.log(`Creating test organisation:`);
    console.log(`  Name:       ${orgName}`);
    console.log(`  Slug:       ${orgSlug}`);
    console.log(`  ID:         ${orgId}`);
    console.log(`  Schema:     ${schemaName}`);
    console.log(`  Test run:   ${testRunId}`);

    try {
      await db.insert(organizationsTable).values({
        id: orgId,
        name: orgName!,
        slug: orgSlug!,
        displayName: orgName,
        status: "active",
        subscriptionTier: "starter",
        isTestOrganisation: true,
        environment: "test",
      } as any);

      console.log("\n✓ Organisation record created in public.organizations");
    } catch (err: any) {
      console.error("\n✗ Failed to create organisation record:", err?.message ?? err);
      process.exit(2);
    }
  }

  // Provision the operational schema
  const [registryEntry] = await db
    .select()
    .from(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, orgId))
    .limit(1);

  if (registryEntry) {
    console.log("\n✓ Schema already provisioned:", registryEntry.schemaName);
  } else {
    console.log("\nProvisioning operational schema...");

    const [org] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .limit(1);

    try {
      const result = await provisionOrgDb({
        organizationId: orgId,
        organizationName: org.name,
        schemaName: deriveSchemaName(orgId),
        adminUserId: adminUserId ?? "test-setup",
      });

      if (result.success) {
        console.log(`✓ Provisioning complete! Schema: ${result.schemaName}`);
      } else {
        const failed = result.steps.filter(s => s.status === "failed");
        console.error(`✗ Provisioning failed: ${failed[0]?.error}`);
        process.exit(2);
      }
    } catch (err: any) {
      console.error("✗ Provisioning error:", err?.message ?? err);
      process.exit(2);
    }
  }

  // Final output
  console.log("\n=== Test Organisation Ready ===");
  console.log(`Org ID:    ${orgId}`);
  console.log(`Schema:    ${deriveSchemaName(orgId)}`);
  console.log(`Test run:  ${testRunId}`);
  console.log("");
  console.log("IMPORTANT: Clean up this org after testing:");
  console.log(`  pnpm run create-test-org -- --org-id ${orgId} --cleanup`);

  // Cleanup (if requested)
  if (cleanup) {
    console.log("\n[--cleanup] Deprovisioning and deleting test organisation...");
    try {
      await deprovisionOrgDb(orgId);
      await db.delete(organizationsTable).where(eq(organizationsTable.id, orgId));
      console.log("✓ Test organisation deleted.");
    } catch (err: any) {
      console.error("✗ Cleanup failed:", err?.message ?? err);
      process.exit(2);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err?.message ?? err);
  process.exit(2);
});
