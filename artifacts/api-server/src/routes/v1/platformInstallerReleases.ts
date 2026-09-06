import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { installerReleasesTable } from "@workspace/db";
import { platformDb } from "@workspace/db/platform";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth, requirePlatformRole } from "../../middlewares/requirePlatformRole.js";

const router = Router();
const auth = [requireAuth, requirePlatformAuth, requirePlatformRole("platform_operations_admin")];

router.post("/releases", ...auth, async (req, res, next) => {
  try {
    const {
      version,
      channel = "stable",
      platform,
      arch,
      downloadUrl,
      sha256,
      fileSizeBytes,
      minOsVersion,
      releaseNotes,
      isCurrent = true,
    } = req.body;

    if (!version || !platform || !arch || !downloadUrl) {
      res.status(422).json({
        error: { code: "VALIDATION_ERROR", message: "version, platform, arch, downloadUrl required." },
      });
      return;
    }

    if (isCurrent) {
      await platformDb
        .update(installerReleasesTable)
        .set({ isCurrent: false, updatedAt: new Date() })
        .where(
          and(
            eq(installerReleasesTable.platform, platform),
            eq(installerReleasesTable.arch, arch),
            eq(installerReleasesTable.channel, channel),
          ),
        );
    }

    const id = `ir_${randomUUID()}`;
    await platformDb.insert(installerReleasesTable).values({
      id,
      version,
      channel,
      platform,
      arch,
      downloadUrl,
      sha256,
      fileSizeBytes,
      minOsVersion,
      releaseNotes,
      isCurrent,
      publishedAt: new Date(),
    });

    res.status(201).json({ release: { id, version, platform, arch, downloadUrl } });
  } catch (err) {
    next(err);
  }
});

export default router;
