import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requireOwnerOrAdmin } from "../../middlewares/requireOrgRole.js";
import {
  createParticipant,
  linkParticipantSource,
  listParticipantSources,
  listParticipants,
  listUnlinkedParticipantSources,
  ParticipantServiceError,
  searchParticipants,
  softDeleteParticipant,
  unlinkParticipantSource,
  updateParticipant,
} from "../../services/participantService.js";

const router = Router({ mergeParams: true });

function handleParticipantError(err: unknown, res: any): boolean {
  if (!(err instanceof ParticipantServiceError)) return false;
  const status =
    err.code === "NOT_FOUND" || err.code === "SOURCE_NOT_FOUND" ? 404 :
    err.code === "VALIDATION_ERROR" || err.code === "INVALID_SOURCE_TYPE" ? 400 :
    409;
  res.status(status).json({ error: { code: err.code, message: err.message } });
  return true;
}

router.get("/", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const { status, q, limit, offset } = req.query as Record<string, string>;
    const result = await listParticipants({
      organizationId: ctx.tenantId,
      status,
      query: q,
      limit,
      offset,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/search", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const { q, limit } = req.query as Record<string, string>;
    const results = await searchParticipants(ctx.tenantId, q ?? "", limit);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.get("/unlinked-sources", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const sources = await listUnlinkedParticipantSources(ctx.tenantId);
    res.json({ sources });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, resolveTenantFromSlug, requireOwnerOrAdmin, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const participant = await createParticipant(ctx.tenantId, req.body);
    res.status(201).json({ participant });
  } catch (err) {
    if (handleParticipantError(err, res)) return;
    next(err);
  }
});

router.patch("/:participantId", requireAuth, resolveTenantFromSlug, requireOwnerOrAdmin, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const participant = await updateParticipant(ctx.tenantId, req.params.participantId!, req.body);
    res.json({ participant });
  } catch (err) {
    if (handleParticipantError(err, res)) return;
    next(err);
  }
});

router.delete("/:participantId", requireAuth, resolveTenantFromSlug, requireOwnerOrAdmin, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const result = await softDeleteParticipant(ctx.tenantId, req.params.participantId!);
    res.json(result);
  } catch (err) {
    if (handleParticipantError(err, res)) return;
    next(err);
  }
});

router.get("/:participantId/sources", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const sources = await listParticipantSources(ctx.tenantId, req.params.participantId!);
    res.json({ sources });
  } catch (err) {
    if (handleParticipantError(err, res)) return;
    next(err);
  }
});

router.post("/:participantId/sources/:sourceId", requireAuth, resolveTenantFromSlug, requireOwnerOrAdmin, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const scope = await linkParticipantSource({
      organizationId: ctx.tenantId,
      participantId: req.params.participantId!,
      sourceId: req.params.sourceId!,
      actorUserId: user.id,
    });
    res.status(201).json({ scope });
  } catch (err) {
    if (handleParticipantError(err, res)) return;
    next(err);
  }
});

router.delete("/:participantId/sources/:sourceId", requireAuth, resolveTenantFromSlug, requireOwnerOrAdmin, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    await unlinkParticipantSource({
      organizationId: ctx.tenantId,
      participantId: req.params.participantId!,
      sourceId: req.params.sourceId!,
      actorUserId: user.id,
    });
    res.status(204).send();
  } catch (err) {
    if (handleParticipantError(err, res)) return;
    next(err);
  }
});

export default router;
