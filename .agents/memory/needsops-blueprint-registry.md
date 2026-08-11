---
name: Production Blueprint Registry Architecture
description: Two-layer blueprint visibility model, DB schema, access control, seeding, and test patterns.
---

## What was built

- **blueprintRegistry.ts** — 59 canonical registry entries (family, code, title, purpose, modes, maturityState, ownerType). `BLUEPRINT_ACTIONS` taxonomy separates agent actions from blueprints. `LEGACY_CODE_MAP` built from entries with `legacyCode` field.
- **blueprintIntentMap.ts** — ~90 intent keys → blueprint code or action. `resolveIntent("care_plan.create")` returns code `"care_plan"` (registry codes are family-level, NOT `"family.mode"`). Intent map uses `"incident.investigation"` (not `"incident.investigate"`).
- **blueprintAccessControl.ts** — `filterBlueprintForRole(bp, ctx)` strips private spec fields. `BlueprintAccessContext` uses `role` (not `orgRole`). `isTenantPlatformAdmin(req)` is synchronous (returns `boolean`, not `Promise<boolean>`).
- **blueprintSections.ts** — `blueprint_sections` table, no RLS (platform-managed).

## DB schema changes (lib/db/src/schema/workBlueprints.ts)

Added 9 columns to `work_blueprints`:
- `blueprint_family`, `supported_modes` (jsonb), `maturity_state` (default 'placeholder'), `owner_type` (default 'platform_owned'), `purpose`, `primary_deliverable`, `deliverable_contract` (jsonb), `evidence_contract` (jsonb), `permitted_org_overrides` (jsonb)

Migration applied directly via psql (ALTER TABLE ... ADD COLUMN IF NOT EXISTS). `blueprint_sections` table also created.

**Why:** New columns are accessed as `as any` in Drizzle insert/update calls because the compiled @workspace/db types may not include them until rebuilt. Uses `{ maturityState: "placeholder" } as any` pattern.

## Seeding

`seedBuiltInBlueprints()` — back-fills legacy 14 built-ins with `maturityState='placeholder'`, `ownerType='platform_owned'`, `blueprintFamily` from LEGACY_FAMILY_MAP.

`seedRegistryBlueprints()` — inserts new registry entries; updates existing rows to add registry metadata. Both called at startup (index.ts).

After seeding: 70 platform blueprints in DB (14 legacy + 56 new registry entries).

## Access control model

```
member/viewer/manager/auditor → descriptor only (purpose, family, modes, maturityState, title, code)
org owner/administrator → descriptor + permittedOrgOverrides (on platform bps)
org owner/administrator → full spec (on org-owned bps they own)
platform admin → full spec on everything
```

**Private spec fields** (stripped from non-platform-admin on platform bps): objective, primarySpecialist, supportingSpecialists, requiredLibraryKnowledge, requiredEntityKnowledge, requiredMemories, requiredApprovals, validationRules, qualityRules, successCriteria, outputTypes, escalationRules, mandatoryCitations, deliverableContract, evidenceContract, internalExecutionInstructions.

`filterBlueprintsForRole` applied in the GET list and GET single endpoints (workBlueprints route). Audit logged fire-and-forget for platform admin spec access.

## UI changes (BlueprintStudioPage)

- `WorkBlueprint` type extended with new optional fields.
- `MATURITY_BADGE` map added (placeholder/draft/professional_review/production_ready/superseded).
- `BlueprintCard`: shows maturity badge when not production_ready; shows PLATFORM tag for platform-owned; shows supported modes chips; shows "Configure" button (not "Edit") for platform blueprints; hides Archive/Test on platform blueprints.
- Section header: "Platform Blueprints" (not "Built-in Blueprints").

## Test file

`artifacts/api-server/src/__tests__/blueprint-registry-access.test.ts` — 45 tests, all passing.

## How to apply

- `REQUIRED_RLS_TABLES` stays at 75 (`blueprint_sections` has no RLS).
- Intent keys use family.mode format but registry codes are family-level (e.g. `"care_plan"`, not `"care_plan.create"`).
- `isAction(code)` checks `BLUEPRINT_ACTIONS[].code` field.
- No professional content in registry yet — seeded as placeholder objective only.
