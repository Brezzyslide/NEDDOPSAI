# Blueprint Extraction Survey

Date: 2026-09-03

Scope: read-only investigation of the NeedsOps blueprint registry and related runtime gates. No source code was modified. Live dev API probing was attempted only with unauthenticated GET requests.

## Executive finding

Observed: the registry contains 75 blueprints. All 75 have section prose. Only `care_plan` has machine-readable section `fixedContent`, `fields`, `completionPrompt`, and an authored `deliverableContract.requirementPlan`.

Observed in source:

- `RegistryEntry.deliverableContract.requirementPlan` is the authored requirement-plan slot (`artifacts/api-server/src/services/blueprintRegistry.ts:107`).
- Section machine-readable slots are `fixedContent`, `fields`, and `completionPrompt` (`artifacts/api-server/src/services/blueprintRegistry.ts:162`).
- The ordinary `section(...)` helper returns section code, title, description, instructions, evidence controls, assumptions, quality criteria and sort order, but no `fixedContent`, `fields` or `completionPrompt` (`artifacts/api-server/src/services/blueprintRegistry.ts:2992`).
- `carePlanUserSection(...)` can merge the extra authored fields through its `extra` parameter (`artifacts/api-server/src/services/blueprintRegistry.ts:3036`).
- Runtime coverage requires 100% mandatory coverage before completion (`artifacts/api-server/src/services/blueprintRuntimeValidationService.ts:172`).
- If no authored requirement plan exists, the coverage service falls back to generic mandatory content plus required blueprint sections (`artifacts/api-server/src/services/deliverableRequirementCoverageService.ts:584`).

Inference: extraction can recover many field labels and boundary clauses from the existing section descriptions, but it cannot recover the founder-authored standing content, adequacy criteria, conditional non-applicability wording, escalation wording, or deterministic completion prompts at the same standard as `care_plan`.

## Live check

Attempted:

- `GET https://d2y3hd4ltf3qdv.cloudfront.net/api/health`
- `GET https://d2y3hd4ltf3qdv.cloudfront.net/v1/work-blueprints`
- `GET https://d2y3hd4ltf3qdv.cloudfront.net/api/v1/work-blueprints`

Observed: each returned 404 from CloudFront/Express with Clerk signed-out headers. Source shows blueprint listing is mounted as `GET /v1/organisations/:slug/work-blueprints` behind `requireAuth` and tenant resolution (`artifacts/api-server/src/routes/v1/workBlueprints.ts:71`). I could not verify the live registry contents without an authenticated organisation slug/session.

## 1. Per-blueprint structure survey

Observed by importing `BLUEPRINT_REGISTRY` through the local TypeScript compiler.

| Blueprint | Line | Sections | fixedContent | fields | completionPrompt | Authored req plan |
|---|---:|---:|---:|---:|---:|---:|
| care_plan | 4694 | 14 | 14 | 14 | 14 | 14 |
| individual_support_plan | 4818 | 4 | 0 | 0 | 0 | 0 |
| sil_support_plan | 4865 | 4 | 0 | 0 | 0 | 0 |
| service_delivery_review | 4913 | 4 | 0 | 0 | 0 | 0 |
| participant_transition_plan | 4957 | 4 | 0 | 0 | 0 | 0 |
| participant_goals_review | 4984 | 3 | 0 | 0 | 0 | 0 |
| participant_periodic_summary | 5011 | 3 | 0 | 0 | 0 | 0 |
| support_strategy_analysis | 5038 | 4 | 0 | 0 | 0 | 0 |
| funding_utilisation_review | 5061 | 22 | 0 | 0 | 0 | 0 |
| mealtime_risk_assessment | 5156 | 3 | 0 | 0 | 0 | 0 |
| mealtime_management_plan_review | 5184 | 3 | 0 | 0 | 0 | 0 |
| dysphagia_mealtime_safety_review | 5212 | 3 | 0 | 0 | 0 | 0 |
| mealtime_support_strategy | 5237 | 3 | 0 | 0 | 0 | 0 |
| medication_management_review | 5267 | 3 | 0 | 0 | 0 | 0 |
| health_support_plan | 5296 | 3 | 0 | 0 | 0 | 0 |
| health_clinical_escalation_plan | 5328 | 3 | 0 | 0 | 0 | 0 |
| participant_risk_assessment | 5362 | 3 | 0 | 0 | 0 | 0 |
| community_access_risk_assessment | 5395 | 3 | 0 | 0 | 0 | 0 |
| site_environmental_risk_assessment | 5423 | 7 | 0 | 0 | 0 | 0 |
| fire_risk_assessment | 5453 | 6 | 0 | 0 | 0 | 0 |
| evacuation_emergency_assessment | 5485 | 3 | 0 | 0 | 0 | 0 |
| participant_disaster_risk_assessment | 5509 | 3 | 0 | 0 | 0 | 0 |
| disaster_emergency_management_plan | 5537 | 5 | 0 | 0 | 0 | 0 |
| business_continuity_plan | 5567 | 17 | 0 | 0 | 0 | 0 |
| individual_emergency_preparedness_plan | 5689 | 3 | 0 | 0 | 0 | 0 |
| behaviour_support_plan_review | 5719 | 6 | 0 | 0 | 0 | 0 |
| behaviour_trigger_analysis | 5759 | 5 | 0 | 0 | 0 | 0 |
| restrictive_practice_risk_assessment | 5791 | 13 | 0 | 0 | 0 | 0 |
| restrictive_practice_comparison | 5824 | 9 | 0 | 0 | 0 | 0 |
| restrictive_practice_authorisation | 5850 | 9 | 0 | 0 | 0 | 0 |
| unauthorised_restrictive_practice_review | 5878 | 14 | 0 | 0 | 0 | 0 |
| incident_investigation | 5920 | 14 | 0 | 0 | 0 | 0 |
| incident_review_improvement | 5961 | 15 | 0 | 0 | 0 | 0 |
| reportable_incident_assessment | 6002 | 15 | 0 | 0 | 0 | 0 |
| safeguarding_assessment | 6043 | 15 | 0 | 0 | 0 | 0 |
| corrective_action_improvement | 6086 | 15 | 0 | 0 | 0 | 0 |
| clinical_governance_review | 6130 | 15 | 0 | 0 | 0 | 0 |
| governance_executive_review | 6173 | 15 | 0 | 0 | 0 | 0 |
| rostering_fatigue_review | 6210 | 15 | 0 | 0 | 0 | 0 |
| roster_planning | 6257 | 14 | 0 | 0 | 0 | 0 |
| workforce_performance_review | 6307 | 13 | 0 | 0 | 0 | 0 |
| people_management_review | 6360 | 12 | 0 | 0 | 0 | 0 |
| learning_capability_development_plan | 6423 | 13 | 0 | 0 | 0 | 0 |
| workforce_compliance_assessment | 6490 | 12 | 0 | 0 | 0 | 0 |
| payroll_workforce_cost_review | 6544 | 13 | 0 | 0 | 0 | 0 |
| operational_readiness_assessment | 6603 | 17 | 0 | 0 | 0 | 0 |
| standard_operating_procedure | 6728 | 17 | 0 | 0 | 0 | 0 |
| business_process_analysis | 6860 | 17 | 0 | 0 | 0 | 0 |
| asset_lifecycle_review | 6995 | 14 | 0 | 0 | 0 | 0 |
| document_control_review | 7118 | 22 | 0 | 0 | 0 | 0 |
| knowledge_base_review | 7236 | 24 | 0 | 0 | 0 | 0 |
| controlled_document_assembly | 7380 | 22 | 0 | 0 | 0 | 0 |
| policy | 7508 | 23 | 0 | 0 | 0 | 0 |
| governance_framework | 7660 | 23 | 0 | 0 | 0 | 0 |
| regulatory_change_impact_assessment | 7760 | 30 | 0 | 0 | 0 | 0 |
| governance_gap_analysis | 7859 | 28 | 0 | 0 | 0 | 0 |
| delegation_framework | 7952 | 14 | 0 | 0 | 0 | 0 |
| compliance_audit_readiness | 8020 | 16 | 0 | 0 | 0 | 0 |
| legislation_regulatory_review | 8077 | 18 | 0 | 0 | 0 | 0 |
| regulatory_change_impact | 8134 | 1 | 0 | 0 | 0 | 0 |
| regulator_response_submission | 8160 | 18 | 0 | 0 | 0 | 0 |
| schads_award_analysis | 8199 | 21 | 0 | 0 | 0 | 0 |
| employment_compliance_review | 8237 | 21 | 0 | 0 | 0 | 0 |
| business_financial_analysis | 8280 | 26 | 0 | 0 | 0 | 0 |
| financial_planning_reporting_review | 8318 | 32 | 0 | 0 | 0 | 0 |
| tax_financial_obligation_review | 8371 | 26 | 0 | 0 | 0 | 0 |
| operational_finance_reconciliation_review | 8410 | 26 | 0 | 0 | 0 | 0 |
| business_growth_analysis | 8470 | 29 | 0 | 0 | 0 | 0 |
| ndis_marketing_strategy | 8531 | 31 | 0 | 0 | 0 | 0 |
| marketing_communications_review | 8605 | 30 | 0 | 0 | 0 | 0 |
| ndis_market_analysis | 8644 | 50 | 0 | 0 | 0 | 0 |
| business_proposal | 8692 | 25 | 0 | 0 | 0 | 0 |
| formal_stakeholder_correspondence | 8755 | 23 | 0 | 0 | 0 | 0 |
| complaints_review_response | 8817 | 26 | 0 | 0 | 0 | 0 |
| service_agreement_review | 8882 | 30 | 0 | 0 | 0 | 0 |

Totals: 75 blueprints, 1,085 sections, 14 sections with fixed content, 14 sections with fields, 14 sections with completion prompts, and 1 authored requirement plan. All of those are `care_plan`.

## 2. How much is derivable from existing prose?

### 2a. Fields

Observed: the declared `fields` arrays cannot be recovered as declared fields because they are absent from 74 registry entries. Conceptually, many field labels can be derived from comma-separated section descriptions.

Five-domain sample:

| Blueprint | Domain | Derivable from prose | Example derivation |
|---|---|---|---|
| `participant_risk_assessment` | risk | High | `RISK_ANALYSIS` yields hazard/concern, exposure, likelihood, consequence, current controls, residual risk. `CONTROLS_AND_ESCALATION` yields existing controls, control effectiveness, additional controls, owner, review date. |
| `restrictive_practice_authorisation` | behaviour | High | `AUTHORISATION_QUESTION_AND_SCOPE` yields participant, restrictive practice, RP category/type, reason/purpose, relevant BSP, relevant assessment, implementing provider, jurisdiction/pathway, dates, review reason. |
| `rostering_fatigue_review` | workforce | High | `DOCUMENT_CONTROL` yields title, review reference, worker/group, participant/site/service, review period/date, reviewer, owner, status, version, approver/sign-off. |
| `service_agreement_review` | agreement/commercial | High | `DOCUMENT_AUTHORITY_AND_STATUS` yields agreement number, participant, provider, ABN/org details, version, status, period, created date, signed dates, template source, supersession and variation status. |
| `business_financial_analysis` | finance | High for labels, medium for formulas | `ANALYSIS_SCOPE` yields entity, business unit/service, reporting period, comparison period, management question, accounting basis, currency, jurisdiction. `FINANCIAL_PERFORMANCE_RECONSTRUCTION` yields revenue, direct costs, workforce costs, gross profit/contribution, operating expenses, EBITDA/operating result, depreciation/amortisation, interest/finance cost, net result. |

Inference: field labels are the most extractable part. The extraction result would still need human review because descriptions mix labels, options, exclusions, states, and professional judgements in prose. Extraction can propose `fields`; it cannot prove the field set is complete, ordered, or safe.

### 2b. Authority boundaries in purpose text

Observed: 10 of the 75 purpose strings carry clear limit/exclusion/boundary wording extractable verbatim. I excluded `community_access_risk_assessment` because "outside the home" is a location phrase, not an authority boundary.

Purpose-boundary hits:

- `care_plan`
- `sil_support_plan`
- `restrictive_practice_risk_assessment`
- `restrictive_practice_authorisation`
- `clinical_governance_review`
- `business_process_analysis`
- `document_control_review`
- `controlled_document_assembly`
- `ndis_marketing_strategy`
- `marketing_communications_review`

Important limitation: this count is purpose text only. Many additional boundaries exist in `externalAuthorityRequiredFor`, `validationRules`, `prohibitedDeliverables`, `prohibitedAssumptions`, `successCriteria`, section instructions, and `escalationRules`. For example, `participant_risk_assessment` has authority boundaries in `externalAuthorityRequiredFor` and escalation rules but not in its purpose text (`artifacts/api-server/src/services/blueprintRegistry.ts:5365`, `artifacts/api-server/src/services/blueprintRegistry.ts:5373`, `artifacts/api-server/src/services/blueprintRegistry.ts:5386`).

### 2c. completionPrompt

Inference: completion prompts are partially derivable but should be authored.

Reason: section instructions tell what to do, but not the final fillable wording or exact deterministic prompt a template should show. `care_plan` completion prompts are treated as authored deterministic content and tested as such (`artifacts/api-server/src/__tests__/sprint35h-professional-deliverable-architecture.test.ts:1093`). The template criteria code also treats authored completion prompts as verbatim criteria (`artifacts/api-server/src/services/deliverableRequirementCoverageService.ts:696`).

Extraction can produce a first draft, e.g. for `participant_risk_assessment.CONTROLS_AND_ESCALATION`: "Record existing controls, assess control effectiveness, identify additional controls, assign an owner, set a review date, and escalate any clinical, BSP, RP, safeguarding, WHS or external-authority matter." That is useful, but it is authored-by-extraction, not already present as a completion prompt.

### 2d. Requirement plans

Inference: requirement plans are not safely derivable as final authored plans. They can be scaffolded from section descriptions and success criteria, but adequacy criteria, classification, target locations, coverage rules and conditional applicability need authoring.

Observed: the system explicitly distinguishes authored requirement plans from fallback-derived requirements. `authoredDeliverableRequirements(...)` reads `requirementPlan`, `requirements`, or `deliverableRequirements` and marks them with origin `AUTHORED` (`artifacts/api-server/src/services/deliverableRequirementCoverageService.ts:626`). If none exists, `genericDeliverableRequirements(...)` derives fallback requirements from mandatory content and required sections (`artifacts/api-server/src/services/deliverableRequirementCoverageService.ts:584`).

## 3. What is not in the prose?

Observed for `care_plan`: standing content exists in constants outside normal section prose:

- `CARE_PLAN_AUTHORITY_BOUNDARY` contains boundary wording (`artifacts/api-server/src/services/blueprintRegistry.ts:3053`).
- `CARE_PLAN_DOCUMENT_TO_SECTIONS` maps required source documents to sections (`artifacts/api-server/src/services/blueprintRegistry.ts:3069`).
- `CARE_PLAN_REQUIREMENT_PLAN` contains authored adequacy criteria (`artifacts/api-server/src/services/blueprintRegistry.ts:3081`).
- `CARE_PLAN_TEMPLATE_CONTENT` and `CARE_PLAN_SECTIONS` feed the authored deterministic section content (`artifacts/api-server/src/services/blueprintRegistry.ts:3291`, `artifacts/api-server/src/services/blueprintRegistry.ts:3423`).

Observed across the other 74: zero fixed-content sections, zero declared-field sections, zero completion-prompt sections, and zero authored requirement plans. By the requested equivalence standard, 0 of the 74 already carry their equivalent standing content in the machine-readable structure.

Estimate:

- Equivalent standing content already carried in the required machine-readable structure: 0 of 74.
- Professionally rich prose that can seed extraction: most of the 74, especially the later 15-50 section blueprints.
- Thin like `participant_risk_assessment` in machine-readable terms: all 74.
- Thin like `participant_risk_assessment` in prose depth: mainly the early 3-4 section participant/clinical/risk blueprints and `regulatory_change_impact` with 1 section. The later operational, governance, finance, marketing, correspondence and service-agreement blueprints carry much denser prose, but still not the machine-readable standing content.

## 4. participant_risk_assessment extraction-only result

Source observed:

- Purpose: "Assess risks to a participant's safety and wellbeing, including physical, behavioural and environmental factors." (`artifacts/api-server/src/services/blueprintRegistry.ts:5365`)
- External authority required for clinical, BSP/RP, safeguarding and WHS/site technical determinations (`artifacts/api-server/src/services/blueprintRegistry.ts:5373`).
- Prohibited deliverables are `clinical_risk_assessment`, `behaviour_support_plan`, and `restrictive_practice_authorisation` (`artifacts/api-server/src/services/blueprintRegistry.ts:5376`).
- Success criteria require hazard/exposure/likelihood/consequence/control model, residual risk and review owner, and preserved domain boundaries (`artifacts/api-server/src/services/blueprintRegistry.ts:5384`).
- Escalation rules require credentialed clinical input, BSI/APO deferral and safeguarding deferral (`artifacts/api-server/src/services/blueprintRegistry.ts:5386`).
- Sections are `RISK_CONTEXT`, `RISK_ANALYSIS`, and `CONTROLS_AND_ESCALATION` (`artifacts/api-server/src/services/blueprintRegistry.ts:5392`).

Extraction below authors nothing beyond reformatting visible prose into machine-readable candidate structures. It is not registry-ready.

### Derived authority boundary

This assessment may assess risks to a participant's safety and wellbeing, including physical, behavioural and environmental factors. It must not produce a clinical risk assessment, behaviour support plan or restrictive practice authorisation. Clinical risk determination, BSP/RP risk determination, safeguarding determination, and WHS or site technical certification require the relevant external or credentialed authority. Escalate clinical risk authority to credentialed clinical input, behaviour or RP risk to BSI/APO, and safeguarding risk to the incident safeguarding specialist.

### Derived fields

`RISK_CONTEXT`

- Scope
- Participant context
- Risk domain
- Risk domain option: service
- Risk domain option: clinical
- Risk domain option: behaviour
- Risk domain option: RP
- Risk domain option: safeguarding
- Risk domain option: WHS
- Risk domain option: environmental
- Evidence basis

`RISK_ANALYSIS`

- Hazard/concern
- Exposure
- Likelihood
- Consequence
- Current controls
- Residual risk
- Uncertainty
- Evidence basis

`CONTROLS_AND_ESCALATION`

- Existing controls
- Control effectiveness
- Additional controls
- Owner
- Review date
- Escalation required
- Escalation pathway: clinical
- Escalation pathway: BSP
- Escalation pathway: RP
- Escalation pathway: safeguarding
- Escalation pathway: WHS
- Escalation pathway: external authority

### Derived completion prompts

`RISK_CONTEXT`: Identify the assessment scope, participant context and risk domain. State whether the risk is service, clinical, behaviour, RP, safeguarding, WHS or environmental, and preserve any evidence gap or uncertainty.

`RISK_ANALYSIS`: Record the hazard or concern, exposure, likelihood, consequence, current controls and residual risk. Do not collapse professional risk domains; state uncertainty and the evidence basis.

`CONTROLS_AND_ESCALATION`: Record existing controls, control effectiveness, additional controls, owner and review date. Escalate clinical, BSP, RP, safeguarding, WHS or external-authority matters to the correct pathway.

### Derived requirement plan

| id | sectionCode | classification | requirementText | targetLocation | adequacy criteria source |
|---|---|---|---|---|---|
| `pra-risk-context` | `RISK_CONTEXT` | `MUST_BE_REPRESENTED` | Scope, participant context and risk domain are represented, including whether the risk is service, clinical, behaviour, RP, safeguarding, WHS or environmental. | Risk Context | Derived from section description/instructions only. No authored adequacy criteria available. |
| `pra-risk-analysis` | `RISK_ANALYSIS` | `MUST_BE_REPRESENTED` | Hazard/concern, exposure, likelihood, consequence, current controls and residual risk are represented, with uncertainty and evidence basis. | Risk Analysis | Derived from section description/instructions and success criteria only. No authored adequacy criteria available. |
| `pra-controls-escalation` | `CONTROLS_AND_ESCALATION` | `MUST_BE_REPRESENTED` | Existing controls, control effectiveness, additional controls, owner, review date and escalation pathways are represented. | Controls and Escalation | Derived from section description/instructions and escalation rules only. No authored adequacy criteria available. |
| `pra-domain-boundary` | all | `CONDITIONAL` | Domain boundaries are preserved and clinical, BSP/RP, safeguarding, WHS/site technical and external-authority determinations are escalated rather than made by this deliverable. | Authority Boundary / Escalation | Derived from `externalAuthorityRequiredFor`, prohibited deliverables, validation rule, success criteria and escalation rules. No authored adequacy criteria available. |

### Coverage estimate for extraction-only PRA

Observed: the existing registry PRA has no authored fields, no fixed content, no completion prompts and no authored requirement plan. The regression test confirms all four zero counts and that runtime fails the mandatory coverage gate for an empty standard risk assessment template (`artifacts/api-server/src/__tests__/sprint36a-professional-routing-domain-isolation.test.ts:444`).

Inferred result if the extraction above were supplied to the generator as guidance but not written to the registry:

- It can represent the three existing required sections.
- It can represent the authority boundary in prose.
- It still cannot satisfy the authored-template standard because no authored fixed content exists, no declared `fields` arrays exist in the registry, no authored completion prompts exist in the registry, and no authored adequacy criteria exist.
- It would improve the content plan from "fallback generic" to an extraction scaffold, but it would not be equivalent to `care_plan`.

Coverage estimate:

- Against the current fallback 7-obligation shape described in the task: likely 4/7 if the model emits all three blueprint sections and the explicit domain-boundary material. The remaining failures are expected to be the request-level/generic template obligations that need declared field/template structure and authored adequacy criteria.
- Against a registry-authored PRA plan created only from the four derived rows above: it could reach 4/4 structurally, but that would be a misleading pass because the adequacy criteria would still be absent or generic.
- Against the real production gate expectation of complete machine-readable, authored content: not pass-ready.

What still fails:

- No standing fixed content for reusable risk-assessment clauses.
- No declared field set reviewed by the founder/professional owner.
- No authored completion prompts.
- No authored adequacy criteria for "good enough" risk context, likelihood/consequence treatment, control effectiveness, residual risk and escalation boundaries.
- No approved risk matrix vocabulary or scale.
- No approved residual-risk wording.
- No approved non-applicability/gap wording.
- No founder decision about how far a generic PRA may go before it must defer to clinical, BSP/RP, safeguarding or WHS authority.

## 5. Estimate across the 74

Passing content gates through extraction alone: 0 of 74.

Reason: the content gate requires complete mandatory coverage, and the only blueprint with the machine-readable authored package is `care_plan`. Extraction can produce scaffolds, not founder/professional authority.

Likely tiers:

- Tier 1, fast scaffold then founder review: about 45-55 blueprints. These have rich section prose with enough concepts to derive fields and an initial requirement plan, but still need standing wording and adequacy criteria.
- Tier 2, moderate authoring: about 15-25 blueprints. These have fewer sections or domain-sensitive limits where the existing prose is not enough to define safe template content.
- Tier 3, deep founder/professional input first: about 5-10 blueprints. This includes very thin early blueprints and high-risk authority-heavy domains such as clinical/health, restrictive practice, safeguarding, WHS/site technical, legal/regulatory, SCHADS/employment and financial/tax obligations.

Specific input needed from founder/professional owners:

- Approved standing fixed content for each user-facing section.
- Approved field lists and table structures.
- Approved completion prompts written as final template guidance.
- Authored requirement plan with classifications, target locations, adequacy criteria, coverage rules and conditional applicability.
- Boundary wording for external/credentialed authority.
- Non-applicability wording and evidence-gap wording.
- Escalation instructions and named owner roles.
- Domain-specific scales, vocabularies or calculations where relevant, for example risk ratings, fatigue indicators, SCHADS thresholds, finance formulas, service-agreement term classes and NDIS market/claims limits.

Bottom line: extraction is useful for bootstrapping the 74, but it is not a substitute for the authored blueprint package. The real cost per blueprint is not finding headings; it is turning each professional method into deterministic fields, standing content, completion prompts and adequacy criteria that the runtime can enforce.
