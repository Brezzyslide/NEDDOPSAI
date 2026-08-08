/**
 * completed_work_claim_evidence — Sprint 29K.3
 *
 * Binding table linking a specific claim to a specific evidence link row.
 * Evidence links (completed_work_evidence_links) are the durable provenance
 * anchors written during Sprint 29K.2.
 *
 * relationship semantics:
 *   direct_support      — chunk directly supports the claim (observation)
 *   context             — chunk provides surrounding context (inference)
 *   contradiction       — chunk is one side of a contradiction pair
 *   external_authority  — chunk comes from an approved external/legislative source
 *   searched_for_absence — chunk was retrieved when searching for absent content
 *
 * supportingSpan: an exact verbatim substring of EvidenceChunk.text verified
 *   server-side. Never auto-filled with passageSnapshot.
 *   null when the claim binds to a chunk but no specific span is cited.
 *
 * spanVerified: "true" only when supportingSpan was confirmed as an exact
 *   substring of the live chunk text at persistence time.
 */
import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { completedWorkClaimsTable } from "./completedWorkClaims.js";
import { completedWorkEvidenceLinksTable } from "./completedWorkEvidenceLinks.js";

export type ClaimRelationship =
  | "direct_support"
  | "context"
  | "contradiction"
  | "external_authority"
  | "searched_for_absence";

export const completedWorkClaimEvidenceTable = pgTable(
  "completed_work_claim_evidence",
  {
    id: text("id").primaryKey(),

    claimId: text("claim_id")
      .notNull()
      .references(() => completedWorkClaimsTable.id, { onDelete: "cascade" }),

    evidenceLinkId: text("evidence_link_id")
      .notNull()
      .references(() => completedWorkEvidenceLinksTable.id, { onDelete: "cascade" }),

    organizationId: text("organization_id").notNull(),

    /**
     * Describes how the evidence relates to the claim.
     * DB-level check in migration SQL.
     */
    relationship: text("relationship").notNull(),

    /**
     * Server-verified exact substring from EvidenceChunk.text.
     * null if no span was cited or span failed verification.
     * MUST NOT be set to passageSnapshot automatically.
     */
    supportingSpan: text("supporting_span"),

    /**
     * "true"  — supportingSpan was confirmed as exact substring at persistence time.
     * "false" — no span provided, span failed verification, or evidence binding has no span.
     */
    spanVerified: text("span_verified").notNull().default("false"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueBinding: unique("completed_work_claim_evidence_unique").on(
      table.claimId,
      table.evidenceLinkId,
      table.relationship,
    ),
  }),
);
