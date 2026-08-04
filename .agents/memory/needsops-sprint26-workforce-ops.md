---
name: NeedsOps Sprint 26 Workforce Operations Centre
description: 9 service functions, 9 routes, 2 frontend pages, 48 new tests — patterns and gotchas worth preserving
---

## What was built

**Backend** (`artifacts/api-server/src/`):
- `services/workforceOpsService.ts` — 9 exported async functions + `WorkforceOpsError` class.  Reads 10 existing DB tables, REQUIRED_RLS_TABLES stays at 67.
- `routes/v1/workforceOps.ts` — 9 routes under `/v1/organisations/:slug/workforce-ops/*`.

**Frontend** (`artifacts/needsops-web/src/`):
- `pages/app/WorkforceOpsCentre.tsx` — metrics strip, specialist roster, alerts, health chart, recommendations.
- `pages/app/WorkforceSpecialistDetail.tsx` — 6-tab detail page.

---

## Critical RegistrySpecialist field names

The `RegistrySpecialist` type (from `artifacts/api-server/src/lib/workforceRegistry.ts`) uses:
- `displayName` (NOT `title`)
- `description` (NOT `descriptor`)
- `departmentCode` (NOT `domain`)
- `version` (NOT `dnaVersion`)

All test mocks and service field references must use these exact names.

**Why:** Sprint 26 initially used `spec.title` etc. which compiled fine in mocks (loose typing) but failed tsc and caused `undefined` in assertions.

---

## logOrgEvent — object signature only

`logOrgEvent` from `auditService.ts` takes a **single params object**, NOT positional args:
```ts
await logOrgEvent({
  eventType: "specialist.assigned", // use closest valid AuditEventType
  organizationId,
  actorUserId: userId,
  actorType: "user",
  resourceType: "specialist",
  resourceId: specialistCode,
  metadata: { ... },
});
```

Test assertions must match object form:
```ts
expect(logOrgEvent).toHaveBeenCalledWith(expect.objectContaining({
  organizationId: ORG_ID, actorUserId: USER_ID, ...
}));
```

**Why:** Service was originally written with positional args, causing TS error `Expected 1 arguments, but got 4`.

---

## Route file: TenantContext field names

In route handlers, access tenant data via `req.tenantContext!.tenantId` (NOT `.organizationId`) and check roles as `"owner"` | `"administrator"` (NOT `"admin"`).

**Why:** `MembershipRole` union is `"owner" | "administrator" | ...`; `"admin"` is deprecated (from USER_ROLES), `"organizationId"` doesn't exist on TenantContext.

---

## getSpecialistPerformance — Promise.all destructuring

All 3 queries in `Promise.all` must end with `.limit()`. Then destructure the aggregate rows as arrays:
```ts
const [workRows, [qualityRow], [confidenceRow]] = await Promise.all([...]);
// qualityRow?.avg  ← correct, not qualityRow?.[0]?.avg
```

**Why:** Without `[qualityRow]` destructuring, `qualityRow` is the whole array and `.avg` is undefined.  Without `.limit()`, `.where()` returns mockDb (synchronous) instead of a Promise.

---

## resetChain() — must use mockReset to clear once-queues

```js
function resetChain() {
  const chainFns = [mockDb.from, mockDb.where, mockDb.set,
    mockDb.orderBy, mockDb.limit, mockDb.offset, mockDb.values];
  for (const fn of chainFns) {
    fn.mockReset();
    fn.mockImplementation(() => mockDb);
  }
  (logOrgEvent as any).mockReset?.();
  (logOrgEvent as any).mockResolvedValue?.(undefined);
}
```

`mockImplementation` alone does NOT clear the `mockResolvedValueOnce` queue. Leftover queue entries from failing tests leak into subsequent tests, causing spurious results (e.g. "33 instead of 67" for trainingCompletion). Must use `mockReset()` first.

Also reset `logOrgEvent` so per-test `toHaveBeenCalledTimes(1)` works.

---

## @swc/helpers — needed at runtime

The `fontkit`/`brotli` dependency chain requires `@swc/helpers` at runtime, but it is marked external in the build config. If the API server fails with `Cannot find module '@swc/helpers/cjs/_define_property.cjs'`, run:
```
pnpm add -w @swc/helpers
```

**Why:** `@swc/*` is in esbuild externals so brotli's require is preserved as-is. If `@swc/helpers` isn't installed in root node_modules, startup fails.
