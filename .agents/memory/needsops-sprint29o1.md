---
name: NeedsOps Sprint 29O.1 Mac OpenClaw Connectivity
description: Discovery endpoint on broker, discoverEvidence() on client, CloudOpenClawDiscoveryAdapter; real CLI contract; isAvailable() must be "connected" not "connecting"; selectAdapter fallback must be nullDiscoveryAdapter not adapters[0]; scope-bounded discovery prompt with allowedRoots/knownSourcePaths; OpenClaw native field-name aliases passageText→supportingPassage / sourceUri→accessLocation
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

## MAC PROOF RESULTS

### Proof 1 (2026-08-10, 19.5 s)
- Command: `openclaw agent --agent main --message-file <tmpfile> --json`
- Workspace: `/Users/tayephilipajao/.openclaw/workspace/rostering/`
- Result: status "ok", 1 verbatim passage from FATIGUE_MANAGEMENT.md, 0 tool failures
- retrievalMethod in real output: `local_file`

### Proof 2 (2026-08-10, live broker test)
- Request: `allowedRoots + knownSourcePaths pointing at FATIGUE_MANAGEMENT.md`
- Result: `openClawStatus:"available"`, 1 candidate with correct sourceTitle/retrievalMethod/relevanceScore
- **Bug found**: `sourceUri:null` and `passageText:null` in broker response

## CRITICAL: OpenClaw Field-Name Aliases

OpenClaw 2026.7.x uses its OWN field naming conventions, not our canonical names:

| OpenClaw native | Our canonical contract |
|-----------------|------------------------|
| `passageText`   | `supportingPassage`    |
| `sourceUri`     | `accessLocation`       |

**The fix** — `resolveOpenClawAlias()` in `validateAndFilterCandidates`:
- Tries canonical name first
- Falls back to OpenClaw alias if canonical is absent/empty
- Rejects schema-template placeholders (`<verbatim passage from the source>`) that OpenClaw emits when it fills our JSON example literally
- Fail-closed: if no real passage found in EITHER field → candidate rejected

**Additional hardening:**
- `passageHash` always recomputed from normalised passage (never trusted from OpenClaw)
- `contentType` defaults to `"unknown"` when absent or placeholder
- `REQUIRED_STRING_FIELDS` trimmed to `["sourceTitle", "retrievalMethod"]` — only fields OpenClaw reliably returns with canonical names

## Discovery Strategy (proven by live tests)

**knownSourcePaths-scoped discovery** → completes within 45 seconds ✓
**allowedRoots-only (broad) discovery** → times out at 45 seconds ✗

**Rule: Always prefer `knownSourcePaths` as the primary strategy.** Broad root scanning is too slow for the 45 s timeout.

## Scope-bounded discovery prompt

`buildDiscoveryInstruction` emits a **SCOPED SEARCH BOUNDARIES** block when `allowedRoots` or `knownSourcePaths` are non-empty:

```
═══ SCOPED SEARCH BOUNDARIES ═══
Search ONLY within the locations listed below.
Do NOT access any file, directory, or URL not covered by these paths.

ALLOWED ROOTS:
  /Users/tayephilipajao/.openclaw/workspace/rostering

KNOWN SOURCE PATHS (check these first):
  /path/to/FATIGUE_MANAGEMENT.md
```

Rule 8 (`Only access files within the SCOPED SEARCH BOUNDARIES`) appended only when scoped.

## New wire fields on DiscoveryBrokerRequest

```typescript
allowedRoots?:      string[]  // Absolute Mac dirs OpenClaw may search within
knownSourcePaths?:  string[]  // Specific files expected to contain relevant content
```

Default `timeoutMs`: 45 s (proven run ~20 s; gives headroom without hitting 60 s max).

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
    "knownSourcePaths": ["/Users/tayephilipajao/.openclaw/workspace/rostering/FATIGUE_MANAGEMENT.md"],
    "allowedDiscoveryScope": "internal_references_only",
    "allowExternalWebSearch": false,
    "maxHops": 2,
    "maxSources": 5,
    "maxPassages": 3,
    "timeoutMs": 45000
  }' | jq '{status: .openClawStatus, passage: .candidates[0].supportingPassage[:80], location: .candidates[0].accessLocation}'
```

Success = `"status":"available"` with non-null `passage` and `location`.

## Spawn-mode implementation (evidence.ts)

- Write governed instruction to `os.tmpdir()/needsops-discovery-<uuid>.txt`
- Spawn `openclaw agent --agent main --message-file <tmpfile> --json` with `stdio: ["ignore", "pipe", "pipe"]`
- Collect all stdout into a buffer (no streaming events)
- On exit: JSON-parse top-level → `result.payloads[].text` → `{ candidates: [] }`
- `resolveOpenClawAlias()` normalises field names in `validateAndFilterCandidates`
- Always `unlinkSync(tmpFile)` in settle callback

## Failure behaviour

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
| No passage in either field (passageText or supportingPassage) | candidate dropped | remaining |
| Schema-template placeholder in both passage fields | candidate dropped | remaining |
| connectivity_test retrievalMethod | candidate rejected | remaining |
| No location in either field (sourceUri or accessLocation) | candidate dropped | remaining |

## isAvailable() / selectAdapter rules

- `isAvailable()` returns true only when `connectionStatus.state === "connected"` (not "connecting")
- `selectAdapter` in discoveryOrchestrator falls back to `nullDiscoveryAdapter` explicitly — never `adapters[0]`

## Test count

Desktop-connector: 52 tests in evidence-discovery.test.ts — all pass.
Tests #42–51 cover alias normalization, placeholder rejection, and full spawn regression.

## Remaining before Cloudflare tunnel

1. Mac broker rebuild: `node build.mjs` → restart
2. Run curl test above — should now return real `supportingPassage` + `accessLocation`
3. Confirm result uses canonical field names (NOT passageText/sourceUri)
4. Cloudflare tunnel: `cloudflared tunnel run needsops-broker` → configure OPENCLAW_RUNTIME_URL on Replit side
