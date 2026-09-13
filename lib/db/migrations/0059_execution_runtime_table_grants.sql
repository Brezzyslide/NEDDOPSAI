-- 0059 - Execution runtime table grants
--
-- Tables added after the original app-role grant baseline still rely on
-- public-schema RLS for tenant isolation, but table privileges were missing.
-- Grant the request-serving role access to the execution runtime tables it
-- must read/write while keeping audit/provisioning paths behind their bounded
-- function or platform-only boundaries.

BEGIN;

GRANT SELECT ON TABLE
  public.work_blueprints,
  public.blueprint_sections,
  public.blueprint_versions,
  public.work_templates,
  public.blueprint_intent_mappings
TO needsops_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.work_package_manifests,
  public.completed_work,
  public.completed_work_versions,
  public.completed_work_comments,
  public.completed_work_assets,
  public.completed_work_evidence_snapshots,
  public.completed_work_evidence_links,
  public.completed_work_claims,
  public.completed_work_claim_evidence,
  public.work_artifacts,
  public.execution_checkpoints,
  public.execution_actions
TO needsops_app;

COMMIT;
