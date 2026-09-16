-- 0064: Capture-time evidence class for knowledge sources.
--
-- Evidence class is distinct from source type and document category. It tells
-- the execution engine how a retrieved chunk may be used in participant work.

ALTER TABLE public.knowledge_sources
  ADD COLUMN IF NOT EXISTS evidence_class text NOT NULL DEFAULT 'ORGANISATIONAL_SOURCE';

ALTER TABLE public.knowledge_sources
  DROP CONSTRAINT IF EXISTS knowledge_sources_evidence_class_check,
  ADD CONSTRAINT knowledge_sources_evidence_class_check
  CHECK (
    evidence_class IN (
      'PARTICIPANT_STATED',
      'PROFESSIONAL_SOURCE',
      'ORGANISATIONAL_SOURCE',
      'PROVIDER_STATED',
      'SYSTEM_DERIVED'
    )
  );

UPDATE public.knowledge_sources
SET evidence_class = 'PROFESSIONAL_SOURCE'
WHERE source_type = 'participant_document'
   OR document_category IN (
    'behaviour_support_plan',
    'risk_assessment',
    'intake_form',
    'clinical_report',
    'allied_health_report',
    'ot_assessment',
    'speech_assessment',
    'physiotherapy_assessment',
    'mealtime_management_risk_assessment',
    'disaster_management_risk_assessment',
    'community_access_risk_assessment',
    'restrictive_practice_authorisation'
  );

UPDATE public.knowledge_sources
SET evidence_class = 'PROVIDER_STATED'
WHERE source_scope = 'task'
  AND evidence_class = 'ORGANISATIONAL_SOURCE';

UPDATE public.knowledge_sources
SET evidence_class = 'SYSTEM_DERIVED'
WHERE source_type = 'approved_example'
  AND evidence_class = 'ORGANISATIONAL_SOURCE';

CREATE INDEX IF NOT EXISTS knowledge_sources_org_evidence_class_idx
  ON public.knowledge_sources (organization_id, evidence_class)
  WHERE deleted_at IS NULL;

GRANT SELECT (evidence_class), UPDATE (evidence_class) ON public.knowledge_sources TO needsops_app;

COMMENT ON COLUMN public.knowledge_sources.evidence_class IS
  'Capture-time evidence class: PARTICIPANT_STATED, PROFESSIONAL_SOURCE, ORGANISATIONAL_SOURCE, PROVIDER_STATED, or SYSTEM_DERIVED.';
