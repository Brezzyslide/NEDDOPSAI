# Sprint 3 — Middleware: Platform Auth

## requirePlatformAuth

File: `artifacts/api-server/src/middlewares/requirePlatformRole.ts`

```typescript
import { requirePlatformAuth, requirePlatformRole } from "../middlewares/requirePlatformRole.js";
```

### What it does

1. Validates the Clerk JWT (via `getAuth(req)`)
2. Looks up the user's row in `platform_roles` WHERE `revoked_at IS NULL`
3. If no row exists, checks `publicMetadata.platformAdmin` as a bootstrap fallback
4. Attaches `req.platformRole` and `req.platformUserId` for downstream use

### Usage

```typescript
// Gate an entire router to any platform role
router.use(requirePlatformAuth);

// Gate a specific route to a specific role (super_admin always passes)
router.post("/suspend", requirePlatformRole("platform_admin"), handler);
```

### Role hierarchy

`platform_super_admin` bypasses all `requirePlatformRole` checks. All other roles must match exactly.

---

## requirePermission (tenant RBAC)

File: `artifacts/api-server/src/middlewares/requirePermission.ts`

Enforces org-level RBAC. Must run after `resolveTenantFromSlug`.

```typescript
router.delete("/:id", requireAuth, resolveTenantFromSlug, requirePermission("member:remove"), handler);
```

Permissions are derived from the user's org role (owner, admin, member, viewer, agent). See `lib/permissions` for the full permission matrix.

---

## Middleware Chain Summary

### Tenant routes (`/v1/organisations/:slug/*`)

```
requireAuth
  └─ resolveTenantFromSlug   (attaches req.tenantContext)
       └─ requirePermission  (optional, action-specific)
```

### Platform routes (`/v1/platform/*`)

```
requirePlatformAuth
  └─ requirePlatformRole     (optional, role-specific)
```

### Legacy admin routes (`/v1/admin/*`)

```
requireAuth
  └─ requirePlatformAdmin    (re-exported from requirePlatformRole.ts)
```

`requirePlatformAdmin` is the same as `requirePlatformAuth` — it accepts either a Clerk `platformAdmin` flag or a DB platform role. This backward-compatible alias ensures existing `/admin` routes continue to work.

---

## Security Rules

- **Never** grant platform console access based on org membership or subscription tier.
- Platform roles are granted via the `platform_roles` table only.
- The Clerk `publicMetadata.platformAdmin` flag is a bootstrap mechanism only — it must be removed once the first `platform_super_admin` DB row is created.
- `req.platformRole` and `req.platformUserId` are only populated by `requirePlatformAuth`. Never assume they exist without running that middleware.
