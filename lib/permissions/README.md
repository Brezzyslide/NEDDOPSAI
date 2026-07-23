# @workspace/permissions

Role-based access control (RBAC) for the NeedsOps AI+ platform.

## Sprint 0 status

Functional. Defines the full permission model — role hierarchy, permission actions, and guard functions. Ready for integration in Sprint 1.

## Architecture

- Four-tier role hierarchy per organisation: `viewer → member → admin → owner`
- Permissions are additive (owners have all permissions)
- `hasPermission(user, action)` — check a single permission
- `assertPermission(user, action)` — throw if not permitted (Sprint 1: return HTTP 403)
- `assertTenantAccess(user, orgId)` — core tenant isolation guard

## Sprint 1 integration

Wire `assertTenantAccess` into the `requireTenantAccess` middleware in `@workspace/auth`.
