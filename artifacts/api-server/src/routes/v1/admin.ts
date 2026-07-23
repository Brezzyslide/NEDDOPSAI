/**
 * Platform admin routes — /v1/admin/*
 *
 * Requires: valid Clerk session + publicMetadata.platformAdmin = true
 * These routes are separate from org-level routes and have no tenant context.
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAdmin } from "../../middlewares/requirePermission.js";
import { db, usersTable, organizationsTable, membershipsTable, auditLogTable } from "@workspace/db";
import { count } from "drizzle-orm";

const router = Router();

// GET /v1/admin/status
router.get("/status", requireAuth, requirePlatformAdmin, async (_req, res, next) => {
  try {
    const [userCount] = await db.select({ n: count() }).from(usersTable);
    const [orgCount] = await db.select({ n: count() }).from(organizationsTable);
    const [membershipCount] = await db.select({ n: count() }).from(membershipsTable);
    const [auditCount] = await db.select({ n: count() }).from(auditLogTable);

    res.json({
      platform: "NeedsOps AI+",
      sprint: "1",
      metrics: {
        users: Number(userCount?.n ?? 0),
        organisations: Number(orgCount?.n ?? 0),
        memberships: Number(membershipCount?.n ?? 0),
        auditEvents: Number(auditCount?.n ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/admin/users
router.get("/users", requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const users = await db
      .select()
      .from(usersTable)
      .limit(limit)
      .offset(offset)
      .orderBy(usersTable.createdAt);

    res.json({ users, page, limit });
  } catch (err) {
    next(err);
  }
});

// GET /v1/admin/tenants
router.get("/tenants", requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const orgs = await db
      .select()
      .from(organizationsTable)
      .limit(limit)
      .offset(offset)
      .orderBy(organizationsTable.createdAt);

    res.json({ organisations: orgs, page, limit });
  } catch (err) {
    next(err);
  }
});

export default router;
