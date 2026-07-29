# Specialist Consolidation Map — Sprint 11 (32 → 17)

**Sprint:** 11  
**Change:** 32 original roles consolidated to 17 roles  
**Total entries preserved (deprecated):** 28  
**New roles (renamed/merged):** 17

This document provides a complete map of all 32 original specialist roles and their destination in the v2 catalogue.

---

## Consolidation Table

| Original Role | Original Code | Destination | Destination Code | Reason |
|--------------|---------------|-------------|-----------------|--------|
| Chief of Staff | `chief_of_staff` | Chief of Staff | `chief_of_staff` | Retained — core orchestrator |
| Executive Assistant | `executive_assistant` | Executive Assistant | `executive_assistant` | Retained — expanded scope |
| Research Specialist | `research_specialist` | *(Distributed)* | `null` | Capability distribution — research absorbed into compliance, policy, and knowledge roles |
| Document Specialist | `document_specialist` | Knowledge and Documentation Specialist | `knowledge_documentation_specialist` | Merged — scope expanded to include knowledge management |
| Calendar Specialist | `calendar_specialist` | Executive Assistant | `executive_assistant` | Merged — calendar is a core EA function |
| Communication Specialist | `communication_specialist` | Executive Assistant | `executive_assistant` | Merged — communications drafting is a core EA function |
| Compliance Officer | `compliance_officer` | Compliance and Quality Manager | `compliance_quality_manager` | Merged — compliance + quality unified under one manager |
| Quality Officer | `quality_officer` | Compliance and Quality Manager | `compliance_quality_manager` | Merged — quality assessment unified with compliance |
| Policy Officer | `policy_officer` | Policy and Governance Specialist | `policy_governance_specialist` | Merged — policy governance is a distinct domain |
| Incident Review Officer | `incident_review_officer` | Incident and Safeguarding Specialist | `incident_safeguarding_specialist` | Merged — incidents and safeguarding unified |
| Corrective Action Officer | `corrective_action_officer` | Compliance and Quality Manager | `compliance_quality_manager` | Merged — corrective action is part of compliance management |
| Restrictive Practice Officer | `restrictive_practice_officer` | Incident and Safeguarding Specialist | `incident_safeguarding_specialist` | Merged — restrictive practices are a safeguarding concern |
| Operations Manager | `operations_manager` | Operations Manager | `operations_manager` | Retained — expanded responsibilities |
| Service Delivery Coordinator | `service_delivery_coordinator` | Service Delivery Coordinator | `service_delivery_coordinator` | Retained — unchanged |
| Roster Coordinator | `roster_coordinator` | Workforce Rostering Coordinator | `workforce_rostering_coordinator` | Renamed — clearer scope: workforce rostering |
| Asset Coordinator | `asset_coordinator` | Process and Asset Coordinator | `process_asset_coordinator` | Merged — assets and processes managed together |
| Workflow Coordinator | `workflow_coordinator` | Process and Asset Coordinator | `process_asset_coordinator` | Merged — workflow design unified with asset coordination |
| Accounts Officer | `accounts_officer` | Finance Officer | `finance_officer` | Merged — finance consolidated under one officer |
| Payroll Officer | `payroll_officer` | Payroll and Workforce Cost Officer | `payroll_workforce_cost_officer` | Renamed — scope expanded to workforce cost analysis |
| Invoice Specialist | `invoice_specialist` | Finance Officer | `finance_officer` | Merged — invoice review is a core finance function |
| Budget Analyst | `budget_analyst` | Financial Planning and Reporting Manager | `financial_planning_reporting_manager` | Merged — budgeting and reporting unified under manager |
| Financial Reporting Officer | `financial_reporting_officer` | Financial Planning and Reporting Manager | `financial_planning_reporting_manager` | Merged — financial reporting unified with planning |
| HR Officer | `hr_officer` | People and Culture Manager | `people_culture_manager` | Merged — HR administration elevated to P&C manager |
| Recruitment Officer | `recruitment_officer` | Talent and Learning Specialist | `talent_learning_specialist` | Merged — recruitment is part of talent management |
| Learning Coordinator | `learning_coordinator` | Talent and Learning Specialist | `talent_learning_specialist` | Merged — learning is part of talent development |
| Performance Officer | `performance_officer` | Talent and Learning Specialist | `talent_learning_specialist` | Merged — performance reviews are part of talent cycle |
| Staff Compliance Officer | `staff_compliance_officer` | Workforce Compliance Specialist | `workforce_compliance_specialist` | Renamed — clearer scope: workforce-specific compliance |
| Marketing Director | `marketing_director` | Marketing and Communications Manager | `marketing_communications_manager` | Merged — marketing leadership consolidated |
| Content Strategist | `content_strategist` | Marketing and Communications Manager | `marketing_communications_manager` | Merged — content is part of marketing communications |
| Campaign Manager | `campaign_manager` | Marketing and Communications Manager | `marketing_communications_manager` | Merged — campaign management is core marketing |
| Brand Manager | `brand_manager` | Marketing and Communications Manager | `marketing_communications_manager` | Merged — brand is part of marketing communications |
| Social Media Specialist | `social_media_specialist` | Marketing and Communications Manager | `marketing_communications_manager` | Merged — social media is a marketing communications channel |

---

## Consolidation Reasons — Definitions

| Reason | Description |
|--------|-------------|
| **Retained** | Role exists unchanged in v2. Code may be same or expanded. |
| **Renamed** | Role exists in v2 with a clearer code and display name. Capabilities are identical or slightly expanded. |
| **Merged** | Role's capabilities absorbed into a broader v2 role. Deprecated entry preserved for historical reference. |
| **Capability distribution** | Role's capabilities distributed across multiple v2 roles. No single replacement role. Alias resolution returns `null`. |

---

## Roles by Destination

| Destination (v2 Code) | Absorbed From (v1 Codes) | Net Change |
|----------------------|--------------------------|------------|
| `chief_of_staff` | *(self)* | No change |
| `executive_assistant` | `executive_assistant`, `calendar_specialist`, `communication_specialist` | +2 absorbed |
| `knowledge_documentation_specialist` | `document_specialist` | +1 absorbed, name changed |
| `compliance_quality_manager` | `compliance_officer`, `quality_officer`, `corrective_action_officer` | +2 absorbed |
| `incident_safeguarding_specialist` | `incident_review_officer`, `restrictive_practice_officer` | +1 absorbed (new role name) |
| `policy_governance_specialist` | `policy_officer` | Renamed |
| `operations_manager` | *(self)* | No change |
| `service_delivery_coordinator` | *(self)* | No change |
| `workforce_rostering_coordinator` | `roster_coordinator` | Renamed |
| `process_asset_coordinator` | `asset_coordinator`, `workflow_coordinator` | +1 absorbed, new role name |
| `finance_officer` | `accounts_officer`, `invoice_specialist` | +1 absorbed, name changed |
| `payroll_workforce_cost_officer` | `payroll_officer` | Renamed |
| `financial_planning_reporting_manager` | `budget_analyst`, `financial_reporting_officer` | +1 absorbed (new role name) |
| `people_culture_manager` | `hr_officer` | Renamed + elevated |
| `talent_learning_specialist` | `recruitment_officer`, `learning_coordinator`, `performance_officer` | +2 absorbed (new role name) |
| `workforce_compliance_specialist` | `staff_compliance_officer` | Renamed |
| `marketing_communications_manager` | `marketing_director`, `content_strategist`, `campaign_manager`, `brand_manager`, `social_media_specialist` | +4 absorbed |

---

## Special Case: research_specialist

The `research_specialist` role has been deprecated with `replacementType: "capability_distribution"`. Research capabilities were distributed as follows:

| Research Capability | Now Served By |
|--------------------|---------------|
| General research | `compliance_quality_manager`, `policy_governance_specialist` |
| Documentation research | `knowledge_documentation_specialist` |
| Orchestration-level research | `chief_of_staff` |

Calling `resolveAlias("research_specialist")` returns `null`. There is no single replacement role.

---

*All deprecated entries remain in the SPECIALISTS array with `executionStatus: "deprecated"` and `catalogueVersion: "1"` for historical audit and alias resolution purposes.*
