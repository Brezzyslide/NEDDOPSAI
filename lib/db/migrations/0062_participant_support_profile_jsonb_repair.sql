-- 0062 - Participant support profile JSONB repair
--
-- jsonb_set does not create missing intermediate objects for
-- {supportProfile, ...}. Repair participants that have linked approved
-- BSP-category evidence by merging an explicit supportProfile object.

BEGIN;

UPDATE public.participants p
SET metadata = COALESCE(p.metadata, '{}'::jsonb)
  || jsonb_build_object(
    'supportProfile',
    COALESCE(p.metadata->'supportProfile', '{}'::jsonb)
      || jsonb_build_object(
        'hasBehaviourSupportPlan',
        true,
        'hasRestrictivePractices',
        COALESCE(p.metadata #> '{supportProfile,hasRestrictivePractices}', 'false'::jsonb),
        'receivesHealthSupport',
        COALESCE(p.metadata #> '{supportProfile,receivesHealthSupport}', 'false'::jsonb)
      )
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
