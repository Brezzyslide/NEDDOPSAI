import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { completedWorkTable } from "./completedWork.js";

export const WORK_ARTIFACT_STATUSES = [
  "pending",
  "generated",
  "generation_failed",
  "stored",
] as const;
export type WorkArtifactStatus = (typeof WORK_ARTIFACT_STATUSES)[number];

export const workArtifactsTable = pgTable("work_artifacts", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  taskId: text("task_id"),
  completedWorkId: text("completed_work_id")
    .references(() => completedWorkTable.id, { onDelete: "set null" }),
  workroomId: text("workroom_id"),
  conversationId: text("conversation_id"),

  artifactType: text("artifact_type").notNull(),
  fileFormat: text("file_format").notNull(),
  storageReference: text("storage_reference"),
  storageProvider: text("storage_provider"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  checksum: text("checksum"),
  version: integer("version").notNull().default(1),
  generationStatus: text("generation_status")
    .$type<WorkArtifactStatus>()
    .notNull()
    .default("pending"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
