# DNA Design Status — Sprint 11 Workforce

**As of:** Sprint 11  
**Total Active Employees:** 17  
**DNA Approved:** 2  
**DNA Pending Design:** 15

This document tracks the DNA design status for every active employee in the NeedsOps AI+ v2 workforce catalogue. It also notes what DNA design work is required for pending employees, and which historical DNA versions (if any) can be used as a starting point.

---

## Status Overview

| Employee Code | Display Name | DNA Status | Historical Reference |
|--------------|-------------|------------|---------------------|
| `chief_of_staff` | Chief of Staff | ✅ Approved (v1.0.0) | — |
| `executive_assistant` | Executive Assistant | ⏳ Pending Design | — |
| `compliance_quality_manager` | Compliance and Quality Manager | ⏳ Pending Design | compliance_officer DNA v1.0.0 (starting point) |
| `incident_safeguarding_specialist` | Incident and Safeguarding Specialist | ⏳ Pending Design | — |
| `policy_governance_specialist` | Policy and Governance Specialist | ⏳ Pending Design | — |
| `operations_manager` | Operations Manager | ✅ Approved (v1.0.0) | — |
| `service_delivery_coordinator` | Service Delivery Coordinator | ⏳ Pending Design | — |
| `workforce_rostering_coordinator` | Workforce Rostering Coordinator | ⏳ Pending Design | — |
| `process_asset_coordinator` | Process and Asset Coordinator | ⏳ Pending Design | — |
| `finance_officer` | Finance Officer | ⏳ Pending Design | — |
| `payroll_workforce_cost_officer` | Payroll and Workforce Cost Officer | ⏳ Pending Design | — |
| `financial_planning_reporting_manager` | Financial Planning and Reporting Manager | ⏳ Pending Design | — |
| `people_culture_manager` | People and Culture Manager | ⏳ Pending Design | — |
| `talent_learning_specialist` | Talent and Learning Specialist | ⏳ Pending Design | — |
| `workforce_compliance_specialist` | Workforce Compliance Specialist | ⏳ Pending Design | — |
| `marketing_communications_manager` | Marketing and Communications Manager | ⏳ Pending Design | — |
| `knowledge_documentation_specialist` | Knowledge and Documentation Specialist | ⏳ Pending Design | document_specialist DNA v1.0.0 (starting point) |

---

## Approved DNA Profiles

### Chief of Staff (`chief_of_staff`)

- **DNA Version:** 1.0.0  
- **Status:** ✅ Approved — active and available for execution  
- **Capabilities:** Routing, orchestration, summarisation  
- **DNA Notes:** Full DNA profile with reasoning methodology, hard stops, evidence standards, and security constraints. Actively used in production.

### Operations Manager (`operations_manager`)

- **DNA Version:** 1.0.0  
- **Status:** ✅ Approved — active and available for execution  
- **Capabilities:** Roster review, workflow creation, capacity analysis, service delivery review  
- **DNA Notes:** Full DNA profile including SCHADS award awareness, operational reasoning methodology, hard stops for financial decisions, and evidence standards for workforce data.

---

## Pending DNA Profiles — Design Work Required

### Executive Assistant (`executive_assistant`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity and domain: executive support for NDIS provider leadership
  - Specify reasoning methodology for calendar management and scheduling
  - Define hard stops: cannot send external communications without human review, cannot make commitments on behalf of leadership
  - Draft evidence standards for communications drafting
  - Define security constraints: access to calendar data, communications channels
  - Expand scope to cover absorbed Calendar Specialist and Communication Specialist capabilities

---

### Compliance and Quality Manager (`compliance_quality_manager`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** `compliance_officer` DNA v1.0.0 — can be used as starting point  
- **Design Work Required:**
  - Import and expand compliance_officer hard stops (must not suppress reportable events, must not submit to NDIS Commission autonomously)
  - Add quality management reasoning methodology (practice standard reviews, quality improvement cycles)
  - Add corrective action tracking capabilities and boundaries
  - Update identity to reflect merged scope: compliance + quality + corrective action
  - Preserve NDIS regulatory knowledge from compliance_officer DNA
  - Ensure evidence standards cover both compliance evidence and quality metrics

> **Note:** The `compliance_officer` DNA v1.0.0 is preserved as a reference in the historical DNA registry. The new DNA for `compliance_quality_manager` should extend and expand this base, not replace it wholesale.

---

### Incident and Safeguarding Specialist (`incident_safeguarding_specialist`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None (new consolidated role)  
- **Design Work Required:**
  - Define identity: incident investigation, safeguarding oversight, restrictive practice review
  - Hard stop: cannot submit to NDIS Commission autonomously — must always route for human approval
  - Hard stop: cannot close or archive incidents without sign-off
  - Reasoning methodology for incident classification (reportable vs. non-reportable)
  - Evidence standards for incident documentation
  - Security constraints: access to incident records, participant data handling rules

---

### Policy and Governance Specialist (`policy_governance_specialist`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: policy drafting, governance frameworks, regulatory research
  - Hard stop: cannot approve or publish policies — all policy changes require human sign-off
  - Hard stop: must not invent or misrepresent regulatory requirements
  - Reasoning methodology for policy gap analysis and research
  - Evidence standards: must cite authoritative sources (NDIS Practice Standards, legislation, official guidance)
  - Research capability boundaries aligned with Sprint 11 research.general remapping

---

### Service Delivery Coordinator (`service_delivery_coordinator`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: NDIS service delivery coordination and participant outcome monitoring
  - Reasoning methodology for service delivery review and workflow documentation
  - Hard stops: cannot make commitments to participants, cannot modify support plans without authorisation
  - Evidence standards for service delivery reporting

---

### Workforce Rostering Coordinator (`workforce_rostering_coordinator`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: staff roster management, shift allocation, SCHADS award compliance in scheduling
  - SCHADS Award awareness (rates, penalty rates, minimum engagement)
  - Reasoning methodology for roster conflict resolution
  - Hard stops: cannot approve rosters — must route for manager sign-off
  - Evidence standards: reference SCHADS award documents for compliance claims

---

### Process and Asset Coordinator (`process_asset_coordinator`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: workflow design, process documentation, asset tracking
  - Reasoning methodology for workflow optimisation and asset lifecycle management
  - Hard stops: cannot approve procurement — must route for manager approval
  - Evidence standards for process documentation

---

### Finance Officer (`finance_officer`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: NDIS invoice review, accounts reconciliation, financial reporting
  - **Critical hard stop: cannot release payments — review only**
  - **Critical hard stop: cannot initiate fund transfers**
  - Reasoning methodology for invoice validation against NDIS price guide
  - Evidence standards: invoice data, service agreements, NDIS claiming records
  - Security constraints: read-only access to financial systems

---

### Payroll and Workforce Cost Officer (`payroll_workforce_cost_officer`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: payroll analysis, workforce cost review, SCHADS award compliance
  - **Critical hard stop: cannot transfer funds — analysis only**
  - **Critical hard stop: cannot run or finalise a payroll cycle**
  - SCHADS Award knowledge (classification levels, allowances, penalty rates)
  - Reasoning methodology for payroll discrepancy identification
  - Security constraints: read-only access to payroll system data

---

### Financial Planning and Reporting Manager (`financial_planning_reporting_manager`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: budget analysis, financial planning, board-level reporting
  - Hard stops: cannot approve budget changes, cannot release financial commitments
  - Reasoning methodology for variance analysis and financial forecasting
  - Evidence standards for financial reports (must use verified financial data only)
  - Security constraints: read-only access to financial data

---

### People and Culture Manager (`people_culture_manager`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: HR administration, policy review, employee relations support
  - Hard stops: cannot make employment decisions (hire, terminate, discipline)
  - Reasoning methodology for HR policy review and employee relations guidance
  - Evidence standards: must reference Fair Work Act, NDIS workforce standards
  - Security constraints: access to HR records, confidentiality requirements

---

### Talent and Learning Specialist (`talent_learning_specialist`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: recruitment support, learning coordination, performance cycle management
  - Hard stops: cannot make hiring decisions, cannot finalise performance ratings without manager sign-off
  - Reasoning methodology for candidate screening and learning needs analysis
  - Evidence standards for performance documentation
  - Three absorbed roles (recruitment, learning, performance) — ensure all capability domains covered

---

### Workforce Compliance Specialist (`workforce_compliance_specialist`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: NDIS worker screening, credential verification, staff compliance monitoring
  - Hard stop: cannot approve worker screening outcomes — must flag for human decision
  - Reasoning methodology for compliance gap identification in staff records
  - Evidence standards: NDIS Worker Screening Database, credential verification sources
  - Security constraints: access to sensitive staff credential data

---

### Marketing and Communications Manager (`marketing_communications_manager`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** None  
- **Design Work Required:**
  - Define identity: marketing strategy, brand, content, campaigns, social media — all consolidated
  - **Critical hard stop: regulated claims require approval before publication**
  - **Critical hard stop: participant-identifiable content requires privacy clearance**
  - Reasoning methodology for campaign planning and brand consistency
  - Evidence standards for marketing claims (must not make unsubstantiated therapeutic or outcome claims)
  - NDIS marketing compliance awareness (advertising restrictions for disability service providers)

---

### Knowledge and Documentation Specialist (`knowledge_documentation_specialist`)

- **DNA Status:** ⏳ Pending Design  
- **Historical Reference:** `document_specialist` DNA v1.0.0 — can be used as starting point  
- **Design Work Required:**
  - Import and expand document_specialist DNA (document creation, formatting, review)
  - Add knowledge management capabilities: organisational knowledge structuring, knowledge base maintenance
  - Hard stop: cannot draft policies without approved subject-matter input
  - Hard stop: cannot publish or finalise documents without human review
  - Expand evidence standards to cover knowledge base content quality
  - Update identity to reflect knowledge management scope beyond document creation

> **Note:** The `document_specialist` DNA v1.0.0 is preserved as a reference in the historical DNA registry. The new DNA for `knowledge_documentation_specialist` should extend this base with knowledge management reasoning and broader organisational scope.

---

## Historical DNA Preserved as References

| Historical DNA | Version | Preserved For | Notes |
|---------------|---------|---------------|-------|
| `compliance_officer` | v1.0.0 | `compliance_quality_manager` design | Full NDIS compliance DNA with hard stops, NDIS regulatory knowledge, evidence standards |
| `document_specialist` | v1.0.0 | `knowledge_documentation_specialist` design | Document creation reasoning, formatting standards, review methodology |
| `chief_of_staff` | v1.0.0 | Production (approved) | In active use |
| `operations_manager` | v1.0.0 | Production (approved) | In active use |

---

## Priority Order for DNA Design

Based on business impact and activation urgency:

| Priority | Employee Code | Rationale |
|----------|--------------|-----------|
| 1 | `executive_assistant` | Core pack — needed for every organisation |
| 2 | `compliance_quality_manager` | High-demand compliance capability, reference DNA available |
| 3 | `knowledge_documentation_specialist` | Core pack — reference DNA available |
| 4 | `incident_safeguarding_specialist` | Critical safety function, high regulatory risk |
| 5 | `policy_governance_specialist` | Compliance dependency |
| 6 | `finance_officer` | High business value, payment boundary critical |
| 7 | `workforce_rostering_coordinator` | Operational dependency |
| 8 | `people_culture_manager` | HR administration demand |
| 9 | `payroll_workforce_cost_officer` | Finance dependency |
| 10 | `service_delivery_coordinator` | Service operations |
| 11 | `process_asset_coordinator` | Operational support |
| 12 | `financial_planning_reporting_manager` | Reporting dependency |
| 13 | `talent_learning_specialist` | HR development |
| 14 | `workforce_compliance_specialist` | Staff compliance monitoring |
| 15 | `marketing_communications_manager` | Marketing — lower operational urgency |

---

*DNA profiles must be designed, reviewed, and approved before an employee's `dnaStatus` can change from `pending_design` to `approved`. Dispatch protection blocks any employee with `dnaStatus: "pending_design"` from execution-level tasks.*
