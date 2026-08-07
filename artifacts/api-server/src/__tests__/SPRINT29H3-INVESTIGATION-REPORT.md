# Sprint 29H.3 — Capability Gate False-Positive Investigation Report

**Prepared:** 2026-08-07  
**Conversation:** `96b7bcfe-946b-4aa5-bf6b-635afaa950f5`  
**Organisation:** `98b132ec-958c-4ff4-8e80-c5fc7fccd1e2` (mhr-holdings-2)  
**Method:** Source analysis + live DB probe (6/6 tests pass, `sprint29h3-entitlement-probe.test.ts`)

---

## Q1 — What capability codes were identified from the acceptance message?

**Answer:** Four codes were identified — one too many.

| Code | Level Requested | Decision | Reason |
|---|---|---|---|
| `incident.review` | `professional_analysis` | ✅ allowed | `workforce_pack_included` |
| `compliance.gap_analysis` | `professional_analysis` | ✅ allowed | `workforce_pack_included` |
| `compliance.evidence_review` | `professional_analysis` | ✅ allowed | `workforce_pack_included` |
| `policy.review` | `execution` | ❌ blocked | `level_not_supported` |

Source: `capability_decisions` table, evaluated at `2026-08-07T07:34:48.XXX Z`.

`policy.review` should NOT have been identified. The user asked to review an **Incident Management Policy document**. They did not request the Policy Review product capability.

---

## Q2 — Why was `policy.review` identified in the first place?

**Answer:** Keyword false-positive in `capabilityIdentificationService.ts`.

The `CAPABILITY_KEYWORD_PATTERNS` in `lib/capabilityRegistry.ts` defines:

```typescript
{
  capabilityCode: "policy.review",
  keywords: ["policy", "policies", "procedure", "procedures", "policy review"],
  ...
}
```

The bare keyword `"policy"` matches the substring "Policy" in "Incident Management **Policy**". The acceptance message mentions a document name — not a product capability.

Both `policy.review` and `incident.review` scored 2 points (one single-word keyword match each = 2 pts), giving a deterministic confidence of `2/8 = 0.25`. Because this is below the 0.7 threshold, the deterministic path was bypassed and the **LLM identifier fired**.

---

## Q3 — How did the LLM change the result?

**Answer:** The LLM assigned `execution` level to `policy.review`, which the registry does not support.

The LLM identification prompt (line 199) allows the model to freely choose `requestedLevel` from:
```
"general_information" | "professional_analysis" | "execution"
```

The LLM read "Review our current Incident Management **Policy**" and interpreted it as executing a Policy Review, returning `requestedLevel: "execution"`. The other three capabilities were assigned `professional_analysis`.

The `adjustLevelsForIntent` guard (lines 158–174) checks `cap.executionAllowed` before escalating to `execution` — but this guard **only runs on deterministic results**. LLM-returned levels bypass it entirely and reach `decideCapabilityAccess` unchecked.

---

## Q4 — Why was `policy.review` at `execution` level blocked?

**Answer:** `policy.review` does not support execution level (`executionAllowed: false` in registry).

`decideCapabilityAccess` step 2 (lines 126–131):
```typescript
if (!isLevelSupported(cap, requestedLevel)) {
  return makeDenied(..., "level_not_supported",
    `${cap.displayName} does not support ${requestedLevel} level`, []);
}
```

DB record confirms: `decision: "blocked"`, `reasonCode: "level_not_supported"`, `source: "Policy Review does not support execution level"`.

The registry allows `policy.review` at `general_information` and `professional_analysis`. Execution is not supported because it has no eligible execution specialist (no Operations Manager or Chief of Staff in `eligibleRoles`).

---

## Q5 — Does mhr-holdings-2 actually have the compliance pack?

**Answer:** Yes. The block had nothing to do with missing entitlements.

```json
{
  "packCode": "compliance",
  "source": "onboarding_trial",
  "status": "trial",
  "trialStartedAt": "2026-08-06T02:20:47.835Z",
  "trialEndsAt": "2026-08-20T02:20:47.835Z",
  "revokedAt": null
}
```

Live `decideCapabilityAccess` calls confirm:
- `policy.review` at `professional_analysis` → **allowed**, `workforce_pack_included`
- `incident.review` at `professional_analysis` → **allowed**
- `compliance.gap_analysis` at `professional_analysis` → **allowed**
- `compliance.evidence_review` at `professional_analysis` → **allowed**

If `policy.review` had been requested at `professional_analysis` (its correct level), it would have been **allowed**. The org would have had full access to all four capabilities.

---

## Q6 — Why did the UI say "Requires upgrade: Policy Review"?

**Answer:** The `buildMixedCapabilityResponse` function uses a generic "Requires upgrade" label for all blocked capabilities regardless of their `reasonCode`.

Source in `capabilityGateService.ts` line 72:
```typescript
if (!mixed.canProceedPartially && blocked.length > 0) {
  response += `**Requires upgrade:**\n${blocked.map(b => `- ${b}`).join("\n")}\n\n`;
}
```

The actual reason (`level_not_supported`) is discarded. "Requires upgrade" implies a missing subscription — factually wrong here, since the org has the compliance pack and CAN use `policy.review` at `professional_analysis`. This is a **misleading user-facing error message**.

---

## Q7 — Why was the conversation interrupted instead of continuing?

**Answer:** `canProceedPartially = true` AND `requiresUserConfirmationForPartialWork = true` → `buildMixedCapabilityResponse` fired.

`decideMixedCapabilityAccess` result:
- `allowedCapabilities`: 3 (incident.review, compliance.gap_analysis, compliance.evidence_review)  
- `blockedCapabilities`: 1 (policy.review)  
- `canProceedPartially = true` (allowed.length > 0)  
- `requiresUserConfirmationForPartialWork = true` (there is at least one blocked capability)

This triggers the `else if (mixed.requiresUserConfirmationForPartialWork)` branch in `conversationService.ts` (line 536), replacing the entire conversation response with a mixed capability card. The capability gate fires **before** the Sprint 29H.2 action state/decision logic can dispatch.

---

## Q8 — Did Sprint 29H.2 work correctly?

**Answer:** Yes — Sprint 29H.2 is sound. It was not involved in the failure.

The action state (`level = "specialist_assigned"`, not short-circuiting to "completed") and action decision (`rerun_existing`, `shouldDispatchSpecialist: true`) are correctly computed for this conversation. The route handler would have dispatched the Operations Manager via `dispatchWorkExecution` had the capability gate not intercepted first.

The capability gate runs at step 3b in `conversationService.processUserMessage`, before the 29H.2 action decision is resolved (step 3c) and before the route handler dispatches. The gate fires at **message classification time** (`conversationMode = "task_intent"` or `"task_clarification"`) — which the acceptance message triggers.

---

## Q9 — What is the complete causal chain?

```
User message: "Review our current Incident Management Policy..."
         │
         ▼
capabilityIdentificationService.identifyCapabilities()
 ├─ Deterministic: "policy" keyword → policy.review score=2
 │                "incident" keyword → incident.review score=2
 │  confidence = 2/8 = 0.25 → below 0.70 threshold
 │  → FALLS THROUGH TO LLM
 └─ LLM: returns 4 capabilities
     ├─ incident.review         → professional_analysis
     ├─ compliance.gap_analysis → professional_analysis
     ├─ compliance.evidence_review → professional_analysis
     └─ policy.review           → execution   ← LLM assigns execution freely
         (adjustLevelsForIntent guard bypassed for LLM-returned caps)
         │
         ▼
decideMixedCapabilityAccess()
 ├─ incident.review @professional_analysis     → ALLOWED (compliance trial pack)
 ├─ compliance.gap_analysis @professional_analysis → ALLOWED
 ├─ compliance.evidence_review @professional_analysis → ALLOWED
 └─ policy.review @execution
     └─ isLevelSupported("execution") = false  → BLOCKED (level_not_supported)
         │
         ▼
canProceedPartially = true, requiresUserConfirmationForPartialWork = true
         │
         ▼
buildMixedCapabilityResponse() → "Requires upgrade: Policy Review"
         │
         ▼
capabilityGateOverride set → replaces conversation response
         │
         ▼
Action decision (29H.2) NOT reached — no dispatch — OM not dispatched
```

---

## Q10 — What are the bugs and where are they?

Three distinct defects, in priority order:

### Bug 1 (Highest priority) — Bare "policy" keyword matches document names
**File:** `artifacts/api-server/src/lib/capabilityRegistry.ts` (CAPABILITY_KEYWORD_PATTERNS)  
**Problem:** The keyword `"policy"` matches any message containing the word "policy", including document names like "Incident Management Policy".  
**Fix:** Replace bare `"policy"` with multi-word phrases: `"policy review"`, `"review our policy"`, `"conduct a policy review"`, `"perform a policy review"`. Remove single-word `"policy"` and `"policies"` from the pattern, or add them only as minimum-score signals that alone cannot cross the threshold.

### Bug 2 (High priority) — LLM-returned capability levels bypass the `executionAllowed` registry guard
**File:** `artifacts/api-server/src/services/capabilityIdentificationService.ts`, `adjustLevelsForIntent()`  
**Problem:** `adjustLevelsForIntent` is called only on deterministic results (it checks `cap.executionAllowed` before assigning `execution`). LLM-returned capabilities can freely claim `requestedLevel: "execution"` for capabilities that don't support it, causing `level_not_supported` blocks.  
**Fix:** Apply `adjustLevelsForIntent` (or an equivalent cap check) to LLM-returned capabilities before returning from `identifyCapabilities`. Specifically: after parsing the LLM JSON, for each capability, if `requestedLevel === "execution" && !cap.executionAllowed`, downgrade to `professional_analysis` (or `general_information` if `analysisAllowed` is also false).

### Bug 3 (Medium priority) — "Requires upgrade" label used for `level_not_supported` decisions
**File:** `artifacts/api-server/src/services/capabilityGateService.ts`, `buildMixedCapabilityResponse()`  
**Problem:** All blocked capabilities are labelled "Requires upgrade" regardless of `reasonCode`. A `level_not_supported` block implies the org needs to upgrade — which is false when they already own the pack.  
**Fix:** Segment the blocked list by `reasonCode`. For `level_not_supported`, show "Not available for this type of request" or similar. For `workforce_pack_not_included`, show "Requires upgrade". For `execution_not_included`, show "Requires execution add-on".

---

## Summary Table

| Finding | Fact |
|---|---|
| Does mhr-holdings-2 have the compliance pack? | **Yes** — trial active until 2026-08-20 |
| Was the block due to missing entitlement? | **No** — all 4 capabilities pass at professional_analysis |
| What caused the block? | `policy.review` identified falsely; LLM assigned `execution` level; registry rejects it |
| Did Sprint 29H.2 (action decision/dispatch) work? | **Yes** — logic is correct; gate fired before it could execute |
| What triggered the partial-block gate? | 3 allowed + 1 level_not_supported blocked → `requiresUserConfirmationForPartialWork = true` |
| Where is the primary fix needed? | `CAPABILITY_KEYWORD_PATTERNS` — remove bare `"policy"` keyword from `policy.review` pattern |
| Where is the secondary fix needed? | `adjustLevelsForIntent` — apply to LLM-returned capabilities to cap levels at `executionAllowed` |
| Where is the tertiary fix needed? | `buildMixedCapabilityResponse` — use `reasonCode` to differentiate "Requires upgrade" vs "Not supported" |
| Root-cause service | `capabilityIdentificationService.ts` (keyword false-positive + LLM level bypass) |
| Net outcome | No UEE execution; conversation replaced with misleading gate card |

---

*Investigation complete. No implementation was done in this session per explicit user instruction. The bugs above are candidates for a follow-up sprint.*
