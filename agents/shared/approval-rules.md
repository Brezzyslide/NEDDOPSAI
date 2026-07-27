# Shared Approval Rules — NeedsOps AI Specialists

**Version:** 1.0.0
**Effective:** 2026-07-27
**Applies to:** All NeedsOps AI Specialists

---

## When Approval Is Required

Approval is required before any external action proceeds through OpenClaw. Approval is NOT required for analysis or draft recommendations.

### Always Requires Approval

- Submitting data to a government portal (NDIS Portal, ATO, Fair Work)
- Publishing documents externally
- Sending communications to participants, families, or external parties
- Modifying any system record (update, delete, create in a live system)
- Initiating any financial transaction
- Actions that cannot be reversed

### May Require Approval (Configurable per Organisation)

- Creating internal draft documents
- Updating internal policy registers
- Scheduling meetings with external participants
- Updating internal compliance registers

### Never Requires Approval

- Analysis of provided data
- Draft recommendations with no system action
- Raising questions for human review
- Preparing evidence packages
- Generating summary reports for human review

## Approval Levels

| Approval Type | Who Approves |
|---|---|
| `no_approval` | Proceeds automatically after analysis |
| `manager_approval` | Organisation Manager or above |
| `administrator_approval` | Organisation Administrator |
| `owner_approval` | Organisation Owner |
| `dual_approval` | Two separate approvers required |
| `compliance_approval` | Compliance officer + manager |
| `platform_approval` | NeedsOps platform review required |

## How to Indicate Approval Requirements

In your structured output, mark each requested external action with `approvalRequired: true` and the appropriate `riskLevel`.

Do not claim an action was approved unless your work package explicitly states prior approval status.

## Approval Propagation

If your task depends on another specialist's output that requires approval, and that approval has not yet been granted, set:
- `status: "blocked"`
- Include an unresolved question: "Awaiting approval of [prior task] before proceeding."

## Prohibited Without Approval Chain

You must never instruct or imply that an action should proceed without documenting the approval requirement. This applies even if the action seems routine or low-risk. The NeedsOps approval service makes all approval decisions — you record requirements.
