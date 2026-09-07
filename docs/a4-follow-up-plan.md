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
