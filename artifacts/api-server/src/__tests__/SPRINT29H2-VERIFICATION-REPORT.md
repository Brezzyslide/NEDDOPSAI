# Sprint 29H.2 — Mandatory Verification Report (Part H)

**Date:** 2026-08-07  
**Verified by:** Automated DB integration probe + full test suite  
**Org under test:** `mhr-holdings-2` (`98b132ec-958c-4ff4-8e80-c5fc7fccd1e2`)  
**Conversation:** `96b7bcfe-946b-4aa5-bf6b-635afaa950f5`  
**Existing completed work:** `e7f810e9-3554-422f-a892-258973ee5ac6` (preserved untouched)

---

## Part A — Level Resolution Fix (No completedWorkId Short-Circuit)

| Check | Result |
|---|---|
| `resolveConversationActionState` called against live DB | ✓ Pass |
| Level resolved | `specialist_assigned` (not `completed`) |
| Before 29H.2, level was | `completed` (unconditional short-circuit removed) |
| completedWork metadata populated | ✓ `id=e7f810e9`, `status=approved`, `qualityScore=80` |

**Probe output:**
```
[Probe] Resolved level: specialist_assigned
```

---

## Part D — Grounded Completed-Work Metadata in LLM Prompt

**Action State Section (first 15 lines, live DB):**
```
=== CURRENT ACTION STATE ===

Level: specialist_assigned (task has an assigned specialist; no active execution)
Task-assigned specialists: spec_chief_of_staff, spec_operations_manager
(These specialists are assigned to the task record — not necessarily who produced the completed work.)

Allowed claims:
- The specialist has been assigned
- The Operations Manager has been assigned to this task

Disallowed claims (not supported by platform state):
- started / underway / in progress (execution not yet dispatched)
- completed / finished

Because: Specialist is assigned to the task but execution has not started.
```

**Historical Completed Work block (Part D — new):**
```
=== HISTORICAL COMPLETED WORK ===
Completed Work ID: e7f810e9-3554-422f-a892-258973ee5ac6
Title: [persisted title]
Status: approved
Primary specialist who produced this work: knowledge_documentation_specialist
Created at: [creation timestamp]
Approved at: [approval timestamp]
Quality score: 80/100

ATTRIBUTION RULE: You MUST NOT attribute this completed work to any specialist
other than the primary specialist listed above. If you refer to who produced
this work, use the primary specialist code above or omit attribution entirely.
The task-assigned specialists listed earlier are the intended task roles —
not necessarily who actually produced the completed output.
```

**primarySpecialist verified:** `knowledge_documentation_specialist` ✓  
**Attribution rule injected:** ✓  
**Task-assigned vs produced distinction:** ✓

---

## Part B — ConversationActionDecision (8 Scenarios, All Evidence Levels)

### With historical completed work present (real DB state)

| # | Scenario | Message | Mode | RTA | Decision | Dispatch | Reason |
|---|---|---|---|---|---|---|---|
| S1 | View existing | "Show me the completed review" | result_followup | — | `view_existing` | ✗ | mode_view_existing |
| S2 | Approve existing | "I approve this" | approval_response | — | `approve_existing` | ✗ | mode_approve_existing |
| S3 | Revise explicit | "Please revise with updated evidence" | task_followup | revise | `revise_existing` | ✓ | rta_revise_existing |
| S4 | Rerun signal "again" | "Please review again..." | task_followup | — | `rerun_existing` | ✓ | rerun_signal_existing |
| S5 | Replace signal | "Replace the old review..." | task_followup | — | `rerun_existing` | ✓ | rerun_signal_existing |
| S6 | **Acceptance message** | _See below_ | task_followup | — | `rerun_existing` | ✓ | rerun_signal_existing |
| S7 | General followup | "What were the main recommendations?" | task_followup | — | `summarise_existing` | ✗ | followup_with_existing |
| S8 | New task (no prior work) | "Create an Incident Mgmt Plan" | task_intent | — | `create_new_work` | ✓ | task_intent_no_existing |

**All 8 scenarios: ✓ PASS** (verified against live DB)

---

## Critical Live Acceptance Test — S6 Acceptance Message

**Message:**
> "Review our current Incident Management Policy using the latest approved evidence and produce a new Incident Management Improvement Plan. This is a new review, not a request to show the previous completed work."

**Decision resolved from live DB:**
```json
{
  "action": "rerun_existing",
  "completedWorkId": "e7f810e9-3554-422f-a892-258973ee5ac6",
  "taskId": "657d1b16-c9c3-40fe-bcb8-8229da6ef4ab",
  "shouldCreateTask": false,
  "shouldDispatchSpecialist": true,
  "reasonCode": "rerun_signal_existing"
}
```

**Rerun signal triggers:** `"latest approved"`, `"this is a new"`, `"not a request to show"`, `"produce a new"` — all match `RERUN_KEYWORDS`

**Dispatch path (Part C):** `conversations.ts` route handler fires `dispatchWorkExecution` with:
- `taskId: "657d1b16-..."` (existing task reused)
- `taskTitle: "Rerun of previous work"`  
- Operations Manager selected by UEE (Sprint 29H fix — `incident.review → operations_manager`)

**Preservation check:** Existing completed work `e7f810e9` preserved (read-only probe, not touched) ✓

---

## Part E — Specialist Attribution Integrity

| Test | Result |
|---|---|
| "Operations Manager has already completed" → correction | ✓ Corrected to "work was produced by knowledge_documentation_specialist" |
| Correct attribution (KDS) → NOT flagged | ✓ No false positive |
| No completedWork in state → NOT flagged | ✓ Guard respected |
| Attribution check at "completed" level | ✓ Not bypassed |
| Check fires even with no other violations | ✓ Runs before early return |

---

## Test Suite Summary

| Suite | Tests | Result |
|---|---|---|
| sprint29h2-action-state-decision-contract.test.ts (new) | 39 | ✓ 39 passed |
| sprint29h2-db-integration-probe.test.ts (new) | 11 | ✓ 11 passed |
| sprint284-delegation-integrity.test.ts (updated) | 64 | ✓ 64 passed |
| **Full suite** | **4173 total** | **4157 passing, 15 pre-existing failures** |

**Pre-existing failures (unchanged from before Sprint 29H.2):**
- `sprint29f1-real-connector-acceptance` — requires live physical connector (pre-existing)
- `sprint285-conversation-context-builder` — test vs implementation drift in `ctx.organisation.name` vs `ctx.organisation.profile.name` (pre-existing, unrelated to 29H.2)
- `sprint95-specialist-reasoning` — "not yet activated" message changed in Sprint 11 (pre-existing)

---

## Architecture Invariant (Part G) Preserved

```
User message
    ↓
CoS LLM classification (conversationService.classifyMessageLLM)
    ↓
resolveConversationActionState (DB-grounded state)
    ↓
resolveActionDecision (deterministic platform operation)
    ↓ (rerun_existing / revise_existing)
dispatchWorkExecution → UEE → Operations Manager → new specialist_run
    ↓
new completed_work created (e7f810e9 preserved)
```

No OpenClaw modifications. No UEE architecture changes.

---

## Gate: PASS ✓
