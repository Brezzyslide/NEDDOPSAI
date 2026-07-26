#!/usr/bin/env tsx
/**
 * scripts/provision-persistent-orgs.ts — Persistent Organisation Provisioning
 *
 * Provisions four stable, named organisations with fixed UUIDs that persist
 * across all test runs and environment restarts. These are the canonical
 * test/development organisations for the NeedsOps AI+ platform.
 *
 * Organisations:
 *   1. NeedsOps Internal     — Internal platform org (environment: internal)
 *   2. MH&R Holdings         — Simulated large enterprise org (environment: test)
 *   3. Organisation Alpha    — Test org A for isolation tests (environment: test)
 *   4. Organisation Beta     — Test org B for isolation tests (environment: test)
 *
 * Properties:
 *   • Fixed stable UUIDs — never regenerated, safe to reference in docs/tests
 *   • Idempotent — safe to re-run without side effects
 *   • NOT cleaned up in teardown — these rows survive all test runs
 *   • Full 14-step provisioning: schema, credentials, backup config, settings
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run tsx scripts/provision-persistent-orgs.ts
 *   # or directly:
 *   tsx scripts/provision-persistent-orgs.ts [--dry-run] [--force-reprovision]
 *
 * Output:
 *   Console log of each step + docs/persistent-org-provisioning-report.md
 */

import { db, organizationsTable, orgDatabaseRegistryTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { provisionOrgDb, deriveSchemaName } from "@workspace/org-db";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Fixed stable UUIDs ───────────────────────────────────────────────────────
// These UUIDs are permanent — never regenerate them.

const PERSISTENT_ORGS = [
  {
    id:          "00000000-0001-0000-0000-needsops0001",
    name:        "NeedsOps Internal",
    slug:        "needsops-internal",
    displayName: "NeedsOps AI+ Internal",
    type:        "platform_internal" as const,
    status:      "active" as const,
    tier:        "enterprise",
    environment: "internal",
    isTest:      false,
    description: "Internal NeedsOps platform organisation for staff tools and admin.",
  },
  {
    id:          "00000000-0002-0000-0000-mhrholdings02",
    name:        "MH&R Holdings",
    slug:        "mhr-holdings",
    displayName: "MH&R Holdings Pty Ltd",
    type:        "ndis_provider" as const,
    status:      "active" as const,
    tier:        "enterprise",
    environment: "test",
    isTest:      true,
    description: "Simulated large enterprise NDIS provider for integration testing.",
  },
  {
    id:          "00000000-0003-0000-0000-orgalpha00003",
    name:        "Organisation Alpha",
    slug:        "org-alpha",
    displayName: "Organisation Alpha (Test)",
    type:        "ndis_provider" as const,
    status:      "active" as const,
    tier:        "starter",
    environment: "test",
    isTest:      true,
    description: "Test organisation A — used for cross-org isolation tests.",
  },
  {
    id:          "00000000-0004-0000-0000-orgbeta000004",
    name:        "Organisation Beta",
    slug:        "org-beta",
    displayName: "Organisation Beta (Test)",
    type:        "ndis_provider" as const,
    status:      "active" as const,
    tier:        "starter",
    environment: "test",
    isTest:      true,
    description: "Test organisation B — used for cross-org isolation tests.",
  },
] as const;

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE_REPROVISION = args.includes("--force-reprovision");

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrgReport {
  id: string;
  name: string;
  schemaName: string;
  status: "provisioned" | "already_active" | "failed";
  steps: string[];
  error?: string;
  durationMs: number;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("NeedsOps AI+ — Persistent Organisation Provisioning");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);
  if (FORCE_REPROVISION) console.log("Force re-provisioning: ON");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log();

  const reports: OrgReport[] = [];
  const startedAt = new Date();

  for (const org of PERSISTENT_ORGS) {
    const t = Date.now();
    console.log(`▸ [${org.name}] (${org.id})`);

    if (DRY_RUN) {
      const schemaName = deriveSchemaName(org.id);
      console.log(`  → DRY RUN: would provision schema '${schemaName}'`);
      reports.push({
        id: org.id,
        name: org.name,
        schemaName,
        status: "provisioned",
        steps: ["dry_run_skip"],
        durationMs: Date.now() - t,
      });
      continue;
    }

    try {
      // ── 1. Upsert org record ─────────────────────────────────────────────
      const existingRows = await db
        .select({ id: organizationsTable.id, status: organizationsTable.status })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, org.id))
        .limit(1);

      if (existingRows.length === 0) {
        console.log(`  → Creating organization record...`);
        await db.insert(organizationsTable).values({
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: org.status,
          subscriptionTier: org.tier,
          isTestOrganisation: org.isTest,
          environment: org.environment,
        } as any).onConflictDoNothing();
        console.log(`  ✓ Organization record created`);
      } else {
        console.log(`  → Organization record exists (status: ${existingRows[0]!.status})`);
        // Ensure environment and isTestOrganisation are set correctly
        await db.execute(sql`
          UPDATE organizations
          SET is_test_organisation = ${org.isTest},
              environment = ${org.environment},
              updated_at = NOW()
          WHERE id = ${org.id}
        `);
      }

      // ── 2. Check existing registry ───────────────────────────────────────
      if (!FORCE_REPROVISION) {
        const existing = await db
          .select({ status: orgDatabaseRegistryTable.status, schemaName: orgDatabaseRegistryTable.schemaName })
          .from(orgDatabaseRegistryTable)
          .where(eq(orgDatabaseRegistryTable.organizationId, org.id))
          .limit(1);

        if (existing.length > 0 && existing[0]!.status === "active") {
          console.log(`  ✓ Already provisioned and active (schema: ${existing[0]!.schemaName})`);
          reports.push({
            id: org.id,
            name: org.name,
            schemaName: existing[0]!.schemaName,
            status: "already_active",
            steps: ["skipped_already_active"],
            durationMs: Date.now() - t,
          });
          console.log();
          continue;
        }
      }

      // ── 3. Run full 14-step provisioning ─────────────────────────────────
      console.log(`  → Running 14-step provisioning...`);
      const result = await provisionOrgDb({
        organizationId: org.id,
        provisionedBy: "provision-persistent-orgs-script",
      });

      const schemaName = deriveSchemaName(org.id);

      if (result.success) {
        console.log(`  ✓ Provisioning complete (schema: ${schemaName})`);
        result.steps.forEach(s => {
          const icon = s.status === "completed" ? "✓" : s.status === "skipped" ? "↷" : "✗";
          console.log(`    ${icon} ${s.step} (${s.durationMs}ms)`);
        });

        reports.push({
          id: org.id,
          name: org.name,
          schemaName,
          status: "provisioned",
          steps: result.steps.map(s => `${s.step}: ${s.status}`),
          durationMs: Date.now() - t,
        });
      } else {
        console.error(`  ✗ Provisioning failed: ${result.error}`);
        reports.push({
          id: org.id,
          name: org.name,
          schemaName,
          status: "failed",
          steps: result.steps.map(s => `${s.step}: ${s.status}`),
          error: result.error,
          durationMs: Date.now() - t,
        });
      }
    } catch (err: any) {
      const schemaName = deriveSchemaName(org.id);
      console.error(`  ✗ Error: ${err?.message ?? err}`);
      reports.push({
        id: org.id,
        name: org.name,
        schemaName,
        status: "failed",
        steps: [],
        error: err?.message ?? String(err),
        durationMs: Date.now() - t,
      });
    }

    console.log();
  }

  // ── Verify registry count ──────────────────────────────────────────────────
  if (!DRY_RUN) {
    const registryRows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(orgDatabaseRegistryTable)
      .where(eq(orgDatabaseRegistryTable.status, "active"));

    const activeCount = Number(registryRows[0]?.count ?? 0);
    console.log(`Registry: ${activeCount} active organisation(s) total`);
    console.log();
  }

  // ── Produce provisioning report ────────────────────────────────────────────
  const completedAt = new Date();
  const report = buildReport(reports, startedAt, completedAt, DRY_RUN);

  const docsDir = join(__dirname, "../docs");
  try {
    mkdirSync(docsDir, { recursive: true });
  } catch {}

  const reportPath = join(docsDir, "persistent-org-provisioning-report.md");
  writeFileSync(reportPath, report, "utf8");
  console.log(`Report written to: ${reportPath}`);

  // ── Exit code ──────────────────────────────────────────────────────────────
  const failures = reports.filter(r => r.status === "failed");
  if (failures.length > 0) {
    console.error(`\n${failures.length} organisation(s) failed to provision. Check errors above.`);
    process.exit(2);
  }

  console.log("\n✓ All persistent organisations provisioned successfully.");
  process.exit(0);
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(
  reports: OrgReport[],
  startedAt: Date,
  completedAt: Date,
  dryRun: boolean,
): string {
  const lines: string[] = [
    "# Persistent Organisation Provisioning Report",
    "",
    `Generated: ${completedAt.toISOString()}`,
    `Mode: ${dryRun ? "Dry Run (no changes)" : "Live"}`,
    `Duration: ${completedAt.getTime() - startedAt.getTime()}ms`,
    "",
    "## Summary",
    "",
    `| Org | UUID | Schema | Status | Duration |`,
    `|-----|------|--------|--------|----------|`,
  ];

  for (const r of reports) {
    const statusIcon = r.status === "provisioned" ? "✓ Provisioned"
      : r.status === "already_active" ? "↷ Already active"
      : "✗ Failed";
    lines.push(`| ${r.name} | \`${r.id}\` | \`${r.schemaName}\` | ${statusIcon} | ${r.durationMs}ms |`);
  }

  lines.push("");
  lines.push("## Persistent Organisation UUIDs");
  lines.push("");
  lines.push("These UUIDs are permanent and must not be changed.");
  lines.push("");

  for (const r of reports) {
    lines.push(`### ${r.name}`);
    lines.push(`- **UUID:** \`${r.id}\``);
    lines.push(`- **Schema:** \`${r.schemaName}\``);
    lines.push(`- **Status:** ${r.status}`);
    if (r.error) {
      lines.push(`- **Error:** ${r.error}`);
    }
    if (r.steps.length > 0 && r.steps[0] !== "skipped_already_active" && r.steps[0] !== "dry_run_skip") {
      lines.push(`- **Steps:**`);
      r.steps.forEach(s => lines.push(`  - ${s}`));
    }
    lines.push("");
  }

  lines.push("## Important Notes");
  lines.push("");
  lines.push("- These organisations have **fixed stable UUIDs** that must never be regenerated.");
  lines.push("- They are **not cleaned up** in test teardown — rows survive all test runs.");
  lines.push("- The vitest global setup checks that `org_database_registry` has ≥ 4 active rows.");
  lines.push("- Run this script again at any time — it is fully idempotent.");
  lines.push("- Re-provisioning uses `provisionOrgDb()` which skips already-completed steps.");
  lines.push("");
  lines.push("## Re-running");
  lines.push("");
  lines.push("```bash");
  lines.push("# Safe to run multiple times:");
  lines.push("tsx scripts/provision-persistent-orgs.ts");
  lines.push("");
  lines.push("# Force re-provisioning of all steps:");
  lines.push("tsx scripts/provision-persistent-orgs.ts --force-reprovision");
  lines.push("");
  lines.push("# Dry run (no changes):");
  lines.push("tsx scripts/provision-persistent-orgs.ts --dry-run");
  lines.push("```");

  return lines.join("\n");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
