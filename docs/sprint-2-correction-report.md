# Sprint 2 Architecture Correction — Completion Report

**Date:** 2026-07-24  
**Status:** ✅ Complete  
**Type:** Architecture correction (no Sprint 3 work included)

---

## What Changed

### Conceptual clarification: Workforce Role vs Worker Profile

The 32 AI Specialists created in Sprint 2 are **Workforce Roles** — not OpenClaw runtimes and not separate software installations.

| Concept | Internal name | Customer-facing name |
|---------|---------------|----------------------|
| Business role defining expertise and responsibility | Workforce Role | AI Specialist |
| Execution boundary profile for the future OpenClaw runtime | Worker Profile | (internal only) |

The customer-facing term **AI Specialist** is unchanged. The UI is unchanged. The API is unchanged.

---

## New: Worker Profile model

A Worker Profile defines what the future OpenClaw runtime may access and do when executing on behalf of a Workforce Role.

### Fields

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Unique identifier (e.g. `wp_compliance_officer`) |
| `code` | string | Machine-readable code (e.g. `compliance_officer_profile`) |
| `displayName` | string | Human-readable name |
| `description` | string | Explains what this profile permits and why |
| `allowedExecutionChannels` | `ExecutionChannel[]` | Permitted execution surfaces |
| `allowedToolCategories` | `ToolCategory[]` | Tool groupings the profile may invoke |
| `allowedConnectorCategories` | `ConnectorCategory[]` | External connector families |
| `allowedBrowserDomains` | `string[]` | Permitted web domains (empty — future sprint) |
| `allowedLocalPathCategories` | `string[]` | Local file paths (empty — future sprint) |
| `allowedApplicationCategories` | `string[]` | Desktop app access (empty — future sprint) |
| `prohibitedActions` | `string[]` | Never-permitted actions |
| `approvalRequiredActions` | `string[]` | Actions requiring explicit approval |
| `riskLevel` | `RiskLevel` | low / medium / high / critical |
| `status` | `WorkerProfileStatus` | active / beta / coming_soon / deprecated |
| `version` | string | semver |

### Execution channel types

`internal_api` · `document_store` · `calendar_system` · `email_system` · `web_browser` · `local_files` · `database_query`

(Browser domains, local paths, and application categories are intentionally empty until the relevant execution channels are live.)

### Risk levels

| Level | Assigned to |
|-------|-------------|
| `low` | Core workforce, orchestration-only roles, marketing (coming soon) |
| `medium` | Most compliance and operations roles |
| `high` | Finance roles with payment access, compliance roles with external NDIS submissions |
| `critical` | Reserved — not assigned in this sprint |

---

## Files Created or Modified

### Shared library (`lib/shared/src/index.ts`)
New type exports:
- `WORKER_PROFILE_STATUSES` + `WorkerProfileStatus`
- `EXECUTION_CHANNELS` + `ExecutionChannel`
- `TOOL_CATEGORIES` + `ToolCategory`
- `CONNECTOR_CATEGORIES` + `ConnectorCategory`
- `RISK_LEVELS` + `RiskLevel`

### Worker Profile Registry (`artifacts/api-server/src/lib/workerProfileRegistry.ts`)
New file. Contains:
- `WorkerProfile` interface
- `WORKER_PROFILES` — 32 profiles (one per Workforce Role)
- `ROLE_TO_PROFILES` — mapping from workforce role code → worker profile code(s)
- `getWorkerProfileByCode(code)` — look up a profile by code
- `getWorkerProfilesForRole(roleCode)` — get all profiles for a role
- `getActiveWorkerProfilesForRole(roleCode)` — excludes coming_soon profiles
- `getRoleCodesForProfile(profileCode)` — reverse lookup

### Workforce Registry (`artifacts/api-server/src/lib/workforceRegistry.ts`)
Updated:
- `RegistrySpecialist` interface — added `workerProfileCodes: string[]` field
- File header comment clarified: internal concept is "Workforce Role"; customer-facing is "AI Specialist"
- All 32 specialist entries now have `workerProfileCodes` populated

### Database (`lib/db/src/schema/`)
Two new tables, migrated:

**`worker_profiles`**  
Platform-level registry of Worker Profile metadata. All jsonb fields default to `[]`. New enums: `worker_profile_status`, `worker_profile_risk_level`.

**`workforce_role_profiles`**  
Join table linking workforce role codes to worker profile codes (composite PK). Supports 1-to-many: one role may have multiple profiles for different execution contexts.

### Tests (`artifacts/api-server/src/__tests__/workerProfiles.test.ts`)
New file — 35 tests across 5 suites:

| Suite | Tests |
|-------|-------|
| Worker Profile Registry integrity | 10 |
| Role-to-Worker-Profile mapping | 10 |
| Active Worker Profile filtering | 2 |
| Architecture correctness | 11 |
| Risk classification | 3 |
| **Total** | **35** |

### Documentation
- `docs/sprint-2-architecture.md` — expanded with full Workforce Role vs Worker Profile section, conceptual chain diagram, and OpenClaw boundary rules
- `docs/sprint-2-correction-report.md` — this file

---

## Test Results

```
Test Files  3 passed (3)
     Tests  99 passed (99)
```

Breakdown:
- Email service tests: 17
- Workforce tests (Sprint 2): 47  
- Worker Profile tests (Correction): 35

---

## Architecture rules documented

1. **Workforce Roles define who and what expertise.** Worker Profiles define which tools and surfaces.
2. **OpenClaw will execute through approved Worker Profiles.** It does not own policy, tenancy, billing, or approvals.
3. **Intelligence Engines provide deterministic domain rules.** (Future sprint — not in Sprint 2.)
4. **No live permissions exist yet.** All Worker Profile fields are metadata only. `allowedBrowserDomains`, `allowedLocalPathCategories`, and `allowedApplicationCategories` are intentionally empty.
5. **Payroll Officer profile explicitly prohibits payment processing.** `process_payment`, `approve_payrun`, `modify_bank_account_details`, `access_tax_file_numbers` are all in `prohibitedActions`.
6. **Marketing pack profiles are `coming_soon`.** They follow the same spec as their parent Workforce Roles.
7. **Chief of Staff profile is orchestration-only.** `allowedExecutionChannels: ["internal_api"]` only. No connector access. `modify_data` is in `prohibitedActions`.

---

## Not done (by design)

- No live browser permissions  
- No local file system access  
- No connector credentials  
- No OpenClaw runtime  
- No Intelligence Engine implementations  
- No UI changes (customer-facing term "AI Specialist" unchanged)
- No new API routes (Worker Profiles are served via the existing `/v1/workforce/specialists/:code` response via `workerProfileCodes`)

---

**Ready to receive Sprint 3 specification.**
