# Persistent Organisation Provisioning Report

Generated: 2026-07-25T09:15:40.896Z
Mode: Live
Duration: 1383ms

## Summary

| Org | UUID | Schema | Status | Duration |
|-----|------|--------|--------|----------|
| NeedsOps Internal | `00000000-0001-0000-0000-needsops0001` | `org_00000000_0001_0000_0000_needsops0001` | ✓ Provisioned | 608ms |
| MH&R Holdings | `00000000-0002-0000-0000-mhrholdings02` | `org_00000000_0002_0000_0000_mhrholdings02` | ✓ Provisioned | 285ms |
| Organisation Alpha | `00000000-0003-0000-0000-orgalpha00003` | `org_00000000_0003_0000_0000_orgalpha00003` | ✓ Provisioned | 156ms |
| Organisation Beta | `00000000-0004-0000-0000-orgbeta000004` | `org_00000000_0004_0000_0000_orgbeta000004` | ✓ Provisioned | 328ms |

## Persistent Organisation UUIDs

These UUIDs are permanent and must not be changed.

### NeedsOps Internal
- **UUID:** `00000000-0001-0000-0000-needsops0001`
- **Schema:** `org_00000000_0001_0000_0000_needsops0001`
- **Status:** provisioned
- **Steps:**
  - validate_org: completed
  - generate_db_identifier: completed
  - check_existing_registry: completed
  - create_database: completed
  - create_credentials: completed
  - apply_migrations: completed
  - apply_roles_and_permissions: completed
  - configure_backup: completed
  - seed_initial_settings: completed
  - create_org_administrator: skipped
  - health_check: completed
  - isolation_check: completed
  - mark_active: completed
  - audit_event: completed

### MH&R Holdings
- **UUID:** `00000000-0002-0000-0000-mhrholdings02`
- **Schema:** `org_00000000_0002_0000_0000_mhrholdings02`
- **Status:** provisioned
- **Steps:**
  - validate_org: completed
  - generate_db_identifier: completed
  - check_existing_registry: completed
  - create_database: completed
  - create_credentials: completed
  - apply_migrations: completed
  - apply_roles_and_permissions: completed
  - configure_backup: completed
  - seed_initial_settings: completed
  - create_org_administrator: skipped
  - health_check: completed
  - isolation_check: completed
  - mark_active: completed
  - audit_event: completed

### Organisation Alpha
- **UUID:** `00000000-0003-0000-0000-orgalpha00003`
- **Schema:** `org_00000000_0003_0000_0000_orgalpha00003`
- **Status:** provisioned
- **Steps:**
  - validate_org: completed
  - generate_db_identifier: completed
  - check_existing_registry: completed
  - create_database: completed
  - create_credentials: completed
  - apply_migrations: completed
  - apply_roles_and_permissions: completed
  - configure_backup: completed
  - seed_initial_settings: completed
  - create_org_administrator: skipped
  - health_check: completed
  - isolation_check: completed
  - mark_active: completed
  - audit_event: completed

### Organisation Beta
- **UUID:** `00000000-0004-0000-0000-orgbeta000004`
- **Schema:** `org_00000000_0004_0000_0000_orgbeta000004`
- **Status:** provisioned
- **Steps:**
  - validate_org: completed
  - generate_db_identifier: completed
  - check_existing_registry: completed
  - create_database: completed
  - create_credentials: completed
  - apply_migrations: completed
  - apply_roles_and_permissions: completed
  - configure_backup: completed
  - seed_initial_settings: completed
  - create_org_administrator: skipped
  - health_check: completed
  - isolation_check: completed
  - mark_active: completed
  - audit_event: completed

## Important Notes

- These organisations have **fixed stable UUIDs** that must never be regenerated.
- They are **not cleaned up** in test teardown — rows survive all test runs.
- The vitest global setup checks that `org_database_registry` has ≥ 4 active rows.
- Run this script again at any time — it is fully idempotent.
- Re-provisioning uses `provisionOrgDb()` which skips already-completed steps.

## Re-running

```bash
# Safe to run multiple times:
tsx scripts/provision-persistent-orgs.ts

# Force re-provisioning of all steps:
tsx scripts/provision-persistent-orgs.ts --force-reprovision

# Dry run (no changes):
tsx scripts/provision-persistent-orgs.ts --dry-run
```