import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function platformDatabaseUrlFromEnvironment(): string | undefined {
  if (process.env.PLATFORM_DATABASE_URL) {
    return process.env.PLATFORM_DATABASE_URL;
  }

  const host = process.env.DB_HOST ?? process.env.PGHOST;
  const port = process.env.DB_PORT ?? process.env.PGPORT ?? "5432";
  const database = process.env.DB_NAME ?? process.env.PGDATABASE;
  const username = process.env.DB_PLATFORM_USERNAME ?? process.env.PLATFORM_DB_USERNAME;
  const password = process.env.DB_PLATFORM_PASSWORD ?? process.env.PLATFORM_DB_PASSWORD;

  if (!host || !database || !username || !password) {
    return undefined;
  }

  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=verify-full`;
}

const platformDatabaseUrl = platformDatabaseUrlFromEnvironment();

if (!platformDatabaseUrl) {
  throw new Error(
    "PLATFORM_DATABASE_URL or DB_HOST/DB_NAME/DB_PLATFORM_USERNAME/DB_PLATFORM_PASSWORD must be set for platform database access.",
  );
}

export const platformPool = new Pool({ connectionString: platformDatabaseUrl });
export const platformDb = drizzle(platformPool, { schema });
