# NeedsOps Digital Workforce — Professional Design Framework

> **Version:** 1.0.0  
> **Status:** Draft — awaiting founder approval  
> **Purpose:** Reusable templates and standards for designing every NeedsOps AI Employee from founder-approved professional knowledge

---

## Overview

Every NeedsOps AI Employee is designed through a staged professional development lifecycle. No Employee File is authored until the preceding stage has been completed and approved.

```
Professional Design Workshop
        ↓
Professional Design Brief  (Founder-Approved)
        ↓
Employee File
        ↓
Capability Catalogue
        ↓
Authority Matrix
        ↓
Runtime Manifest
        ↓
Implementation
        ↓
Validation
        ↓
Production
```

---

## Framework Documents

| # | Document | Purpose |
|---|---|---|
| 1 | [Professional Design Brief Template](./professional-design-brief-template.md) | 26-section founder-completed design document that sits behind every Employee File. Never used as prompt content. The source from which the Employee File is derived. |
| 2 | [Capability Definition Template](./capability-definition-template.md) | Defines what a specialist can do, under what conditions, with what evidence, and when they must refuse or escalate. One file per capability code. |
| 3 | [Responsibility Matrix Template](./responsibility-matrix-template.md) | RACI-extended matrix defining primary ownership, shared ownership, consultation, approval, review, escalation, and never-owner status for every responsibility. |
| 4 | [Authority Matrix Template](./authority-matrix-template.md) | Structured authority domains with graduated codes (decide / recommend / approve / assign / delegate / consult / escalate / refuse / never authorised) and approval thresholds. |
| 5 | [Collaboration Matrix Template](./collaboration-matrix-template.md) | Working relationships between this specialist and every other role — reporting, delegation, review, consultation, cross-functional dependencies. |
| 6 | [Professional Competency Model Template](./professional-competency-model-template.md) | Structured competency definitions including knowledge sources, evidence requirements, validation requirements, trusted providers, expected outputs, and quality expectations. |
| 7 | [Schema Extension Recommendations](./schema-extension-recommendations.md) | Analysis of the existing Employee File, DNA, and Runtime Manifest schema against these new artefacts — recommending what should remain founder-only documentation, what should extend the platform schema, and what compiles to runtime. |

---

## Tier Model

All workforce design artefacts are classified into three tiers:

| Tier | Description | Location | Runtime? |
|---|---|---|---|
| **1 — Founder Documentation** | Design knowledge owned by the founder. The source of professional truth. Never enters any software system as instruction content. | `docs/workforce/[role]/` | No |
| **2 — Platform Layer** | Structured Employee File and DNA schema fields. Read at system configuration time. Used to build system instructions. Not sent to the Execution Runtime. | `lib/workforce-dna/src/` TypeScript types | No |
| **3 — Runtime Layer** | Compiled into the Runtime Manifest. Sent to OpenClaw / Task Dispatcher during execution. Minimal — identity, capabilities, boundaries, hard stops, constitution statements. | `compileRuntimeManifest()` output | Yes |

---

## Using This Framework

### For a new specialist

1. Conduct a Professional Design Workshop with the founder
2. Complete the **Professional Design Brief** using the template — every section
3. Submit for founder review and approval
4. Once the Brief is approved, author the **Employee File** using the Brief as source
5. Complete **Capability Definitions** for each capability the specialist will hold
6. Complete the **Responsibility Matrix** and **Authority Matrix**
7. Complete the **Collaboration Matrix**
8. Complete the **Professional Competency Model**
9. Submit all documents for founder approval before any implementation begins

### For an existing specialist

The Chief of Staff and Executive Assistant were designed before this framework existed. They are the reference implementations. Their Employee Files should be reviewed against this framework to identify gaps — but they must not be modified until a retrospective Design Brief has been completed and approved for each role.

---

## Rules

- No Employee File is authored without an approved Professional Design Brief
- No capability is added to a Worker Profile without a completed Capability Definition
- No specialist is activated without an approved Employee File
- Framework documents are founder-owned design artefacts — they are never used as prompt content, system instructions, or runtime configuration
- AI-generated content may be used to structure these documents but every substantive section must reflect founder-approved professional knowledge, not AI assumption

---

*NeedsOps Digital Workforce Professional Design Framework v1.0.0*  
*Built August 2026. Awaiting founder approval before first specialist workshop.*
