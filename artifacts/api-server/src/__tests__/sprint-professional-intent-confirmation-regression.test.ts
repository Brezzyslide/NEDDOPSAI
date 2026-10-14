/**
 * Regression: a confirmation utterance such as "yes, procced" must not erase
 * the originating professional intent before auto-dispatch/preflight.
 */

import { describe, expect, it } from "vitest";

const runDbBackedTests = process.env["NEEDSOPS_DB_TESTS"] === "1" && !!process.env["DATABASE_URL"];

async function withTimeout<T>(promise: Promise<T>, label: string, ms = 10_000): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out while ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function loadModules() {
  const dbModule = await withTimeout(import("@workspace/db"), "importing db module");
  const drizzle = await withTimeout(import("drizzle-orm"), "importing drizzle");
  const conversationControl = await withTimeout(
    import("../services/conversationControlService.js"),
    "importing conversation control",
  );
  const autoDispatch = await withTimeout(
    import("../services/autoDispatchService.js"),
    "importing auto dispatch service",
  );
  return { dbModule, drizzle, conversationControl, autoDispatch };
}

async function alignTaskCreationIdempotencyFkWithCommittedMigration(
  db: { execute: (query: unknown) => Promise<unknown> },
  sql: (strings: TemplateStringsArray, ...params: unknown[]) => unknown,
) {
  // Drizzle 0.45 can model FK actions but not PostgreSQL FK deferrability.
  // Migration 0040 makes task_id DEFERRABLE INITIALLY DEFERRED so reservation
  // rows can be inserted before the task row in the same transaction.
  await db.execute(sql`
    ALTER TABLE task_creation_idempotency_keys
      DROP CONSTRAINT IF EXISTS task_creation_idempotency_keys_task_id_tasks_id_fk;
    ALTER TABLE task_creation_idempotency_keys
      DROP CONSTRAINT IF EXISTS task_creation_idempotency_keys_task_id_fkey;
    ALTER TABLE task_creation_idempotency_keys
      ADD CONSTRAINT task_creation_idempotency_keys_task_id_tasks_id_fk
      FOREIGN KEY (task_id)
      REFERENCES tasks(id)
      ON DELETE CASCADE
      DEFERRABLE INITIALLY DEFERRED;
  `);
}

async function seedAutoDispatchFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organizationId = `org-intent-${suffix}`;
  const userId = `user-intent-${suffix}`;
  const conversationId = `conv-intent-${suffix}`;
  const blueprintId = `bp-care-plan-${suffix}`;
  const mappingId = `bim-care-plan-${suffix}`;
  const originalRequest = "i want a NDIS care plan template";

  const modules = await loadModules();
  const { dbModule, drizzle, conversationControl, autoDispatch } = modules;
  const {
    db,
    organizationsTable,
    plansTable,
    planVersionsTable,
    tenantSubscriptionsTable,
    tenantEntitlementsTable,
    tenantWorkforcePacksTable,
    tenantUsageAllowancesTable,
    usersTable,
    membershipsTable,
    conversationsTable,
    workBlueprintsTable,
    blueprintIntentMappingsTable,
    withSystemTenantContext,
  } = dbModule;
  const { sql } = drizzle;

  await alignTaskCreationIdempotencyFkWithCommittedMigration(db, sql);

  await withTimeout(db.insert(organizationsTable).values({
    id: organizationId,
    name: "Intent Regression Org",
    slug: `intent-regression-${suffix}`.slice(0, 63),
    displayName: "Intent Regression Org",
    status: "active",
    environment: "test",
    isTestOrganisation: true,
  }), "inserting regression organization");
  await db.insert(plansTable).values({
    id: `plan-intent-${suffix}`,
    code: `intent-regression-${suffix}`.slice(0, 63),
    name: "Intent Regression Plan",
    description: "Local regression plan",
    isPublic: false,
    isActive: true,
    displayOrder: "0",
  });
  await db.insert(planVersionsTable).values({
    id: `plan-version-intent-${suffix}`,
    planId: `plan-intent-${suffix}`,
    versionNumber: 1,
    label: "Regression",
    isActive: true,
    includedSeats: 10,
    activatedAt: new Date(),
  });
  await db.insert(tenantSubscriptionsTable).values({
    id: `subscription-intent-${suffix}`,
    organizationId,
    planId: `plan-intent-${suffix}`,
    planVersionId: `plan-version-intent-${suffix}`,
    status: "active",
    currentPeriodStart: new Date(Date.now() - 60_000),
    currentPeriodEnd: new Date(Date.now() + 86_400_000),
    internalNote: "Regression execution access",
  });
  await db.insert(tenantEntitlementsTable).values({
    id: `entitlement-intent-${suffix}`,
    organizationId,
    featureCode: "execution.professional_work",
    state: "granted",
    source: "override",
    reason: "Regression execution access",
    isCustomerVisible: false,
  });
  await db.insert(tenantWorkforcePacksTable).values({
    id: `pack-intent-${suffix}`,
    organizationId,
    packCode: "core",
    source: "manual_grant",
    reason: "Regression core pack",
    status: "active",
    activatedAt: new Date(),
  });
  await db.insert(tenantUsageAllowancesTable).values({
    id: `usage-intent-${suffix}`,
    organizationId,
    dimensionCode: "ai_tasks",
    hardLimit: null,
    source: "override",
    reason: "Regression unlimited AI task usage",
  });
  await db.insert(usersTable).values({
    id: userId,
    externalId: `clerk-intent-${suffix}`,
    email: `intent-${suffix}@example.test`,
    displayName: "Intent Regression User",
    status: "active",
  });
  await db.insert(membershipsTable).values({
    id: `membership-intent-${suffix}`,
    organizationId,
    userId,
    role: "owner",
    status: "active",
    joinedAt: new Date(),
  });
  await db.insert(workBlueprintsTable).values({
    id: blueprintId,
    organizationId,
    code: "care_plan",
    title: "Care Plan",
    version: "1.0.0",
    blueprintFamily: "care_plan",
    supportedModes: ["create"],
    maturityState: "production_ready",
    ownerType: "platform_owned",
    primaryDeliverable: "care_plan",
    deliverableContract: {
      primaryDeliverable: "care_plan",
      artifactRequired: false,
      requirementPlan: [],
    },
    evidenceContract: {
      requiredEvidenceCategories: [],
      requiredEntityTypes: [],
      minimumEvidenceCount: 0,
      claimIntegrityRequired: false,
    },
    permittedOrgOverrides: {},
    templateRequired: false,
    objective: "Produce a standard reusable care plan template.",
    primarySpecialist: "chief_of_staff",
    supportingSpecialists: [],
    requiredLibraryKnowledge: [],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: {},
    validationRules: [],
    qualityRules: [],
    successCriteria: ["Template structure is produced"],
    outputTypes: ["care_plan"],
    escalationRules: [],
    mandatoryCitations: [],
    isBuiltIn: false,
    isActive: true,
    status: "published",
  });
  await db.insert(blueprintIntentMappingsTable).values({
    id: mappingId,
    canonicalIntent: "care_plan.create",
    blueprintFamily: "care_plan",
    blueprintMode: "create",
    blueprintId,
    organizationId,
    isActive: true,
  });

  await withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "vitest", purpose: "intent_regression.seed_conversation" },
    async (client) => {
      await client.insert(conversationsTable).values({
        id: conversationId,
        organizationId,
        createdByUserId: userId,
        title: "Intent Regression Conversation",
        conversationType: "general_workforce",
        status: "active",
      });
    },
  );

  await conversationControl.persistConversationConfirmation({
    organizationId,
    conversationId,
    action: "NEW_TASK",
    expectedResponse: "yes_no",
    reason: "task_proposal_confirmation",
    proposedTask: {
      title: "Create NDIS Care Plan Template",
      summary: "Create a standard reusable NDIS care plan template.",
      priority: "normal",
      sourceUserRequest: originalRequest,
    },
  });

  const pending = await conversationControl.getPendingConversationConfirmation({
    organizationId,
    conversationId,
    recoverTaskProposal: true,
  });

  expect(pending?.proposedTask?.sourceUserRequest).toBe(originalRequest);
  expect(conversationControl.resolvePendingConfirmationAnswer("yes, procced", pending!)).toEqual({ kind: "confirm" });

  return {
    ...modules,
    organizationId,
    userId,
    conversationId,
    originalRequest,
    pending: pending!,
  };
}

describe.runIf(runDbBackedTests)("DB-backed professional intent confirmation regression", () => {
  it("preserves originating request through confirmation and resolves manifest intent from the persisted plan", async () => {
    const {
      dbModule,
      drizzle,
      autoDispatch,
      organizationId,
      userId,
      conversationId,
      originalRequest,
      pending,
    } = await seedAutoDispatchFixture();

    const {
      tasksTable,
      taskExecutionPlansTable,
      workPackageManifestsTable,
      withSystemTenantContext,
    } = dbModule;
    const { eq, and, desc } = drizzle;

    const created = await autoDispatch.autoCreateAndDispatch({
      organizationId,
      requesterId: userId,
      conversationId,
      idempotencyKey: `conversation_confirmation:${pending.id}`,
      proposedTask: pending.proposedTask!,
    });
    expect(created.dispatched).toBe(true);
    expect(created.reusedExisting).not.toBe(true);

    const [taskRow] = await withSystemTenantContext(
      { tenantId: organizationId, serviceIdentity: "vitest", purpose: "intent_regression.read_task" },
      async (client) => client
        .select()
        .from(tasksTable)
        .where(and(
          eq(tasksTable.organizationId, organizationId),
          eq(tasksTable.id, created.taskId),
        ))
        .limit(1),
    );
    expect(((taskRow?.metadata as { taskCreation?: { sourceUserRequest?: string } } | null)?.taskCreation)?.sourceUserRequest)
      .toBe(originalRequest);

    const [planRow] = await withSystemTenantContext(
      { tenantId: organizationId, serviceIdentity: "vitest", purpose: "intent_regression.read_plan" },
      async (client) => client
        .select()
        .from(taskExecutionPlansTable)
        .where(and(
          eq(taskExecutionPlansTable.organizationId, organizationId),
          eq(taskExecutionPlansTable.taskId, created.taskId),
        ))
        .limit(1),
    );
    expect((planRow?.planData as { intent?: string } | undefined)?.intent).toBe("care_plan.create");

    let manifest: typeof workPackageManifestsTable.$inferSelect | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      [manifest] = await withSystemTenantContext(
        { tenantId: organizationId, serviceIdentity: "vitest", purpose: "intent_regression.read_manifest" },
        async (client) => client
          .select()
          .from(workPackageManifestsTable)
          .where(eq(workPackageManifestsTable.organizationId, organizationId))
          .orderBy(desc(workPackageManifestsTable.createdAt))
          .limit(1),
      );
      if (manifest) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    expect(manifest?.canonicalIntent).toBe("care_plan.create");
    expect(manifest?.blueprintId).toEqual(expect.any(String));
    expect((manifest?.selectionMetadata as { blueprintFamily?: string } | null | undefined)?.blueprintFamily).toBe("care_plan");
  }, 60_000);

  it("deduplicates concurrent confirmations through the real auto-dispatch path", async () => {
    const {
      dbModule,
      drizzle,
      autoDispatch,
      organizationId,
      userId,
      conversationId,
      pending,
    } = await seedAutoDispatchFixture();

    const {
      tasksTable,
      taskCreationIdempotencyTable,
      withSystemTenantContext,
    } = dbModule;
    const { eq, and } = drizzle;
    const idempotencyKey = `conversation_confirmation:${pending.id}`;

    const [first, second] = await Promise.all([
      autoDispatch.autoCreateAndDispatch({
        organizationId,
        requesterId: userId,
        conversationId,
        idempotencyKey,
        proposedTask: pending.proposedTask!,
      }),
      autoDispatch.autoCreateAndDispatch({
        organizationId,
        requesterId: userId,
        conversationId,
        idempotencyKey,
        proposedTask: pending.proposedTask!,
      }),
    ]);

    expect(new Set([first.taskId, second.taskId]).size).toBe(1);
    expect([first.reusedExisting, second.reusedExisting].filter(Boolean)).toHaveLength(1);

    const reservations = await withSystemTenantContext(
      { tenantId: organizationId, serviceIdentity: "vitest", purpose: "intent_regression.read_reservations" },
      async (client) => client
        .select()
        .from(taskCreationIdempotencyTable)
        .where(and(
          eq(taskCreationIdempotencyTable.organizationId, organizationId),
          eq(taskCreationIdempotencyTable.scope, "idempotency_key"),
          eq(taskCreationIdempotencyTable.idempotencyKey, idempotencyKey),
        )),
    );
    expect(reservations).toHaveLength(1);

    const taskRows = await withSystemTenantContext(
      { tenantId: organizationId, serviceIdentity: "vitest", purpose: "intent_regression.read_tasks" },
      async (client) => client
        .select()
        .from(tasksTable)
        .where(and(
          eq(tasksTable.organizationId, organizationId),
          eq(tasksTable.title, pending.proposedTask!.title),
        )),
    );
    expect(taskRows).toHaveLength(1);
  }, 60_000);
});
