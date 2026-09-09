# A4 Follow-Up Plan

## Conversation Intent Classifier

After A4, replace the participant/template regex decision stack with one structured classifier call.

Scope:
- Return whether the request is template/general, participant-specific, or unknown.
- If participant-specific, return the referenced person span and normalized candidate name.
- Keep deterministic participant exact/fuzzy matching after the classifier returns the name.
- Run in shadow mode first, logging classifier output beside the current regex decision before switching traffic.

Regexes to retire:
- `EXPLICIT_TEMPLATE_TERMS`
- `NAME_AFTER_FOR_PATTERN`
- `POSSESSIVE_PLAN_PATTERN`
- `PERSON_REFERENCE_TERMS`
- `NAME_STOP_WORDS`

Expected size:
- 2-3 days for schema, prompt, wiring, fixtures, golden tests, and shadow-mode telemetry.
- Estimated model cost below $0.001 per classified request on a mini classifier model.
- Expected latency 300-900 ms p50, 1-2 s p95 before caching/retry tuning.

## Silent Fallback Inventory

Known fallback/default-return surfaces left for follow-up after the A4 role switch:

- `artifacts/api-server/src/routes/v1/orgSubscription.ts` `/workforce`: catalogue merge failures become `entries: []`, which can hide specialist catalogue permission failures and show stale registry fields.
- `artifacts/api-server/src/services/workforceOpsService.ts`: catalogue lookups degrade to registry/default specialist display data, which can mask missing catalogue grants in workforce operations.
- `artifacts/api-server/src/services/conversationMemoryService.ts`: summary trigger/update paths can return `false` or deterministic summaries, which can hide DB or gateway failures behind normal conversation flow.
- `artifacts/api-server/src/services/knowledgeCurationService.ts`: LLM failures intentionally use rule-based proposal extraction, but proposal persistence failures are logged and skipped, reducing governance visibility.
- `artifacts/api-server/src/routes/v1/installerReleases.ts`: installer reads propagate, but download-event insert failures are swallowed, so analytics can undercount without surfacing write permission issues.
- `artifacts/api-server/src/services/auditService.ts`: org-schema audit writes fall back to legacy public audit only for provisioning gaps; if both writes fail, audit evidence is warning-only.
- `artifacts/api-server/src/routes/v1/orgAudit.ts`: org audit reads fall back to legacy public audit for unprovisioned org schemas, which is legitimate only during provisioning transition.
- `artifacts/api-server/src/services/executionCoordinatorService.ts`: progress, checkpoint, plan, blueprint and notification side effects use several best-effort `.catch()` fallbacks, risking incomplete execution telemetry.
- `artifacts/api-server/src/services/discoveryService.ts`: discovery completion falls back from update to insert and swallows org update failures, which can leave onboarding state partially recorded.
