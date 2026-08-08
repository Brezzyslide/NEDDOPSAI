---
name: NeedsOps Sprint 29M.3 RBAC Hardening
description: Four critical security defects fixed — "admin" role drift, memory/approval gate gaps, self-approval, nav matrix. Canonical requireOrgRole middleware added. 4,491 tests passing.
---

## What changed

**RED-1 fix — "admin" vs "administrator" string drift (systemic)**
Five route files had inline `requireOwnerOrAdmin` that checked `role !== "admin"`. Canonical DB value is `"administrator"`. Fixed in all five:
- `knowledgeSources.ts` → renamed to `requireOwnerOrAdminInline`, corrected string
- `curation.ts` → corrected string
- `ingestion.ts` → corrected string (was already Express middleware style)
- `completedWork.ts` → corrected string; *approve* and *reject* handlers now use manager-inclusive check (`requireOwnerOrAdminOrManager`); *promote-to-library* stays owner/administrator-only
- `workBlueprints.ts` → corrected string
- `AppShell.tsx` → `orgRole === "admin"` → `orgRole === "administrator"`

**Canonical middleware — `artifacts/api-server/src/middlewares/requireOrgRole.ts`** (new file)
Exports:
- `requireOrgRole(...allowedRoles: MembershipRole[])` — returns Express middleware; 403 with structured `{ code: "INSUFFICIENT_ROLE", requiredRoles, currentRole }` on failure
- `requireOwnerOrAdmin` — shorthand (owner | administrator)
- `requireAtLeastManager` — shorthand (owner | administrator | manager)
- `requireOwner` — shorthand (owner only)

**RED-2 fix — Memory routes now require owner/administrator**
All 9 routes in `organisationMemory.ts` now have `requireOwnerOrAdmin` in their middleware chain (added via batch script). System auto-memory continues via service layer (not these HTTP routes). The *approve* handler additionally has a **self-approval (SoD) check** using `memory.createdBy === user.id` → 409 `SELF_APPROVAL_BLOCKED`; owner may force with `{ forceSelfApproval: true, forceSelfApprovalReason }` (audit-logged).

**RED-3 fix — Approval resolve now checks role against approvalType**
`approvalRoutes.ts` resolve handler (`POST /:approvalId/resolve`):
1. Fetches the approval record via `getApprovalById` BEFORE calling `resolveApproval`
2. Maps `approvalType` → required roles (`APPROVAL_RESOLVER_ROLES` constant):
   - `manager_approval` → manager | administrator | owner
   - `administrator_approval` → administrator | owner
   - `owner_approval` → owner
   - `dual_approval` / `compliance_approval` → administrator | owner
   - `platform_approval` → 403 (not resolvable at org level)
3. Returns 403 `INSUFFICIENT_ROLE` with `requiredRoles` array
Bulk resolve (`POST /bulk`) now has `requireOrgRole("owner", "administrator", "manager")` middleware (floor gate).

**RED-4 fix — Self-approval blocked for governance approvals**
In the resolve handler (step after role check): when `action === "approved"` and `task.originatingUserId === user.id`, returns 409 `SELF_APPROVAL_BLOCKED`. Owner may force with `{ forceSelfApproval: true, forceSelfApprovalReason }` (audit-logged as `approval.self_approved_owner_override`).

**Blueprint execute gate**
`POST /organisations/:slug/work-executions` (workBlueprints.ts) now requires manager | administrator | owner. Members submit via chat/task UI (approval flow), not this direct pipeline endpoint.

**ROLE_PERMISSIONS additions** (`lib/permissions/src/roles.ts`)
New `PermissionAction` values:
- `governance:resolve_work` — operational work approvals; granted to: manager, administrator, owner
- `governance:resolve_authority` — knowledge/Memory/Blueprint/compliance approvals; granted to: administrator, owner
- `memory:govern` — approve/reject/merge/supersede org memory; granted to: administrator, owner
- `knowledge:govern` — mark authoritative/revoke knowledge sources; granted to: administrator, owner
- `blueprint:govern` — publish/archive/rollback blueprints; granted to: administrator, owner

**AppShell nav matrix** — `artifacts/needsops-web/src/components/layout/AppShell.tsx`
Six-role nav visibility matrix (corrected "administrator"):
| Section | Roles |
|---------|-------|
| Workspace (Dashboard/Inbox/Active Work/Notifications) | all |
| Operations (Chat/Workforce/Ops Centre/Tasks/Completed Work) | all |
| Library | member, manager, administrator, owner |
| Memory + Blueprint Studio | administrator, owner only |
| Governance main (Governance/Approvals/Health/Timeline) | manager, administrator, owner, auditor |
| Audit Log | owner, administrator, auditor |
| Organisation (Team/Plan/Usage/Settings) | administrator, owner |

**Security test matrix** — `artifacts/api-server/src/__tests__/rbac.test.ts`
28 tests covering:
- RED-1 regression: "admin" denied, "administrator" granted for all 6 roles
- requireAtLeastManager boundary (manager+, not member/viewer/auditor)
- requireOwner exclusivity
- Missing tenantContext (returns 403, not 500)
- requireOrgRole arbitrary set + response body shape
- ROLE_PERMISSIONS assignments for all new governance permissions

Also added `@workspace/permissions` alias to `artifacts/api-server/vitest.config.ts`.

## Test baseline
- REQUIRED_RLS_TABLES: 75 (unchanged)
- Tests: **4,491 passing / 13 failing** (13 failures are all pre-existing DB integration probes; no new failures)
- The 4,724 baseline in sprint29m2 memory was from the task-agent branch (Sprint 29M Task #143, not yet merged to main). Main branch baseline after this sprint is **4,491**.

## Rules to preserve
- **"administrator" not "admin"** — the canonical org role string is always `"administrator"`. Any new inline role check must use this.
- **Always use `requireOrgRole` from the canonical middleware** — do not write new inline role-check functions.
- **Self-approval block** — both memory approve and governance approval resolve check `createdBy/originatingUserId === user.id`. Owner override requires explicit `forceSelfApproval: true` body param and emits an audit event.
- **Approval type is authoritative for resolver role** — `APPROVAL_RESOLVER_ROLES` in approvalRoutes.ts maps approval type to allowed roles; any new approval type must be added there.
- **System auto-memory writes** go through the service layer directly, not HTTP routes. Do NOT require org role on service-layer calls.
- **@workspace/permissions alias** added to api-server vitest.config.ts; tests can now `import { ROLE_PERMISSIONS } from "@workspace/permissions"` directly.
