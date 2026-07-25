# NeedsOps AI+ — Operational Runbooks

Runbooks for production operations, incident response, and maintenance tasks.
All runbooks follow the same format: Trigger → Prerequisites → Steps → Verify → Rollback.

| Runbook | Trigger |
|---------|---------|
| [credential-rotation.md](credential-rotation.md) | Scheduled 90-day rotation or suspected credential leak |
| [org-suspension.md](org-suspension.md) | Non-payment, policy violation, or legal hold |
| [org-recovery.md](org-recovery.md) | Reactivating a suspended organisation |
| [backup-restore.md](backup-restore.md) | Data corruption, accidental deletion, or DR drill |
| [cross-org-exposure.md](cross-org-exposure.md) | RLS failure or suspected cross-tenant data access |
| [secret-compromise.md](secret-compromise.md) | Confirmed or suspected platform secret leak |
| [legacy-write-detection.md](legacy-write-detection.md) | LegacyWriteError at startup or write-restriction regression |
| [org-provisioning.md](org-provisioning.md) | Onboarding a new organisation's operational schema |
| [schema-migration.md](schema-migration.md) | Applying DDL migrations to org schemas |
| [backup-failure.md](backup-failure.md) | Backup scheduler failure or missed backup window |
| [org-data-deletion.md](org-data-deletion.md) | GDPR/Privacy Act right-to-erasure request |

## Principles

1. **Explicit over implicit** — every step names the exact command, SQL, or script.
2. **Verify before and after** — each runbook includes verification queries.
3. **No hardcoded org data** — scripts accept `--org-id <uuid>` at runtime.
4. **Fail loudly** — prefer an error that stops you over a silent wrong action.
5. **Audit everything** — leave an audit trail in platform_audit_log for every operational action.
