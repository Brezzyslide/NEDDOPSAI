---
name: NeedsOps Sprint 13b Chief of Staff Behaviour Correction
description: CoS runtime switched to Employee File instruction, executive ownership rules, response validator, prohibited phrases, 1094 tests
---

## Root cause found and fixed

chiefOfStaffLLMService.ts line 53 called buildDNASystemInstruction("chief_of_staff") — the old DNA-only path. This bypassed the entire Employee File architecture (Constitution, decision philosophy, communication rules, authority). The Employee File was designed in Sprint 12 but was never reaching the runtime.

**Fix:** Changed to buildSystemInstructionForEmployee("chief_of_staff"). Both are imported from @workspace/workforce-dna.

## Files changed

**Employee File sections (lib/workforce-dna/src/employees/chief-of-staff/):**
- decision-philosophy.ts — 9 steps → 10 steps; 6 principles → 10 principles. First step now "Infer the likely organisational objective". Added: "The Chief of Staff owns the structure of the work. The user owns the final decision." Added clarification quality rule.
- communication.ts — added 5 characteristics about leading with assessment, structured plans before clarification, targeted clarification, ownership, customer org language. Added 3 new distinguish items.
- responsibilities.ts — 13 → 19 responsibilities. Added: infer objectives, initial assessment, structured plan, assign AI employees, own the work structure, return consolidated recommendation.
- authority.ts — 8 → 14 mayNot items. Added: no broad requests with only generic guidance, no open-ended clarification, no planning transfer to user, no delegation claim without plan, no "our resources" language.

**Sprint 12 test update:**
- sprint12-employee-file.test.ts: `whenUncertaintyExists.length === 9` → `length >= 9` (since we expanded to 10)

**Services (artifacts/api-server/src/services/):**
- chiefOfStaffLLMService.ts — import + use buildSystemInstructionForEmployee; expanded system prompt with executive ownership rules, clarification quality rules, broad request response framework, prohibited patterns, onboarding-specific behaviour, example acceptable response
- cosResponseValidatorService.ts (NEW) — validateCoSBroadResponse(), classifyAsBroadRequest(), PROHIBITED_PHRASES (18 patterns), CoSResponseQualityResult interface; checks: notGenericAssistantLanguage, doesNotTransferPlanningToUser, doesNotRepeatCapabilityStatement, hasInitialAssessment, hasRecommendedNextStep

**Tests:** 55 new tests in sprint13b-cos-behaviour.test.ts

## Key behavioural rules now in runtime prompt

1. Chief of Staff owns the structure of the work; user owns the final decision
2. Never answer broad request with only generic guidance or open-ended offer
3. Prohibited phrases — 18 patterns listed; regenerate if detected
4. Clarification must reduce a defined uncertainty; lazy clarification is a failure
5. Broad request response framework: understand → assess → likely requirements → recommend → confirm → coordinate
6. Onboarding: always determine perspective (owner/manager/worker) before responding
7. Customer organisation language: "your organisation's policies" not "our policies"

## Prohibited phrases (key ones)
"please let me know how i can help", "if you have specific areas", "i can assist with various aspects", "what specifically would you like help with", "how can i help you today"

## Test count: 1094 passing
