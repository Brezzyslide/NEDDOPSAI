import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, ilike, sql } from "drizzle-orm";
import { db, organizationsTable, usersTable } from "@workspace/db";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  idParamSchema,
  paginationSchema,
} from "@workspace/validation";

const router = Router();

// GET /organizations
router.get("/", async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  const { page, limit, search } = parsed.data;
  const offset = (page - 1) * limit;

  const whereClause = search
    ? ilike(organizationsTable.name, `%${search}%`)
    : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(organizationsTable)
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .orderBy(organizationsTable.createdAt),
    db
      .select({ count: sql<number>`count(*)` })
      .from(organizationsTable)
      .where(whereClause),
  ]);

  const total = Number(countResult[0]?.count ?? 0);

  res.json({ items, total, page, limit });
});

// POST /organizations
router.post("/", async (req, res) => {
  const parsed = createOrganizationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const { name, slug, industry, subscriptionTier } = parsed.data;
  const id = randomUUID();

  const [org] = await db
    .insert(organizationsTable)
    .values({ id, name, slug, industry, subscriptionTier })
    .returning();

  res.status(201).json(org);
});

// GET /organizations/:id
router.get("/:id", async (req, res) => {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, parsed.data.id))
    .limit(1);

  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  res.json(org);
});

// PATCH /organizations/:id
router.patch("/:id", async (req, res) => {
  const paramParsed = idParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const bodyParsed = updateOrganizationSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const [existing] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, paramParsed.data.id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const [updated] = await db
    .update(organizationsTable)
    .set({ ...bodyParsed.data, updatedAt: new Date() })
    .where(eq(organizationsTable.id, paramParsed.data.id))
    .returning();

  res.json(updated);
});

// DELETE /organizations/:id
router.delete("/:id", async (req, res) => {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [existing] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, parsed.data.id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  await db.delete(organizationsTable).where(eq(organizationsTable.id, parsed.data.id));
  res.status(204).send();
});

// GET /organizations/:orgId/users — Sprint 0 stub (users no longer have direct org FK;
// use /v1/organisations/:slug/members for Sprint 1)
router.get("/:orgId/users", async (_req, res) => {
  res.status(410).json({ error: "Deprecated. Use /v1/organisations/:slug/members instead." });
});

// POST /organizations/:orgId/users — deprecated in Sprint 1 (use invitations)
router.post("/:orgId/users", async (_req, res) => {
  res.status(410).json({ error: "Deprecated. Use /v1/organisations/:slug/invitations instead." });
});

export default router;
