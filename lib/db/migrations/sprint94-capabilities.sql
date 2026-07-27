-- Sprint 9.4 — Capability Identification, Entitlement Enforcement and Upgrade Guidance
-- Platform DB: creates business_capabilities and capability_decisions tables.
-- Run against the platform database.

BEGIN;

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE capability_category AS ENUM (
    'compliance','quality','policy','incident','operations','service_delivery',
    'roster','human_resources','staff_compliance','learning','finance',
    'accounting','payroll','invoicing','budgeting','reporting','marketing',
    'communications','documents','research','calendar','administration'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE capability_level_enum AS ENUM (
    'general_information','professional_analysis','execution'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE capability_status_enum AS ENUM (
    'active','beta','coming_soon','deprecated'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE capability_decision_result AS ENUM (
    'allowed','partially_allowed','blocked','clarification_required'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── business_capabilities ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_capabilities (
  id                          TEXT PRIMARY KEY,
  code                        TEXT NOT NULL UNIQUE,
  display_name                TEXT NOT NULL,
  description                 TEXT NOT NULL,
  category                    capability_category NOT NULL,
  pack_code                   TEXT,
  eligible_roles              JSONB NOT NULL DEFAULT '[]',
  required_worker_profiles    JSONB NOT NULL DEFAULT '[]',
  required_execution_channels JSONB NOT NULL DEFAULT '[]',
  required_connector_categories JSONB NOT NULL DEFAULT '[]',
  default_risk_level          TEXT NOT NULL DEFAULT 'medium',
  default_approval_required   BOOLEAN NOT NULL DEFAULT FALSE,
  information_allowed         BOOLEAN NOT NULL DEFAULT TRUE,
  analysis_allowed            BOOLEAN NOT NULL DEFAULT TRUE,
  execution_allowed           BOOLEAN NOT NULL DEFAULT FALSE,
  status                      capability_status_enum NOT NULL DEFAULT 'active',
  version                     TEXT NOT NULL DEFAULT '1.0',
  effective_date              TIMESTAMPTZ NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_business_capabilities_code    ON business_capabilities (code);
CREATE INDEX IF NOT EXISTS idx_business_capabilities_pack    ON business_capabilities (pack_code);
CREATE INDEX IF NOT EXISTS idx_business_capabilities_status  ON business_capabilities (status);
CREATE INDEX IF NOT EXISTS idx_business_capabilities_cat     ON business_capabilities (category);

-- ── capability_decisions ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS capability_decisions (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id                   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id           TEXT,
  task_id                   TEXT,
  specialist_run_id         TEXT,
  requested_capability_code TEXT NOT NULL,
  requested_level           TEXT NOT NULL,
  decision                  capability_decision_result NOT NULL,
  reason_code               TEXT NOT NULL,
  source                    TEXT NOT NULL,
  required_workforce_pack   TEXT,
  upgrade_options           JSONB NOT NULL DEFAULT '[]',
  evaluated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                TIMESTAMPTZ,
  correlation_id            TEXT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cap_decisions_org         ON capability_decisions (organization_id);
CREATE INDEX IF NOT EXISTS idx_cap_decisions_user        ON capability_decisions (user_id);
CREATE INDEX IF NOT EXISTS idx_cap_decisions_conv        ON capability_decisions (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cap_decisions_task        ON capability_decisions (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cap_decisions_code        ON capability_decisions (requested_capability_code);
CREATE INDEX IF NOT EXISTS idx_cap_decisions_decision    ON capability_decisions (decision);
CREATE INDEX IF NOT EXISTS idx_cap_decisions_reason      ON capability_decisions (reason_code);
CREATE INDEX IF NOT EXISTS idx_cap_decisions_correlation ON capability_decisions (correlation_id);
CREATE INDEX IF NOT EXISTS idx_cap_decisions_evaluated   ON capability_decisions (evaluated_at);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE capability_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cap_decisions_org_isolation ON capability_decisions;
CREATE POLICY cap_decisions_org_isolation ON capability_decisions
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

-- business_capabilities is platform-managed (no tenant RLS)

-- ── Seed: canonical capability registry ──────────────────────────────────────

INSERT INTO business_capabilities
  (id, code, display_name, description, category, pack_code,
   eligible_roles, required_worker_profiles, required_execution_channels,
   required_connector_categories, default_risk_level, default_approval_required,
   information_allowed, analysis_allowed, execution_allowed,
   status, version, effective_date)
VALUES
-- Core
('cap94_admin',   'administration.general',   'General Administration',   'General administrative support, scheduling, and coordination',       'administration', NULL,         '["chief_of_staff","executive_assistant"]',       '[]','[]','[]','low', FALSE, TRUE, TRUE, TRUE,  'active','1.0','2025-01-01'),
('cap94_cal',     'calendar.management',      'Calendar Management',      'Schedule meetings, manage calendars, send invitations',              'calendar',       NULL,         '["executive_assistant","chief_of_staff"]',       '[]','["browser_session"]','["calendar"]','low', FALSE, TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_comm',    'communications.draft',     'Draft Communications',     'Draft emails, letters, memos and other communications',              'communications', NULL,         '["executive_assistant","document_specialist","chief_of_staff","marketing_director"]','[]','[]','[]','low', FALSE, TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_docs',    'documents.draft',          'Draft Documents',          'Create, format and review operational documents and reports',         'documents',      NULL,         '["document_specialist","chief_of_staff","research_specialist"]','[]','[]','[]','low', FALSE, TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_res',     'research.general',         'Research',                 'Research regulations, best practices, and industry standards',        'research',       NULL,         '["research_specialist","chief_of_staff"]',       '[]','[]','[]','low', FALSE, TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
-- Compliance
('cap94_c1','compliance.audit_readiness',       'Audit Readiness Assessment',   'Assess organisation readiness for NDIS audits',                 'compliance',   'compliance','["compliance_officer"]','["compliance_auditor"]','[]','[]','high',TRUE, TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_c2','compliance.gap_analysis',          'Compliance Gap Analysis',      'Identify compliance gaps against NDIS Practice Standards',      'compliance',   'compliance','["compliance_officer"]','["compliance_auditor"]','[]','[]','high',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_c3','compliance.evidence_review',       'Evidence Review',              'Review and assess compliance evidence documentation',           'compliance',   'compliance','["compliance_officer"]','["compliance_auditor"]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_c4','compliance.corrective_actions',    'Corrective Action Planning',   'Plan and track corrective actions for compliance findings',     'compliance',   'compliance','["compliance_officer"]','["compliance_auditor"]','[]','[]','high',TRUE, TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_c5','policy.review',                    'Policy Review',                'Review and validate organisational policies',                   'policy',       'compliance','["compliance_officer","document_specialist"]','[]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_c6','incident.review',                  'Incident Review',              'Investigate, document, and analyse incidents',                  'incident',     'compliance','["compliance_officer"]','["compliance_auditor"]','[]','[]','critical',TRUE,TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_c7','restrictive_practice.review',      'Restrictive Practice Review',  'Review restrictive practices per NDIS requirements',           'compliance',   'compliance','["compliance_officer"]','["compliance_auditor"]','[]','[]','critical',TRUE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_c8','quality.practice_standard_review', 'Practice Standard Review',     'Review organisation practices against NDIS standards',         'quality',      'compliance','["compliance_officer"]','[]','[]','[]','high',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
-- Finance
('cap94_f1','finance.invoice_review',           'Invoice Review',               'Review and validate invoices against service agreements',      'finance',      'finance',   '["accounts_officer"]','["finance_analyst"]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_f2','finance.budget_analysis',          'Budget Analysis',              'Analyse budgets, variances, and financial performance',        'finance',      'finance',   '["accounts_officer"]','["finance_analyst"]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_f3','finance.cost_impact_analysis',     'Cost Impact Analysis',         'Analyse the financial impact of operational decisions',        'finance',      'finance',   '["accounts_officer"]','["finance_analyst"]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_f4','finance.financial_reporting',      'Financial Reporting',          'Prepare financial statements and management reports',          'reporting',    'finance',   '["accounts_officer"]','["finance_analyst"]','["browser_session"]','["accounting"]','high',TRUE, TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_a1','accounting.reconciliation',        'Account Reconciliation',       'Reconcile accounts and bank statements',                       'accounting',   'finance',   '["accounts_officer"]','["finance_analyst"]','["browser_session"]','["accounting"]','high',TRUE, TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_a2','accounting.bas_analysis',          'BAS Analysis',                 'Analyse Business Activity Statement data and GST obligations', 'accounting',   'finance',   '["accounts_officer"]','["finance_analyst"]','[]','["accounting"]','high',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_a3','accounting.bas_preparation',       'BAS Preparation',              'Prepare and lodge Business Activity Statements',               'accounting',   'finance',   '["accounts_officer"]','["finance_analyst"]','["browser_session"]','["accounting"]','critical',TRUE, TRUE, FALSE,TRUE, 'active','1.0','2025-01-01'),
('cap94_p1','payroll.review',                   'Payroll Review',               'Review payroll records for accuracy and compliance',           'payroll',      'finance',   '["accounts_officer"]','["finance_analyst"]','[]','[]','high',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_p2','payroll.schads_analysis',          'SCHADS Award Analysis',        'Analyse payroll against SCHADS Award rates and conditions',    'payroll',      'finance',   '["accounts_officer"]','["finance_analyst"]','[]','[]','high',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_i1','invoicing.create_draft',           'Create Invoice Draft',         'Create and submit draft invoices for NDIS services',          'invoicing',    'finance',   '["accounts_officer"]','["finance_analyst"]','["browser_session"]','["accounting"]','high',TRUE, TRUE, FALSE,TRUE, 'active','1.0','2025-01-01'),
-- HR
('cap94_h1','hr.recruitment',                   'Recruitment',                  'Support recruitment processes and candidate screening',        'human_resources','hr',      '["hr_officer"]','[]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_h2','hr.onboarding',                    'Staff Onboarding',             'Manage employee onboarding and setup',                         'human_resources','hr',      '["hr_officer"]','[]','["browser_session"]','["hrms"]','medium',FALSE,TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_h3','hr.performance',                   'Performance Management',       'Support performance review processes',                         'human_resources','hr',      '["hr_officer"]','[]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_s1','staff_compliance.qualification_review','Staff Qualification Review','Review staff qualifications and NDIS worker screening',      'staff_compliance','hr',     '["hr_officer","compliance_officer"]','[]','[]','[]','high',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_l1','learning.training_gap_analysis',   'Training Gap Analysis',        'Identify training gaps against NDIS mandatory requirements',   'learning',     'hr',        '["hr_officer"]','[]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
-- Operations
('cap94_o1','operations.workflow_review',       'Workflow Review',              'Review and improve operational workflows and processes',       'operations',   'operations','["operations_manager"]','[]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_o2','operations.capacity_analysis',     'Capacity Analysis',            'Analyse workforce capacity against service delivery needs',    'operations',   'operations','["operations_manager"]','[]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_o3','roster.review',                    'Roster Review',                'Review rosters for SCHADS compliance and coverage',           'roster',       'operations','["operations_manager"]','[]','[]','[]','medium',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_o4','service_delivery.review',          'Service Delivery Review',      'Review service delivery quality and participant outcomes',     'service_delivery','operations','["operations_manager"]','[]','[]','[]','high',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_o5','asset.review',                     'Asset Review',                 'Review and manage organisational assets and resources',        'administration','operations','["operations_manager"]','[]','[]','[]','low',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
-- Marketing
('cap94_m1','marketing.campaign_planning',      'Campaign Planning',            'Plan and coordinate marketing campaigns',                      'marketing',    'marketing', '["marketing_director"]','[]','[]','[]','low',FALSE,TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_m2','marketing.brand_management',       'Brand Management',             'Manage brand assets, guidelines, and consistency',            'marketing',    'marketing', '["marketing_director"]','[]','[]','[]','low',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01'),
('cap94_m3','marketing.content_strategy',       'Content Strategy',             'Develop content plans and social media strategy',             'marketing',    'marketing', '["marketing_director"]','[]','[]','[]','low',FALSE,TRUE, TRUE, TRUE, 'active','1.0','2025-01-01'),
('cap94_m4','reporting.marketing',              'Marketing Reporting',          'Analyse marketing performance and return on investment',       'reporting',    'marketing', '["marketing_director"]','[]','[]','[]','low',FALSE,TRUE, TRUE, FALSE,'active','1.0','2025-01-01')
ON CONFLICT (code) DO NOTHING;

COMMIT;
