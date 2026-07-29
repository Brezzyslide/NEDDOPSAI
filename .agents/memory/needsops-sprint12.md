---
name: NeedsOps Sprint 12 Chief of Staff Employee File
description: Workforce Constitution v1.0, Employee File architecture, CoS reference implementation, DNA v2.0.0 draft, Runtime Manifest compilation
---

## What was delivered

**New package structure (lib/workforce-dna/src/):**
- constitution.ts — NEEDSOPS_CONSTITUTION (10 principles), CONSTITUTION_VERSION="1.0.0", buildConstitutionPreamble(), getConstitutionStatements(), validateConstitutionInheritance()
- employee/types.ts — All Employee File interfaces: EmployeeFile, EmployeeIdentity, EmployeeSoul, EmployeeMission, EmployeeValues, EmployeePersonality, EmployeeAuthority, EmployeeDecisionPhilosophy, EmployeeCommunicationStyle, EmployeeResponsibilities, EmployeeProfessionalDNA, ExpandedWorkerProfile, RuntimeManifest, RuntimeTaskContext
- employee/index.ts — compileRuntimeManifest(), buildEmployeeSystemInstruction(), validateEmployeeFile(), getSensitiveEmployeeFileSections()
- employees/chief-of-staff/ — 12 section files: identity.ts, soul.ts, mission.ts, values.ts, personality.ts, authority.ts, decision-philosophy.ts, communication.ts, responsibilities.ts, worker-profile.ts, professional-dna.ts, index.ts
- profiles/chiefOfStaffV2.ts — CHIEF_OF_STAFF_DNA_V2 (v2.0.0, isActive: false, 10-step reasoning, 8 competencies)

**Key invariants:**
- values.constitutionInherited must always be readonly true — cannot be bypassed
- communication.neverExaggerateCertainty must always be readonly true
- DNA v1.0.0 (chiefOfStaff.ts) NEVER modified — historical runs reproducible
- DNA v2.0.0 is draft (isActive: false) — not in dispatch registry
- getDNAProfile("chief_of_staff") still returns v1.0.0
- buildDNASystemInstruction() unchanged — fallback for employees without Employee File
- buildSystemInstructionForEmployee() uses Employee File architecture if available

**Runtime Manifest compilation:**
- compileRuntimeManifest(employeeFile, taskContext) → RuntimeManifest
- Sensitive sections EXCLUDED from manifest: soul, personality, full values, full DNA profiles, fileVersion, createdAt, updatedAt
- constitutionStatements (all 10) ALWAYS included in manifest
- Only RuntimeManifest is sent to execution runtime — never the full EmployeeFile

**CHIEF_OF_STAFF_DNA_V2 export gotcha:**
- The test imports CHIEF_OF_STAFF_DNA_V2 from employees/chief-of-staff/index.ts
- That file must re-export it: export { CHIEF_OF_STAFF_DNA_V2 } from "../../profiles/chiefOfStaffV2.js"
- (Discovered when tests failed with undefined)

**Registry additions:**
- EMPLOYEE_FILE_REGISTRY: ReadonlyMap<string, EmployeeFile> (currently: chief_of_staff only)
- getEmployeeFile(roleCode): EmployeeFile | null
- buildSystemInstructionForEmployee(roleCode): string — uses Employee File if present, falls back to DNA

**Tests:** 955 passing (86 new sprint12 tests)

**Documentation created:** docs/workforce/chief-of-staff/{employee-file.md, constitution.md, dna-v2.md, worker-profile.md, runtime-manifest.md}

## Architecture hierarchy (canonical)
NeedsOps Constitution
        ↓
Employee File
        ↓
Professional DNA
        ↓
Worker Profile
        ↓
Runtime Manifest
        ↓
Execution Runtime

## Template for remaining 16 employees
1. Create 12 section files in lib/workforce-dna/src/employees/<role-code>/
2. Each section implements the matching interface from employee/types.ts
3. Index file assembles EmployeeFile and exports CHIEF_OF_STAFF_RUNTIME_MANIFEST equivalent
4. Register in EMPLOYEE_FILE_REGISTRY in registry.ts
5. DNA design comes separately — employee file can exist with DNA v1 only
6. values.constitutionInherited MUST be true — no exceptions

## REQUIRED_RLS_TABLES = 35 (unchanged)
## Test count: 955 passing
