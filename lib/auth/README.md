# @workspace/auth

Authentication infrastructure for the NeedsOps AI+ platform.

## Sprint 0 status

Shell only. Exports types (`AuthUser`, `Session`, `JWTPayload`, `AuthContext`) and passthrough middleware stubs (`requireAuth`, `requireTenantAccess`).

## Sprint 1 plan

- Integrate Clerk for JWT-based authentication
- Implement `requireAuth` middleware with real token verification
- Implement `requireTenantAccess` middleware enforcing `req.auth.user.organizationId === req.params.orgId`
- Add `setAuthTokenGetter` hook for the React client

## Usage (Sprint 1+)

```typescript
import { requireAuth, requireTenantAccess } from "@workspace/auth";

// On all protected routes
app.use("/api", requireAuth);

// On all tenant-scoped routes
app.use("/api/organizations/:orgId", requireAuth, requireTenantAccess);
```
