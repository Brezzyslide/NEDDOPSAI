---
name: NeedsOps v1 Router double-prefix bug
description: Routers mounted at router.use("/", sub) inside v1Router must NOT prefix routes with /v1/. Frontend calls /v1/... correctly.
---

# v1Router route path convention

## The rule
Routers mounted as `router.use("/", subRouter)` inside `v1Router` (which itself is at `app.use("/v1", v1Router)`) must define their routes WITHOUT a leading `/v1/` prefix. Express strips the `/v1` at the app mount point, so the subRouter only sees the remainder.

```
app.use("/v1", v1Router)         ← strips /v1
  router.use("/", subRouter)     ← strips nothing
    router.get("/organisations/:slug/memory") ← correct
    router.get("/v1/organisations/:slug/memory") ← WRONG — becomes /v1/v1/...
```

Routers mounted with a specific prefix are fine:
```
router.use("/organisations", orgRouter)   ← orgRouter sees /:slug
router.use("/organisations/:slug/members", membersRouter)  ← membersRouter sees / and /:id
```

## Why
All "flat" routers (organisationMemory, knowledgeSources, ingestion, conversationMemory, specialistTraining) were erroneously including `/v1/organisations/...` in their route paths. Requests to `/v1/organisations/...` returned 404 even though the API was running.

## How to apply
- Any router mounted at `router.use("/", subRouter)` → routes inside start with `/organisations/...`
- Any new router that handles org-scoped paths → should be mounted as `router.use("/organisations/:slug/...", subRouter)` and routes start with `/` or `/:param`
- Frontend always calls `/v1/organisations/...` — that is correct and never changes.

## Files fixed (2026-08-03)
- `routes/v1/organisationMemory.ts` — removed /v1 prefix from 7 routes
- `routes/v1/knowledgeSources.ts` — removed /v1 prefix from ~12 routes
- `routes/v1/ingestion.ts` — removed /v1 prefix + removed non-existent requireMembership/requireRole imports
- `routes/v1/conversationMemory.ts` — removed /v1 prefix
- `routes/v1/specialistTraining.ts` — removed /v1 prefix

## Inline role check pattern (ingestion.ts)
`requireMembership` and `requireRole` middlewares do not exist. Use inline check:
```ts
function requireOwnerOrAdmin(req, res, next) {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: { code: "FORBIDDEN", ... } });
    return;
  }
  next();
}
```
