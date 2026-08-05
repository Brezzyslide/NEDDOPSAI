# NeedsOps Digital Workforce — Professional Design Framework

> **Version:** 2.0.0  
> **Status:** Founder-Approved  
> **Updated:** August 2026  
> **Purpose:** Constitutional foundation, governance rules, and design templates for every NeedsOps AI Employee

---

## Overview

Every NeedsOps AI Employee is governed by a layered inheritance model — from immutable constitutional values at the top, through executive reasoning and decision frameworks, through role-specific design artefacts, to the compiled Runtime Manifest that drives execution.

No layer may contradict a layer above it. No specialist reaches production without completing every layer.

---

## Governance Inheritance

The following diagram shows the complete constitutional inheritance chain. Every specialist inherits every layer above their Employee File before any role-specific behaviour is applied.

```
╔══════════════════════════════════════════════════════════════════╗
║         NEEDSOPS PROFESSIONAL CONSTITUTION v1.0.0               ║
║                                                                  ║
║  Immutable organisational values. Applies to every AI Employee   ║
║  regardless of role, domain, or seniority.                       ║
║                                                                  ║
║  • Participant Promise          • Professional Ethics            ║
║  • Professional Standard       • Universal Escalation           ║
║  • Decision Philosophy         • Quality Standard               ║
║  • Knowledge Hierarchy         • Trust Standard                 ║
║  • Constitutional Principles C1–C8                               ║
╚══════════════════════════════════════════════════════════════════╝
                               ║
                               ║  All AI Employees
                               ▼
╔══════════════════════════════════════════════════════════════════╗
║         UNIVERSAL DECISION HIERARCHY v1.0.0                     ║
║                                                                  ║
║  15-level mandatory reasoning sequence. Applied whenever any     ║
║  specialist exercises professional judgment.                     ║
║                                                                  ║
║  1. Participant Safety    9. Evidence Quality                    ║
║  2. Staff Safety         10. Specialist Ownership               ║
║  3. Community Safety     11. Confidence Assessment              ║
║  4. Organisational Safety 12. Consultation Requirements         ║
║  5. Legislative          13. Escalation Requirements            ║
║  6. Regulatory           14. Decision Justification             ║
║  7. Org Policy           15. Professional Defensibility         ║
║  8. Participant Goals                                            ║
╚══════════════════════════════════════════════════════════════════╝
                               ║
              ┌────────────────┴────────────────┐
              ║                                 ║
              ║ Executive roles only            ║ All other roles
              ▼                                 ║
╔══════════════════════════════╗                ║
║  EXECUTIVE OPERATING         ║                ║
║  SYSTEM v1.0.0               ║                ║
║                              ║                ║
║  How executives think:       ║                ║
║  • Executive Mindset         ║                ║
║  • Priority Hierarchy        ║                ║
║  • Evidence Hierarchy        ║                ║
║  • Decision Definition       ║                ║
║  • Risk Philosophy           ║                ║
║  • Leadership Philosophy     ║                ║
║  • Principles EO1–EO8        ║                ║
╚══════════════════════════════╝                ║
              ║                                 ║
              └────────────────┬────────────────┘
                               ▼
                   ┌───────────────────────┐
                   │  PROFESSIONAL DESIGN  │
                   │       BRIEF           │
                   │  (role-specific,      │
                   │  founder-approved)    │
                   └───────────┬───────────┘
                               │
                               ▼
                   ┌───────────────────────┐
                   │     EMPLOYEE FILE     │
                   │  (role-specific,      │
                   │  12 sections,         │
                   │  authored from Brief) │
                   └───────────┬───────────┘
                               │
                               ▼
                   ┌───────────────────────┐
                   │  CAPABILITY CATALOGUE │
                   │  (defined conditions, │
                   │  evidence, refusal    │
                   │  and escalation       │
                   │  criteria)            │
                   └───────────┬───────────┘
                               │
                               ▼
                   ┌───────────────────────┐
                   │   AUTHORITY MATRIX    │
                   │  (decide / recommend  │
                   │  / approve / escalate │
                   │  / never — per domain)│
                   └───────────┬───────────┘
                               │
                               ▼
                   ┌───────────────────────┐
                   │   RUNTIME MANIFEST    │
                   │  (compiled subset —   │
                   │  identity, selected   │
                   │  principles, caps,    │
                   │  authority codes,     │
                   │  hard stops)          │
                   └───────────┬───────────┘
                               │
                               ▼
                   ┌───────────────────────┐
                   │      EXECUTION        │
                   │  (OpenClaw runtime,   │
                   │  task dispatcher,     │
                   │  live operation)      │
                   └───────────────────────┘
```

---

## Runtime Inheritance

The following diagram shows what actually reaches the execution runtime at each layer.

```
CONSTITUTIONAL LAYER                        → Selected statements compiled into manifest
  NeedsOps Professional Constitution            (8 constitutional principles — selected)
  Executive Operating System                    (executive operating principles — selected)
  Universal Decision Hierarchy                  (priority reference — compiled)

DESIGN LAYER                               → Does NOT enter the runtime
  Professional Design Brief                     (founder documentation only)
  Professional Evidence Register                (founder documentation only)
  Employee File                                 (platform layer — not runtime)

PLATFORM LAYER                             → Identifiers and codes enter the runtime
  Capability Catalogue                          (capability codes)
  Authority Matrix                              (authority codes)
  Responsibility Matrix                         (escalation triggers)

RUNTIME LAYER                              → Full content in the runtime
  Runtime Manifest                              (compiled package — identity, capabilities,
                                                boundaries, authority, hard stops,
                                                selected constitutional statements)
```

---

## Documentation Hierarchy

```
docs/workforce/
├── framework/                          ← Shared governance (this directory)
│   ├── README.md                       ← This document
│   ├── SharedProfessionalConstitution.md    ← Constitutional foundation
│   ├── ExecutiveOperatingSystem.md          ← Executive reasoning framework
│   ├── UniversalDecisionHierarchy.md        ← 15-level decision sequence
│   ├── GovernanceRules.md                   ← Binding governance rules
│   ├── ProfessionalDesignLifecycle.md       ← 12-stage design pipeline
│   ├── SpecialistReadinessAssessment.md     ← Framework completeness gate
│   ├── professional-design-brief-template.md
│   ├── capability-definition-template.md
│   ├── responsibility-matrix-template.md
│   ├── authority-matrix-template.md
│   ├── collaboration-matrix-template.md
│   ├── professional-competency-model-template.md
│   └── schema-extension-recommendations.md
│
├── chief-of-staff/                     ← Role-specific artefacts
│   ├── DesignBrief.md
│   └── EmployeeFile.md
│
├── executive-assistant/                ← Role-specific artefacts
│   ├── DesignBrief.md
│   └── EmployeeFile.md
│
└── [specialist-name]/                  ← One directory per specialist
    ├── DesignBrief.md                  ← Populated after founder workshop
    ├── EvidenceRegister.md             ← Evidence quality documentation
    ├── EmployeeFile.md                 ← Authored after Brief approval
    ├── CapabilityCatalogue.md          ← One definition per capability
    ├── AuthorityMatrix.md              ← Decision authority structure
    └── CollaborationMatrix.md          ← Working relationships
```

---

## Framework Documents

### Tier 1 — Constitutional (Founder-Approved, Immutable)

| # | Document | Purpose | Status |
|---|----------|---------|--------|
| 1 | [NeedsOps Professional Constitution](./SharedProfessionalConstitution.md) | Immutable organisational values, ethics, and professional standards governing every AI Employee | ✅ Approved |
| 2 | [Executive Operating System](./ExecutiveOperatingSystem.md) | How executives reason — mindset, priority hierarchy, evidence hierarchy, decision criteria | ✅ Approved |
| 3 | [Universal Decision Hierarchy](./UniversalDecisionHierarchy.md) | 15-level mandatory reasoning sequence inherited by every specialist | ✅ Approved |
| 4 | [Governance Rules](./GovernanceRules.md) | Binding rules governing all artefacts from constitutional documents to runtime compilation | ✅ Approved |
| 5 | [Professional Design Lifecycle](./ProfessionalDesignLifecycle.md) | 12-stage lifecycle from Founder Workshop to Production — stages, gates, and responsibilities | ✅ Approved |
| 6 | [Specialist Readiness Assessment](./SpecialistReadinessAssessment.md) | Formal confirmation that shared framework is complete; gate to specialist workshops | ✅ Approved |

### Tier 2 — Design Templates (Architecture-Owned, In Use)

| # | Document | Purpose | Status |
|---|----------|---------|--------|
| 7 | [Professional Design Brief Template](./professional-design-brief-template.md) | 26-section founder-completed design document. Source for every Employee File. | ✅ In use |
| 8 | [Capability Definition Template](./capability-definition-template.md) | Conditions, evidence, refusal and escalation criteria per capability. | ✅ In use |
| 9 | [Responsibility Matrix Template](./responsibility-matrix-template.md) | RACI-extended responsibility ownership per domain. | ✅ In use |
| 10 | [Authority Matrix Template](./authority-matrix-template.md) | Decision authority codes and approval thresholds. | ✅ In use |
| 11 | [Collaboration Matrix Template](./collaboration-matrix-template.md) | Working relationships across all roles. | ✅ In use |
| 12 | [Professional Competency Model Template](./professional-competency-model-template.md) | Knowledge sources, evidence requirements, expected outputs, quality standards. | ✅ In use |
| 13 | [Schema Extension Recommendations](./schema-extension-recommendations.md) | What extends the platform schema vs. stays as founder documentation. | ✅ In use |

---

## Tier Model

| Tier | Description | Location | Runtime? |
|------|-------------|----------|----------|
| **1 — Constitutional** | Immutable founder-approved governance. Never contradicted by any lower layer. | `docs/workforce/framework/` | Selected statements only |
| **2 — Design** | Professional knowledge structured by architecture from founder workshops. Source of professional truth. | `docs/workforce/[role]/` | No |
| **3 — Platform** | Employee File and DNA schema fields. Configuration-time data, not runtime content. | `lib/workforce-dna/src/` | No |
| **4 — Runtime** | Compiled Runtime Manifest. Sent to the execution engine. Minimal — identity, capabilities, authority codes, selected constitutional statements, hard stops. | `compileRuntimeManifest()` output | Yes |

---

## Using This Framework

### Starting a new specialist

1. Confirm the shared framework covers the specialist's domain — consult the [Specialist Readiness Assessment](./SpecialistReadinessAssessment.md)
2. Conduct a **Founder Workshop** — founder provides the professional knowledge
3. Structure workshop output into a **Professional Design Brief** using the template
4. Complete the **Professional Evidence Register** alongside the Brief
5. Submit for **Founder Approval** — no Employee File work begins until approved
6. Author the **Employee File** from the approved Brief
7. Complete **Capability Definitions** for every capability the specialist holds
8. Complete the **Authority Matrix** and **Responsibility Matrix**
9. Submit the full package for **Founder Approval**
10. Engineering compiles the **Runtime Manifest** from the approved package
11. Architecture validates the manifest against the Employee File
12. Engineering executes the test suite; architecture reviews professional quality
13. Production deployment with ongoing monitoring

Full stage detail, quality gates, and responsibility assignments: [Professional Design Lifecycle](./ProfessionalDesignLifecycle.md).

### Modifying an existing specialist

See the Change Governance section of the [Professional Design Lifecycle](./ProfessionalDesignLifecycle.md).

All substantive changes require founder approval. Bug fixes (no design change) require architecture review and test clearance.

---

## Key Rules

- **No Employee File without an approved Design Brief.** No exceptions.
- **Constitutional documents cannot be contradicted.** Role-specific behaviour that conflicts with the Constitution is corrected before the specialist is activated.
- **Workshop notes never become runtime instructions.** All workshop content passes through the formal design pipeline.
- **Legislative obligations override organisational policy.** Always.
- **Participant safety overrides operational convenience.** Always.
- **Runtime Manifests compile selected principles only.** Full constitutional documents do not enter the runtime.
- **Design artefacts are founder-owned.** Engineering implements; founders own the content.

Full governance rules: [Governance Rules](./GovernanceRules.md).

---

## Framework Status

| Component | Version | Status |
|-----------|---------|--------|
| Professional Constitution | 1.0.0 | ✅ Founder-Approved |
| Executive Operating System | 1.0.0 | ✅ Founder-Approved |
| Universal Decision Hierarchy | 1.0.0 | ✅ Founder-Approved |
| Governance Rules | 1.0.0 | ✅ Founder-Approved |
| Professional Design Lifecycle | 1.0.0 | ✅ Founder-Approved |
| Specialist Readiness Assessment | 1.0.0 | ✅ Approved — framework complete |
| Design Brief Template | 1.0.0 | ✅ In use |
| Chief of Staff Employee File | Active | ✅ Implemented |
| Executive Assistant Employee File | Active | ✅ Implemented |
| Operations Manager | — | 🔵 Next — awaiting workshop |
| Incident Management Specialist | — | ⬜ Queued |
| Progress Note Specialist | — | ⬜ Queued |
| Support Plan Reviewer | — | ⬜ Queued |

---

## Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | August 2026 | Initial framework with design templates |
| 2.0.0 | August 2026 | Added constitutional layer — Professional Constitution, Executive Operating System, Universal Decision Hierarchy, Governance Rules, Professional Design Lifecycle, Specialist Readiness Assessment. Updated inheritance model, runtime diagrams, documentation hierarchy, and tier model. |

---

*NeedsOps Digital Workforce Professional Design Framework v2.0.0*  
*Constitutional layer founder-approved August 2026.*  
*Framework confirmed complete for specialist workshop commencement.*
