-- Sprint 11 — Workforce Catalogue Streamlining (32 → 17 AI Employees)
-- Idempotent, transaction-safe.
-- Preserves all historical specialist records, runs, and audit data.

BEGIN;

-- ── 1. Extend execution_status enum ──────────────────────────────────────────
-- PostgreSQL ALTER TYPE ADD VALUE cannot run inside a transaction block,
-- so we use a DO block with exception handling for idempotency.
DO $$
BEGIN
  ALTER TYPE specialist_execution_status ADD VALUE IF NOT EXISTS 'dna_pending';
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TYPE specialist_execution_status ADD VALUE IF NOT EXISTS 'archived';
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

COMMIT;
-- Re-open transaction after enum additions (PostgreSQL requires this)
BEGIN;

-- ── 2. Extend specialists table ───────────────────────────────────────────────
ALTER TABLE specialists
  ADD COLUMN IF NOT EXISTS deprecated_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deprecated_by       TEXT,
  ADD COLUMN IF NOT EXISTS deprecation_reason  TEXT,
  ADD COLUMN IF NOT EXISTS replacement_role_code TEXT,
  ADD COLUMN IF NOT EXISTS replacement_type    TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS department_code     TEXT,
  ADD COLUMN IF NOT EXISTS display_order       INTEGER NOT NULL DEFAULT 99,
  ADD COLUMN IF NOT EXISTS catalogue_version   TEXT NOT NULL DEFAULT '1',
  ADD COLUMN IF NOT EXISTS dna_status          TEXT NOT NULL DEFAULT 'pending_design';

-- ── 3. Update the 4 retained specialists ─────────────────────────────────────

UPDATE specialists SET
  department_code   = 'executive',
  display_order     = 1,
  catalogue_version = '2',
  dna_status        = 'approved',
  execution_status  = 'available'
WHERE code = 'chief_of_staff';

UPDATE specialists SET
  department_code   = 'executive',
  display_order     = 2,
  catalogue_version = '2',
  dna_status        = 'pending_design',
  execution_status  = 'dna_pending'
WHERE code = 'executive_assistant';

UPDATE specialists SET
  department_code   = 'operations',
  display_order     = 6,
  catalogue_version = '2',
  dna_status        = 'approved',
  execution_status  = 'available'
WHERE code = 'operations_manager';

UPDATE specialists SET
  department_code   = 'operations',
  display_order     = 7,
  catalogue_version = '2',
  dna_status        = 'pending_design',
  execution_status  = 'dna_pending'
WHERE code = 'service_delivery_coordinator';

-- ── 4. Insert 13 new AI employee entries ──────────────────────────────────────

INSERT INTO specialists (id, code, display_name, description, icon, colour,
  required_permissions, required_entitlements, approval_requirements,
  execution_status, version, department_code, display_order,
  catalogue_version, dna_status, replacement_type)
VALUES
  -- Compliance & Governance
  ('spec_compliance_quality_manager', 'compliance_quality_manager',
   'Compliance and Quality Manager',
   'Interprets NDIS compliance requirements, reviews quality standards, prepares for audits, develops corrective-action plans, and supports continuous improvement.',
   '⚖️', '#E05C00',
   '["compliance:read"]', '["compliance_workforce"]', 'manager_approval',
   'dna_pending', '1.0.0', 'compliance_governance', 3, '2', 'pending_design', 'none'),

  ('spec_incident_safeguarding_specialist', 'incident_safeguarding_specialist',
   'Incident and Safeguarding Specialist',
   'Reviews incidents, classifies severity, identifies reportable obligations, reviews restrictive-practice documentation, and escalates safeguarding risks.',
   '🚨', '#C0143C',
   '["compliance:read","incidents:read"]', '["compliance_workforce"]', 'compliance_approval',
   'dna_pending', '1.0.0', 'compliance_governance', 4, '2', 'pending_design', 'none'),

  ('spec_policy_governance_specialist', 'policy_governance_specialist',
   'Policy and Governance Specialist',
   'Drafts and reviews organisational policies, maps them to NDIS Practice Standards, develops governance frameworks, and prepares board materials.',
   '📜', '#7B5A14',
   '["compliance:read"]', '["compliance_workforce"]', 'administrator_approval',
   'dna_pending', '1.0.0', 'compliance_governance', 5, '2', 'pending_design', 'none'),

  -- Operations
  ('spec_workforce_rostering_coordinator', 'workforce_rostering_coordinator',
   'Workforce and Rostering Coordinator',
   'Reviews staff rosters, identifies scheduling conflicts and SCHADS issues, assesses workforce coverage, and prepares rostering execution intents.',
   '📊', '#B8860B',
   '["operations:read","roster:read"]', '["operations_workforce"]', 'no_approval',
   'dna_pending', '1.0.0', 'operations', 8, '2', 'pending_design', 'none'),

  ('spec_process_asset_coordinator', 'process_asset_coordinator',
   'Process and Asset Coordinator',
   'Maps and improves workflows, documents standard operating procedures, tracks assets and maintenance schedules, and coordinates procurement needs.',
   '🔄', '#5B8C5A',
   '["operations:read"]', '["operations_workforce"]', 'no_approval',
   'dna_pending', '1.0.0', 'operations', 9, '2', 'pending_design', 'none'),

  -- Finance
  ('spec_finance_officer', 'finance_officer',
   'Finance Officer',
   'Reviews accounts payable and receivable, reconciles transactions, reviews NDIS invoices, identifies billing discrepancies, and escalates suspicious transactions.',
   '💰', '#1A7A32',
   '["finance:read"]', '["finance_workforce"]', 'manager_approval',
   'dna_pending', '1.0.0', 'finance', 10, '2', 'pending_design', 'none'),

  ('spec_payroll_workforce_cost_officer', 'payroll_workforce_cost_officer',
   'Payroll and Workforce Cost Officer',
   'Reviews payroll input data, identifies SCHADS issues, reconciles roster and payroll records, prepares exception reports, and analyses labour-cost trends.',
   '💳', '#1E3A8A',
   '["finance:read","payroll:read"]', '["finance_workforce"]', 'administrator_approval',
   'dna_pending', '1.0.0', 'finance', 11, '2', 'pending_design', 'none'),

  ('spec_financial_planning_reporting_manager', 'financial_planning_reporting_manager',
   'Financial Planning and Reporting Manager',
   'Prepares budgets and forecasts, analyses actuals against budget, produces management and board reports, and assesses financial sustainability.',
   '📈', '#6B2A2A',
   '["finance:read"]', '["finance_workforce"]', 'administrator_approval',
   'dna_pending', '1.0.0', 'finance', 12, '2', 'pending_design', 'none'),

  -- People & Culture
  ('spec_people_culture_manager', 'people_culture_manager',
   'People and Culture Manager',
   'Supports HR administration, coordinates performance reviews, develops improvement plans, analyses workforce trends, and escalates high-risk HR matters.',
   '👥', '#DB2777',
   '["hr:read"]', '["hr_workforce"]', 'no_approval',
   'dna_pending', '1.0.0', 'people_culture', 13, '2', 'pending_design', 'none'),

  ('spec_talent_learning_specialist', 'talent_learning_specialist',
   'Talent and Learning Specialist',
   'Drafts position descriptions, supports candidate screening, prepares onboarding plans, maintains training matrices, and monitors certification expiry.',
   '🎓', '#7C3AED',
   '["hr:read"]', '["hr_workforce"]', 'no_approval',
   'dna_pending', '1.0.0', 'people_culture', 14, '2', 'pending_design', 'none'),

  ('spec_workforce_compliance_specialist', 'workforce_compliance_specialist',
   'Workforce Compliance Specialist',
   'Reviews worker screening status, verifies required credentials, monitors registration and certification expiry, and escalates expired or invalid screening.',
   '🛡️', '#0369A1',
   '["hr:read","compliance:read"]', '["hr_workforce"]', 'no_approval',
   'dna_pending', '1.0.0', 'people_culture', 15, '2', 'pending_design', 'none'),

  -- Marketing
  ('spec_marketing_communications_manager', 'marketing_communications_manager',
   'Marketing and Communications Manager',
   'Develops marketing strategy, maintains brand positioning, plans campaigns, drafts content for web and social, prepares email campaigns, and analyses marketing performance.',
   '📣', '#D97706',
   '["marketing:read"]', '["marketing_workforce"]', 'manager_approval',
   'dna_pending', '1.0.0', 'marketing', 16, '2', 'pending_design', 'none'),

  -- Shared Professional Services
  ('spec_knowledge_documentation_specialist', 'knowledge_documentation_specialist',
   'Knowledge and Documentation Specialist',
   'Drafts professional documents and reports, reviews for completeness and NDIS alignment, converts complex content to plain English, and preserves organisational knowledge.',
   '📚', '#0D9488',
   '[]', '[]', 'no_approval',
   'dna_pending', '1.0.0', 'shared_professional_services', 17, '2', 'pending_design', 'none')

ON CONFLICT (code) DO NOTHING;

-- ── 5. Deprecate the 28 old specialists ──────────────────────────────────────

-- Research Specialist → capability distribution (no replacement employee)
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Research is now a shared capability distributed to appropriate employees. No replacement employee.',
  replacement_role_code = NULL,
  replacement_type    = 'capability_distribution',
  catalogue_version   = '2'
WHERE code = 'research_specialist' AND execution_status != 'deprecated';

-- Calendar Specialist → Executive Assistant
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Calendar management absorbed into Executive Assistant.',
  replacement_role_code = 'executive_assistant',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'calendar_specialist' AND execution_status != 'deprecated';

-- Communication Specialist → Executive Assistant
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Communication drafting absorbed into Executive Assistant.',
  replacement_role_code = 'executive_assistant',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'communication_specialist' AND execution_status != 'deprecated';

-- Compliance Officer → Compliance and Quality Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Merged into Compliance and Quality Manager (Sprint 11 consolidation). DNA v1.0.0 preserved for historical reproducibility.',
  replacement_role_code = 'compliance_quality_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'compliance_officer' AND execution_status != 'deprecated';

-- Quality Officer → Compliance and Quality Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Quality review absorbed into Compliance and Quality Manager.',
  replacement_role_code = 'compliance_quality_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'quality_officer' AND execution_status != 'deprecated';

-- Corrective Action Officer → Compliance and Quality Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Corrective action planning absorbed into Compliance and Quality Manager.',
  replacement_role_code = 'compliance_quality_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'corrective_action_officer' AND execution_status != 'deprecated';

-- Incident Review Officer → Incident and Safeguarding Specialist
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Incident review absorbed into Incident and Safeguarding Specialist.',
  replacement_role_code = 'incident_safeguarding_specialist',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'incident_review_officer' AND execution_status != 'deprecated';

-- Restrictive Practice Officer → Incident and Safeguarding Specialist
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Restrictive practice review absorbed into Incident and Safeguarding Specialist.',
  replacement_role_code = 'incident_safeguarding_specialist',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'restrictive_practice_officer' AND execution_status != 'deprecated';

-- Policy Officer → Policy and Governance Specialist
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Policy drafting absorbed into Policy and Governance Specialist.',
  replacement_role_code = 'policy_governance_specialist',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'policy_officer' AND execution_status != 'deprecated';

-- Roster Coordinator → Workforce and Rostering Coordinator
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Renamed and expanded to Workforce and Rostering Coordinator.',
  replacement_role_code = 'workforce_rostering_coordinator',
  replacement_type    = 'renamed',
  catalogue_version   = '2'
WHERE code = 'roster_coordinator' AND execution_status != 'deprecated';

-- Asset Coordinator → Process and Asset Coordinator
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Asset management absorbed into Process and Asset Coordinator.',
  replacement_role_code = 'process_asset_coordinator',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'asset_coordinator' AND execution_status != 'deprecated';

-- Workflow Coordinator → Process and Asset Coordinator
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Workflow design absorbed into Process and Asset Coordinator.',
  replacement_role_code = 'process_asset_coordinator',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'workflow_coordinator' AND execution_status != 'deprecated';

-- Accounts Officer → Finance Officer
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Accounts work absorbed into Finance Officer.',
  replacement_role_code = 'finance_officer',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'accounts_officer' AND execution_status != 'deprecated';

-- Invoice Specialist → Finance Officer
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Invoice review absorbed into Finance Officer.',
  replacement_role_code = 'finance_officer',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'invoice_specialist' AND execution_status != 'deprecated';

-- Payroll Officer → Payroll and Workforce Cost Officer
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Renamed and expanded to Payroll and Workforce Cost Officer.',
  replacement_role_code = 'payroll_workforce_cost_officer',
  replacement_type    = 'renamed',
  catalogue_version   = '2'
WHERE code = 'payroll_officer' AND execution_status != 'deprecated';

-- Budget Analyst → Financial Planning and Reporting Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Budget analysis absorbed into Financial Planning and Reporting Manager.',
  replacement_role_code = 'financial_planning_reporting_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'budget_analyst' AND execution_status != 'deprecated';

-- Financial Reporting Officer → Financial Planning and Reporting Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Financial reporting absorbed into Financial Planning and Reporting Manager.',
  replacement_role_code = 'financial_planning_reporting_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'financial_reporting_officer' AND execution_status != 'deprecated';

-- HR Officer → People and Culture Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'HR administration absorbed into People and Culture Manager.',
  replacement_role_code = 'people_culture_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'hr_officer' AND execution_status != 'deprecated';

-- Performance Officer → People and Culture Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Performance management absorbed into People and Culture Manager.',
  replacement_role_code = 'people_culture_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'performance_officer' AND execution_status != 'deprecated';

-- Recruitment Officer → Talent and Learning Specialist
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Recruitment absorbed into Talent and Learning Specialist.',
  replacement_role_code = 'talent_learning_specialist',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'recruitment_officer' AND execution_status != 'deprecated';

-- Learning Coordinator → Talent and Learning Specialist
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Learning coordination absorbed into Talent and Learning Specialist.',
  replacement_role_code = 'talent_learning_specialist',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'learning_coordinator' AND execution_status != 'deprecated';

-- Staff Compliance Officer → Workforce Compliance Specialist
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Renamed to Workforce Compliance Specialist.',
  replacement_role_code = 'workforce_compliance_specialist',
  replacement_type    = 'renamed',
  catalogue_version   = '2'
WHERE code = 'staff_compliance_officer' AND execution_status != 'deprecated';

-- Document Specialist → Knowledge and Documentation Specialist
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Renamed and expanded to Knowledge and Documentation Specialist. DNA v1.0.0 preserved as historical source version.',
  replacement_role_code = 'knowledge_documentation_specialist',
  replacement_type    = 'renamed',
  catalogue_version   = '2'
WHERE code = 'document_specialist' AND execution_status != 'deprecated';

-- Marketing Director → Marketing and Communications Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Merged into Marketing and Communications Manager.',
  replacement_role_code = 'marketing_communications_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'marketing_director' AND execution_status != 'deprecated';

-- Content Strategist → Marketing and Communications Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Content strategy absorbed into Marketing and Communications Manager.',
  replacement_role_code = 'marketing_communications_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'content_strategist' AND execution_status != 'deprecated';

-- Campaign Manager → Marketing and Communications Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Campaign management absorbed into Marketing and Communications Manager.',
  replacement_role_code = 'marketing_communications_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'campaign_manager' AND execution_status != 'deprecated';

-- Brand Manager → Marketing and Communications Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Brand management absorbed into Marketing and Communications Manager.',
  replacement_role_code = 'marketing_communications_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'brand_manager' AND execution_status != 'deprecated';

-- Social Media Specialist → Marketing and Communications Manager
UPDATE specialists SET
  execution_status    = 'deprecated',
  deprecated_at       = NOW(),
  deprecated_by       = 'platform_migration_sprint11',
  deprecation_reason  = 'Social media management absorbed into Marketing and Communications Manager.',
  replacement_role_code = 'marketing_communications_manager',
  replacement_type    = 'merged',
  catalogue_version   = '2'
WHERE code = 'social_media_specialist' AND execution_status != 'deprecated';

-- ── 6. Update pack display names ──────────────────────────────────────────────
UPDATE workforce_packs SET
  name        = 'People and Culture Workforce',
  description = 'AI employees for human resources, talent acquisition, learning and development, and workforce compliance.'
WHERE code = 'hr';

UPDATE workforce_packs SET
  description = 'AI employees for NDIS compliance management, incident and safeguarding review, and policy and governance.',
  name        = 'Compliance Workforce'
WHERE code = 'compliance';

UPDATE workforce_packs SET
  name        = 'Core Workforce',
  description = 'The essential AI workforce: Chief of Staff orchestration, Executive Assistant, and Knowledge and Documentation.'
WHERE code = 'core';

UPDATE workforce_packs SET
  name        = 'Operations Workforce',
  description = 'AI employees for service delivery, workforce rostering, and process and asset coordination.'
WHERE code = 'operations';

UPDATE workforce_packs SET
  name        = 'Finance Workforce',
  description = 'AI employees for accounts and invoicing, payroll review, and financial planning and reporting.'
WHERE code = 'finance';

UPDATE workforce_packs SET
  name        = 'Marketing Workforce',
  description = 'AI employee for marketing strategy, brand management, campaigns, and communications.',
  status      = 'available'
WHERE code = 'marketing';

-- ── 7. Update workforce_pack_specialists — add new employees ──────────────────
-- Remove old deprecated entries and add new approved ones.
-- We use INSERT ... ON CONFLICT DO NOTHING for idempotency.

-- Core Pack: chief_of_staff (retained), executive_assistant (retained), knowledge_documentation_specialist (new)
INSERT INTO workforce_pack_specialists (pack_code, specialist_code)
VALUES ('core', 'knowledge_documentation_specialist')
ON CONFLICT DO NOTHING;

-- Remove deprecated core entries from pack
DELETE FROM workforce_pack_specialists
WHERE pack_code = 'core'
  AND specialist_code IN ('research_specialist','document_specialist','calendar_specialist','communication_specialist');

-- Compliance Pack: replace old entries with new
INSERT INTO workforce_pack_specialists (pack_code, specialist_code)
VALUES
  ('compliance', 'compliance_quality_manager'),
  ('compliance', 'incident_safeguarding_specialist'),
  ('compliance', 'policy_governance_specialist')
ON CONFLICT DO NOTHING;

DELETE FROM workforce_pack_specialists
WHERE pack_code = 'compliance'
  AND specialist_code IN (
    'compliance_officer','quality_officer','policy_officer',
    'incident_review_officer','corrective_action_officer','restrictive_practice_officer'
  );

-- Operations Pack: keep operations_manager, service_delivery_coordinator; add new; remove old
INSERT INTO workforce_pack_specialists (pack_code, specialist_code)
VALUES
  ('operations', 'workforce_rostering_coordinator'),
  ('operations', 'process_asset_coordinator')
ON CONFLICT DO NOTHING;

DELETE FROM workforce_pack_specialists
WHERE pack_code = 'operations'
  AND specialist_code IN ('roster_coordinator','asset_coordinator','workflow_coordinator');

-- Finance Pack: replace all old with new
INSERT INTO workforce_pack_specialists (pack_code, specialist_code)
VALUES
  ('finance', 'finance_officer'),
  ('finance', 'payroll_workforce_cost_officer'),
  ('finance', 'financial_planning_reporting_manager')
ON CONFLICT DO NOTHING;

DELETE FROM workforce_pack_specialists
WHERE pack_code = 'finance'
  AND specialist_code IN (
    'accounts_officer','payroll_officer','invoice_specialist',
    'budget_analyst','financial_reporting_officer'
  );

-- People & Culture Pack (hr): replace all old with new
INSERT INTO workforce_pack_specialists (pack_code, specialist_code)
VALUES
  ('hr', 'people_culture_manager'),
  ('hr', 'talent_learning_specialist'),
  ('hr', 'workforce_compliance_specialist')
ON CONFLICT DO NOTHING;

DELETE FROM workforce_pack_specialists
WHERE pack_code = 'hr'
  AND specialist_code IN (
    'hr_officer','recruitment_officer','learning_coordinator',
    'performance_officer','staff_compliance_officer'
  );

-- Marketing Pack: replace all old with new
INSERT INTO workforce_pack_specialists (pack_code, specialist_code)
VALUES ('marketing', 'marketing_communications_manager')
ON CONFLICT DO NOTHING;

DELETE FROM workforce_pack_specialists
WHERE pack_code = 'marketing'
  AND specialist_code IN (
    'marketing_director','content_strategist','campaign_manager',
    'brand_manager','social_media_specialist'
  );

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  current_count INTEGER;
  deprecated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO current_count
  FROM specialists
  WHERE execution_status IN ('available','dna_pending')
    AND catalogue_version = '2';

  SELECT COUNT(*) INTO deprecated_count
  FROM specialists
  WHERE execution_status = 'deprecated';

  RAISE NOTICE 'Sprint 11 migration complete. Current employees: %, Deprecated roles: %',
    current_count, deprecated_count;

  IF current_count != 17 THEN
    RAISE WARNING 'Expected 17 current employees, found %', current_count;
  END IF;
END$$;
