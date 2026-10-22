#!/usr/bin/env tsx
import { pathToFileURL } from "url";
import pg from "pg";

const { Pool } = pg;

export interface RuntimeCredentialDbClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface RuntimeCredentialResult {
  roleName: string;
  databaseName: string;
  schemas: string[];
  grants: string[];
}

const API_ROLE = "needsops_api_app";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function buildDatabaseUrlFromPgEnv(): string | null {
  const host = process.env["DB_HOST"] ?? process.env["PGHOST"];
  const port = process.env["DB_PORT"] ?? process.env["PGPORT"] ?? "5432";
  const database = process.env["DB_NAME"] ?? process.env["PGDATABASE"];
  const username = process.env["DB_USERNAME"] ?? process.env["PGUSER"];
  const password = process.env["DB_PASSWORD"] ?? process.env["PGPASSWORD"];

  if (!host || !database || !username || !password) {
    return null;
  }

  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=verify-full`;
}

async function readApplicationSchemas(client: RuntimeCredentialDbClient): Promise<string[]> {
  const result = await client.query<{ schema_name: string }>(`
    SELECT nspname AS schema_name
    FROM pg_namespace
    WHERE nspname <> 'information_schema'
      AND nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
    ORDER BY nspname
  `);

  return result.rows.map((row) => row.schema_name);
}

async function readDatabaseName(client: RuntimeCredentialDbClient): Promise<string> {
  const result = await client.query<{ database_name: string }>("SELECT current_database() AS database_name");
  const databaseName = result.rows[0]?.database_name;
  if (!databaseName) {
    throw new Error("Unable to determine current database name");
  }
  return databaseName;
}

async function verifyRoleIsRestricted(client: RuntimeCredentialDbClient): Promise<void> {
  const result = await client.query<{
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    rolcanlogin: boolean;
    rolinherit: boolean;
    memberships: string[];
  }>(`
    SELECT
      r.rolsuper,
      r.rolcreatedb,
      r.rolcreaterole,
      r.rolreplication,
      r.rolbypassrls,
      r.rolcanlogin,
      r.rolinherit,
      COALESCE(array_agg(parent.rolname) FILTER (WHERE parent.rolname IS NOT NULL), ARRAY[]::name[]) AS memberships
    FROM pg_roles r
    LEFT JOIN pg_auth_members m ON m.member = r.oid
    LEFT JOIN pg_roles parent ON parent.oid = m.roleid
    WHERE r.rolname = 'needsops_api_app'
    GROUP BY
      r.oid,
      r.rolsuper,
      r.rolcreatedb,
      r.rolcreaterole,
      r.rolreplication,
      r.rolbypassrls,
      r.rolcanlogin,
      r.rolinherit
  `);
  const role = result.rows[0];
  if (!role) {
    throw new Error(`${API_ROLE} was not created`);
  }
  const memberships = Array.isArray(role.memberships)
    ? role.memberships
    : String(role.memberships ?? "")
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((membership) => membership.trim())
      .filter(Boolean);
  const failures: string[] = [];
  if (!role.rolcanlogin) failures.push("role cannot login");
  if (role.rolsuper) failures.push("role is SUPERUSER");
  if (role.rolcreatedb) failures.push("role has CREATEDB");
  if (role.rolcreaterole) failures.push("role has CREATEROLE");
  if (role.rolreplication) failures.push("role has REPLICATION");
  if (role.rolbypassrls) failures.push("role has BYPASSRLS");
  if (role.rolinherit) failures.push("role has INHERIT");
  if (memberships.length > 0) failures.push(`role has memberships: ${memberships.join(", ")}`);

  if (failures.length > 0) {
    throw new Error(`${API_ROLE} restriction verification failed: ${failures.join("; ")}`);
  }
}

export async function configureApiRuntimeCredential(
  client: RuntimeCredentialDbClient,
  password: string,
): Promise<RuntimeCredentialResult> {
  if (!password) {
    throw new Error("NEEDSOPS_API_APP_PASSWORD is required");
  }

  const databaseName = await readDatabaseName(client);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'needsops_api_app') THEN
        CREATE ROLE needsops_api_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
      END IF;
    END;
    $$;
  `);
  await client.query(`
    ALTER ROLE needsops_api_app
      LOGIN
      NOINHERIT
      PASSWORD ${sqlLiteral(password)}
  `);
  await client.query(`
    DO $$
    DECLARE membership RECORD;
    BEGIN
      FOR membership IN
        SELECT parent.rolname AS role_name
        FROM pg_auth_members m
        JOIN pg_roles child ON child.oid = m.member
        JOIN pg_roles parent ON parent.oid = m.roleid
        WHERE child.rolname = 'needsops_api_app'
      LOOP
        EXECUTE format('REVOKE %I FROM needsops_api_app', membership.role_name);
      END LOOP;
    END;
    $$;
  `);

  await client.query(`GRANT CONNECT ON DATABASE ${sqlIdentifier(databaseName)} TO needsops_api_app`);

  const schemas = await readApplicationSchemas(client);
  for (const schemaName of schemas) {
    const schema = sqlIdentifier(schemaName);
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO needsops_api_app`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO needsops_api_app`);
    await client.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO needsops_api_app`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO needsops_api_app`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE ON SEQUENCES TO needsops_api_app`);
  }

  await verifyRoleIsRestricted(client);

  return {
    roleName: API_ROLE,
    databaseName,
    schemas,
    grants: [
      `CONNECT ON DATABASE ${databaseName}`,
      ...schemas.flatMap((schema) => [
        `USAGE ON SCHEMA ${schema}`,
        `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema}`,
        `USAGE ON ALL SEQUENCES IN SCHEMA ${schema}`,
        `DEFAULT SELECT, INSERT, UPDATE, DELETE ON TABLES IN SCHEMA ${schema}`,
        `DEFAULT USAGE ON SEQUENCES IN SCHEMA ${schema}`,
      ]),
    ],
  };
}

export async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    const derivedDatabaseUrl = buildDatabaseUrlFromPgEnv();
    if (derivedDatabaseUrl) {
      process.env["DATABASE_URL"] = derivedDatabaseUrl;
    }
  }

  requiredEnv("DATABASE_URL");
  const password = requiredEnv("NEEDSOPS_API_APP_PASSWORD");
  const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

  try {
    console.log("[db:runtime-credentials] Configuring API runtime database credential");
    const result = await configureApiRuntimeCredential(pool, password);
    console.log("[db:runtime-credentials] Complete", {
      roleName: result.roleName,
      databaseName: result.databaseName,
      schemas: result.schemas,
      grantCount: result.grants.length,
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[db:runtime-credentials] FAILED", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
