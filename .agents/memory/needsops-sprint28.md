---
name: NeedsOps Sprint 28 Blueprint Studio
description: Blueprint versioning lifecycle, org override selection, sandbox testing, 6 frontend pages. REQUIRED_RLS_TABLES=69, 2733 tests.
---

## What was built

### DB changes
- Added `status TEXT NOT NULL DEFAULT 'draft'` column to `work_blueprints` (migration backfills built-ins to 'published')
- New table `blueprint_versions` — immutable snapshots; RLS = tenant_isolation; REQUIRED_RLS_TABLES now 69

### Service extensions (`workBlueprintService.ts`)
- `archiveBlueprint` — sets status=archived, isActive=false; logs audit event
- `restoreBlueprint` — archived → draft, isActive=true; only allowed from status=archived
- `cloneBlueprint` — deep copy into new org draft; CAN clone built-ins; generates new code suffix
- `submitForReview` — draft → review; only from draft
- `publishBlueprint` — draft/review → published; creates immutable blueprint_versions snapshot; supersedes same-code previously-published org blueprints; logs audit
- `rollbackToVersion` — creates new draft from version snapshot; original unchanged
- `getVersionHistory` / `getVersionById` — queries blueprint_versions
- `testBlueprintSandbox` — dry-run validation, never creates work, never dispatches specialists; returns specialist, missing assets, validation outcome
- `listBlueprints` — extended with search/filter (status, specialist)/sort options
- `selectBlueprint` — Sprint 28: org-published blueprints take precedence over built-ins for same code (two-query: org first, built-in fallback)
- `updateCustomBlueprint` — now rejects edits on published/superseded blueprints (409)

### Route extensions (`workBlueprints.ts`)
New endpoints:
- PATCH /:id/archive, PATCH /:id/restore
- POST /:id/clone, POST /:id/submit-for-review
- POST /:id/publish, POST /:id/rollback
- GET /:id/versions, GET /versions/:versionId
- POST /:id/test (sandbox)
- GET /:blueprintId (single blueprint detail)

### Frontend pages (6 new files)
- `BlueprintStudioPage.tsx` — library, search/filter/sort, archive/restore/clone actions
- `BlueprintDetailPage.tsx` — full view, all lifecycle actions, structured rules display
- `BlueprintEditorPage.tsx` — create/edit form (shared component, mode = create vs edit)
- `BlueprintVersionHistoryPage.tsx` — version list, version detail, compare two versions, rollback
- `BlueprintTestPage.tsx` — sandbox test form, results panel (specialist/validation/missing assets/outputs)
- `BlueprintPublishPage.tsx` — pre-publish checklist, release notes, confirmation, supersede warning

Routes added to App.tsx (in order, before :id catch-all):
- /blueprints/new, /blueprints/:id/edit, /blueprints/:id/versions, /blueprints/:id/test, /blueprints/:id/publish, /blueprints/:id, /blueprints

Nav: Blueprint Studio (📐) added to KNOWLEDGE_NAV in AppShell.tsx

### Key rules
- Cross-org blueprint access: getBlueprintById returns null for other-org rows → service throws 404 (not 403). Tests must expect 404 for cross-org scenarios.
- Built-ins are status="published" (seeded and migrated). The `status` column exists in DB and is mapped in mapRow.
- selectBlueprint always does two DB queries now (org-published first, built-in second). Existing sprint22 tests that mock only one call needed a second mockReturnValueOnce.
- vi.mock factory cannot reference non-hoisted variables — all sprint28 mocks use vi.hoisted().

## Test count
- sprint28-blueprint-studio.test.ts — 83 tests
- Total: **2733 tests passing** (up from 2650)
- REQUIRED_RLS_TABLES: 69
