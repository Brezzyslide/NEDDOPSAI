# NeedsOps AI+ — Database Architecture Assessment
**Date:** 25 July 2026  
**Status:** Pre-Sprint 5 review  
**Scope:** Current-state analysis, gap identification, and target-state migration plan  

---

## Executive Summary

NeedsOps currently operates a **single shared PostgreSQL database** using a shared-schema multi-tenancy model. Tenant isolation is enforced at the application query layer via `WHERE organization_id = :tenantId`. No Row Level Security (RLS) is in place. No per-organisation operational databases are provisioned.

The approved target architecture requires a **hybrid model**: one shared Platform Database for platform-level concerns, and one dedicated Operational Database per customer organisation for all clinical, operational, and AI data. This is a significant architectural change.

**No production database changes should be made until the migration plan in this document is reviewed and approved.**

---

## 1. Current Architecture

### 1.1 Database Topology

| Property | Current State |
|---|---|
| Number of databases | **1** (shared, single PostgreSQL instance) |
| Database per organisation | **Not implemented** |
| Schema isolation | Logical only — `organization_id` column |
| Row Level Security | **Not implemented** |
| Isolation enforcement | Application layer (`WHERE` clauses) |
| Migration tooling | `drizzle-kit push` (single DB) |
| Backup/restore | Replit-managed (entire DB) |

### 1.2 Current Tenant Isolation Model

Isolation is enforced by a middleware chain on every tenant-scoped API route:

```
requireAuth → resolveTenantFromSlug → handler
```

**`resolveTenantFromSlug`** (`artifacts/api-server/src/middlewares/tenantContext.ts`):
1. Reads `:slug` from route params
2. Looks up the organisation by slug (`organizationsTable`)
3. Verifies org is not `closed` or `suspended`
4. Verifies the authenticated user has an active membership in that org
5. Attaches `req.tenantContext = { tenantId, tenantSlug, role, permissions }`

All org-scoped handlers then use `req.tenantContext.tenantId` in every query. This is consistently applied to customer-facing routes.

**Platform console routes bypass this entirely.** They use `requirePlatformAuth` + `requirePlatformRole` and query across all organisations without a tenant scope — by design for administrative purposes.

---

## 2. Current Schema — All Tables

### 2.1 Platform-Level Tables (no org scope — correct)

| Table | Purpose |
|---|---|
| `organizations` | Org directory — root entity |
| `users` | Clerk-linked user identity (shared) |
| `platform_roles` | Staff platform role grants |
| `platform_internal_notes` | Staff notes about orgs |
| `platform_settings` | Global key-value config |
| `feature_flags` | Feature toggle registry |
| `plans` | Global plan catalogue |
| `plan_versions` | Plan version history |
| `plan_features` | Features per plan version |
| `plan_usage_allowances` | Allowance limits per plan version |
| `plan_workforce_packs` | Packs included in a plan version |
| `features` | Feature code registry |
| `usage_dimensions` | Usage metric definitions |
| `workforce_packs` | Global pack catalogue |
| `specialists` | AI specialist definitions |
| `worker_profiles` | AI specialist execution profiles |
| `capabilities` | Specialist capability registry |
| `specialist_capabilities` | Join: specialist → capability |
| `workforce_role_profiles` | Join: specialist → worker profile |
| `workforce_pack_specialists` | Join: pack → specialist |
| `email_delivery_logs` | Email delivery audit |

### 2.2 Tenant-Scoped Tables (exist in current shared DB — currently correct for shared model)

| Table | `organization_id`? | Notes |
|---|---|---|
| `memberships` | ✅ Yes | |
| `invitations` | ✅ Yes | |
| `tenant_subscriptions` | ✅ Yes | |
| `tenant_entitlements` | ✅ Yes | |
| `tenant_overrides` | ✅ Yes | |
| `tenant_addons` | ✅ Yes | |
| `tenant_usage_allowances` | ✅ Yes | |
| `tenant_workforce_packs` | ✅ Yes | |
| `tenant_settings` | ✅ Yes | |
| `usage_events` | ✅ Yes | |
| `usage_period_summaries` | ✅ Yes | |
| `audit_log` | ✅ Yes | Contains both platform and tenant events |
| `tasks` | ✅ Yes | AI task log |
| `approvals` | ✅ Yes | Approval requests |
| `approval_rules` | ✅ Yes | |
| `approval_history` | ⚠️ Via `approval_id` FK | No direct `organization_id` |
| `task_execution_plans` | ⚠️ Via `task_id` FK | No direct `organization_id` |
| `task_specialists` | ⚠️ Via `task_id` FK | No direct `organization_id` |

### 2.3 Clinical / Operational Tables — Status

| Domain | Required | Current State |
|---|---|---|
| Participants | Required | ❌ Not implemented (only `participant_count` int on org) |
| Staff profiles | Required | ⚠️ Partial — `memberships` + `worker_profiles` (global) |
| Case notes | Required | ❌ Not implemented |
| Incidents | Required | ❌ Not implemented |
| Care plans | Required | ❌ Not implemented (`task_execution_plans` is AI-only) |
| Medication records | Required | ❌ Not implemented |
| Rosters / shifts | Required | ❌ Not implemented |
| Documents | Required | ❌ Not implemented |
| AI conversations | Required | ❌ Not implemented |
| Embeddings / vectors | Required | ❌ Not implemented |
| Connector credentials | Required | ❌ Not implemented |
| Organisation audit log | Required | ⚠️ Shared `audit_log` table (mixed with platform events) |

---

## 3. Security Gap Analysis

### Gap 1 — No Row Level Security ❗ HIGH
**Current:** Isolation relies entirely on application-layer `WHERE organization_id = :tenantId`. A query bug, missing middleware, or direct DB connection bypasses all isolation.  
**Risk:** Cross-tenant data leakage via application bug.  
**Required:** PostgreSQL RLS policies on all operational tables.

### Gap 2 — Platform console reads operational tables ❗ HIGH
**Current:** `platformOrgs.ts` directly queries `tasksTable`, `approvalsTable`, `membershipsTable`, and `auditLogTable` to populate the 13-tab org detail view. Platform staff can read customer task content, member data, and audit records.  
**Risk:** In the target architecture this violates the separation — platform staff should never have direct access to operational database content. They should only see aggregate metadata.  
**Required:** Platform console must be redesigned to query only the Platform DB. Operational data in the org detail view must be served via a secure inter-database API boundary.

### Gap 3 — Audit log is mixed ❗ MEDIUM
**Current:** A single `audit_log` table stores both platform-level events (plan changes, role grants) and tenant-level events (task created, member invited). The `organization_id` column scopes tenant events, but they sit in the same table.  
**Risk:** Platform queries can accidentally read operational audit content; tenant queries may be over-broad.  
**Required:** Separate platform audit log (stays in Platform DB) from operational audit logs (move to each org's Operational DB).

### Gap 4 — Join tables lack direct `organization_id` ⚠️ MEDIUM
**Current:** `approval_history`, `task_execution_plans`, `task_specialists` do not carry `organization_id` directly — they are reached via FK joins through their parent.  
**Risk:** RLS policies cannot be applied directly without schema changes.  
**Required:** Add `organization_id` to all join tables, or enforce isolation via parent-table RLS + FK cascades.

### Gap 5 — No clinical/operational schema ⚠️ MEDIUM (for future sprints)
**Current:** None of the NDIS operational tables exist yet (participants, case notes, incidents, medication, rosters, documents).  
**Risk:** If built in the current shared-schema model, migrating to per-org DBs later becomes significantly more complex.  
**Required:** All clinical tables must be built into the Operational DB design from the outset, not retrofitted.

### Gap 6 — No AI Privacy Gateway ⚠️ MEDIUM
**Current:** No AI request pipeline exists yet. The `chiefOfStaffService.ts` uses deterministic keyword routing with no LLM. No identity propagation, no purpose recording, no cross-org isolation controls.  
**Required:** Implement before any LLM integration. Must enforce: authenticated identity, role inheritance, org DB scoping, minimum data retrieval, purpose logging, approval gating.

### Gap 7 — Single migration path ⚠️ LOW (now, HIGH later)
**Current:** `drizzle-kit push` operates on one database. No tooling exists for provisioning, migrating, or backing up per-org databases.  
**Required:** Per-org DB provisioning CLI, per-org migration runner, backup/restore automation.

---

## 4. Current-State Database Diagram

```
SHARED POSTGRESQL DATABASE
│
├── PLATFORM TABLES (no org scope)
│   ├── organizations          ← root entity, org metadata only
│   ├── users                  ← Clerk-linked identities
│   ├── platform_roles         ← staff role grants
│   ├── platform_internal_notes
│   ├── platform_settings
│   ├── feature_flags
│   ├── plans + plan_versions + plan_features + plan_usage_allowances
│   ├── features + usage_dimensions
│   ├── workforce_packs + specialists + worker_profiles + capabilities
│   └── email_delivery_logs
│
├── TENANT-SCOPED TABLES (all in same DB, isolated by organization_id)
│   ├── memberships            ← org members
│   ├── invitations
│   ├── tenant_subscriptions
│   ├── tenant_entitlements
│   ├── tenant_overrides
│   ├── tenant_addons
│   ├── tenant_usage_allowances
│   ├── tenant_workforce_packs
│   ├── tenant_settings
│   ├── usage_events + usage_period_summaries
│   ├── audit_log              ← MIXED: platform + tenant events
│   ├── tasks + task_execution_plans + task_specialists
│   └── approvals + approval_rules + approval_history
│
└── ISOLATION MECHANISM
    └── Application-layer WHERE organization_id = :tenantId
        (enforced by resolveTenantFromSlug middleware)
        No RLS. No per-org schema or database.
```

---

## 5. Target Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  PLATFORM DATABASE (shared)              │
│                                                         │
│  Platform identity & admin                              │
│  ├── organizations (metadata + status only)             │
│  ├── users                                              │
│  ├── platform_roles                                     │
│  ├── platform_internal_notes                            │
│  ├── platform_settings + feature_flags                  │
│  ├── platform_audit_log  ← separated from tenant audit  │
│  │                                                      │
│  Commercial & licensing                                 │
│  ├── plans + plan_versions + plan_features              │
│  ├── plan_usage_allowances + plan_workforce_packs       │
│  ├── tenant_subscriptions + tenant_entitlements         │
│  ├── tenant_overrides + tenant_addons                   │
│  ├── tenant_usage_allowances                            │
│  ├── usage_events + usage_period_summaries              │
│  │                                                      │
│  Workforce catalogue (global metadata)                  │
│  ├── workforce_packs + specialists + worker_profiles    │
│  └── capabilities + email_delivery_logs                 │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┴────────────────┐
        ▼ org provisioning API             ▼ org provisioning API
┌──────────────────┐             ┌──────────────────┐
│  ORG DB: org-a   │             │  ORG DB: org-b   │  ...one per org
│                  │             │                  │
│  Identity        │             │  Identity        │
│  ├── memberships │             │  ├── memberships │
│  ├── invitations │             │  └── invitations │
│                  │             │                  │
│  Clinical        │             │  Clinical        │
│  ├── participants│             │  ├── participants│
│  ├── case_notes  │             │  ├── case_notes  │
│  ├── incidents   │             │  ├── incidents   │
│  ├── care_plans  │             │  ├── care_plans  │
│  ├── medications │             │  ├── medications │
│  └── rosters     │             │  └── rosters     │
│                  │             │                  │
│  Documents       │             │  Documents       │
│  └── documents   │             │  └── documents   │
│                  │             │                  │
│  AI              │             │  AI              │
│  ├── conversations│            │  ├── conversations│
│  ├── embeddings  │             │  ├── embeddings  │
│  └── ai_audit_log│            │  └── ai_audit_log│
│                  │             │                  │
│  Operations      │             │  Operations      │
│  ├── tasks       │             │  ├── tasks       │
│  ├── approvals   │             │  ├── approvals   │
│  ├── approval_rules│           │  └── approval_rules│
│  ├── tenant_settings│          │                  │
│  ├── tenant_workforce_packs│   │                  │
│  └── org_audit_log│           │  └── org_audit_log│
└──────────────────┘             └──────────────────┘

                    AI PRIVACY GATEWAY
                    ├── Authenticated identity (Clerk JWT)
                    ├── Role + permissions inherited
                    ├── Routes to org DB only
                    ├── Minimum data retrieval
                    ├── Purpose + records accessed logged
                    ├── No cross-org data access
                    └── Approval gate for regulated outputs
```

---

## 6. Tables: Platform DB vs Operational DB (Target)

### Stays in Platform DB

| Table | Reason |
|---|---|
| `organizations` | Org registry — platform concern |
| `users` | Shared identity across orgs |
| `platform_roles` | Staff grants — platform concern |
| `platform_internal_notes` | Staff notes — platform concern |
| `platform_settings` | Global config |
| `feature_flags` | Global toggles |
| `platform_audit_log` | Separated from org audit |
| `plans` + `plan_versions` + `plan_features` | Global catalogue |
| `plan_usage_allowances` + `plan_workforce_packs` | Global catalogue |
| `tenant_subscriptions` | Billing is platform concern |
| `tenant_entitlements` | Computed from subscription |
| `tenant_overrides` | Applied by platform staff |
| `tenant_addons` | Billing line items |
| `tenant_usage_allowances` | Aggregated usage caps |
| `usage_events` + `usage_period_summaries` | Platform billing/monitoring |
| `workforce_packs` + `specialists` + `worker_profiles` | Global AI catalogue |
| `capabilities` + join tables | Global metadata |
| `email_delivery_logs` | Platform-level comms |
| `features` + `usage_dimensions` | Global definitions |

### Moves to each Org's Operational DB

| Table | Reason |
|---|---|
| `memberships` | Operational — who belongs to this org |
| `invitations` | Operational |
| `tenant_settings` | Org-local config |
| `tenant_workforce_packs` | Org-local pack grants |
| `tasks` + `task_execution_plans` + `task_specialists` | Operational AI work |
| `approvals` + `approval_rules` + `approval_history` | Operational workflow |
| `audit_log` (org portion) | Renamed `org_audit_log` — operational |
| **NEW:** `participants` | Clinical — NDIS participant records |
| **NEW:** `staff` | Operational — staff details |
| **NEW:** `case_notes` | Clinical — NDIS regulated |
| **NEW:** `incidents` | Clinical — regulated |
| **NEW:** `care_plans` | Clinical — regulated |
| **NEW:** `medications` | Clinical — regulated |
| **NEW:** `rosters` | Operational |
| **NEW:** `documents` | Operational |
| **NEW:** `ai_conversations` | AI — org-scoped |
| **NEW:** `embeddings` | AI — org-scoped vectors |
| **NEW:** `connector_credentials` | Encrypted, org-scoped |
| **NEW:** `ai_privacy_log` | AI access audit — per org |

---

## 7. Migration Strategy

### Approach: Strangler Fig — extract, don't cut over

Do not attempt a big-bang migration. Extract each concern incrementally while keeping the shared DB operational.

### Phase 1 — Harden current shared model (Sprint 5)
*Goal: make the current state as safe as possible before the split.*

- [ ] Add PostgreSQL RLS policies to all tenant-scoped tables in the current shared DB
- [ ] Add `organization_id` directly to `approval_history`, `task_execution_plans`, `task_specialists`
- [ ] Split `audit_log` into `platform_audit_log` and `org_audit_log` in the current DB (separate tables, same DB for now)
- [ ] Redesign platform console org detail view to stop reading operational tables — show only aggregate metrics from the Platform DB
- [ ] Write cross-tenant isolation tests (automated, run on every PR)

### Phase 2 — Build Operational DB provisioning (Sprint 6)
*Goal: ability to create, migrate, and connect to a per-org database.*

- [ ] Design the Operational DB schema (all tables from the "moves to org DB" list)
- [ ] Build an org provisioning service: `provision-org-db.ts` — creates a new PostgreSQL DB, runs migrations, returns connection string
- [ ] Encrypt and store the org DB connection string in the Platform DB against the org record
- [ ] Build a connection pool manager: resolves the correct DB connection for a given `tenantId`
- [ ] Write migration scripts to move existing tenant data from shared DB to new org DBs
- [ ] Implement per-org `drizzle-kit` migration runner
- [ ] Build backup/restore automation per org

### Phase 3 — Migrate existing orgs (Sprint 7, coordinated)
*Goal: move live data without downtime.*

- [ ] Provision org DBs for all existing organisations
- [ ] Run data migration with dual-write (write to both DBs, read from org DB)
- [ ] Verify with automated cross-tenant isolation tests
- [ ] Cut read traffic over to org DBs per org
- [ ] Remove tenant tables from shared DB after all orgs are migrated

### Phase 4 — AI Privacy Gateway (Sprint 7–8)
*Goal: safe AI request pipeline before any LLM is integrated.*

- [ ] Build `AiPrivacyGateway` service
- [ ] Propagate authenticated identity + role into every AI request context
- [ ] Route AI requests to the org's database only
- [ ] Implement minimum data retrieval policies per specialist type
- [ ] Log every access: purpose, records accessed, actor, timestamp
- [ ] Require approval tokens for regulated outputs (care plans, medication, incidents)

### Phase 5 — Clinical tables (Sprint 8+)
*Goal: build NDIS operational schema on the org DB foundation.*

- [ ] Participants, case notes, incidents, care plans, medication, rosters, documents
- [ ] All in Operational DB from day one — never in shared DB

---

## 8. Risks to Existing Data

| Risk | Severity | Mitigation |
|---|---|---|
| Data loss during migration | Critical | Dual-write period; migration verified by row count + checksum |
| Connection pool exhaustion (N org DBs) | High | PgBouncer or connection pooler per org; pool on demand, release on idle |
| Schema drift between org DBs | High | Centralised migration runner applies the same migrations to all org DBs |
| Secrets management for N connection strings | High | Encrypted at rest in Platform DB; never in environment variables or code |
| Platform console losing visibility | Medium | Redesign to use aggregate read views, not direct operational DB access |
| Audit log continuity | Medium | Migrate existing audit records to split tables before dropping originals |
| Backup coverage gaps | Medium | Confirm per-org DB is covered by backup automation before migrating data |
| Replit DB provisioning limits | Medium | Verify number of PostgreSQL databases Replit can provision per project; may need external DB hosting for scale |

---

## 9. Automated Tests Required to Prove Cross-Org Isolation

The following test suite must pass before any org migration is declared complete:

```
cross-tenant-isolation.test.ts
```

**Required test cases:**

1. **Direct ID access:** An authenticated user from org-A cannot retrieve a record from org-B by guessing its UUID, even with a valid JWT.
2. **List query isolation:** `GET /tasks` for org-A returns zero records belonging to org-B.
3. **Approval cross-read:** User from org-A cannot read org-B's approval requests.
4. **Member isolation:** User from org-A cannot list org-B's members.
5. **Audit log isolation:** User from org-A cannot read org-B's audit events.
6. **Platform route org access:** Platform staff reading org detail can only see aggregate metadata — not task content or case notes.
7. **No-context query rejection:** Any service function that queries an operational table without a `tenantId` must throw (enforced via type system + linting rule).
8. **RLS bypass test:** Direct DB connection (without application middleware) cannot return rows for org-A using a session configured for org-B.
9. **AI gateway identity:** AI requests must fail if the JWT does not resolve to a membership in the target org's database.
10. **Cross-org embedding search:** Vector similarity search must be scoped to the requesting org's embeddings only — cannot return results from another org's embedding space.

---

## 10. Estimated Sprint Breakdown

| Sprint | Work | Outcome |
|---|---|---|
| **Sprint 5** | RLS on current shared DB, audit log split, platform console operational data isolation, cross-tenant isolation tests | Current model is as safe as possible |
| **Sprint 6** | Org DB provisioning service, connection pool manager, operational DB schema design, per-org migration runner, backup automation | Infrastructure for per-org DBs |
| **Sprint 7** | Migrate existing orgs to org DBs (dual-write → cut over), AI Privacy Gateway foundation | Hybrid architecture live |
| **Sprint 8** | Clinical tables (participants, case notes, incidents, care plans, medication, rosters), documents, connector credentials | NDIS operational schema |
| **Sprint 9** | AI conversations, embeddings, full AI Privacy Gateway with approval gating, ai_privacy_log | AI pipeline secure end-to-end |

---

## 11. Required Infrastructure Changes

| Change | Current | Required |
|---|---|---|
| Database instances | 1 shared | 1 Platform DB + 1 per org |
| Connection management | Single `DATABASE_URL` env var | Dynamic connection resolution by `tenantId` |
| Migration tooling | `drizzle-kit push` (single) | Per-org migration runner + platform migration runner |
| Backup | Replit-managed (whole DB) | Per-org backup with individual restore capability |
| Secrets | Single connection string | Encrypted org DB credentials in Platform DB |
| DB hosting | Replit PostgreSQL | May require external DB provider for per-org scale |
| RLS | None | PostgreSQL policies on all operational tables |
| Vector/embedding storage | None | `pgvector` extension per org DB |

---

## 12. What Is Currently Implemented vs Proposed

| Capability | Status |
|---|---|
| Single shared PostgreSQL database | ✅ Implemented |
| `organization_id` on tenant tables | ✅ Implemented |
| Application-layer tenant filtering (`resolveTenantFromSlug`) | ✅ Implemented |
| Platform-level tables separated by design | ✅ Implemented |
| Platform console (staff admin views) | ✅ Implemented |
| Audit log (mixed platform + tenant) | ⚠️ Partially implemented — needs split |
| Direct `organization_id` on all join tables | ⚠️ Partially — join tables use FK only |
| Row Level Security | ❌ Not implemented |
| Per-org operational database | ❌ Not implemented |
| Clinical/NDIS tables | ❌ Not implemented |
| AI conversations + embeddings | ❌ Not implemented |
| Connector credentials | ❌ Not implemented |
| AI Privacy Gateway | ❌ Not implemented |
| Per-org DB provisioning service | ❌ Not implemented |
| Cross-tenant isolation test suite | ❌ Not implemented |
| Per-org migration runner | ❌ Not implemented |
| Per-org backup/restore | ❌ Not implemented |
| Platform console redesigned to not read org operational data | ❌ Not implemented |
