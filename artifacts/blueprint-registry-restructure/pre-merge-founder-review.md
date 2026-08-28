# Blueprint Pre-Merge Founder Review

No merge has been applied. These are review packs only.

## Risk Assessments

Founder decision needed: whether fire and site/environmental should split into a separate site-level Blueprint.

### Entries

| Code | Name | Purpose / description | Operations | Scopes | Specificity | Authority boundary |
|---|---|---|---|---|---|---|
| `community_access_risk_assessment` | Community Access Risk Assessment | Assess risks for a participant engaging in activities outside the home or service environment. | assess | community_access | participant_specific | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `fire_risk_assessment` | Fire Risk Assessment | Assess fire safety risks at a service site and document controls and evacuation arrangements. | assess | fire | both | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `participant_risk_assessment` | Participant Risk Assessment | Assess risks to a participant's safety and wellbeing, including physical, behavioural and environmental factors. | assess | behavioural, general, health, home | participant_specific | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `site_environmental_risk_assessment` | Site & Environmental Risk Assessment | Assess physical and environmental risks at a service site or participant residence. | assess | environmental, site | participant_specific | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |

### Deliverable / Section Comparison

Shared section-code percentage: **0%**

| Code | Section codes and headings |
|---|---|
| `community_access_risk_assessment` | RISK_CONTEXT: Risk Context; RISK_ANALYSIS: Risk Analysis; CONTROLS_AND_ESCALATION: Controls and Escalation |
| `fire_risk_assessment` | PARTICIPANT_SERVICE_FIRE_CONTEXT: Participant and Service Fire Context; CROSS_SYSTEM_FIRE_EVIDENCE: Cross-System Fire Evidence; FIRE_VULNERABILITY_EVACUATION_CAPACITY: Fire Vulnerability and Evacuation Capacity; PROPERTY_CONTROLS_AND_STAFFING: Property Controls and Staffing; CONFLICTS_RP_AND_ESCALATION: Evidence Conflicts, RP Interaction and Escalation; FIRE_CONTROLS_ACTIONS_AND_REASSESSMENT: Fire Controls, Actions and Reassessment |
| `participant_risk_assessment` | RISK_CONTEXT: Risk Context; RISK_ANALYSIS: Risk Analysis; CONTROLS_AND_ESCALATION: Controls and Escalation |
| `site_environmental_risk_assessment` | SITE_SERVICE_CONTEXT: Site and Service Context; PARTICIPANT_ENVIRONMENT_COMPATIBILITY: Participant-Environment Compatibility; PHYSICAL_ENVIRONMENT_HAZARDS: Physical Environment Hazards; EMERGENCY_AND_OPERATIONAL_READINESS: Emergency and Operational Readiness; STAFF_READINESS_AND_REINDUCTION: Staff Readiness and Re-Induction; RISK_RATING_CONTROLS_AND_CLOSURE: Risk Rating, Controls and Closure Evidence; SUITABILITY_CONCLUSION_REASSESSMENT: Suitability Conclusion and Reassessment Triggers |

### Clauses To Preserve

| Source code | Clause |
|---|---|
| `community_access_risk_assessment` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `fire_risk_assessment` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `participant_risk_assessment` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `site_environmental_risk_assessment` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |

### Proposed Merged Entry For Review Only

```yaml
code: risk_assessment
name: Risk Assessment
domain: risk_emergency
purpose: "[AUTHORED — REVIEW REQUIRED] Merge candidate combining the listed purposes without deleting any source purpose text."
source_purposes:
  - community_access_risk_assessment: "Assess risks for a participant engaging in activities outside the home or service environment."
  - fire_risk_assessment: "Assess fire safety risks at a service site and document controls and evacuation arrangements."
  - participant_risk_assessment: "Assess risks to a participant's safety and wellbeing, including physical, behavioural and environmental factors."
  - site_environmental_risk_assessment: "Assess physical and environmental risks at a service site or participant residence."
operations:
  - assess
scopes:
  - participant_general
  - participant_health
  - participant_behavioural
  - participant_home
  - community_access
  - site_environmental
  - fire
authority_boundary:
  - community_access_risk_assessment: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
  - fire_risk_assessment: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
  - participant_risk_assessment: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
  - site_environmental_risk_assessment: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
```

DECISION: KEEP BOTH / MERGE / ARCHIVE ONE

## Mealtime

Founder decision needed: preserve dysphagia/credentialed clinical authority boundaries before any merge.

### Entries

| Code | Name | Purpose / description | Operations | Scopes | Specificity | Authority boundary |
|---|---|---|---|---|---|---|
| `dysphagia_mealtime_safety_review` | Dysphagia & Mealtime Safety Review | Review dysphagia risk factors and mealtime safety practices for participants with swallowing difficulties. | review | dysphagia | both | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `mealtime_management_plan_review` | Mealtime Management Plan Review | Review and update a participant's mealtime management plan in line with current clinical guidance. | review | - | participant_specific | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `mealtime_risk_assessment` | Mealtime Risk Assessment | Assess risks associated with a participant's mealtime, including swallowing, positioning and texture requirements. | assess | risk_assessment | participant_specific | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `mealtime_support_strategy` | Mealtime Support Strategy | Define the strategies staff must use to safely support a participant during meals. | create | strategy | participant_specific | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |

### Deliverable / Section Comparison

Shared section-code percentage: **100%**

| Code | Section codes and headings |
|---|---|
| `dysphagia_mealtime_safety_review` | CLINICAL_SOURCE_INSTRUCTIONS: Clinical Source Instructions; IMPLEMENTATION_SUPPORTS: Implementation Supports; RISK_ESCALATION_GAPS: Risk, Escalation and Gaps |
| `mealtime_management_plan_review` | CLINICAL_SOURCE_INSTRUCTIONS: Clinical Source Instructions; IMPLEMENTATION_SUPPORTS: Implementation Supports; RISK_ESCALATION_GAPS: Risk, Escalation and Gaps |
| `mealtime_risk_assessment` | CLINICAL_SOURCE_INSTRUCTIONS: Clinical Source Instructions; IMPLEMENTATION_SUPPORTS: Implementation Supports; RISK_ESCALATION_GAPS: Risk, Escalation and Gaps |
| `mealtime_support_strategy` | CLINICAL_SOURCE_INSTRUCTIONS: Clinical Source Instructions; IMPLEMENTATION_SUPPORTS: Implementation Supports; RISK_ESCALATION_GAPS: Risk, Escalation and Gaps |

### Clauses To Preserve

| Source code | Clause |
|---|---|
| `dysphagia_mealtime_safety_review` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `mealtime_management_plan_review` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `mealtime_risk_assessment` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `mealtime_support_strategy` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |

### Proposed Merged Entry For Review Only

```yaml
code: mealtime_safety_management
name: Mealtime Safety Management
domain: clinical_mealtime
purpose: "[AUTHORED — REVIEW REQUIRED] Merge candidate combining the listed purposes without deleting any source purpose text."
source_purposes:
  - dysphagia_mealtime_safety_review: "Review dysphagia risk factors and mealtime safety practices for participants with swallowing difficulties."
  - mealtime_management_plan_review: "Review and update a participant's mealtime management plan in line with current clinical guidance."
  - mealtime_risk_assessment: "Assess risks associated with a participant's mealtime, including swallowing, positioning and texture requirements."
  - mealtime_support_strategy: "Define the strategies staff must use to safely support a participant during meals."
operations:
  - review
  - assess
  - create
scopes:
  - dysphagia_review
  - risk_assessment
  - support_strategy
  - plan_review
authority_boundary:
  - dysphagia_mealtime_safety_review: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
  - mealtime_management_plan_review: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
  - mealtime_risk_assessment: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
  - mealtime_support_strategy: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
```

DECISION: KEEP BOTH / MERGE / ARCHIVE ONE

## Participant Emergency

Founder decision needed before any merge.

### Entries

| Code | Name | Purpose / description | Operations | Scopes | Specificity | Authority boundary |
|---|---|---|---|---|---|---|
| `participant_disaster_risk_assessment` | Participant Disaster & Emergency Risk Assessment | Assess risks to an individual participant during disaster or emergency events. | assess | participant | participant_specific | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `individual_emergency_preparedness_plan` | Individual Emergency Preparedness Plan | Document personalised emergency preparedness arrangements for an individual participant. | create | participant | participant_specific | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |

### Deliverable / Section Comparison

Shared section-code percentage: **100%**

| Code | Section codes and headings |
|---|---|
| `participant_disaster_risk_assessment` | PARTICIPANT_EMERGENCY_CONTEXT: Participant Emergency Context; SUPPORT_ACTIONS: Support Actions; ESCALATION_AND_GAPS: Escalation and Gaps |
| `individual_emergency_preparedness_plan` | PARTICIPANT_EMERGENCY_CONTEXT: Participant Emergency Context; SUPPORT_ACTIONS: Support Actions; ESCALATION_AND_GAPS: Escalation and Gaps |

### Clauses To Preserve

| Source code | Clause |
|---|---|
| `participant_disaster_risk_assessment` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `individual_emergency_preparedness_plan` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |

### Proposed Merged Entry For Review Only

```yaml
code: participant_emergency_preparedness
name: Participant Emergency Preparedness
domain: risk_emergency
purpose: "[AUTHORED — REVIEW REQUIRED] Merge candidate combining the listed purposes without deleting any source purpose text."
source_purposes:
  - participant_disaster_risk_assessment: "Assess risks to an individual participant during disaster or emergency events."
  - individual_emergency_preparedness_plan: "Document personalised emergency preparedness arrangements for an individual participant."
operations:
  - assess
  - create
scopes:
  - risk_assessment
  - preparedness_plan
authority_boundary:
  - participant_disaster_risk_assessment: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
  - individual_emergency_preparedness_plan: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
```

DECISION: KEEP BOTH / MERGE / ARCHIVE ONE

## Health Support

Founder decision needed: author and preserve clinical-authority limitations before any merge.

### Entries

| Code | Name | Purpose / description | Operations | Scopes | Specificity | Authority boundary |
|---|---|---|---|---|---|---|
| `health_support_plan` | Health Support Plan | Document a participant's health conditions, clinical needs and the health supports required. | create | health_support | participant_specific | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `health_clinical_escalation_plan` | Health / Clinical Escalation Plan | Define escalation pathways for a participant's health conditions, including triggers and emergency contacts. | create | escalation | participant_specific | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |

### Deliverable / Section Comparison

Shared section-code percentage: **0%**

| Code | Section codes and headings |
|---|---|
| `health_support_plan` | CLINICAL_SOURCE_BASIS: Clinical Source Basis; SUPPORT_IMPLEMENTATION: Support Implementation; ESCALATION_REVIEW_GAPS: Escalation, Review and Gaps |
| `health_clinical_escalation_plan` | ESCALATION_CONTEXT: Escalation Context; SUPPORT_ACTIONS_AND_CONTACTS: Support Actions and Contacts; REVIEW_AND_GAPS: Review and Gaps |

### Clauses To Preserve

| Source code | Clause |
|---|---|
| `health_support_plan` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |
| `health_clinical_escalation_plan` | [AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner. |

### Proposed Merged Entry For Review Only

```yaml
code: health_support_plan
name: Health Support Plan
domain: clinical_mealtime
purpose: "[AUTHORED — REVIEW REQUIRED] Merge candidate combining the listed purposes without deleting any source purpose text."
source_purposes:
  - health_support_plan: "Document a participant's health conditions, clinical needs and the health supports required."
  - health_clinical_escalation_plan: "Define escalation pathways for a participant's health conditions, including triggers and emergency contacts."
operations:
  - create
scopes:
  - support_plan
  - escalation_pathways
authority_boundary:
  - health_support_plan: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
  - health_clinical_escalation_plan: "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner."
```

DECISION: KEEP BOTH / MERGE / ARCHIVE ONE

## Care Plan vs Individual Support Plan

Comparison only. No merge proposal without an explicit founder ruling.

### Entries

| Code | Name | Purpose / description | Operations | Scopes | Specificity | Authority boundary |
|---|---|---|---|---|---|---|
| `care_plan` | Care Plan | Document operational/service-delivery supports for a participant. Clinical, medication, dysphagia, mealtime or other credentialed health judgements require external or appropriately credentialed professional authority. | create, review, revise | - | participant_specific | Clinical, medication, dysphagia, mealtime or other credentialed health judgements require external or appropriately credentialed professional authority. |
| `individual_support_plan` | Individual Support / Implementation Plan | Define how approved supports are coordinated and implemented for an individual participant, including service goals, delivery requirements, monitoring and escalation. Clinical, BSP, RP, legal or practitioner-level judgements require the relevant professional authority. | create, review, revise | - | participant_specific | Clinical, BSP, RP, legal or practitioner-level judgements require the relevant professional authority. |

### Deliverable / Section Comparison

Shared section-code percentage: **11%**

| Code | Section codes and headings |
|---|---|
| `care_plan` | PARTICIPANT_CONTEXT: Participant Context; PURPOSE_AND_SCOPE: Purpose and Scope; GOALS_AND_PREFERENCES: Goals and Preferences; SUPPORT_REQUIREMENTS: Support Requirements; RISKS_SAFEGUARDS_ESCALATION: Risks, Safeguards and Escalation; MONITORING_REVIEW_GAPS: Monitoring, Review and Evidence Gaps |
| `individual_support_plan` | APPROVED_SUPPORT_BASIS: Approved Support Basis; IMPLEMENTATION_REQUIREMENTS: Implementation Requirements; ROLES_HANDOFFS_ESCALATION: Roles, Handoffs and Escalation; MONITORING_REVIEW_GAPS: Monitoring, Review and Gaps |

### Clauses To Preserve

| Source code | Clause |
|---|---|
| `care_plan` | Clinical, medication, dysphagia, mealtime or other credentialed health judgements require external or appropriately credentialed professional authority. |
| `individual_support_plan` | Clinical, BSP, RP, legal or practitioner-level judgements require the relevant professional authority. |

### Proposed Merged Entry For Review Only

No merged entry proposed. Founder ruling required first.

DECISION: KEEP BOTH / MERGE / ARCHIVE ONE
