-- 0050_platform_public_worker_boundaries.sql
--
-- Adds separate app roles for platform-console and worker claim paths,
-- column-scoped public catalogue grants, and a worker-only ingestion claim
-- function. These roles do not own schemas and cannot perform DDL or grant
-- privileges.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'needsops_platform_app') THEN
    CREATE ROLE needsops_platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'needsops_worker_app') THEN
    CREATE ROLE needsops_worker_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO needsops_platform_app;
GRANT USAGE ON SCHEMA public TO needsops_worker_app;
GRANT needsops_app TO needsops_worker_app;

-- Platform console grants. This is intentionally not the migration role:
-- no schema ownership, no DDL, no GRANT OPTION.
GRANT SELECT ON TABLE
  public.organizations,
  public.users,
  public.memberships,
  public.audit_log,
  public.platform_audit_log,
  public.platform_roles,
  public.platform_internal_notes,
  public.platform_settings,
  public.feature_flags,
  public.plans,
  public.plan_versions,
  public.plan_features,
  public.plan_workforce_packs,
  public.plan_usage_allowances,
  public.features,
  public.usage_dimensions,
  public.usage_events,
  public.usage_period_summaries,
  public.tenant_subscriptions,
  public.tenant_entitlements,
  public.tenant_workforce_packs,
  public.tenant_overrides,
  public.seat_overrides,
  public.tasks,
  public.approvals,
  public.workforce_packs,
  public.workforce_pack_price_versions,
  public.workforce_pack_access_requests,
  public.specialist_catalogue,
  public.specialist_runs,
  public.execution_sessions,
  public.org_database_registry,
  public.devices,
  public.device_credentials,
  public.device_access_tokens,
  public.device_refresh_tokens,
  public.installer_releases,
  public.installer_download_events
TO needsops_platform_app;

GRANT INSERT, UPDATE ON TABLE
  public.organizations,
  public.platform_audit_log,
  public.platform_roles,
  public.platform_internal_notes,
  public.platform_settings,
  public.feature_flags,
  public.plans,
  public.plan_versions,
  public.plan_features,
  public.plan_workforce_packs,
  public.plan_usage_allowances,
  public.tenant_subscriptions,
  public.tenant_entitlements,
  public.tenant_workforce_packs,
  public.tenant_overrides,
  public.seat_overrides,
  public.workforce_packs,
  public.workforce_pack_price_versions,
  public.workforce_pack_access_requests,
  public.specialist_catalogue,
  public.devices,
  public.device_credentials,
  public.device_access_tokens,
  public.device_refresh_tokens,
  public.installer_releases
TO needsops_platform_app;

-- Public catalogue reads exposed to the normal API role. Column lists exclude
-- internal plan/version notes and staff-only authorship fields.
GRANT SELECT (
  id, code, name, description, is_public, is_active, display_order,
  trial_length_days, monthly_price_cents, annual_price_cents, currency,
  created_at, updated_at
) ON TABLE public.plans TO needsops_app;

GRANT SELECT (
  id, plan_id, version_number, label, is_active, is_legacy,
  included_seats, max_seats, activated_at, archived_at, created_at, updated_at
) ON TABLE public.plan_versions TO needsops_app;

GRANT SELECT (plan_version_id, feature_code, enabled_by_default, created_at)
  ON TABLE public.plan_features TO needsops_app;
GRANT SELECT (plan_version_id, pack_code, is_included, created_at)
  ON TABLE public.plan_workforce_packs TO needsops_app;
GRANT SELECT (plan_version_id, dimension_code, hard_limit, soft_limit_pct, created_at)
  ON TABLE public.plan_usage_allowances TO needsops_app;

GRANT SELECT (
  id, version, channel, platform, arch, download_url, sha256,
  file_size_bytes, min_os_version, release_notes, is_current,
  published_at, created_at, updated_at
) ON TABLE public.installer_releases TO needsops_app;

GRANT INSERT (
  id, release_id, organization_id, user_id, platform, arch, ip_hash, user_agent
) ON TABLE public.installer_download_events TO needsops_app;

GRANT SELECT (
  id, code, name, description, marketing_tagline, industry, icon_emoji,
  color_hex, tier, status, price_monthly_cents, price_annual_cents,
  currency, display_order, featured, is_publicly_visible, is_free,
  pricing_status, fallback_display_text, auto_grant_on_signup,
  trial_eligible, trial_length_days, requires_manual_approval,
  requires_payment, publicly_selectable, selection_mode, created_at, updated_at
) ON TABLE public.workforce_packs TO needsops_app;

GRANT SELECT (
  id, workforce_pack_id, version_number, monthly_price_cents,
  annual_price_cents, currency, status, effective_from, effective_to,
  is_current, published_at, created_at, updated_at
) ON TABLE public.workforce_pack_price_versions TO needsops_app;

GRANT SELECT (
  id, specialist_code, display_name, description, execution_status,
  availability, category, icon_metadata, pack_membership, plan_visibility,
  coming_soon, display_order, version_metadata, is_active, is_archived,
  version_counter, created_at, updated_at
) ON TABLE public.specialist_catalogue TO needsops_app;

CREATE OR REPLACE FUNCTION public.claim_next_ingestion_job(
  p_worker_id TEXT
)
RETURNS TABLE (
  id TEXT,
  "organizationId" TEXT,
  "knowledgeSourceId" TEXT,
  "sourceVersionId" TEXT,
  status TEXT,
  "attemptCount" INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.ingestion_jobs
     SET status = 'fetching',
         claimed_by = p_worker_id,
         claimed_at = NOW(),
         last_attempt_at = NOW(),
         attempt_count = attempt_count + 1,
         started_at = COALESCE(started_at, NOW()),
         updated_at = NOW()
   WHERE id = (
     SELECT id
       FROM public.ingestion_jobs
      WHERE status = 'queued'
         OR (status = 'failed' AND attempt_count < max_attempts)
      ORDER BY created_at ASC, id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
   RETURNING
     ingestion_jobs.id,
     ingestion_jobs.organization_id,
     ingestion_jobs.knowledge_source_id,
     ingestion_jobs.source_version_id,
     ingestion_jobs.status,
     ingestion_jobs.attempt_count;
$$;

COMMENT ON FUNCTION public.claim_next_ingestion_job(TEXT) IS
  'Worker-only bounded ingestion queue claim using FOR UPDATE SKIP LOCKED; returns minimal fields needed to enter tenant-scoped processing.';

REVOKE ALL ON FUNCTION public.claim_next_ingestion_job(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_ingestion_job(TEXT) TO needsops_worker_app;

COMMIT;
