#!/usr/bin/env tsx
import { spawn } from "child_process";
import pg from "pg";

const { Pool } = pg;

interface BootstrapIdentity {
  environment: string;
  databaseName: string;
  serverAddress: string | null;
  postgresVersion: string;
  awsRegion: string | null;
  sourceVersion: string | null;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
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

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

function shouldRunDrizzleSchemaPush(): boolean {
  return process.env["NEEDSOPS_RUN_DRIZZLE_PUSH"] === "true";
}

async function readDatabaseIdentity(pool: pg.Pool): Promise<BootstrapIdentity> {
  const result = await pool.query<{
    database_name: string;
    server_address: string | null;
    postgres_version: string;
  }>(`
    SELECT
      current_database() AS database_name,
      inet_server_addr()::text AS server_address,
      version() AS postgres_version
  `);

  const row = result.rows[0];
  if (!row) throw new Error("Unable to read database identity");

  return {
    environment: requiredEnv("NEEDSOPS_DB_BOOTSTRAP_ENV"),
    databaseName: row.database_name,
    serverAddress: row.server_address,
    postgresVersion: row.postgres_version,
    awsRegion: process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"] ?? null,
    sourceVersion: process.env["SOURCE_VERSION"] ?? process.env["GIT_SHA"] ?? null,
  };
}

async function ensureFreshSchemaPrerequisites(pool: pg.Pool): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function configureRestrictedRolePasswords(pool: pg.Pool): Promise<void> {
  const platformPassword = process.env["NEEDSOPS_PLATFORM_APP_PASSWORD"];
  const workerPassword = process.env["NEEDSOPS_WORKER_APP_PASSWORD"];

  if (platformPassword) {
    await pool.query(`ALTER ROLE needsops_platform_app PASSWORD ${sqlLiteral(platformPassword)}`);
  }
  if (workerPassword) {
    await pool.query(`ALTER ROLE needsops_worker_app PASSWORD ${sqlLiteral(workerPassword)}`);
  }
}

function validateBootstrapEnvironment(identity: BootstrapIdentity): void {
  if (identity.environment !== "dev") {
    throw new Error(`Refusing bootstrap for environment "${identity.environment}". Expected "dev".`);
  }

  const expectedDb = process.env["EXPECTED_DATABASE_NAME"];
  if (expectedDb && identity.databaseName !== expectedDb) {
    throw new Error(`Refusing bootstrap for database "${identity.databaseName}". Expected "${expectedDb}".`);
  }

  const expectedRegion = process.env["EXPECTED_AWS_REGION"];
  if (expectedRegion && identity.awsRegion !== expectedRegion) {
    throw new Error(`Refusing bootstrap for AWS region "${identity.awsRegion}". Expected "${expectedRegion}".`);
  }
}

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    const derivedDatabaseUrl = buildDatabaseUrlFromPgEnv();
    if (derivedDatabaseUrl) {
      process.env["DATABASE_URL"] = derivedDatabaseUrl;
    }
  }

  requiredEnv("DATABASE_URL");
  requiredEnv("NEEDSOPS_DB_BOOTSTRAP_ENV");

  const [
    { runPlatformMigrations },
    { assertBlueprintAcceptance, checkBlueprintAcceptance },
    { seedPlatformDefaults },
    { runSeed },
    { reconcileMissingOnboardingTrialSubscriptions },
    { seedBuiltInBlueprints },
    { seedCatalogueFromRegistry },
    {
      reconcileWorkerProfilePublication,
      reconcileWorkforceDnaPublication,
      checkWorkforceRuntimeAcceptance,
      assertWorkforceRuntimeAcceptance,
    },
    { runRLSStartupCheck },
  ] = await Promise.all([
    import("../bootstrap/platformMigrations.js"),
    import("../bootstrap/blueprintAcceptance.js"),
    import("../seed-platform-defaults.js"),
    import("../seed.js"),
    import("../services/subscriptionProvisioningService.js"),
    import("../services/workBlueprintService.js"),
    import("../services/specialistCatalogueService.js"),
    Promise.all([
      import("../services/workerProfilePublicationService.js"),
      import("../services/dnaStorageService.js"),
    ]).then(([workerProfiles, dnaStorage]) => ({
      ...workerProfiles,
      reconcileWorkforceDnaPublication: dnaStorage.reconcileWorkforceDnaPublication,
    })),
    import("../startup/rlsStartupCheck.js"),
  ]);

  const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

  try {
    const identity = await readDatabaseIdentity(pool);
    validateBootstrapEnvironment(identity);

    console.log("[db:bootstrap] Environment verified", {
      environment: identity.environment,
      databaseName: identity.databaseName,
      awsRegion: identity.awsRegion,
      sourceVersion: identity.sourceVersion,
      postgresVersion: identity.postgresVersion.split(" ").slice(0, 2).join(" "),
    });

    console.log("[db:bootstrap] Ensuring schema prerequisites");
    await ensureFreshSchemaPrerequisites(pool);

    if (shouldRunDrizzleSchemaPush()) {
      console.log("[db:bootstrap] Applying optional Drizzle schema push (local/dev helper)");
      await runCommand("pnpm", ["--filter", "@workspace/db", "run", "push-force"], process.cwd());
    } else {
      console.log("[db:bootstrap] Skipping Drizzle schema push; ordered platform migrations are authoritative");
    }

    console.log("[db:bootstrap] Applying ordered platform SQL migrations");
    const migrationResult = await runPlatformMigrations(pool, {
      sourceVersion: identity.sourceVersion,
      logger: {
        info: (message, metadata) => console.log(`[db:bootstrap] ${message}`, metadata ?? {}),
        warn: (message, metadata) => console.warn(`[db:bootstrap] ${message}`, metadata ?? {}),
        error: (message, metadata) => console.error(`[db:bootstrap] ${message}`, metadata ?? {}),
      },
    });
    console.log("[db:bootstrap] Platform migrations complete", migrationResult);

    console.log("[db:bootstrap] Configuring restricted runtime role passwords");
    await configureRestrictedRolePasswords(pool);

    console.log("[db:bootstrap] Seeding platform defaults");
    await seedPlatformDefaults();

    console.log("[db:bootstrap] Seeding commercial/catalogue platform records without sample tenant data");
    await runSeed({ includeSampleTenantData: false });

    console.log("[db:bootstrap] Reconciling onboarding trial subscriptions");
    const subscriptionResult = await reconcileMissingOnboardingTrialSubscriptions();
    console.log("[db:bootstrap] Onboarding trial subscription reconciliation complete", subscriptionResult);

    console.log("[db:bootstrap] Seeding built-in Blueprints and intent mappings");
    await seedBuiltInBlueprints();

    console.log("[db:bootstrap] Seeding specialist catalogue");
    await seedCatalogueFromRegistry();

    console.log("[db:bootstrap] Reconciling WorkerProfiles and role mappings");
    const workerProfileResult = await reconcileWorkerProfilePublication();
    console.log("[db:bootstrap] WorkerProfile reconciliation complete", workerProfileResult);

    console.log("[db:bootstrap] Reconciling published Workforce DNA");
    const dnaResult = await reconcileWorkforceDnaPublication({
      apply: true,
      publishedBy: "db_bootstrap",
    });
    console.log("[db:bootstrap] Workforce DNA reconciliation complete", {
      applied: dnaResult.applied,
      summary: dnaResult.summary,
    });

    console.log("[db:bootstrap] Running RLS/startup security validation");
    await runRLSStartupCheck();

    console.log("[db:bootstrap] Running Workforce runtime acceptance");
    const workforceAcceptance = await checkWorkforceRuntimeAcceptance();
    assertWorkforceRuntimeAcceptance(workforceAcceptance);
    console.log("[db:bootstrap] Workforce runtime acceptance passed", {
      expectedRoles: workforceAcceptance.expectedRoleCount,
      workerProfiles: workforceAcceptance.workerProfilesPresent,
      roleMappings: workforceAcceptance.roleMappingsPresent,
      activePublishedDna: workforceAcceptance.activePublishedDnaCount,
      missing: workforceAcceptance.missing.length,
      duplicateActive: workforceAcceptance.duplicateActive.length,
    });

    console.log("[db:bootstrap] Running Blueprint bootstrap acceptance");
    const acceptance = await checkBlueprintAcceptance(pool);
    assertBlueprintAcceptance(acceptance);
    console.log("[db:bootstrap] Blueprint bootstrap acceptance passed", {
      blueprints: `${acceptance.persistedExpectedBlueprints}/${acceptance.registryCodes}`,
      sections: `${acceptance.persistedMatchingProfessionalSections}/${acceptance.expectedProfessionalSections}`,
      titleDrift: acceptance.titleDrift.length,
      methodDrift: acceptance.methodDrift.length,
    });

    console.log("[db:bootstrap] Complete");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[db:bootstrap] FAILED", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
