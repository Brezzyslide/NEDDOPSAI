---
name: NeedsOps Sprint 9.4 Capability Gate
description: Capability registry, identification, entitlement decisions, gates wired into conversation service and task creation, DB schema, tests
---

## Capability Registry

**File:** `artifacts/api-server/src/lib/capabilityRegistry.ts`

- `BUSINESS_CAPABILITIES` — 37 active capabilities, static TypeScript constant (the canonical allowlist)
- `CAPABILITY_KEYWORD_PATTERNS` — 32 patterns for deterministic identification
- Helper: `isKnownCapabilityCode(code)` — used to reject all invented LLM codes
- Pack codes: `compliance`, `finance`, `hr`, `operations`, `marketing`, `null` (core)

**Why static:** No DB round-trip per request. The `business_capabilities` DB table mirrors this for platform console management only.

## Three-Level Model

- `general_information` — no pack required when `cap.informationAllowed = true`
- `professional_analysis` — requires owning Workforce Pack
- `execution` — requires pack + `execution.openclaw_runtime` feature entitlement

`isLevelSupported(cap, level)` checks the relevant boolean field before any entitlement call.

## EntitlementResult API (critical — do not use `.granted`)

`tenantHasWorkforcePack` and `tenantCanUseFeature` both return `EntitlementResult` with:
- `allowed: boolean` (NOT `granted`)
- `source: EntitlementSource` — `"explicit_denial"` is the source for the highest-priority denial
- `evaluatedAt: Date`
- `effectiveUntil: Date | null`

**Why:** Earlier sprint test mocks used `granted: boolean` which is wrong. Always use `.allowed`.

## New DB Tables (Sprint 9.4)

- `business_capabilities` — platform-managed registry (no tenant RLS)
- `capability_decisions` — tenant-scoped decision audit (RLS: `app.current_organization_id`)

Migration: `lib/db/migrations/sprint94-capabilities.sql` — applied.

After adding new schema files, must rebuild `lib/db`:
```
pnpm --filter @workspace/db exec tsc --build
```

## requiresUserConfirmationForPartialWork

Set to `true` when any REQUIRED capability is either blocked OR partially-allowed (not just blocked). This was a fix from the initial implementation — partial access to a required capability is also a material limitation.

## Conversation Gate Integration

**File:** `artifacts/api-server/src/services/conversationService.ts`

Capability gate is between steps 3 (LLM classification) and 4 (structured content):
- Only triggers for `task_intent` or `task_clarification` modes
- On full block: replaces task_proposal with `capability_blocked` card
- On material partial: replaces with `capability_partial` card requiring confirmation
- Gate errors are non-fatal (logged, conversation continues)

## Task Creation Gate

**File:** `artifacts/api-server/src/routes/v1/tasks.ts`

Before `taskService.createTask` — identifies capabilities from title+description, checks access, returns HTTP 403 with `CAPABILITY_NOT_ENTITLED` error if required capabilities are fully blocked.

## StructuredContent Types Added

Added to `conversationIntelligenceService.ts` StructuredContent union:
- `"capability_blocked"`
- `"capability_partial"`

## Keyword Identification Threshold

Threshold = `Math.max(2, maxScore * 0.4)`. For messages with strong general-info signals ("what is", "how does"), `research.general` scores very high (8 pts for two 2-word phrases), which filters out domain-specific low-scoring capabilities. This is correct behavior — "what is a BAS?" maps to general research, not accounting execution.

## What Remains (not built in 9.4)

- Platform Console CRUD UI for capability management (spec §16) — API ready, UI deferred
- `validateSpecialistEligibility` not yet wired into `taskService.planTask` planning loop
- Deep OpenClaw engine integration for execution gate
- `upgrade_option_selected` analytics webhook
