# NeedsOps AI+ — Sprint 0 Completion Report

**Date:** 23 July 2026
**Sprint:** 0 — Foundation Build
**Status:** ✅ Complete

---

## Objective

Establish the production-grade platform foundation for NeedsOps AI+ — an enterprise AI Operations Platform that enables organisations to build, manage, and work alongside an intelligent AI workforce.

Sprint 0 delivers the monorepo architecture, all service shells, database schema, shared libraries, and a fully functional web Command Centre UI. No authentication, billing, AI integrations, or OpenClaw connectivity in this sprint.

---

## Deliverables Completed

### Monorepo Architecture

| Package | Type | Description |
|---|---|---|
| `@workspace/api-server` | Service | Express 5 REST API — fully wired with platform routes |
| `@workspace/needsops-web` | Artifact | React + Vite Command Centre web portal |
| `@workspace/needsops-mobile` | Artifact | Expo React Native mobile shell |
| `@workspace/worker` | Service shell | Background worker service skeleton |
| `@workspace/desktop-connector` | Service shell | Local desktop bridge skeleton |
| `@workspace/db` | Lib | PostgreSQL + Drizzle ORM — schema defined and pushed |
| `@workspace/shared` | Lib | Platform constants, enums, and utility types |
| `@workspace/validation` | Lib | Zod v4 schemas for all domain entities |
| `@workspace/api-zod` | Lib | Generated Zod schemas from OpenAPI spec |
| `@workspace/api-client-react` | Lib | Generated React Query hooks from OpenAPI spec |

### Database Schema (PostgreSQL + Drizzle ORM)

| Table | Description |
|---|---|
| `organizations` | Multi-tenant organisation registry (with status, tier, slug) |
| `users` | User accounts per organisation (roles, status) |
| `workforce_packs` | Available AI workforce packages with JSONB worker roster |

All tables use typed enums (pgEnum): `org_status`, `subscription_tier`, `user_role`, `user_status`, `pack_tier`, `pack_status`.

Schema pushed to development database. Three seed organizations, four seed users, and four workforce packs seeded (including three NDIS packs and one coming-soon healthcare pack).

### API Surface (OpenAPI-first)

All endpoints defined in `lib/api-spec/openapi.yaml` and generated via Orval:

| Method | Path | Description |
|---|---|---|
| GET | `/api/healthz` | Health check |
| GET | `/api/organizations` | List orgs (paginated, searchable) |
| POST | `/api/organizations` | Create org |
| GET | `/api/organizations/:id` | Get org by ID |
| PATCH | `/api/organizations/:id` | Update org |
| DELETE | `/api/organizations/:id` | Delete org |
| GET | `/api/organizations/:orgId/users` | List users in org |
| POST | `/api/organizations/:orgId/users` | Add user to org |
| GET | `/api/workforce-packs` | List workforce packs |
| GET | `/api/workforce-packs/:id` | Get workforce pack |
| GET | `/api/system/status` | Service health status |
| GET | `/api/system/dashboard-summary` | Platform metrics for dashboard |

### Web Portal — NeedsOps AI+ Command Centre

Built by DESIGN subagent. Deep Space Command Centre aesthetic:

- **Color system:** Midnight blue (`hsl(230 25% 5%)`) + electric cyan primary (`hsl(183 100% 45%)`)
- **Typography:** Outfit (body) + Space Mono (data/telemetry)
- **Motion:** Staggered fade-ins, glow effects on active states, smooth transitions

Pages implemented and wired to live API:

| Route | Page | Hooks Used |
|---|---|---|
| `/` | Command Centre dashboard | `useGetDashboardSummary`, `useGetSystemStatus` |
| `/organizations` | Tenant directory | `useListOrganizations` |
| `/organizations/:id` | Org profile | `useGetOrganization`, `useListOrganizationUsers` |
| `/workforce` | AI workforce pack browser | `useListWorkforcePacks` |
| `/system` | System telemetry | `useGetSystemStatus`, `useHealthCheck` |

### Shared Libraries

**`@workspace/shared`** — Pure TypeScript, zero runtime deps:
- Platform constants (`PLATFORM_NAME`, `PLATFORM_VERSION`)
- Subscription tier, org status, user role, AI worker role enums
- Industry labels (NDIS, healthcare, aged care, education, legal, finance)
- Pagination types

**`@workspace/validation`** — Zod v4 schemas:
- `createOrganizationSchema`, `updateOrganizationSchema`
- `createUserSchema`
- `createWorkforcePackSchema`
- `paginationSchema`
- `idParamSchema`, `orgIdParamSchema`

### Infrastructure

- **Docker:** `Dockerfile` (multi-stage, API production build) + `docker-compose.yml` (postgres + api + worker)
- **Environment:** `.env.example` documenting all current and future variables
- **Logging:** pino structured logging throughout API (pino-http middleware on all requests)
- **Graceful shutdown:** SIGTERM/SIGINT handlers in worker and desktop connector shells

---

## Architecture Decisions

1. **OpenAPI-first contract**: `lib/api-spec/openapi.yaml` is the single source of truth. Changing it triggers Orval codegen which produces typed React Query hooks (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`). The API server imports from `@workspace/validation` (hand-authored, canonical) not the generated schemas.

2. **Multi-tenant by design from Sprint 0**: The `organizations` table is the tenancy root. All user and data records reference `organization_id`. Tenant isolation is enforced at the query layer — full row-level security (RLS) will be added in a future sprint.

3. **JSONB for workforce workers**: Workforce pack worker rosters are stored as JSONB rather than a separate normalised table. This trades normalisation for flexibility — the worker schema is expected to evolve rapidly in early sprints. A normalised `workforce_workers` table will be introduced when the schema stabilises.

4. **Shared constants in `@workspace/shared`, not in generated code**: Industry labels, role labels, tier labels, and platform-wide enums are defined once in `@workspace/shared` and imported by both the API server and the frontend. This prevents drift between API validation and UI rendering.

5. **Worker and desktop connector are shells, not stubs**: Each shell is a complete, runnable Node.js process with graceful shutdown, structured logging, and a health loop. They will be extended in future sprints — not replaced.

---

## Technical Debt

| Item | Priority | Sprint |
|---|---|---|
| No authentication on any endpoint | Critical | Sprint 1 |
| No row-level security / tenant isolation enforcement | Critical | Sprint 1 |
| Workforce workers in JSONB — normalise when schema stabilises | Medium | Sprint 2 |
| No rate limiting on API endpoints | Medium | Sprint 1 |
| No input sanitisation beyond Zod parsing | Medium | Sprint 1 |
| Worker service has no job queue (BullMQ, pg-boss, etc.) | Medium | Sprint 2 |
| Desktop connector has no actual WebSocket transport | Low | Sprint 3 |
| No test coverage (unit, integration, e2e) | High | Sprint 1 |
| Docker build uses monolith image — split in future | Low | Sprint 3 |
| No CI/CD pipeline | Medium | Sprint 2 |
| Missing `updatedAt` on `users` table | Low | Sprint 1 |

---

## Sprint 1 Recommendations

Sprint 1 should focus on **Authentication & Tenancy**:

1. **Clerk authentication** — integrate Replit-managed Clerk for organisation-scoped SSO. This unblocks all user-facing features.
2. **Session management** — JWT verification middleware on all API routes using `SESSION_SECRET`.
3. **Tenant isolation middleware** — `req.orgId` set from JWT claims; all DB queries automatically scoped.
4. **Row-level security (RLS)** — PostgreSQL policies enforcing tenant boundaries at the DB layer.
5. **Invitation flow** — users with `status: 'invited'` need an email invitation and onboarding path.
6. **Audit logging table** — `audit_log` table capturing all data mutations with actor, timestamp, and diff.

Estimated scope: 1 sprint (2-3 days).

---

## How to Run

```bash
# Install dependencies
pnpm install

# Push DB schema (dev)
pnpm --filter @workspace/db run push

# Run API server
pnpm --filter @workspace/api-server run dev

# Run web portal
pnpm --filter @workspace/needsops-web run dev

# Typecheck everything
pnpm run typecheck

# Run with Docker
docker compose up
```

---

## Sign-off

Sprint 0 is complete. All services are running. The database is seeded. The web portal is live and connected to real API data. All shells are in place.

**Awaiting approval to begin Sprint 1.**
