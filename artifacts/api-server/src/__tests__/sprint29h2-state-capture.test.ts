/**
 * Sprint 29H.2 Authenticated Runtime Acceptance Test — State Capture
 * Read-only probe of mhr-holdings-2 DB state.
 */
import { describe, it } from "vitest";
import { db } from "@workspace/db";
import {
  specialistRunsTable,
  completedWorkTable,
  completedWorkVersionsTable,
  conversationMessagesTable,
  executionIntentsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";

const ORG_ID  = "98b132ec-958c-4ff4-8e80-c5fc7fccd1e2";
const CONV_ID = "96b7bcfe-946b-4aa5-bf6b-635afaa950f5";
const TASK_ID = "657d1b16-c9c3-40fe-bcb8-8229da6ef4ab";
const HIST_CW = "e7f810e9-3554-422f-a892-258973ee5ac6";

describe("Sprint 29H.2 — State capture (mhr-holdings-2, read-only)", () => {
  it("ALL completed_work for this conversation (chronological order)", async () => {
    // completedWorkTable links via conversationId, not taskId
    const rows = await db
      .select({
        id: completedWorkTable.id,
        status: completedWorkTable.status,
        primarySpecialist: completedWorkTable.primarySpecialist,
        title: completedWorkTable.title,
        currentVersionId: completedWorkTable.currentVersionId,
        createdAt: completedWorkTable.createdAt,
        approvedAt: completedWorkTable.approvedAt,
      })
      .from(completedWorkTable)
      .where(
        and(
          eq(completedWorkTable.conversationId, CONV_ID),
          eq(completedWorkTable.organizationId, ORG_ID)
        )
      )
      .orderBy(completedWorkTable.createdAt);

    console.log("\n=== ALL COMPLETED_WORK FOR CONVERSATION ===");
    for (const r of rows) console.log(JSON.stringify(r));
    console.log("Total records:", rows.length);
    const hist = rows.find((r) => r.id === HIST_CW);
    const newWork = rows.filter((r) => r.id !== HIST_CW);
    console.log("Historical e7f810e9 present:", hist ? "YES — preserved" : "MISSING");
    console.log(
      "New completed_work records (post-29H.2):",
      newWork.length === 0
        ? "NONE — no new execution has run yet"
        : newWork.map((r) => r.id + " [" + r.status + "] " + r.primarySpecialist).join(", ")
    );
  });

  it("specialist_runs for this task (most recent 5)", async () => {
    const rows = await db
      .select({
        id: specialistRunsTable.id,
        specialistCode: specialistRunsTable.specialistCode,
        workforceRoleCode: specialistRunsTable.workforceRoleCode,
        status: specialistRunsTable.status,
        startedAt: specialistRunsTable.startedAt,
        completedAt: specialistRunsTable.completedAt,
      })
      .from(specialistRunsTable)
      .where(
        and(
          eq(specialistRunsTable.taskId, TASK_ID),
          eq(specialistRunsTable.organizationId, ORG_ID)
        )
      )
      .orderBy(desc(specialistRunsTable.startedAt))
      .limit(5);

    console.log("\n=== SPECIALIST RUNS (latest 5 for task) ===");
    for (const r of rows) console.log(JSON.stringify(r));
    console.log("Total shown:", rows.length);
    if (rows.length > 0) {
      const latest = rows[0];
      console.log(
        "Most recent: specialistCode=" + latest.specialistCode +
        " workforceRoleCode=" + latest.workforceRoleCode +
        " status=" + latest.status
      );
    } else {
      console.log("NO specialist runs found for this task");
    }
  });

  it("execution_intents for this task (most recent 5)", async () => {
    const rows = await db
      .select({
        id: executionIntentsTable.id,
        specialistCode: executionIntentsTable.specialistCode,
        status: executionIntentsTable.status,
        createdAt: executionIntentsTable.createdAt,
      })
      .from(executionIntentsTable)
      .where(
        and(
          eq(executionIntentsTable.taskId, TASK_ID),
          eq(executionIntentsTable.organizationId, ORG_ID)
        )
      )
      .orderBy(desc(executionIntentsTable.createdAt))
      .limit(5);

    console.log("\n=== EXECUTION INTENTS (latest 5) ===");
    for (const r of rows) console.log(JSON.stringify(r));
    console.log("Total shown:", rows.length);
  });

  it("recent conversation messages (latest 12)", async () => {
    const rows = await db
      .select({
        id: conversationMessagesTable.id,
        messageType: conversationMessagesTable.messageType,
        createdAt: conversationMessagesTable.createdAt,
      })
      .from(conversationMessagesTable)
      .where(
        and(
          eq(conversationMessagesTable.conversationId, CONV_ID),
          eq(conversationMessagesTable.organizationId, ORG_ID)
        )
      )
      .orderBy(desc(conversationMessagesTable.createdAt))
      .limit(12);

    console.log("\n=== RECENT CONVERSATION MESSAGES (latest 12) ===");
    for (const r of rows) console.log(JSON.stringify(r));
    console.log("Total shown:", rows.length);

    const latestText = rows.filter((r) => r.messageType === "text");
    const execUpdates = rows.filter((r) => r.messageType === "execution_update");
    console.log("Latest text message at:", latestText[0]?.createdAt ?? "none");
    console.log("Latest execution_update at:", execUpdates[0]?.createdAt ?? "none");
  });

  it("historical completed_work version metadata (e7f810e9)", async () => {
    const rows = await db
      .select({
        cwId: completedWorkTable.id,
        cwStatus: completedWorkTable.status,
        primarySpecialist: completedWorkTable.primarySpecialist,
        cwTitle: completedWorkTable.title,
        versionId: completedWorkVersionsTable.id,
        versionTitle: completedWorkVersionsTable.title,
        qualityScore: completedWorkVersionsTable.qualityScore,
        versionStatus: completedWorkVersionsTable.status,
        versionCreatedAt: completedWorkVersionsTable.createdAt,
      })
      .from(completedWorkTable)
      .leftJoin(
        completedWorkVersionsTable,
        eq(completedWorkTable.currentVersionId, completedWorkVersionsTable.id)
      )
      .where(
        and(
          eq(completedWorkTable.id, HIST_CW),
          eq(completedWorkTable.organizationId, ORG_ID)
        )
      );

    console.log("\n=== HISTORICAL COMPLETED WORK VERSION (e7f810e9) ===");
    for (const r of rows) console.log(JSON.stringify(r, null, 2));
  });
});
