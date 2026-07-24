/**
 * Seed default feature flags and platform settings — Sprint 4
 * Idempotent: safe to run multiple times.
 * Run: npx tsx src/seed-platform-defaults.ts
 */

import { db, featureFlagsTable, platformSettingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Seeding platform defaults…");

  // ─── Feature Flags ───────────────────────────────────────────────────────────
  const flags = [
    { key: "maintenance_mode",         label: "Maintenance Mode",          description: "Put the platform into read-only maintenance mode.",                  isEnabled: false },
    { key: "new_onboarding_flow",      label: "New Onboarding Flow",       description: "Enable the redesigned organisation onboarding experience.",          isEnabled: false },
    { key: "ai_task_routing_v2",       label: "AI Task Routing v2",        description: "Use the improved Chief of Staff routing algorithm.",                  isEnabled: false },
    { key: "approval_workflow_auto",   label: "Auto-Approval Workflow",    description: "Allow AI specialists to auto-approve low-risk actions.",              isEnabled: false },
    { key: "platform_audit_streaming", label: "Audit Streaming",           description: "Enable real-time audit event streaming to external SIEM.",            isEnabled: false },
    { key: "csv_export_enabled",       label: "CSV Exports",               description: "Enable CSV download buttons across the platform console.",            isEnabled: true  },
    { key: "usage_warnings_active",    label: "Usage Warning Notifications",description: "Send usage warning notifications to org admins at 80% / 95%.",       isEnabled: true  },
    { key: "trial_auto_expiry",        label: "Trial Auto-Expiry",         description: "Automatically transition trial subscriptions to trial_expired status.",isEnabled: true  },
    { key: "platform_search_enabled",  label: "Platform Global Search",    description: "Enable the global search bar in the Platform Console.",               isEnabled: true  },
    { key: "plan_version_history",     label: "Plan Version History",      description: "Show full plan version history in the Commercial section.",            isEnabled: true  },
  ];

  for (const flag of flags) {
    await db.insert(featureFlagsTable)
      .values({ ...flag, context: {} })
      .onConflictDoNothing();
  }
  console.log(`  ✓ ${flags.length} feature flags`);

  // ─── Platform Settings ────────────────────────────────────────────────────────
  const settings = [
    { key: "default_trial_days",      label: "Default Trial Length (days)",    description: "Number of trial days for new organisations.",                value: 14 },
    { key: "default_currency",        label: "Default Currency",               description: "ISO 4217 currency code for pricing display.",                value: "AUD" },
    { key: "platform_name",           label: "Platform Name",                  description: "Display name shown in the Platform Console header.",          value: "NeedsOps AI+" },
    { key: "support_email",           label: "Support Email",                  description: "Email address shown to organisations for platform support.",  value: "support@needsops.com.au" },
    { key: "maintenance_message",     label: "Maintenance Message",            description: "Message shown during maintenance mode.",                      value: "NeedsOps AI+ is undergoing scheduled maintenance. We'll be back shortly." },
    { key: "max_trial_extensions",    label: "Max Trial Extensions per Org",   description: "Maximum number of times a trial can be extended per org.",   value: 3 },
    { key: "usage_warning_threshold", label: "Usage Warning Threshold (%)",    description: "Percentage of usage limit that triggers a warning.",          value: 80 },
    { key: "usage_critical_threshold",label: "Usage Critical Threshold (%)",   description: "Percentage of usage limit that triggers a critical alert.",   value: 95 },
    { key: "platform_timezone",       label: "Platform Timezone",              description: "Default timezone for date display in the console.",           value: "Australia/Sydney" },
    { key: "ndis_jurisdiction",       label: "NDIS Jurisdiction",              description: "Primary regulatory jurisdiction.",                           value: "Australia" },
  ];

  for (const s of settings) {
    await db.insert(platformSettingsTable)
      .values(s)
      .onConflictDoNothing();
  }
  console.log(`  ✓ ${settings.length} platform settings`);

  console.log("Platform defaults seeded successfully.");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
