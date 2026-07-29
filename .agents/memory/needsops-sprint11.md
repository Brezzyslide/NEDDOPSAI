---
name: NeedsOps Sprint 11 Workforce Catalogue Streamlining
description: 32 specialists collapsed to 17 AI employees — schema, registry rewrite, service guards, UI, tests, docs
---

## What was delivered

**Schema migration** (lib/db/migrations/sprint11-workforce-catalogue-streamlining.sql):
- Extended specialist_execution_status enum: added dna_pending, archived (must COMMIT before ALTER TABLE — enum ADD VALUE cannot run mid-transaction)
- Added columns: deprecated_at, deprecated_by, deprecation_reason, replacement_role_code, replacement_type, department_code, display_order, catalogue_version, dna_status
- 13 new specialists inserted (dna_pending). 4 retained specialists (chief_of_staff, executive_assistant, operations_manager, service_delivery_coordinator) were not in DB yet — required explicit INSERT ON CONFLICT after migration
- 28 old role codes marked deprecated with replacement mappings

**workforceRegistry.ts (fully rewritten — 45 total entries):**
- 17 catalogue v2 entries + 28 deprecated catalogue v1 entries
- New RegistrySpecialist fields: departmentCode, dnaStatus, displayOrder, catalogueVersion, replacementRoleCode, replacementType, deprecatedAt, deprecationReason
- executionStatus union now includes "dna_pending" | "archived"
- New helpers: getCurrentSpecialists(), getDeprecatedSpecialists(), getSpecialistsByDepartment(), resolveAlias()
- _v2SpecialistsForPack() private helper ensures packs only show v2 employees
- HR pack display name → "People and Culture Workforce" (pack code 'hr' unchanged — changing it breaks tenant entitlements)
- Marketing pack status set to "available"

**capabilityRegistry.ts:** All eligibleRoles updated — 28 deprecated codes replaced with v2 equivalents. research.general expanded to 6 eligible roles (distributed capability).

**Services:**
- specialistEligibilityService.ts: ACTIVE_SPECIALISTS = {operations_manager} only. dna_pending → deny("dna_design_pending"). archived → deny("specialist_archived")
- specialistIntelligenceService.ts: ACTIVE_SPECIALIST_VERSIONS = {chief_of_staff, operations_manager}
- chiefOfStaffService.ts: resolveSpecialistAlias() resolves deprecated codes before dispatch

**Web UI (WorkforcePage.tsx):** department grouping, "17 AI employees across 6 departments" header, 🧬 DNA Pending badge, API default excludes deprecated/archived.

**Tests:** 869 passing (72 new sprint11 tests in sprint11-workforce-catalogue.test.ts).

**Docs:** docs/workforce/{approved-workforce-catalogue-v1.md, specialist-consolidation-map.md, workforce-capability-boundaries.md, dna-design-status.md}

## Key rules

**Dispatch guard:** Only roles with executionStatus "available" AND dnaStatus "approved" are dispatchable. Currently only chief_of_staff and operations_manager.

**Alias resolution:** resolveAlias(oldCode) → newCode or null. research_specialist → null (capability_distribution). CoS applies this before dispatch.

**Pack code 'hr' must stay 'hr'.** Renaming breaks tenant entitlements stored in DB. Only update display name.

**research_specialist:** replacementType = "capability_distribution", replacementRoleCode = null. research.general capability still exists, now distributed to multiple roles.

**Historical runs:** specialist_runs keeps original role codes unchanged. Sprint 10 DNA version columns record which DNA version ran. Nothing deleted.

**Test updates made in sprint94-capabilities.test.ts, workforce.test.ts, workerProfiles.test.ts:** Update old role codes (compliance_officer → compliance_quality_manager, etc.) and add dna_pending to valid status list.

## Department structure (17 employees)
- executive (2): chief_of_staff, executive_assistant
- compliance_governance (3): compliance_quality_manager, incident_safeguarding_specialist, policy_governance_specialist
- operations (4): operations_manager, service_delivery_coordinator, workforce_rostering_coordinator, process_asset_coordinator
- finance (3): finance_officer, payroll_workforce_cost_officer, financial_planning_reporting_manager
- people_culture (3): people_culture_manager, talent_learning_specialist, workforce_compliance_specialist
- marketing (1): marketing_communications_manager
- shared_professional_services (1): knowledge_documentation_specialist

## Invariants
- REQUIRED_RLS_TABLES = 35 (unchanged)
- 869 tests passing
- All AI calls through lib/ai-gateway
- seat_overrides excluded from RLS check
