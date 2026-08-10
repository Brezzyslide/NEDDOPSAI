---
name: NeedsOps Sprint 29O.1 Mac OpenClaw Connectivity
description: Discovery endpoint on broker, discoverEvidence() on client, CloudOpenClawDiscoveryAdapter; real CLI contract; isAvailable() must be "connected" not "connecting"; selectAdapter fallback must be nullDiscoveryAdapter not adapters[0]; scope-bounded discovery prompt with allowedRoots/knownSourcePaths
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

**Why:** Live Mac proof (2026-08-10, 19.5 s) on `/Users/tayephilipajao/.openclaw/workspace/rostering/FATIGUE_MANAGEMENT.md` showed spawn mode has no persistent HTTP server and no `--mode` flag. The `--agent main --message-file` command is the only confirmed working interface.

## MAC PROOF RESULT (2026-08-10)

- Command: `openclaw agent --agent main --message-file <tmpfile> --json`
- Workspace: `/Users/tayephilipajao/.openclaw/workspace/rostering/`
- Duration: ~19.5 seconds
- Result: status "ok", 1 verbatim passage from FATIGUE_MANAGEMENT.md, zero tool failures
- retrievalMethod in real output: `local_file`

**Key insight:** The timeout problem was NOT OpenClaw failing — it was an unbounded discovery prompt with no `allowedRoots`. OpenClaw was exploring the whole filesystem, not the specific workspace directory.

## Scope-bounded discovery prompt (added post-proof)

`buildDiscoveryInstruction` now emits a **SCOPED SEARCH BOUNDARIES** block when `allowedRoots` or `knownSourcePaths` are non-empty:

```
═══ SCOPED SEARCH BOUNDARIES ═══
Search ONLY within the locations listed below.
Do NOT access any file, directory, or URL that is not covered by these paths.

ALLOWED ROOTS (search any file within these directories):
  /Users/tayephilipajao/.openclaw/workspace/rostering

KNOWN SOURCE PATHS (check these files first):
  /path/to/FATIGUE_MANAGEMENT.md
```

Rule 8 (`Only access files within the SCOPED SEARCH BOUNDARIES`) is appended to CRITICAL RULES only when scoped.

For `internal_references_only` scope with no roots/paths provided: lightweight `SCOPE — INTERNAL ONLY` section emitted instead.

**Why:** Unbounded prompt sent OpenClaw on a full filesystem crawl that exhausted the timeout. Explicit roots bound the search to the relevant directory and complete in ~20 s.

## New wire fields on DiscoveryBrokerRequest

```typescript
allowedRoots?:      string[]  // Absolute Mac dirs OpenClaw may search within
knownSourcePaths?:  string[]  // Specific files expected to contain relevant content
```

These flow through:
- `DiscoveryBrokerRequest` (broker wire type)
- `DiscoveryParams` (internal params)
- `buildDiscoveryInstruction` (prompt)
- `callBridgeDiscover` (bridge passthrough)
- `BrokerEvidenceDiscoveryRequest` in `lib/openclaw/src/types.ts`

## Default timeout

Changed from 20 s → **45 s** (proven real-Mac duration is ~20 s; 45 s gives comfortable headroom without hitting `MAX_DISCOVERY_TIMEOUT_MS = 60 s`).

## Localhost curl test (for Mac broker validation)

```bash
curl -s -X POST http://127.0.0.1:19001/v1/evidence/discover \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat ~/.needsops/broker.token 2>/dev/null || echo dev)" \
  -d '{
    "organizationId": "test-org-001",
    "executionId":    "test-exec-001",
    "specialistCode": "chief_of_staff",
    "searchObjective": "Find fatigue management policy requirements for roster scheduling",
    "allowedRoots": ["/Users/tayephilipajao/.openclaw/workspace/rostering"],
    "knownSourcePaths": [],
    "allowedDiscoveryScope": "internal_references_only",
    "allowExternalWebSearch": false,
    "maxHops": 2,
    "maxSources": 5,
    "maxPassages": 3,
    "timeoutMs": 45000
  }' | jq '{status: .openClawStatus, count: (.candidates | length)}'
```

Success = `{"status":"available","count":<n≥1>}` within 45 seconds.

## Regression fixture (test #37)

Models the proven 2026-08-10 Mac run:
- `sourceTitle`: "Fatigue Management Policy"
- `accessLocation`: `/Users/tayephilipajao/.openclaw/workspace/rostering/FATIGUE_MANAGEMENT.md`
- `retrievalMethod`: `local_file` ← must NOT be treated as synthetic (not filtered)
- `relevanceScore`: 0.91, `openClawConfidence`: 0.96

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

## isAvailable() / selectAdapter rules

- `isAvailable()` returns true only when `connectionStatus.state === "connected"` (not "connecting")
- `selectAdapter` in discoveryOrchestrator falls back to `nullDiscoveryAdapter` explicitly — never `adapters[0]`

## Test count

Desktop-connector: 42 tests in evidence-discovery.test.ts — all pass.
New tests: #37 (regression fixture), #38–41 (scope bounding).

## Remaining before Cloudflare tunnel

1. Mac broker rebuild: `node build.mjs` → restart → run curl test above
2. Confirm result is `"available"` with ≥1 non-synthetic candidate from FATIGUE_MANAGEMENT.md
3. Cloudflare tunnel: `cloudflared tunnel run needsops-broker` → configure OPENCLAW_RUNTIME_URL on Replit side
