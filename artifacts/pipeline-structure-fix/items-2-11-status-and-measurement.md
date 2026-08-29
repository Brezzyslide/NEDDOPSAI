# Pipeline Structure Fix Items 2-11 Status and Measurement

No deploy, image build/push, Terraform apply, DB write, ECS/service change, AWS resource creation, AWS console mutation or git push occurred.

## Items 2-9 Status

| Item | Status | Commit | Files changed | Token before -> after |
|---|---|---|---|---:|
| 2 sectionRole field added/rendered | DONE | `c7d3db2` | `blueprintRegistry.ts`, `unifiedExecutionEngine.ts`, `workBlueprintService.ts`, `workBlueprints.ts`, `sprint35h...test.ts` | `37,823 -> ~38,375` |
| 3 authored requirements + adequacyCriteria + visible fallback marking | DONE | `139be0b` | `deliverableRequirementCoverageService.ts`, `sprint35h...test.ts` | `~38,375 -> ~39,556` |
| 4 dropped section fields rendered | DONE | `00b928d` | `unifiedExecutionEngine.ts`, `sprint35h...test.ts` | `~39,556 -> ~40,942` |
| 5 per-requirement `deliverable.sections[]` and coverage validation | DONE | `70562aa` | `claimValidationService.ts`, `deliverableRequirementCoverageService.ts`, `blueprintRuntimeValidationService.ts`, `unifiedExecutionEngine.ts`, `sprint35h...test.ts` | `~40,942 -> ~41,140` |
| 6 strict JSON schema response_format | DONE | `c79f0f9` | `unifiedExecutionEngine.ts`, `openai.ts`, `types.ts`, `sprint287...test.ts`, `sprint35h...test.ts` | `~41,140 -> ~41,140` |
| 7 Stage 2 trimmed | DONE | `a026b70` | `unifiedExecutionEngine.ts`, `sprint35h...test.ts` | `~41,140 -> ~41,029` |
| 8 self-review gets deliverable + requirements + failures | DONE | `9811527` | `selfReviewService.ts`, `unifiedExecutionEngine.ts`, `sprint35h...test.ts` | `~41,029 -> ~42,775` |
| 9 repair context trimmed | DONE | `fd77119` | `unifiedExecutionEngine.ts`, `types.ts`, `sprint35h...test.ts`, `sprint35j...test.ts` | `~42,775 -> ~31,179` |
| 10 prompt caching ordering | DONE | `72faa87` | `unifiedExecutionEngine.ts`, `professionalExecutionContextService.ts`, `aiGateway.ts`, `openai.ts`, `types.ts`, `sprint287...test.ts`, `sprint35h...test.ts` | `~31,179 -> ~31,057` |

## Item 11 Live Local Measurement

Measurement mode: local provider-boundary care-plan generation using real OpenAI, read-only key retrieval from AWS Secrets Manager after SSO refresh. No DB/task mutation. This is not a production task run.

### Stage Results

| Stage | Input tokens | Output tokens | Total tokens | Cache hit tokens | Result |
|---|---:|---:|---:|---:|---|
| Stage 1 professional draft | `8,246` | `1,327` | `9,573` | `0` | structured candidate returned |
| Targeted repair | `1,056` | `302` | `1,358` | `0` | returned two sections only, empty `assembledMarkdown` |

Stage 2 and self-review were not run in the local harness because Stage 1 already produced a structured candidate and local validation failed before an accept path. The repair pass was run to test the item-9 context.

### Cost

Using GPT-4o mini prices: input `$0.15/M`, cached input `$0.075/M`, output `$0.60/M`.

| Cost basis | Cost |
|---|---:|
| Stage 1 actual | `$0.002033` |
| Repair actual | `$0.000340` |
| Total actual measured | `$0.002373` |
| Stage 1 projected with cache hit | `$0.001439` |
| Total projected with Stage 1 cache hit | `$0.001778` |

Approximate Stage 1 cacheable prefix: `7,923 / 8,246` input tokens, `96.1%`. First run had no cache hit, as expected.

### Gate Results

Stage 1 candidate:

- structured output: pass
- `deliverable.sections[]`: 9 sections for 9 mandatory requirements
- adequacyCriteria validations: 0
- fallback heuristic validations: 9
- fallback pass: 7
- fallback fail: 2
- failed/thin: `mandatory-1`, `mandatory-2`
- self-reported ready: true
- self-reported methodology leakage: false

Targeted repair candidate:

- structured output: pass
- returned sections: 2
- assembledMarkdown: empty
- all mandatory requirement IDs present: false
- fallback pass: 1/9
- fallback fail: 8/9
- would not be acceptable as Completed Work

## Produced Stage 1 Candidate

```markdown
# NDIS Care Plan Template

## Participant Identity
**Participant Name:** [PARTICIPANT_NAME]
**Date of Birth:** [DOB]
**NDIS Number:** [NDIS_NUMBER]
**Address:** [ADDRESS]

## Goals and Preferences
**Goals:** [GOALS]
**Preferences:** [PREFERENCES]
**Communication Needs:** [COMMUNICATION_NEEDS]

## Support Domains and Daily Living Support Structure
**Support Domains:**
1. Daily Living Skills
2. Community Participation
3. Health and Wellbeing
**Daily Living Support Structure:** [SUPPORT_NEEDS]

## Provider and Worker Responsibilities
The provider is responsible for ensuring that all supports are delivered in a safe and respectful manner, consistent with the participant's goals and preferences. Workers must adhere to the service delivery plan and report any issues promptly.

## Participant, Representative and Support-Network Responsibilities
The participant and their representatives are responsible for communicating their needs and preferences clearly. They must also engage in the planning and review processes.

## Health, Medication, Behaviour Support and Restrictive-Practice Boundaries
All health and medication management must be conducted by qualified professionals. Behaviour support strategies must comply with the approved behaviour support plan.

## Risk, Safety, Incident and Escalation Arrangements
Risk management strategies must be in place to ensure the safety of the participant. Any incidents must be reported to the appropriate authorities.

## Community Participation and Service-Delivery Coordination
The participant will be supported to engage in community activities that align with their goals. Coordination of services will be managed by the designated support coordinator.

## Review, Updates, Consent and Sign-off Provisions
This plan will be reviewed on [REVIEW_DATE]. All changes must be documented and agreed upon by the participant and provider. Sign-off: [SIGN_OFF]
```

## Skeleton Comparison

Compared with the captured skeleton, the fixed pipeline improves structure because it returns 9 per-requirement sections rather than four headings. However, the content is still shallow:

- participant identity is mostly fields, 12 words
- goals/preferences is mostly fields, 7 words
- several clauses are one or two generic sentences
- no `[Insert known risks]` marker appeared
- no internal methodology headings appeared
- substantive fallback still blocks acceptance

Gate: ITEMS 2-11 STATUS CONFIRMED AND END-TO-END MEASURED — STRUCTURED OUTPUT PRESENT, SUBSTANTIVE CARE-PLAN CONTENT STILL TOO THIN
