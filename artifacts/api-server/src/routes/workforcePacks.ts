import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, workforcePacksTable } from "@workspace/db";
import { idParamSchema } from "@workspace/validation";

const router = Router();

// GET /workforce-packs
router.get("/", async (_req, res) => {
  const items = await db
    .select()
    .from(workforcePacksTable)
    .orderBy(workforcePacksTable.name);

  res.json({ items, total: items.length });
});

// GET /workforce-packs/:id
router.get("/:id", async (req, res) => {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [pack] = await db
    .select()
    .from(workforcePacksTable)
    .where(eq(workforcePacksTable.id, parsed.data.id))
    .limit(1);

  if (!pack) {
    res.status(404).json({ error: "Workforce pack not found" });
    return;
  }

  res.json(pack);
});

export default router;
