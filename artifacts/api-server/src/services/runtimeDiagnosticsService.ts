import { timingSafeEqual } from "crypto";
import { HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Pool } from "pg";
import { checkBlueprintAcceptance } from "../bootstrap/blueprintAcceptance.js";
import { getRuntimeIdentity } from "../lib/runtimeIdentity.js";

export interface RuntimeDiagnostics {
  identity: ReturnType<typeof getRuntimeIdentity>;
  database: {
    name: string | null;
    version: string | null;
    latestMigration: string | null;
    migrationCount: number;
  };
  blueprints: {
    registryCount: number;
    persistedCount: number;
    expectedProfessionalSections: number;
    persistedProfessionalSections: number;
    titleDrift: number;
    methodDrift: number;
  };
  rls: {
    healthy: boolean;
    tablesChecked: number;
  };
  storage: {
    provider: string;
    bucketConfigured: boolean;
    bucketReachable: boolean;
    syntheticObjectRoundTrip?: boolean;
  };
  krs: {
    knowledgeSources: number;
    approvedSources: number;
  };
  desktopConnector: {
    registeredDevices: number;
    activeDevices: number;
  };
}

export function isDiagnosticsAuthorized(headerValue: string | undefined): boolean {
  const token = process.env["INTERNAL_DIAGNOSTICS_TOKEN"];
  if (!token || !headerValue) return false;

  const expected = Buffer.from(token);
  const actual = Buffer.from(headerValue);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function readRuntimeDiagnostics(options: { runStorageRoundTrip?: boolean } = {}): Promise<RuntimeDiagnostics> {
  const identity = getRuntimeIdentity();
  const [{ pool }, { verifyRLS }] = await Promise.all([
    import("@workspace/db"),
    import("@workspace/org-db"),
  ]);
  const [database, acceptance, rls, krs, desktopConnector, storage] = await Promise.all([
    readDatabaseState(pool),
    checkBlueprintAcceptance(pool),
    verifyRLS({ failFast: false }),
    readKrsState(pool),
    readDesktopConnectorState(pool),
    readStorageState(options.runStorageRoundTrip === true),
  ]);

  return {
    identity,
    database,
    blueprints: {
      registryCount: acceptance.registryCodes,
      persistedCount: acceptance.persistedExpectedBlueprints,
      expectedProfessionalSections: acceptance.expectedProfessionalSections,
      persistedProfessionalSections: acceptance.persistedMatchingProfessionalSections,
      titleDrift: acceptance.titleDrift.length,
      methodDrift: acceptance.methodDrift.length,
    },
    rls: {
      healthy: rls.allPoliciesPresent,
      tablesChecked: rls.tableStatuses.length,
    },
    storage,
    krs,
    desktopConnector,
  };
}

async function readDatabaseState(pool: Pool) {
  const identity = await pool.query<{ database_name: string; postgres_version: string }>(`
    SELECT current_database() AS database_name, version() AS postgres_version
  `);

  const migrations = await pool.query<{ migration_id: string; count: string }>(`
    SELECT
      (SELECT migration_id FROM platform_schema_migrations ORDER BY applied_at DESC LIMIT 1) AS migration_id,
      (SELECT count(*)::text FROM platform_schema_migrations) AS count
  `);

  return {
    name: identity.rows[0]?.database_name ?? null,
    version: identity.rows[0]?.postgres_version?.split(" ").slice(0, 2).join(" ") ?? null,
    latestMigration: migrations.rows[0]?.migration_id ?? null,
    migrationCount: Number(migrations.rows[0]?.count ?? 0),
  };
}

async function readKrsState(pool: Pool) {
  const result = await pool.query<{ total: string; approved: string }>(`
    SELECT
      count(*)::text AS total,
      count(*) FILTER (WHERE status = 'approved')::text AS approved
    FROM knowledge_sources
  `);

  return {
    knowledgeSources: Number(result.rows[0]?.total ?? 0),
    approvedSources: Number(result.rows[0]?.approved ?? 0),
  };
}

async function readDesktopConnectorState(pool: Pool) {
  const result = await pool.query<{ total: string; active: string }>(`
    SELECT
      count(*)::text AS total,
      count(*) FILTER (WHERE status = 'connected')::text AS active
    FROM devices
  `);

  return {
    registeredDevices: Number(result.rows[0]?.total ?? 0),
    activeDevices: Number(result.rows[0]?.active ?? 0),
  };
}

async function readStorageState(runRoundTrip: boolean): Promise<RuntimeDiagnostics["storage"]> {
  const bucket = process.env["APP_STORAGE_BUCKET"] ?? process.env["KNOWLEDGE_S3_BUCKET"];
  const provider = bucket ? "s3" : "not_configured";
  if (!bucket) {
    return { provider, bucketConfigured: false, bucketReachable: false };
  }

  const client = new S3Client({ region: process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"] ?? "ap-southeast-2" });
  await client.send(new HeadBucketCommand({ Bucket: bucket }));

  const result: RuntimeDiagnostics["storage"] = {
    provider,
    bucketConfigured: true,
    bucketReachable: true,
  };

  if (runRoundTrip) {
    const key = `diagnostics/synthetic/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: "needsops-runtime-diagnostics",
      ContentType: "text/plain",
      ServerSideEncryption: "AES256",
    }));
    await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 });
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    result.syntheticObjectRoundTrip = true;
  }

  return result;
}
