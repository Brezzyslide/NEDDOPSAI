-- 0060 - Participant document categories
--
-- `source_type` is a retrieval/scope marker. Participant documents need a
-- separate professional category so evidence gates can distinguish a BSP from
-- a risk assessment without relying on filenames or content regexes.

BEGIN;

ALTER TABLE public.knowledge_sources
  ADD COLUMN IF NOT EXISTS document_category text,
  ADD COLUMN IF NOT EXISTS document_category_suggested text,
  ADD COLUMN IF NOT EXISTS document_category_suggestion_confidence text,
  ADD COLUMN IF NOT EXISTS document_category_confirmed_by_user_id text,
  ADD COLUMN IF NOT EXISTS document_category_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_category_matched_suggestion boolean;

ALTER TABLE public.knowledge_sources
  DROP CONSTRAINT IF EXISTS knowledge_sources_document_category_check,
  ADD CONSTRAINT knowledge_sources_document_category_check
  CHECK (
    document_category IS NULL OR document_category IN (
      'care_plan',
      'health_support_plan',
      'behaviour_support_plan',
      'risk_assessment',
      'restrictive_practice_authorisation',
      'participant_document',
      'ndis_plan',
      'strengths_based_questionnaire',
      'intake_form',
      'service_agreement',
      'mealtime_management_risk_assessment',
      'allied_health_report',
      'home_safety_checklist',
      'other_participant_document'
    )
  );

ALTER TABLE public.knowledge_sources
  DROP CONSTRAINT IF EXISTS knowledge_sources_document_category_suggested_check,
  ADD CONSTRAINT knowledge_sources_document_category_suggested_check
  CHECK (
    document_category_suggested IS NULL OR document_category_suggested IN (
      'care_plan',
      'health_support_plan',
      'behaviour_support_plan',
      'risk_assessment',
      'restrictive_practice_authorisation',
      'participant_document',
      'ndis_plan',
      'strengths_based_questionnaire',
      'intake_form',
      'service_agreement',
      'mealtime_management_risk_assessment',
      'allied_health_report',
      'home_safety_checklist',
      'other_participant_document'
    )
  );

CREATE INDEX IF NOT EXISTS knowledge_sources_org_document_category_idx
  ON public.knowledge_sources (organization_id, document_category)
  WHERE deleted_at IS NULL AND document_category IS NOT NULL;

COMMENT ON COLUMN public.knowledge_sources.document_category IS
  'Uploader-selected professional document category. For participant documents, source_type remains participant_document and this field carries BSP/risk/care-plan/etc.';

COMMENT ON COLUMN public.knowledge_sources.document_category_suggested IS
  'Optional model/rule suggestion shown to the uploader. It must not be pre-selected.';

COMMENT ON COLUMN public.knowledge_sources.document_category_matched_suggestion IS
  'Whether the user-selected category matched the visible suggestion.';

GRANT SELECT (
  document_category,
  document_category_suggested,
  document_category_suggestion_confidence,
  document_category_confirmed_by_user_id,
  document_category_confirmed_at,
  document_category_matched_suggestion
) ON public.knowledge_sources TO needsops_app;

GRANT UPDATE (
  document_category,
  document_category_suggested,
  document_category_suggestion_confidence,
  document_category_confirmed_by_user_id,
  document_category_confirmed_at,
  document_category_matched_suggestion,
  updated_at
) ON public.knowledge_sources TO needsops_app;

-- Backfill Micheal/MR participant documents that were approved before the
-- category field existed. These are scoped by title/original filename so the
-- migration is idempotent and does not rely on environment-specific IDs.
UPDATE public.knowledge_sources
SET document_category = 'behaviour_support_plan',
    updated_at = now()
WHERE source_type = 'participant_document'
  AND document_category IS NULL
  AND (
    title ILIKE '%CBSP%'
    OR original_file_name ILIKE '%CBSP%'
    OR title ILIKE '%behaviour support plan%'
    OR original_file_name ILIKE '%behaviour support plan%'
  );

UPDATE public.knowledge_sources
SET document_category = 'risk_assessment',
    updated_at = now()
WHERE source_type = 'participant_document'
  AND document_category IS NULL
  AND (
    title ILIKE '%risk assessment%'
    OR original_file_name ILIKE '%risk assessment%'
  );

UPDATE public.knowledge_sources
SET document_category = 'intake_form',
    updated_at = now()
WHERE source_type = 'participant_document'
  AND document_category IS NULL
  AND (
    title ILIKE '%intake%'
    OR original_file_name ILIKE '%intake%'
  );

-- Backfill the linked participant facts for Micheal/MR where the known CBSP
-- source is attached. These flags are the condition source of truth; uploaded
-- documents do not themselves activate a conditional requirement.
UPDATE public.participants p
SET metadata = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(p.metadata, '{}'::jsonb),
        '{supportProfile,hasBehaviourSupportPlan}',
        'true'::jsonb,
        true
      ),
      '{supportProfile,hasRestrictivePractices}',
      'false'::jsonb,
      true
    ),
    '{supportProfile,receivesHealthSupport}',
    'false'::jsonb,
    true
  ),
  updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM public.knowledge_source_scopes kss
  JOIN public.knowledge_sources ks ON ks.id = kss.knowledge_source_id
  WHERE kss.organization_id = p.organization_id
    AND kss.scope_type = 'entity'
    AND kss.scope_id = p.id
    AND ks.source_type = 'participant_document'
    AND (
      ks.title ILIKE '%CBSP%'
      OR ks.original_file_name ILIKE '%CBSP%'
      OR ks.title ILIKE '%behaviour support plan%'
      OR ks.original_file_name ILIKE '%behaviour support plan%'
    )
);

COMMIT;
