---
name: NeedsOps Sprint 13 Executive Assistant Employee File
description: EA Employee File (12 sections), DNA v1.0.0 draft, capability registry additions, oath export pattern, validator patch for draft-only employees
---

## What was delivered

**New files (lib/workforce-dna/src/employees/executive-assistant/):**
- 12 section files: identity, soul, mission, values, personality, authority, decision-philosophy, communication, responsibilities, professional-dna, worker-profile, index
- Section constants use EA_ prefix (e.g. EA_IDENTITY, EA_SOUL) — not COS_ prefix

**New DNA profile:**
- lib/workforce-dna/src/profiles/executiveAssistant.ts
- EXECUTIVE_ASSISTANT_DNA_V1: isActive: false (draft, awaiting human approval)
- EXECUTIVE_ASSISTANT_PROFESSIONAL_OATH: exported as a SEPARATE constant (not a DNAProfile field)

**CRITICAL — Professional Oath export pattern:**
- The oath is NOT a field on the DNAProfile object (DNAProfile type doesn't have professionalOath)
- It is a standalone export: `export const EXECUTIVE_ASSISTANT_PROFESSIONAL_OATH = "..."`
- It is re-exported from employees/executive-assistant/index.ts
- Tests must import it directly: `import { EXECUTIVE_ASSISTANT_PROFESSIONAL_OATH } from ".../index.js"`
- DO NOT try to read it from dnaProfile.professionalOath (undefined) or dnaProfile.philosophy.statement (wrong field)

**EmployeeProfessionalDNA for draft-only employees:**
- activeVersion: "none" (no published DNA yet)
- v1: { profile: EXECUTIVE_ASSISTANT_DNA_V1, status: "draft" }
- No v2 field

**validateEmployeeFile patch (lib/workforce-dna/src/employee/index.ts):**
- Original rule: v1.status must be "published" (assumed CoS pattern where v1 IS published)
- Patched: if activeVersion === "none", allow v1.status === "draft"
- Rule: `if (file.professionalDNA.activeVersion !== "none" && file.professionalDNA.v1.status !== "published") { error }`
- This must be applied to every new employee whose first DNA version is still draft

**Registry updates:**
- lib/workforce-dna/src/registry.ts: EMPLOYEE_FILE_REGISTRY now has 2 entries (chief_of_staff, executive_assistant)
- lib/workforce-dna/src/index.ts: exports EXECUTIVE_ASSISTANT_EMPLOYEE_FILE, EXECUTIVE_ASSISTANT_DNA_V1, EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST

**New capabilities added to capabilityRegistry.ts:**
calendar.read, calendar.propose_times, communications.summarise, communications.send, meeting.prepare_agenda, meeting.prepare_brief, meeting.capture_notes, meeting.extract_actions, meeting.prepare_follow_up, actions.create, actions.track, actions.escalate, documents.read, documents.organise, contacts.lookup

**Key EA identity:**
- roleCode: executive_assistant, title: AI Executive Assistant, department: Executive
- reportsTo: Chief of Staff, packCode: core, employmentType: permanent_specialist
- roleLevel: specialist, authorityLevel: intermediate
- absorbs: calendar_specialist (deprecated, merged), communication_specialist (deprecated, merged)
- activeVersion: "none" (DNA draft, pending approval)

**Documentation:** docs/workforce/executive-assistant/ (9 files created) + dna-design-status.md + approved-workforce-catalogue-v1.md updated

**Tests:** 1039 passing (84 new sprint13 tests)
**REQUIRED_RLS_TABLES = 35** (unchanged — no DB changes)

## Template for remaining 15 employees
1. Same 12 section files as EA
2. professional-dna.ts: activeVersion: "none", v1: { ..., status: "draft" }
3. Export professionalOath as separate constant from profiles/<role>.ts AND re-export from employees/<role>/index.ts
4. validateEmployeeFile will pass because of the activeVersion==="none" patch
5. DNA profile does NOT need professionalOath as a DNAProfile field — keep it separate
