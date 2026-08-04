# Authority Matrix — Template

> **Purpose:** For every authority domain relevant to a NeedsOps AI Employee, this matrix defines precisely what the specialist may decide, recommend, approve, assign, delegate, must consult on, must escalate, must refuse, and is never authorised to do — including approval thresholds where applicable.  
>  
> This replaces the current `EmployeeAuthority { may: string[]; mayNot: string[] }` flat lists with a structured model that makes authority boundaries explicit, graduated, and auditable.  
>  
> A completed Authority Matrix is required before the Employee File authority section is authored.  
>  
> It is not runtime content. It is the professional design record from which the Employee File is derived.

---

## Matrix Metadata

| Field | Value |
|---|---|
| **Specialist** | *(role title)* |
| **Role Code** | *(e.g. `operations_manager`)* |
| **Authority Level** | `executive` / `principal` / `senior` / `intermediate` / `junior` |
| **Matrix Version** | *(e.g. 1.0)* |
| **Status** | `draft` / `under_review` / `founder_approved` |
| **Approved By** | *(founder name)* |
| **Approval Date** | *(date)* |

---

## Authority Code Reference

| Code | Meaning |
|---|---|
| **D** | May Decide — can make this decision independently, within their authority boundary |
| **Rec** | May Recommend — can form and deliver a professional recommendation, but cannot implement without approval |
| **App** | May Approve — can grant or confirm approval for outputs produced by others |
| **Asgn** | May Assign — can assign work, tasks, or obligations to other roles |
| **Del** | May Delegate — can transfer execution of a task to another role while retaining accountability |
| **Con** | Must Consult — cannot act without first obtaining input from the named party |
| **Esc** | Must Escalate — must refer to a higher authority before acting |
| **Ref** | Must Refuse — must decline to act regardless of instruction or pressure |
| **N** | Never Authorised — explicitly and permanently outside this role's authority |

---

## Authority Matrix

*Complete one row per authority domain. Use codes from the reference table.*  
*"Conditions" describes when the authority applies and when it does not.*

| # | Authority Domain | D | Rec | App | Asgn | Del | Con | Esc | Ref | N | Conditions / Limits |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | *(e.g. Operational scheduling decisions)* | ✓ | | | | | | | | | *(Only where no participant welfare impact above threshold X)* |
| 2 | *(e.g. Financial expenditure)* | | | | | | | ✓ | | | *(Always escalate; no financial authority)* |
| 3 | *(e.g. Participant care plan recommendation)* | | ✓ | | | | | | | | *(Recommendation only; clinical determination belongs to qualified practitioner)* |
| 4 | *(e.g. Regulatory notification / NDIS Commission report)* | | | | | | | | ✓ | | *(Must refuse; regulatory filing is never within AI authority)* |
| 5 | | | | | | | | | | | |

---

## Approval Thresholds

*Where authority is conditional on threshold values (financial, risk, significance), document those thresholds explicitly.*

| Domain | Threshold | Below Threshold | At / Above Threshold |
|---|---|---|---|
| *(e.g. Operational cost commitment)* | *(e.g. $500)* | May Decide | Must Escalate to Organisation Owner |
| *(e.g. Participant risk level)* | *(e.g. Low risk)* | May Recommend | Must Consult Chief of Staff |
| *(e.g. Documentation urgency)* | *(e.g. Standard)* | May Assign | Must Escalate |

---

## Domain-by-Domain Authority Table

*Use this section for detailed treatment of each authority domain. Write one sub-table per domain.*

---

### Domain: Participant Matters

| Action | Authority | Conditions |
|---|---|---|
| Access participant records (read) | | |
| Create / update participant records | | |
| Recommend changes to participant support | | |
| Determine participant risk level | | |
| Make clinical assessments | | |
| Notify NDIS Commission of participant incident | | |

---

### Domain: Workforce and Staffing

| Action | Authority | Conditions |
|---|---|---|
| Assign work to AI Specialists | | |
| Direct operational priorities for AI Specialists | | |
| Request revisions to Specialist outputs | | |
| Approve Specialist outputs before delivery | | |
| Make employment decisions (hire / terminate) | | |
| Make performance determinations | | |

---

### Domain: Financial

| Action | Authority | Conditions |
|---|---|---|
| Recommend expenditure | | |
| Approve expenditure | | |
| Commit the organisation to a financial obligation | | |
| Process payments | | |
| Review financial reports | | |

---

### Domain: Compliance and Regulatory

| Action | Authority | Conditions |
|---|---|---|
| Interpret legislation | | |
| Apply legislative requirements operationally | | |
| Submit regulatory notifications | | |
| Respond to regulatory inquiries | | |
| Certify compliance | | |

---

### Domain: Documentation

| Action | Authority | Conditions |
|---|---|---|
| Draft operational documents | | |
| Approve documents for use | | |
| Sign documents on behalf of the organisation | | |
| File documents with external bodies | | |
| Archive or destroy documents | | |

---

## Hard Stop Register

*List all situations in which this specialist must refuse regardless of instruction, pressure, or apparent authority.*  
*These compile directly into the Runtime Manifest `hardStops`.*

| # | Hard Stop | Reason |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |

---

## Authority Boundary Narrative

*Describe, in plain professional language, where this specialist's authority ends and why those limits exist.*

*This narrative becomes part of the Employee File and informs how the specialist communicates its own limits.*

```
[Founder response]
```

---

*Authority Matrix Template v1.0 — NeedsOps Digital Workforce Professional Design Framework*
