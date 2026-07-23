#!/usr/bin/env bash
# ─── NeedsOps AI+ — Seed development database (Sprint 1) ────────────────────
#
# Usage: ./infrastructure/scripts/seed.sh
#
# Seeds:
#   - 2 sample organisations (Horizon NDIS, Coastal Healthcare)
#   - 4 users
#   - 4 memberships (owner + staff)
#   - 2 tenant settings rows
#   - 4 workforce packs
#   - 1 pending invitation
#
# Requires DATABASE_URL to be set.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

echo "🌱 Seeding database..."

psql "$DATABASE_URL" <<'SQL'
-- Truncate all tables (CASCADE handles FK ordering)
TRUNCATE TABLE
  audit_log, invitations, tenant_settings, memberships,
  workforce_packs, users, organizations
CASCADE;

-- ── Workforce packs ──────────────────────────────────────────────────────────
-- Schema: id, name, description, industry, workers (jsonb), tier, status
INSERT INTO workforce_packs (id, name, description, industry, workers, tier, status)
VALUES
  ('11111111-0000-0000-0000-000000000001', 'NDIS Compliance Suite', 'Full NDIS compliance automation', 'ndis_provider', '[]'::jsonb, 'professional', 'available'),
  ('11111111-0000-0000-0000-000000000002', 'Workforce Operations', 'HR and rostering automation', 'ndis_provider', '[]'::jsonb, 'starter', 'available'),
  ('11111111-0000-0000-0000-000000000003', 'Enterprise Intelligence', 'BI and reporting workers', 'general', '[]'::jsonb, 'enterprise', 'available'),
  ('11111111-0000-0000-0000-000000000004', 'Healthcare Bridge', 'Aged care integration pack', 'healthcare', '[]'::jsonb, 'starter', 'coming_soon');

-- ── Organisations ─────────────────────────────────────────────────────────────
INSERT INTO organizations (id, name, slug, display_name, type, industry, country, state, timezone, status, subscription_tier, abn, ndis_registration_number)
VALUES
  ('22222222-0000-0000-0000-000000000001', 'Horizon Support Services', 'horizon-support', 'Horizon Support', 'ndis_provider', 'ndis_provider', 'AU', 'NSW', 'Australia/Sydney', 'active', 'professional', '12 345 678 901', '4050000001'),
  ('22222222-0000-0000-0000-000000000002', 'Coastal Healthcare Group', 'coastal-healthcare', 'Coastal Healthcare', 'healthcare', 'healthcare', 'AU', 'QLD', 'Australia/Brisbane', 'active', 'starter', '98 765 432 109', NULL);

-- ── Tenant settings ───────────────────────────────────────────────────────────
INSERT INTO tenant_settings (id, organization_id)
VALUES
  ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002');

-- ── Users ─────────────────────────────────────────────────────────────────────
-- Note: external_id must match a real Clerk user ID to authenticate.
-- These are placeholder records for local dev/testing without Clerk.
INSERT INTO users (id, external_id, email, first_name, last_name, display_name, status)
VALUES
  ('44444444-0000-0000-0000-000000000001', 'user_dev_owner_1',  'alice@horizon.com.au',  'Alice', 'Chen',     'Alice Chen',     'active'),
  ('44444444-0000-0000-0000-000000000002', 'user_dev_admin_1',  'bob@horizon.com.au',    'Bob',   'Thompson', 'Bob Thompson',   'active'),
  ('44444444-0000-0000-0000-000000000003', 'user_dev_member_1', 'carol@horizon.com.au',  'Carol', 'Williams', 'Carol Williams', 'active'),
  ('44444444-0000-0000-0000-000000000004', 'user_dev_owner_2',  'diana@coastal.com.au',  'Diana', 'Nguyen',   'Diana Nguyen',   'active');

-- ── Memberships ───────────────────────────────────────────────────────────────
INSERT INTO memberships (id, organization_id, user_id, role, status)
VALUES
  ('55555555-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'owner',         'active'),
  ('55555555-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', 'administrator', 'active'),
  ('55555555-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000003', 'member',        'active'),
  ('55555555-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000004', 'owner',         'active');

-- ── Invitations ───────────────────────────────────────────────────────────────
-- Column: invited_by (FK to users.id), token_hash, expires_at
-- token_hash is SHA-256 of placeholder raw token "dev_test_invite_token_001"
INSERT INTO invitations (id, organization_id, invited_by, email, role, status, token_hash, expires_at)
VALUES
  ('66666666-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001',
   '44444444-0000-0000-0000-000000000001',
   'newstaff@example.com.au',
   'member',
   'pending',
   '6fa2d3e1bb7a2e4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8',
   NOW() + INTERVAL '7 days');

-- ── Audit events ──────────────────────────────────────────────────────────────
INSERT INTO audit_log (id, organization_id, actor_user_id, actor_type, event_type, resource_type, resource_id, occurred_at)
VALUES
  ('77777777-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'user', 'organisation.created',  'organisation', '22222222-0000-0000-0000-000000000001', NOW() - INTERVAL '5 days'),
  ('77777777-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'user', 'membership.created',    'membership',   '55555555-0000-0000-0000-000000000002', NOW() - INTERVAL '4 days'),
  ('77777777-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'user', 'invitation.created',    'invitation',   '66666666-0000-0000-0000-000000000001', NOW() - INTERVAL '1 day');

SELECT 'Seed complete ✓' as status,
  (SELECT count(*) FROM organizations)   as orgs,
  (SELECT count(*) FROM users)           as users,
  (SELECT count(*) FROM memberships)     as memberships,
  (SELECT count(*) FROM invitations)     as invitations,
  (SELECT count(*) FROM workforce_packs) as workforce_packs,
  (SELECT count(*) FROM audit_log)       as audit_events;
SQL

echo "✅ Done."
