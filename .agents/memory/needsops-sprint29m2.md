---
name: NeedsOps Sprint 29M.2 Clarification Resume & Knowledge Nav
description: Clarification resume crash fix (null manifest in UEE), Knowledge nav role-gating, memory adoption policy module
---

## Clarification Resume Crash Fix

**Root cause:** When EVIDENCE_BEARING execution requests clarification during evidence gathering (before `assembleWorkPackage` is called), `createDurableCheckpoint` saves `manifest: result.manifest!` where `manifest` is `undefined` at runtime. The `!` assertion passes `undefined` through as `null` (stored in DB). On resume, `unifiedExecutionEngine.ts` restores `manifest = null` from the checkpoint, then crashes at `manifest.executionId` during the manifest integrity hash computation.

**Fix applied (three changes):**
1. `executionCoordinatorService.ts:515` — changed `manifest: (result as ...).manifest!` to `manifest: ... ?? null` (removes the unsafe assertion)
2. `messageIngressService.ts:163` — changed `resumeResult.checkpoint!` to `resumeResult.checkpoint ?? ({} as any)` (secondary safety guard)
3. `unifiedExecutionEngine.ts` — added null guard BEFORE `const manifestHash = createHash(...)` (line ~894): if `!manifest!`, return `{ outcome: "error", message: "This task cannot be resumed — the work package was not captured..." }`

**Why the guard is in UEE not the coordinator:** The coordinator's `runExecutionInBackground` fires async; adding a return there wouldn't propagate to the conversation. The UEE returns an `ExecutionResult` that the coordinator then processes and posts to conversation.

**Remaining gap:** The error gives the user a clear message but asks them to restart. A future improvement would re-assemble the manifest from the task+plan during resume rather than failing (requires reading `taskId` from checkpoint and calling `assembleWorkPackage`).

## Knowledge Nav Role-Gating

**File:** `artifacts/needsops-web/src/components/layout/AppShell.tsx`

Added `useQuery` that fetches `/v1/me/organisations` (returns `{ organisations: [{ slug, role, ... }] }`). Derives `orgRole` from the current org slug. `KNOWLEDGE_NAV` (Library / Memory / Blueprint Studio) renders only when `orgRole === "owner" || orgRole === "admin"`. Uses `staleTime: 5 * 60_000` — role rarely changes within a session.

**Note:** Route-level guards on the Library/Memory/Blueprint Studio pages themselves are NOT yet implemented — nav hiding is first-layer only. Task #146 covers the route guard.

## Memory Adoption Policy Module

**File:** `artifacts/api-server/src/lib/memoryAdoptionPolicy.ts`

Key exports:
- `GOVERNANCE_SENSITIVE_MEMORY_TYPES: Set<MemoryType>` — 5 types: `approval_rule`, `workflow`, `policy_reference`, `risk_constraint`, `compliance_context`
- `AUTO_ADOPTABLE_MEMORY_TYPES: Set<MemoryType>` — 5 types: `organisation_profile`, `operating_preference`, `terminology`, `system_information`, `reporting_line`, `customer_preference`
- `evaluateMemoryAdoption(memoryType, sourceType, confidence, actorRole)` → `{ allowed, reason }`
- `isGovernanceSensitiveMemoryType(type)` — convenience predicate

**Policy rules:**
- Governance-sensitive types never auto-adopt (regardless of source/confidence)
- `import` source always requires review (bulk content)
- `manual` source needs no gate (already human-authored)
- Auto-adoption only for `conversation`/`ai_proposed` sources
- `reporting_line` requires `admin`/`owner` actor role
- Confidence gates: 0.80 default, 0.85 for `customer_preference`

**NOT yet wired into `organisationMemoryService.createOrganisationMemory`** — policy module exists but is not enforced at the service layer. Follow-up task needed.
