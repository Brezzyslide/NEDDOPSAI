---
name: NeedsOps Production Blueprint Foundation
description: Schema, enforcement, access-control, and intent-map architecture for the blueprint production layer
---

## Key decisions

- `care_plan_arch_test` is the synthetic fixture code (separate from `care_plan`) — keeps the placeholder registry entry clean.
- `filterBlueprintForRole` context: `tenantId` + `isPlatformAdmin` — NOT `organizationId` / `isTenantPlatformAdmin`. All tests must use the correct field names.
- `resolveIntent()` is primary; keyword/LLM fallback is only reached when `resolveIntent` returns null.
- `validatedClaims: []` at the completion gate — full claim provenance runs post-createDraft as fire-and-forget.
- `hasArtifact: false` / `hasTemplate: false` hardcoded at the completion gate; `artifactRequired=true` on the synthetic blueprint triggers `block_completion` in live, which proves the gate works.
- `enforceSectionRequirements` accepts `BlueprintSection[] | null | undefined` — defensive null guard required because `getBlueprintSections` can be mocked/return undefined.

## Required: test mock pattern for workBlueprintService

Any test that mocks `workBlueprintService.js` MUST include `getBlueprintSections`:
```ts
vi.mock("../services/workBlueprintService.js", () => ({
  selectBlueprint:      mockSelectBlueprint,
  getBlueprintById:     vi.fn().mockResolvedValue(null),
  getBlueprintSections: vi.fn().mockResolvedValue([]),
}));
```
Omitting it causes "No export is defined on the mock" errors across all UEE-touching tests.

## New tables (applied live)

- `work_templates` — 15 columns, platform-owned or org-owned document templates
- `work_blueprints` — added `default_template_id` (text nullable), `template_required` (boolean)
- `work_package_manifests` — added `canonical_intent_key`, `blueprint_family`, `blueprint_mode`

## REQUIRED_RLS_TABLES unchanged at 75

`work_templates` uses RLS via tenant isolation — count should be verified before next schema change.

## Test baseline

**5086 passing, 9 pre-existing failures** (sprint8-openclaw: 5 timeout/env failures; sprint-knowledge-ingestion: 4 PDF lib failures). Both pre-existed before this sprint.

**Why:** The 9 failures are environment-dependent (OpenClaw runtime absent, pdf-parse v2 ESM quirks) — not logic failures.

**How to apply:** When checking test health, baseline is "9 pre-existing failures". Any new failures above 9 are regressions.
