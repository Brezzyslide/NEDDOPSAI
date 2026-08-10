---
name: NeedsOps Sprint 29O.1 Mac OpenClaw Connectivity
description: Discovery endpoint on broker, discoverEvidence() on client, CloudOpenClawDiscoveryAdapter; real CLI contract; isAvailable() must be "connected" not "connecting"; selectAdapter fallback must be nullDiscoveryAdapter not adapters[0]
---

## Summary

Sprint to wire real Mac-local OpenClaw evidence discovery into the NeedsOps broker, replacing simulated/stub behaviour.

## Proven OpenClaw CLI contract (OpenClaw 2026.7.2 — f2af4e9)

```
WORKING:   openclaw agent --agent main --message-file <tmpfile> --json
INVALID:   openclaw agent --mode rpc --json   ← --mode flag does not exist on this version
```

Output is a **single JSON object** to stdout (NOT streaming newline-delimited events):
```json
{
  "runId":  "<string>",
  "status": "ok",
  "result": {
    "payloads": [
      { "text": "{\"candidates\":[...]}" }
    ]
  }
}
```

The assistant response lives in `result.payloads[].text`. That text is JSON-parsed to obtain `{ "candidates": [...] }`.

**Why:** Live Mac proof showed spawn mode has no persistent HTTP server on 19001 and no `--mode` flag. The `--agent main --message-file` command is the only confirmed working interface.

## Spawn-mode implementation (evidence.ts)

- Write governed instruction to `os.tmpdir()/needsops-discovery-<uuid>.txt`
- Spawn `openclaw agent --agent main --message-file <tmpfile> --json` with `stdio: ["ignore", "pipe", "pipe"]`
- Collect all stdout into a buffer (no streaming events)
- On exit: JSON-parse top-level, extract `result.payloads[].text`, JSON-parse payload to get `{ candidates: [] }`
- Validate/filter candidates with `validateAndFilterCandidates()`
- Always `unlinkSync(tmpFile)` in settle callback

## Failure behaviour (all explicit, no synthetic fallback)

| Condition | openClawStatus | candidates |
|-----------|----------------|------------|
| Binary not found / spawn error | unavailable | [] |
| Temp file write failure | unavailable | [] |
| Killed by signal / timeout | unavailable | [] |
| Non-zero exit code | unavailable | [] |
| stdout not valid JSON | unavailable | [] |
| result.payloads missing/empty | unavailable | [] |
| payload.text not valid JSON | **available** | [] |
| payload has no candidates array | **available** | [] |
| candidate fails validation | candidate dropped | remaining |
| connectivity_test retrievalMethod | candidate rejected | remaining |

`available` for the last two: OpenClaw executed successfully but the assistant text was not machine-readable — distinguishes "binary unreachable" from "binary ran but returned nothing usable".

## Discovery instruction output format

The instruction asks OpenClaw to return `{"candidates":[...]}` as plain JSON. No `discovery_result` event language. No `--mode rpc` references. Verified with test 36: instruction must contain `"candidates"` and must NOT contain `discovery_result`.

## Candidate validation rules

- Required string fields: sourceTitle, supportingPassage, passageHash, retrievalMethod, retrievalTimestamp, contentType, accessLocation
- `retrievalMethod:"connectivity_test"` always rejected in live mode
- passageHash recomputed from supportingPassage if wrong (SHA-256)
- openClawConfidence and relevanceScore clamped to [0, 1]
- organisationId and executionId stamped from request, never trusted from OpenClaw output
- discoveryId generated fresh if absent

## isAvailable() / selectAdapter rules

- `isAvailable()` returns true only when `connectionStatus.state === "connected"` (not "connecting")
- `selectAdapter` in discoveryOrchestrator falls back to `nullDiscoveryAdapter` explicitly — never `adapters[0]`

## Test count

Desktop-connector: 36 new tests in evidence-discovery.test.ts — all pass.
Pre-existing failures: 18 (in e2e.test.ts, routes.test.ts, validation.test.ts — unrelated).
Api-server: ~5000 passing (pre-existing pdf-parse failures separate).

## Next step before Cloudflare tunnel

Run the curl command below against local broker to confirm spawn-mode discovery returns real candidates or an honest empty result:

```bash
curl -s -X POST http://127.0.0.1:19002/v1/evidence/discover \
  -H "Authorization: Bearer <BROKER_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId":  "test-org-001",
    "executionId":     "test-exec-003",
    "specialistCode":  "chief_of_staff",
    "searchObjective": "Find one known document and return one verbatim passage.",
    "maxHops": 1, "maxSources": 1, "maxPassages": 1,
    "timeoutMs": 45000,
    "allowExternalWebSearch": false
  }' | jq '{openClawStatus, failureReason, candidates: [.candidates[] | {sourceTitle, retrievalMethod}]}'
```

Success: `"openClawStatus": "available"` and no `retrievalMethod: "connectivity_test"`.
If status is `"available"` but candidates empty + failureReason contains "not valid JSON": OpenClaw ran but didn't return `{"candidates":[...]}` — adjust the output format prompt.
If status is `"unavailable"` + failureReason contains exit code: OpenClaw exited non-zero — check OpenClaw logs.
