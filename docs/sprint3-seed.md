# Sprint 3 — Seed Script

## Running the Seed

```bash
cd artifacts/api-server
npx tsx src/seed.ts
```

The seed is **idempotent**: it uses `ON CONFLICT DO NOTHING` for all inserts. It is safe to run multiple times. Re-running on an existing database is a no-op for already-seeded data.

---

## What Gets Seeded

| Step | Records |
|---|---|
| Plans + plan versions | 4 plans, 4 versions |
| Features | 40 feature codes |
| Plan features | 75 plan→feature mappings |
| Plan workforce packs | 17 plan→pack mappings |
| Usage dimensions | 13 dimensions |
| Plan usage allowances | 52 per-dimension limits (across 4 plan versions) |
| Workforce pack specialists | 32 specialist→pack mappings |
| Sample tenant subscriptions | 2 (Foundation active + Professional trial) |

---

## Sample Data

The seed does **not** create new organisations. Instead it locates the two earliest-created organisations in the database and assigns them sample subscriptions:

- **Organisation 1** → Foundation plan, active subscription
- **Organisation 2** → Professional plan, 30-day trial

If fewer than 2 organisations exist, the corresponding subscription step is skipped without error.

---

## Adding to the Seed

1. Add your insert block inside `runSeed()` in `artifacts/api-server/src/seed.ts`
2. Wrap in `ON CONFLICT DO NOTHING` / `onConflictDoNothing()` so it stays idempotent
3. Log progress with `[seed] ✓ N records`

---

## Production Note

The seed script is for **development and staging only**. Do not run it against the production database unless explicitly creating the initial plan catalogue (first deployment). Use proper migrations for schema changes in production.
