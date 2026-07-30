/**
 * Installer release routes — Sprint 14
 *
 * GET /v1/installer/latest?platform=macos|windows|linux&arch=arm64|x64&channel=stable
 *   Redirects to the latest installer download URL for the given platform.
 *
 * GET /v1/installer/latest.json
 *   Returns installer metadata as JSON (no redirect).
 *
 * GET /v1/installer/releases
 *   List all installer releases (platform admin).
 *
 * POST /v1/installer/releases
 *   Create a new installer release record (platform admin).
 */

import { Router } from "express";
import { createHash } from "crypto";
import { db, installerReleasesTable, installerDownloadEventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function detectPlatformFromUserAgent(ua: string): { platform: string; arch: string } | null {
  const uaLower = ua.toLowerCase();
  if (uaLower.includes("win")) return { platform: "windows", arch: "x64" };
  if (uaLower.includes("mac")) {
    // Safari UA on Apple Silicon still says Intel for compatibility reasons
    // so we default to arm64 (the more common modern build target)
    return { platform: "macos", arch: "arm64" };
  }
  if (uaLower.includes("linux")) return { platform: "linux", arch: "x64" };
  return null;
}

async function findLatestRelease(platform: string, arch: string, channel = "stable") {
  const [release] = await db
    .select()
    .from(installerReleasesTable)
    .where(
      and(
        eq(installerReleasesTable.platform, platform),
        eq(installerReleasesTable.arch, arch),
        eq(installerReleasesTable.channel, channel),
        eq(installerReleasesTable.isCurrent, true),
      ),
    )
    .limit(1);
  return release ?? null;
}

// ── GET /v1/installer/latest ─────────────────────────────────────────────────

router.get("/installer/latest", async (req, res, next) => {
  try {
    let platform = req.query.platform as string | undefined;
    let arch = (req.query.arch as string | undefined) ?? "arm64";
    const channel = (req.query.channel as string | undefined) ?? "stable";

    // Auto-detect from User-Agent if platform not provided
    if (!platform) {
      const ua = req.headers["user-agent"] ?? "";
      const detected = detectPlatformFromUserAgent(ua);
      if (detected) { platform = detected.platform; arch = detected.arch; }
    }

    if (!platform) {
      res.status(422).json({
        error: { code: "VALIDATION_ERROR", message: "platform is required (macos, windows, linux)" },
      });
      return;
    }

    const release = await findLatestRelease(platform, arch, channel);

    if (!release) {
      // Try other arch
      const otherArch = arch === "arm64" ? "x64" : "arm64";
      const fallback = await findLatestRelease(platform, otherArch, channel);
      if (!fallback) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `No installer available for ${platform} ${arch}.` },
        });
        return;
      }

      // Record download event
      await recordDownload(req, fallback.id, platform, otherArch);
      return res.redirect(302, fallback.downloadUrl);
    }

    await recordDownload(req, release.id, platform, arch);
    res.redirect(302, release.downloadUrl);
  } catch (err) {
    next(err);
  }
});

// ── GET /v1/installer/latest.json ────────────────────────────────────────────

router.get("/installer/latest.json", async (req, res, next) => {
  try {
    const platform = req.query.platform as string | undefined;
    const arch = (req.query.arch as string | undefined) ?? "arm64";
    const channel = (req.query.channel as string | undefined) ?? "stable";

    if (!platform) {
      // Return all current releases
      const releases = await db
        .select()
        .from(installerReleasesTable)
        .where(
          and(
            eq(installerReleasesTable.isCurrent, true),
            eq(installerReleasesTable.channel, channel),
          ),
        );
      res.json({ releases });
      return;
    }

    const release = await findLatestRelease(platform, arch, channel);
    if (!release) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No installer available." } });
      return;
    }

    res.json({ release });
  } catch (err) {
    next(err);
  }
});

// ── POST /v1/installer/releases (platform admin) ──────────────────────────────

router.post("/installer/releases", async (req, res, next) => {
  try {
    // Require platform admin auth — simple API key check for now
    const adminKey = req.headers["x-platform-admin-key"] as string | undefined;
    if (adminKey !== process.env.PLATFORM_ADMIN_KEY || !process.env.PLATFORM_ADMIN_KEY) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Platform admin key required." } });
      return;
    }

    const { randomUUID } = await import("crypto");
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
      res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "version, platform, arch, downloadUrl required." } });
      return;
    }

    // If isCurrent, clear other current releases for this platform/arch/channel
    if (isCurrent) {
      await db
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
    await db.insert(installerReleasesTable).values({
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

async function recordDownload(
  req: any,
  releaseId: string,
  platform: string,
  arch: string,
): Promise<void> {
  const { randomUUID } = await import("crypto");
  const ip = req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "";
  const ipHash = createHash("sha256").update(String(ip)).digest("hex");

  await db.insert(installerDownloadEventsTable).values({
    id: `ide_${randomUUID()}`,
    releaseId,
    organizationId: null,
    userId: null,
    platform,
    arch,
    ipHash,
    userAgent: req.headers["user-agent"] ?? null,
  }).catch(() => {});
}

export default router;
