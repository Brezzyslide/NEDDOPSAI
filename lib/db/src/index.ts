import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function databaseUrlFromEnvironment(): string | undefined {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.DB_HOST ?? process.env.PGHOST;
  const port = process.env.DB_PORT ?? process.env.PGPORT ?? "5432";
  const database = process.env.DB_NAME ?? process.env.PGDATABASE;
  const username = process.env.DB_USERNAME ?? process.env.PGUSER;
  const password = process.env.DB_PASSWORD ?? process.env.PGPASSWORD;

  if (!host || !database || !username || !password) {
    return undefined;
  }

  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=verify-full`;
}

const databaseUrl = databaseUrlFromEnvironment();

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL or DB_HOST/DB_NAME/DB_USERNAME/DB_PASSWORD must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema });

export * from "./schema";
// Sprint 5 — Tenant-aware data access layer
export * from "./tenantAccess";
