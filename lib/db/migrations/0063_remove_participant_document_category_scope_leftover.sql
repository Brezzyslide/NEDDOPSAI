-- 0063 - Remove participant_document from document categories
--
-- `participant_document` is a source/scope type, not a professional document
-- category. Generic participant documents use `other_participant_document`;
-- category-specific participant documents use BSP/risk/intake/etc.

BEGIN;

UPDATE public.knowledge_sources
SET document_category = 'other_participant_document',
    updated_at = now()
WHERE document_category = 'participant_document';

UPDATE public.knowledge_sources
SET document_category_suggested = 'other_participant_document',
    updated_at = now()
WHERE document_category_suggested = 'participant_document';

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

COMMENT ON COLUMN public.knowledge_sources.document_category IS
  'Uploader-selected professional document category. For participant documents, source_type remains participant_document and this field carries BSP/risk/care-plan/etc.; generic participant documents use other_participant_document.';

COMMIT;
