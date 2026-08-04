# Capability Definition — Template

> **Purpose:** Every capability available to a NeedsOps AI Employee must be defined using this template before it is registered in the Employee File or Worker Profile.  
>  
> A capability definition describes what the specialist can do, under what conditions, with what evidence, and when they must refuse or escalate.  
>  
> Capability definitions are not runtime content — they are the professional specification from which capability codes are compiled.  
>  
> **No capability may be added to a Worker Profile without a completed, approved definition.**

---

## Capability Metadata

| Field | Value |
|---|---|
| **Capability Name** | *(human-readable, e.g. "NDIS Progress Note — Structured Review")* |
| **Capability Code** | *(machine code, e.g. `documentation.progress_note.structured_review`)* |
| **Specialist(s)** | *(which Employee File(s) this applies to)* |
| **Domain** | *(e.g. Documentation / Clinical / Compliance / Finance / Operations)* |
| **Version** | *(e.g. 1.0)* |
| **Status** | `draft` / `under_review` / `approved` / `active` / `deprecated` |
| **Approved By** | *(founder name)* |
| **Approval Date** | *(date)* |

---

## 1 — Purpose

*Why does this capability exist? What professional need does it meet?*

*One or two sentences. Not a feature description — a professional rationale.*

```
[Founder response]
```

---

## 2 — Description

*What does this capability do? Describe it from the perspective of the Organisation Owner: what will they receive, what will happen, what professional task is being completed?*

*Be specific. Do not describe implementation. Describe professional outcome.*

```
[Founder response]
```

---

## 3 — Inputs

*What does the specialist need before this capability can begin?*

*For each input: is it required or optional? What format? Who provides it?*

| Input | Required / Optional | Expected Format | Provided By |
|---|---|---|---|
| | | | |
| | | | |
| | | | |

---

## 4 — Outputs

*What does this capability produce?*

*For each output: describe the professional quality standard expected.*

| Output | Type | Quality Standard | Recipient |
|---|---|---|---|
| | Document / Decision / Recommendation / Action / Record | | |
| | | | |

---

## 5 — Required Evidence

*What evidence must be present and reviewed before this capability can produce a credible output?*

*These are professional evidence requirements — not data field requirements. "Participant's current support plan, dated within the last 12 months" is useful. "Participant ID" is not.*

| # | Evidence | Why required | What to do if unavailable |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## 6 — Required Legislation / Regulation

*What legislation, NDIS rules, standards, or regulatory instruments govern how this capability is exercised?*

*For each: is the specialist expected to apply it directly, or defer to a human authority?*

| Instrument | Jurisdiction | Application (direct / defer) | Escalation if unclear |
|---|---|---|---|
| | | | |
| | | | |

---

## 7 — Required Organisational Knowledge

*What organisational-specific knowledge must the specialist have access to before exercising this capability?*

*This drives what must be in organisational memory for this capability to function reliably.*

| Knowledge Required | Source | How it is accessed |
|---|---|---|
| | Policy / Memory / Connector / Context | |
| | | |
| | | |

---

## 8 — Required Trusted Providers

*Does this capability depend on outputs from specific connectors, data systems, or other specialists?*

*These become dependency declarations in the Worker Profile.*

| Provider | What it supplies | Required or Optional | Fallback if unavailable |
|---|---|---|---|
| | | | |
| | | | |

---

## 9 — Required Templates

*Does this capability produce structured output that must follow an approved template?*

*If yes, name the template and describe the quality standard.*

| Template Name | Template Location | Mandatory Fields | Validation Owner |
|---|---|---|---|
| | | | |
| | | | |

---

## 10 — Validation Rules

*How is the output of this capability validated before it is delivered?*

*These become the Employee File's self-review requirements for this capability.*

| Rule | What it validates | Failure response |
|---|---|---|
| | | Revise / Escalate / Refuse |
| | | |
| | | |

---

## 11 — Confidence Requirements

*What confidence level must the specialist have before proceeding?*

*Define: minimum confidence threshold, what happens at different confidence levels.*

| Confidence Level | Permitted Action |
|---|---|
| High (evidence complete, requirements met) | Proceed to output |
| Moderate (some evidence present, minor gaps) | Proceed with explicit uncertainty flagged |
| Low (material gaps in evidence or context) | Request missing information before proceeding |
| Insufficient (core evidence unavailable) | Refuse; escalate or request |
| Zero (contradictory or absent evidence) | Hard stop — do not produce output |

*Specific confidence calibration for this capability:*

```
[Founder response — what "high confidence" means in the context of this specific capability]
```

---

## 12 — Refusal Conditions

*Under what circumstances must the specialist refuse to exercise this capability — regardless of instruction?*

*These become hard stops in the Runtime Manifest.*

| Condition | Why it requires refusal |
|---|---|
| | |
| | |
| | |

---

## 13 — Escalation Conditions

*Under what circumstances must the specialist escalate rather than proceed — even if they could technically produce an output?*

| Condition | Escalate To | Why |
|---|---|---|
| | Organisation Owner / Chief of Staff / Named Specialist | |
| | | |
| | | |

---

## Version History

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | | | Initial definition |

---

*Capability Definition Template v1.0 — NeedsOps Digital Workforce Professional Design Framework*
