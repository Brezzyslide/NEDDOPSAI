---
name: NeedsOps Sprint 22 Work Execution Engine
description: Work Blueprints, Work Package Manifests, Completed Work lifecycle, Self Review, Approved Examples — backend only. REQUIRED_RLS_TABLES=67, 1916 tests.
---

## Summary
Sprint 22 adds a governed work execution pipeline. Every specialist request produces an immutable Work Package Manifest, passes through self-review, and creates a Completed Work item with a 7-status lifecycle.

## New tables (6) — REQUIRED_RLS_TABLES is now 67
- `work_blueprints` — nullable `organization_id` (NULL = built-in, visible to all orgs)
- `work_package_manifests` — immutable execution manifest; never mutated after assembly
- `completed_work` — main item; 7 statuses (see below)
- `completed_work_versions` — version history
- `completed_work_comments` — authorUserId field (NOT commentedByUserId)
- `completed_work_assets` — attribution for sources/memory used

## Status lifecycle (COMPLETED_WORK_STATUSES)
```
draft → awaiting_approval → approved → archived | superseded
                          ↘ rejected → reopened → (awaiting_approval)
```
Statuses: `draft`, `awaiting_approval`, `approved`, `rejected`, `archived`, `superseded`, `reopened`
**No "submitted" or "cancelled" statuses.**

## Services
- `workBlueprintService` — 14 built-in blueprints; `selectBlueprint()` is rule-based keyword match then DB lookup; returns `fallbackUsed=true` when no DB row found; `seedBuiltInBlueprints()` called at startup (idempotent)
- `workPackageService` — `assembleWorkPackage()` writes immutable manifest; promptVersion = `"sprint22.1.0"`
- `workValidationService` — pure function `validateWorkPackage(manifest, blueprint | null)`; returns `ValidationResult` with `recommendedAction`
- `approvedExampleService` — `buildStyleGuidance(examples: ApprovedExample[], organizationId)` — async, takes example objects NOT raw strings; empty examples returns `guidanceBlock: ""`
- `selfReviewService` — `reviewDraft()` evaluates 10 dimensions; `QUALITY_THRESHOLD = 70`; auto-revision fires once if score < 70
- `completedWorkService` — `addComment()` now calls `logOrgEvent`; `promoteToLibrary()` returns `{ knowledgeSourceId }` only (no `message` field); inserts knowledgeSourcesTable with `as never` cast
- `workExecutionPipelineService` — `executeWork()` orchestrates full pipeline

## Routes
- `workBlueprints.ts` — GET/POST `/work-blueprints`, PUT `/:id`, POST `/work-executions`
- `completedWork.ts` — 13 endpoints
- `taskUploads.ts` — conversation-scoped uploads, promote to library

All three registered in `routes/v1/index.ts`. All use inline `requireOwnerOrAdmin` pattern (no shared lib).

## DB import rules
- Drizzle operators (`eq`, `and`, `or`, `isNull`, `inArray`, `desc`, `asc`) must come from `"drizzle-orm"`, NOT `"@workspace/db"`
- DB tables and types come from `"@workspace/db"`

## Test mock patterns
- `listBlueprints` chain: `.select().from().where()` → returns array directly (no `.orderBy()`)
- `listCompletedWork` chain: `.select().from().where().orderBy().limit().offset()` → array from `.offset()`
- `getComments` / `getAssets` chain: `.select().from().where().orderBy()` → array from `.orderBy()`
- `addComment` insert: `db.insert().values()` no `.returning()` call
- `promoteToLibrary` insert: `db.insert().values()` no `.returning()` call; returns `{ knowledgeSourceId }` UUID string
- `createCustomBlueprint` insert: no `.returning()` — throw tested by mocking `getBlueprintById` (select) to return empty

## work_blueprints RLS policy
Uses `organization_id IS NULL OR organization_id = current_setting(...)` — rlsVerifier sees this as a valid `tenant_isolation` policy (checks existence only).
