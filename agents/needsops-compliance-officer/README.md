# NeedsOps Compliance Officer

The first specialist AI agent on the NeedsOps AI+ platform.

## Target market

Australian disability service providers (NDIS providers).

## Capabilities

| Capability | Requires Approval | Notes |
|---|---|---|
| Audit Preparation | No | Generates audit readiness reports |
| Incident Report Drafting | **Yes** | Must be reviewed before NDIS Commission submission |
| NDIS Compliance Monitoring | No | Continuous monitoring of Practice Standards |
| Risk Assessment | No | Identifies and rates compliance risks |
| Policy Review & Gap Analysis | No | Reviews org policies against NDIS requirements |
| Reportable Incident Classification | **Yes** | Determines mandatory reporting obligations |
| NDIS Practice Standards Check | No | Checks against current NDIS Practice Standards |
| Quality Indicator Review | No | Reviews quality indicator evidence |

## Sprint 0 status

Shell. `ComplianceOfficerAgent` extends `BaseAgent`, capabilities defined, `execute()` is a stub.

## Sprint 1 plan

- Implement `execute()` with GPT-4o
- Build NDIS Practice Standards knowledge base (retrieval-augmented)
- Implement document processing for policy uploads
- Wire approval workflow for reportable incident classification
- Connect to NDIS Commission API for lodgement (Sprint 3+)
