# NeedsOps Digital Workforce — Specialist Quality Gates

> **Version:** 1.0.0  
> **Status:** Founder-Approved  
> **Owner:** Architecture  
> **Last Updated:** August 2026

---

## Purpose

This document defines the twelve mandatory quality gates that every NeedsOps AI Employee must clear before advancing to the next stage of their development lifecycle.

No specialist may bypass any gate. Gate clearance is recorded in the specialist's workspace `ImplementationStatus.md` and reflected in the [Specialist Register](./SPECIALIST_REGISTER.md) and [Progress Dashboard](./WORKFORCE_PROGRESS.md).

---

## Gate Definitions

### Gate 1 — Shared Governance Inherited

**Stage:** Before any specialist design work begins  
**Owner:** Architecture  
**Cleared by:** Architecture sign-off  

**Criteria:**

- [ ] The NeedsOps Professional Constitution v1.0.0 (or current approved version) is confirmed as the constitutional foundation for this specialist
- [ ] The Universal Decision Hierarchy v1.0.0 (or current approved version) is confirmed as the decision framework for this specialist
- [ ] If this specialist carries an executive designation: the Executive Operating System v1.0.0 (or current approved version) is confirmed as the reasoning framework
- [ ] The Governance Rules v1.0.0 (or current approved version) are confirmed as binding on all artefacts produced for this specialist
- [ ] No special exemptions from constitutional obligations have been proposed

**Evidence required:** Architecture confirmation note in `ImplementationStatus.md`

**Cannot advance to:** Design Brief work until this gate is cleared.

---

### Gate 2 — Professional Design Brief Approved

**Stage:** After Design Brief completion and founder review  
**Owner:** Founder  
**Cleared by:** Founder sign-off  

**Criteria:**

- [ ] The Design Brief has been completed using the approved template (all 26 sections)
- [ ] Every section reflects founder-approved professional knowledge — not AI-generated assumption
- [ ] No section of the Brief contradicts the Professional Constitution, Executive Operating System, or Universal Decision Hierarchy
- [ ] The capability scope is correctly defined — not over-scoped or under-scoped
- [ ] The authority scope is correctly defined — proportionate to the role
- [ ] The escalation obligations are complete and correct
- [ ] The hard stops and prohibited behaviours are clearly defined
- [ ] The founder has reviewed the complete Brief and provided written approval
- [ ] Approval is recorded in `FounderApproval.md` and the framework [Founder Approval Register](./framework/FOUNDER_APPROVAL.md)

**Evidence required:** Founder approval entry in `FounderApproval.md`

**Cannot advance to:** Evidence Register or Employee File until this gate is cleared.

---

### Gate 3 — Professional Evidence Register Complete

**Stage:** After Evidence Register completion  
**Owner:** Subject Matter Expert + Architecture  
**Cleared by:** Architecture sign-off after SME review  

**Criteria:**

- [ ] Every significant professional claim in the Design Brief has a corresponding evidence entry
- [ ] Each entry records: evidence type, source, quality tier (using the 7-level hierarchy), jurisdiction, currency date
- [ ] Evidence gaps are documented — absence of evidence is recorded, not concealed
- [ ] Areas of professional uncertainty are explicitly flagged
- [ ] The SME has reviewed the register for professional accuracy
- [ ] No claim is presented as higher-quality evidence than it is

**Evidence required:** SME review note in `ProfessionalEvidenceRegister.md`; architecture sign-off in `ImplementationStatus.md`

**Cannot advance to:** Employee File authorship until this gate is cleared.

---

### Gate 4 — Employee File Complete

**Stage:** After Employee File authorship  
**Owner:** Architecture  
**Cleared by:** Architecture sign-off (independent review)  

**Criteria:**

- [ ] All 12 sections of the Employee File are complete
- [ ] The Employee File is derived from the approved Design Brief — not authored independently
- [ ] No section of the Employee File contradicts the constitutional framework
- [ ] Hard stops are clearly defined and unambiguous
- [ ] Escalation obligations are correctly specified
- [ ] Confidence thresholds are defined where the specialist must escalate
- [ ] The Employee File has been reviewed by a second architecture reviewer (not the author)

**Evidence required:** Independent review sign-off in `EmployeeFile.md`; version entry in `VersionHistory.md`

**Cannot advance to:** Capability Catalogue or Authority Matrix work until this gate is cleared.

---

### Gate 5 — Capability Catalogue Validated

**Stage:** After Capability Catalogue completion  
**Owner:** Architecture + Subject Matter Expert  
**Cleared by:** SME review + architecture sign-off  

**Criteria:**

- [ ] A Capability Definition exists for every capability identified in the Employee File
- [ ] Each definition specifies: conditions of use, evidence requirements, output quality standard, refusal criteria, escalation triggers
- [ ] No capability exceeds the authority defined in the Authority Matrix
- [ ] Capability codes are assigned and recorded
- [ ] The SME has reviewed all capability definitions for professional accuracy
- [ ] Refusal conditions are unambiguous — a reviewer can determine when refusal is required
- [ ] Escalation triggers are specific — not left to specialist discretion

**Evidence required:** SME review sign-off in `CapabilityCatalogue.md`

**Cannot advance to:** Runtime compilation until this gate is cleared.

---

### Gate 6 — Authority Matrix Approved

**Stage:** After Authority Matrix completion  
**Owner:** Architecture + Founder review  
**Cleared by:** Architecture sign-off; founder review for significant authority grants  

**Criteria:**

- [ ] Every decision domain relevant to this specialist is covered in the matrix
- [ ] Each domain has a clear authority code: Decide / Recommend / Approve / Escalate / Never
- [ ] "Never" entries are unambiguous — no specialist discretion is possible
- [ ] Authority codes are consistent with the Employee File and Capability Catalogue
- [ ] The matrix has been reviewed against the constitutional escalation obligations
- [ ] No authority grant exceeds what is warranted by the professional design
- [ ] Founder has reviewed and confirmed significant authority grants

**Evidence required:** Authority Matrix sign-off in `AuthorityMatrix.md`; founder review note for significant grants

**Cannot advance to:** Runtime compilation until this gate is cleared.

---

### Gate 7 — Runtime Compiled

**Stage:** After Runtime Manifest compilation  
**Owner:** Engineering (compilation) + Architecture (validation)  
**Cleared by:** Architecture validation sign-off  

**Criteria:**

- [ ] The Runtime Manifest has been compiled from the current approved versions of the Employee File, Capability Catalogue, and Authority Matrix
- [ ] The manifest contains: specialist identity, selected constitutional statements, capability codes, authority codes, hard stops, escalation chain
- [ ] The manifest does not contain full Employee File text, Design Brief content, or workshop material
- [ ] Architecture has validated the manifest against the Employee File — no content has been omitted or distorted
- [ ] The manifest version is aligned with the Employee File version
- [ ] Compilation notes are recorded in `RuntimeCompilationNotes.md`

**Evidence required:** Architecture validation sign-off in `RuntimeCompilationNotes.md`

**Cannot advance to:** Implementation until this gate is cleared.

---

### Gate 8 — Implementation Complete

**Stage:** After engineering implementation  
**Owner:** Engineering  
**Cleared by:** Engineering sign-off  

**Criteria:**

- [ ] DNA profile implemented in `lib/workforce-dna`
- [ ] Specialist runtime service implemented
- [ ] Capability routing implemented and tested at unit level
- [ ] Authority enforcement implemented — boundary violations are rejected, not silently degraded
- [ ] Escalation handlers implemented
- [ ] Hard stop enforcement implemented — prohibited actions are refused with a clear response
- [ ] Implementation is consistent with the validated Runtime Manifest
- [ ] No implementation decisions have been made that deviate from the approved design without architecture sign-off

**Evidence required:** Engineering sign-off in `ImplementationStatus.md`

**Cannot advance to:** Behaviour validation until this gate is cleared.

---

### Gate 9 — Behaviour Validated

**Stage:** After validation scenarios are executed  
**Owner:** Architecture + Engineering  
**Cleared by:** Architecture sign-off on professional quality  

**Criteria:**

- [ ] All validation scenarios in `ValidationScenarios.md` have been executed
- [ ] Every capability has been exercised under its defined conditions
- [ ] Refusal conditions have been tested — specialist refuses correctly when required
- [ ] Escalation triggers have been tested — specialist escalates correctly when required
- [ ] Hard stops have been tested — specialist refuses prohibited actions unambiguously
- [ ] Constitutional alignment has been confirmed — no output contradicts the Professional Constitution
- [ ] Authority boundary enforcement has been confirmed
- [ ] Architecture has reviewed the professional quality of outputs — not just technical correctness
- [ ] Any issues identified during validation have been resolved and re-validated

**Evidence required:** Architecture sign-off on professional quality in `ValidationScenarios.md`

**Cannot advance to:** Regression testing until this gate is cleared.

---

### Gate 10 — Regression Tests Passing

**Stage:** After automated test suite execution  
**Owner:** Engineering  
**Cleared by:** Engineering sign-off; architecture review of coverage  

**Criteria:**

- [ ] All automated tests pass with no failures
- [ ] Test suite covers every capability defined in the Capability Catalogue
- [ ] Tests cover refusal conditions, escalation triggers, and hard stops
- [ ] No regressions introduced in existing specialists
- [ ] Test coverage meets the defined threshold (documented in `TestCoverage.md`)
- [ ] Architecture has reviewed the test coverage for meaningful coverage vs. superficial coverage

**Evidence required:** Test run results in `TestCoverage.md`; architecture coverage review sign-off

**Cannot advance to:** Founder approval until this gate is cleared.

---

### Gate 11 — Founder Approval

**Stage:** Before production deployment  
**Owner:** Founder  
**Cleared by:** Founder sign-off  

**Criteria:**

- [ ] Founder has reviewed the Employee File in its final form
- [ ] Founder has reviewed the Capability Catalogue summary
- [ ] Founder has reviewed the Authority Matrix
- [ ] Founder has reviewed a Runtime Manifest summary
- [ ] Founder has reviewed the validation results summary
- [ ] Founder is satisfied the specialist's design and behaviour reflects the intent established in the Professional Design Workshop
- [ ] Approval is recorded in `FounderApproval.md` and the framework [Founder Approval Register](./framework/FOUNDER_APPROVAL.md)

**Evidence required:** Founder approval entry in `FounderApproval.md`

**Cannot advance to:** Production deployment until this gate is cleared.

---

### Gate 12 — Production Ready

**Stage:** At production deployment  
**Owner:** Engineering (deployment) + Architecture (governance confirmation)  
**Cleared by:** Engineering deployment confirmation + architecture governance sign-off  

**Criteria:**

- [ ] All preceding gates (1–11) have been cleared and recorded
- [ ] The specialist has been deployed to the production environment
- [ ] The Specialist Register has been updated to reflect production status
- [ ] The Progress Dashboard has been updated
- [ ] The Founder Approval Register has been updated with the final production entry
- [ ] A next review date has been set (annual minimum)
- [ ] Monitoring is in place for specialist performance against the Design Brief standard

**Evidence required:** Deployment confirmation in `ImplementationStatus.md`; register and dashboard updates

**Specialist is considered production-ready when this gate is cleared.**

---

## Gate Clearance Record Template

For each specialist, gate clearance is recorded in `ImplementationStatus.md` using the following format:

```markdown
## Gate Clearance Record

| Gate | Description | Cleared | Date | Cleared By | Evidence |
|------|-------------|---------|------|-----------|---------|
| 1 | Shared governance inherited | ⬜ | — | — | — |
| 2 | Design Brief approved | ⬜ | — | — | — |
| 3 | Evidence Register complete | ⬜ | — | — | — |
| 4 | Employee File complete | ⬜ | — | — | — |
| 5 | Capability Catalogue validated | ⬜ | — | — | — |
| 6 | Authority Matrix approved | ⬜ | — | — | — |
| 7 | Runtime compiled | ⬜ | — | — | — |
| 8 | Implementation complete | ⬜ | — | — | — |
| 9 | Behaviour validated | ⬜ | — | — | — |
| 10 | Regression tests passing | ⬜ | — | — | — |
| 11 | Founder approval | ⬜ | — | — | — |
| 12 | Production ready | ⬜ | — | — | — |
```

---

## Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | August 2026 | Inaugural version. Defines 12 mandatory quality gates for all NeedsOps AI Employee development. |

---

*No specialist may bypass any gate. Gate clearance is the responsibility of the gate owner. Evidence of clearance is recorded in the specialist's workspace.*
