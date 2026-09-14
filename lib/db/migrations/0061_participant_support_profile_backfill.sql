-- 0061 - Participant support profile backfill
--
-- 0060 added document categories and attempted to backfill participant support
-- facts. This forward migration makes that backfill explicit and conservative:
-- a linked approved BSP-category participant document sets the participant BSP
-- flag; health-support and restrictive-practice flags are defaulted only when
-- currently absent, because they are separate declared facts.

BEGIN;

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
      COALESCE(p.metadata #> '{supportProfile,hasRestrictivePractices}', 'false'::jsonb),
      true
    ),
    '{supportProfile,receivesHealthSupport}',
    COALESCE(p.metadata #> '{supportProfile,receivesHealthSupport}', 'false'::jsonb),
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
    AND ks.document_category = 'behaviour_support_plan'
    AND ks.status = 'approved'
    AND ks.deleted_at IS NULL
);

COMMIT;
