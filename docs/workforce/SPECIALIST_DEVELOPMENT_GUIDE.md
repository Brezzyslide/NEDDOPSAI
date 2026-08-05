# NeedsOps Digital Workforce — Specialist Development Guide

> **Version:** 1.0.0  
> **Status:** Founder-Approved  
> **Owner:** Architecture  
> **Last Updated:** August 2026

---

## Purpose

This guide defines the required workflow for developing every NeedsOps AI Employee — from the initial founder workshop through to production deployment. It is the operational companion to the [Professional Design Lifecycle](./framework/ProfessionalDesignLifecycle.md).

No stage may be skipped. No specialist may advance to the next stage without clearing the quality gate at the end of the preceding stage.

---

## The Development Workflow

```
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 1 — PROFESSIONAL WORKSHOP                                 │
│                                                                  │
│  Owner: Founder                                                  │
│  Input: None                                                     │
│  Output: Workshop notes (private — not public artefacts)         │
│                                                                  │
│  The founder leads a structured session exploring:              │
│  • The professional domain this specialist will operate in       │
│  • The participant population they will serve                    │
│  • Legislative and regulatory context                            │
│  • Professional standard expected                                │
│  • Ethical obligations specific to this role                     │
│  • Capabilities this specialist must hold                        │
│  • Boundaries this specialist must respect                       │
│  • Escalation obligations specific to this role                  │
│                                                                  │
│  ── No architecture or engineering input at this stage. ──       │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 2 — DESIGN BRIEF                                          │
│                                                                  │
│  Owner: Architecture (content from Founder)                      │
│  Input: Workshop notes                                           │
│  Output: Professional Design Brief (draft)                       │
│  Workspace document: DesignBrief.md                              │
│                                                                  │
│  Architecture structures the founder's workshop knowledge        │
│  into the 26-section Professional Design Brief template.         │
│                                                                  │
│  Template: framework/professional-design-brief-template.md       │
│                                                                  │
│  The Brief covers:                                               │
│  • Identity and role definition                                  │
│  • Professional domain and population scope                      │
│  • Regulatory and legislative context                            │
│  • Capability architecture                                       │
│  • Authority matrix overview                                     │
│  • Escalation framework                                          │
│  • Quality and evidence standards                                │
│  • Professional ethics (role-specific)                           │
│  • Collaboration model                                           │
│  • Prohibited behaviours and hard stops                          │
│  • Constitutional alignment verification                         │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 3 — FOUNDER REVIEW                                        │
│                                                                  │
│  Owner: Founder                                                  │
│  Input: Design Brief (draft)                                     │
│  Output: Approved Design Brief                                   │
│                                                                  │
│  The founder reviews the Design Brief in full.                   │
│                                                                  │
│  Review confirms:                                                │
│  • The Brief accurately reflects the founder's professional      │
│    intent for this specialist                                    │
│  • No section contradicts the constitutional framework           │
│  • Capability and authority scope is correct                     │
│  • Escalation obligations are complete                           │
│                                                                  │
│  ✅ QUALITY GATE 1 — Brief must be founder-approved before       │
│     any further work begins.                                     │
│                                                                  │
│  Workspace document: FounderApproval.md (Brief approval entry)   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 4 — PROFESSIONAL EVIDENCE REGISTER                        │
│                                                                  │
│  Owner: Subject Matter Expert + Architecture                     │
│  Input: Approved Design Brief                                    │
│  Output: Professional Evidence Register                          │
│  Workspace document: ProfessionalEvidenceRegister.md             │
│                                                                  │
│  For each significant professional claim in the Design Brief:    │
│  • The evidence basis is identified and recorded                 │
│  • Evidence quality is assessed against the 7-level hierarchy    │
│  • Gaps in the evidence base are documented                      │
│  • Areas of professional uncertainty are flagged                 │
│                                                                  │
│  ✅ QUALITY GATE 2 — Evidence Register must be complete          │
│     before Employee File authorship begins.                      │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 5 — EMPLOYEE FILE                                         │
│                                                                  │
│  Owner: Architecture                                             │
│  Input: Approved Design Brief + Evidence Register                │
│  Output: Employee File (12 sections)                             │
│  Workspace document: EmployeeFile.md                             │
│                                                                  │
│  Architecture authors the Employee File from the approved        │
│  Design Brief. The 12 sections:                                  │
│                                                                  │
│  §1  Identity and Core Purpose                                   │
│  §2  Professional Domain                                         │
│  §3  Constitutional Alignment                                    │
│  §4  Core Capabilities                                           │
│  §5  Decision Framework                                          │
│  §6  Communication Standards                                     │
│  §7  Relationship Model                                          │
│  §8  Quality Standards                                           │
│  §9  Ethics and Escalation                                       │
│  §10 Hard Stops and Boundaries                                   │
│  §11 Professional Development Philosophy                         │
│  §12 Governance and Accountability                               │
│                                                                  │
│  ✅ QUALITY GATE 3 — Employee File must be complete and          │
│     reviewed by architecture before capability work begins.      │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 6 — CAPABILITY CATALOGUE                                  │
│                                                                  │
│  Owner: Architecture + Subject Matter Expert                     │
│  Input: Employee File                                            │
│  Output: Capability Catalogue + Authority Matrix + Matrices      │
│  Workspace documents: CapabilityCatalogue.md, AuthorityMatrix.md,│
│    ResponsibilityMatrix.md, CollaborationMatrix.md,              │
│    CompetencyModel.md, KnowledgeRequirements.md,                 │
│    TrustedProviders.md, BlueprintOwnership.md                    │
│                                                                  │
│  For each capability in the Employee File:                       │
│  • A Capability Definition is authored                           │
│  • Conditions of use, evidence requirements, refusal criteria,   │
│    and escalation triggers are defined                           │
│                                                                  │
│  Authority Matrix defines:                                       │
│  • Decide / recommend / approve / escalate / never per domain    │
│                                                                  │
│  ✅ QUALITY GATE 4 — All catalogues and matrices must be         │
│     complete and SME-reviewed before runtime work begins.        │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 7 — RUNTIME COMPILATION                                   │
│                                                                  │
│  Owner: Engineering (compilation) + Architecture (validation)    │
│  Input: Employee File + Capability Catalogue + Authority Matrix   │
│  Output: Validated Runtime Manifest                              │
│  Workspace document: RuntimeCompilationNotes.md                  │
│                                                                  │
│  Engineering compiles the Runtime Manifest — a minimal package   │
│  containing: identity, selected constitutional statements,        │
│  capability codes, authority codes, and hard stops.              │
│                                                                  │
│  Architecture validates the manifest against:                    │
│  • The approved Employee File                                    │
│  • The Authority Matrix                                          │
│  • The constitutional framework                                  │
│                                                                  │
│  ✅ QUALITY GATE 5 — Manifest must be architecture-validated     │
│     before founder full approval is sought.                      │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 8 — IMPLEMENTATION                                        │
│                                                                  │
│  Owner: Engineering                                              │
│  Input: Validated Runtime Manifest + Employee File               │
│  Output: Implemented specialist services                         │
│  Workspace document: ImplementationStatus.md                     │
│                                                                  │
│  Engineering implements the specialist in the platform:          │
│  • DNA profile in lib/workforce-dna                              │
│  • Specialist runtime service in lib/specialist-runtime          │
│  • Capability routing                                            │
│  • Authority enforcement                                         │
│  • Escalation handlers                                           │
│                                                                  │
│  ✅ QUALITY GATE 6 — Implementation must be code-complete        │
│     before validation begins.                                    │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 9 — VALIDATION                                            │
│                                                                  │
│  Owner: Architecture + Engineering                               │
│  Input: Implementation + Validation Scenarios                    │
│  Output: Validated specialist behaviour                          │
│  Workspace documents: ValidationScenarios.md, TestCoverage.md    │
│                                                                  │
│  Validation covers:                                              │
│  • Each capability exercised under defined conditions            │
│  • Refusal conditions verified                                   │
│  • Escalation triggers verified                                  │
│  • Hard stops verified                                           │
│  • Constitutional alignment confirmed                            │
│  • Authority boundary enforcement confirmed                      │
│                                                                  │
│  ✅ QUALITY GATE 7 — All validation scenarios must pass and      │
│     architecture must sign off on professional quality.          │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 10 — TESTING                                              │
│                                                                  │
│  Owner: Engineering + Architecture review                        │
│  Input: Validated implementation                                 │
│  Output: Passing test suite                                      │
│  Workspace document: TestCoverage.md                             │
│                                                                  │
│  Automated test suite covers:                                    │
│  • Unit tests for all specialist services                        │
│  • Integration tests for execution pipeline                      │
│  • Scenario tests from the Validation Scenarios document         │
│  • Regression tests against existing specialists                 │
│                                                                  │
│  ✅ QUALITY GATE 8 — All tests must pass. No regressions         │
│     introduced. Test coverage meets the defined threshold.       │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 11 — FOUNDER APPROVAL                                     │
│                                                                  │
│  Owner: Founder                                                  │
│  Input: Full design package + test results                       │
│  Output: Approved specialist                                     │
│  Workspace document: FounderApproval.md (final approval entry)   │
│                                                                  │
│  The founder reviews and approves:                               │
│  • Employee File                                                 │
│  • Capability Catalogue                                          │
│  • Authority Matrix                                              │
│  • Runtime Manifest summary                                      │
│  • Test results summary                                          │
│                                                                  │
│  ✅ QUALITY GATE 9 — Founder approval required before            │
│     production deployment.                                       │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 12 — PRODUCTION                                           │
│                                                                  │
│  Owner: Engineering (operations) + Architecture (governance)     │
│  Input: Founder-approved specialist                              │
│  Output: Active specialist in production                         │
│  Workspace document: ImplementationStatus.md (updated)           │
│                                                                  │
│  The specialist is deployed and activated in production.         │
│                                                                  │
│  Ongoing governance:                                             │
│  • Performance monitored against the Design Brief standard       │
│  • Issues raised through the change governance process           │
│  • Annual review against the constitutional framework            │
│  • Changes to Employee Files trigger return to Stage 5+          │
│                                                                  │
│  ✅ QUALITY GATE 10 — Specialist Register and Progress           │
│     Dashboard updated to reflect production status.              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Quality Gate Summary

| Gate | After Stage | Required Before |
|------|-------------|----------------|
| **Gate 1** — Brief founder-approved | Stage 3 | Evidence Register + Employee File work |
| **Gate 2** — Evidence Register complete | Stage 4 | Employee File authorship |
| **Gate 3** — Employee File reviewed | Stage 5 | Capability + Authority work |
| **Gate 4** — All catalogues and matrices complete | Stage 6 | Runtime compilation |
| **Gate 5** — Manifest architecture-validated | Stage 7 | Implementation |
| **Gate 6** — Implementation code-complete | Stage 8 | Validation |
| **Gate 7** — Validation scenarios passing | Stage 9 | Testing |
| **Gate 8** — Full test suite passing | Stage 10 | Founder approval |
| **Gate 9** — Founder approval received | Stage 11 | Production deployment |
| **Gate 10** — Register and Dashboard updated | Stage 12 | Specialist considered complete |

Full gate definitions: [SPECIALIST_QUALITY_GATES.md](./SPECIALIST_QUALITY_GATES.md)

---

## Using the Specialist Workspace

Each specialist has a dedicated workspace folder at `docs/workforce/specialists/[slug]/`. The workspace contains all 20 development documents in placeholder state until the corresponding lifecycle stage is reached.

Navigate to a specialist's workspace: `docs/workforce/specialists/[slug]/README.md`

Current specialist status: [SPECIALIST_REGISTER.md](./SPECIALIST_REGISTER.md)

Overall progress: [WORKFORCE_PROGRESS.md](./WORKFORCE_PROGRESS.md)

Cross-specialist dependencies: [SPECIALIST_DEPENDENCIES.md](./SPECIALIST_DEPENDENCIES.md)

---

## Rules

- **No stage is skipped.** Each stage produces an artefact. Each artefact is reviewed. Each gate is cleared before the next stage begins.
- **Founder approval is required at Gates 1 and 9.** Engineering completion is not sufficient for production.
- **Constitutional alignment is verified at every stage.** No specialist may be designed or implemented in a way that contradicts the Professional Constitution, Executive Operating System, or Universal Decision Hierarchy.
- **Workspace documents are populated in order.** Documents that depend on a prior stage are not authored speculatively.
- **The Decision Catalogue grows in operation.** It is not authored before the specialist is active — it records live professional decisions.

---

## Reference Documents

| Document | Path |
|----------|------|
| Professional Constitution | `docs/workforce/framework/SharedProfessionalConstitution.md` |
| Executive Operating System | `docs/workforce/framework/ExecutiveOperatingSystem.md` |
| Universal Decision Hierarchy | `docs/workforce/framework/UniversalDecisionHierarchy.md` |
| Governance Rules | `docs/workforce/framework/GovernanceRules.md` |
| Professional Design Lifecycle | `docs/workforce/framework/ProfessionalDesignLifecycle.md` |
| Design Brief Template | `docs/workforce/framework/professional-design-brief-template.md` |
| Founder Approval Register | `docs/workforce/framework/FOUNDER_APPROVAL.md` |
| Specialist Register | `docs/workforce/SPECIALIST_REGISTER.md` |
| Quality Gates | `docs/workforce/SPECIALIST_QUALITY_GATES.md` |
| Dependencies | `docs/workforce/SPECIALIST_DEPENDENCIES.md` |
| Progress Dashboard | `docs/workforce/WORKFORCE_PROGRESS.md` |

---

*Version 1.0.0 — August 2026. No stage may be skipped. Stop and wait for founder approval at Gates 1 and 9.*
