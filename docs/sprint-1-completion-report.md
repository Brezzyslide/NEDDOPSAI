# Sprint 1 — Completion Report
**Date:** 2026-07-23  
**Sprint:** 1 — Authentication, Multi-tenancy & RBAC  
**Status:** ✅ Complete

---

## Overview

Sprint 1 implements the full identity and authorisation layer for NeedsOps AI+: Clerk authentication, multi-tenant membership, role-based access control, invitation workflows, audit logging, protected routes on both web and mobile, and a comprehensive permission test suite.

---

## Deliverables Completed

### 1. Database Schema

| Table | Description |
|-------|-------------|
| `users` | DB mirror of Clerk users; `externalId` = Clerk user ID; JIT-provisioned on first API hit |
| `organizations` | Full NDIS provider schema; 15+ fields incl. ABN, NDIS reg no., timezone |
| `memberships` | Links users ↔ orgs with 6 roles; status lifecycle: invited → active → suspended/revoked |
| `invitations` | Token-based invites; SHA-256 hash stored, raw token returned for email delivery |
| `tenantSettings` | Per-org settings (timezone, locale, currency, data region) |
| `auditLog` | Append-only compliance log for all state-changing operations |
| `workforcePacks` | Preserved from Sprint 0; schema updated to new style |

Schema pushed to DB with `drizzle-kit push`.

---

### 2. Library Packages

**`@workspace/shared`**
- `MembershipRole`: `owner | administrator | manager | member | viewer | auditor`
- `AUDIT_EVENTS`, `API_ERROR_CODES`, `RESERVED_SLUGS`

**`@workspace/permissions`**
- 6-role RBAC hierarchy with ~30 `PermissionAction` values
- `hasPermission(role, action)` — pure predicate
- `canModifyMembership(actorRole, targetRole)` — role elevation protection
- `roleAtLeast(role, required)` — hierarchy comparison

**`@workspace/auth`**
- `AuthenticatedIdentity`, `AppUser`, `TenantContext` interfaces
- Express `Request` augmentation: `req.appUser`, `req.tenantContext`

---

### 3. API Server — Sprint 1 Routes (`/v1/*`)

| Route | Description |
|-------|-------------|
| `GET /v1/me` | Current user profile, orgs, memberships |
| `POST /v1/organisations` | Create org + owner membership (JIT user provision) |
| `GET /v1/organisations/:slug` | Org detail |
| `PATCH /v1/organisations/:slug` | Update org metadata |
| `GET /v1/organisations/:slug/settings` | Tenant settings |
| `PATCH /v1/organisations/:slug/settings` | Update tenant settings |
| `GET /v1/organisations/:slug/members` | Member list |
| `PATCH /v1/organisations/:slug/members/:membershipId/role` | Role update |
| `PATCH /v1/organisations/:slug/members/:membershipId/suspend` | Suspend member |
| `PATCH /v1/organisations/:slug/members/:membershipId/reactivate` | Reactivate member |
| `DELETE /v1/organisations/:slug/members/:membershipId` | Remove member |
| `GET /v1/organisations/:slug/invitations` | List invitations |
| `POST /v1/organisations/:slug/invitations` | Create invitation |
| `POST /v1/organisations/:slug/invitations/:invitationId/resend` | Resend |
| `DELETE /v1/organisations/:slug/invitations/:invitationId` | Revoke |
| `POST /v1/invitations/accept` | Accept invitation (token-based) |
| `GET /v1/organisations/:slug/audit` | Audit log (paginated) |
| `GET /v1/admin/users` | Platform admin: list users |
| `GET /v1/admin/organisations` | Platform admin: list orgs |

**Middleware chain:**
```
requestId → pinoHttp → clerkProxy → CORS → bodyParser → clerkMiddleware → routes
                                                                            ↓
                                               requireAuth → resolveTenantFromSlug → requirePermission(action)
```

**Security properties:**
- Security boundary is UUID (`tenantContext.tenantId`), never slug
- Slug is cosmetic only; all DB queries use UUID
- JIT user provisioning on first authenticated request
- Invitation tokens: raw token URL-safe, SHA-256 hash in DB
- Platform admin gated on `publicMetadata.platformAdmin = true` in Clerk

---

### 4. Web Portal — Sprint 1 Pages

| Page | Route | Description |
|------|-------|-------------|
| `LandingPage` | `/` | Public deep-space marketing page |
| `OrgOnboarding` | `/onboarding` | 3-step org creation wizard |
| `InvitationAccept` | `/invitation/accept` | Token-based invitation acceptance |
| `AppHome` | `/app` | Dashboard home (authenticated) |
| `AppDashboard` | `/app/:orgSlug` | Org dashboard |
| `TeamPage` | `/app/:orgSlug/team` | Member management |
| `AuditPage` | `/app/:orgSlug/audit` | Audit log viewer |
| `OrgSettings` | `/app/:orgSlug/settings` | Org settings |
| `AccountSettings` | `/app/account` | User account settings |

**Clerk integration:**
- `ClerkProvider` wraps app; `publishableKey` from `VITE_CLERK_PUBLISHABLE_KEY`
- Shadcn theme via `@clerk/themes/shadcn.css`
- `AppShell` sidebar only rendered for authenticated users

---

### 5. Mobile App — Sprint 1 Auth

| File | Description |
|------|-------------|
| `app/_layout.tsx` | Root layout with `ClerkProvider` + auth gate |
| `app/(auth)/_layout.tsx` | Stack layout for auth screens |
| `app/(auth)/sign-in.tsx` | Clerk Core v3 sign-in flow |
| `app/(auth)/sign-up.tsx` | Sign-up with email verification step |

Uses `@clerk/expo@^4.0.1` with Clerk Core v3 APIs (`useSignIn`, `useSignUp`).

---

### 6. Tests

**`lib/permissions/src/__tests__/roles.test.ts`** (26 tests)
- Role hierarchy ordering
- Permission assignments per role
- No duplicate permissions
- `hasPermission` guard correctness

**`lib/permissions/src/__tests__/invitationToken.test.ts`** (6 tests)
- SHA-256 hash determinism
- Hash uniqueness
- Hash irreversibility
- Expiry window calculation

**`lib/permissions/src/__tests__/tenantIsolation.test.ts`** (8 tests)
- UUID boundary enforcement
- Auditor write-access denial
- Viewer read-only scope
- Membership status lifecycle

---

### 7. Seed Script

`infrastructure/scripts/seed.sh` seeds:
- 2 organisations (Horizon Support Services + Coastal Healthcare Group)
- 4 users with dev `externalId` placeholders
- 4 memberships (owner, administrator, member, owner)
- 2 tenant settings rows
- 4 workforce packs
- 1 pending invitation
- 3 audit events

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| UUID as security boundary | Slugs are user-controlled; UUIDs are immutable and unguessable |
| JIT user provisioning | Avoids sync webhooks; DB user created on first authenticated API hit |
| SHA-256 token hash in DB | Raw token never persisted; compromise of DB doesn't expose tokens |
| 6-role hierarchy with auditor aside | Auditor is compliance-only; doesn't fit the operational chain |
| Sprint 0 routes preserved at `/api` | Backwards compat; Sprint 1 at `/v1` |

---

## Test Results

All TypeScript compilations pass:
- `@workspace/api-server` ✅
- `@workspace/permissions` ✅  
- `@workspace/shared` ✅
- `@workspace/auth` ✅
- `@workspace/db` ✅
- `@workspace/validation` ✅

All four workflows running:
- `artifacts/api-server: API Server` ✅ (port 8080, build + start clean)
- `artifacts/needsops-web: web` ✅ (landing page verified via screenshot)
- `artifacts/needsops-mobile: expo` ✅ (Expo Go QR served)
- `artifacts/mockup-sandbox: Component Preview Server` ✅

---

## Sprint 2 Candidates

- Stripe billing integration (subscription management, usage metering)
- Workforce pack activation and worker provisioning
- AI worker task queue and real-time status updates
- Email delivery for invitations (currently console.log in dev)
- E2E Playwright tests for the full auth + onboarding flow
