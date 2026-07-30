/**
 * Device Authentication routes — Sprint 15
 *
 * POST /v1/devices/auth/challenge  — issue a signing nonce (device identity required)
 * POST /v1/devices/auth/exchange   — sign nonce → short-lived access + refresh token
 * POST /v1/devices/auth/refresh    — rotate refresh token → new access + refresh pair
 *
 * These routes use the long-lived brokerAuthToken (from Sprint 14 registration)
 * to bootstrap into the new short-lived token model.
 *
 * After the initial exchange, the device uses only short-lived access tokens
 * for the WS relay. The long-lived token is retained as a fallback bootstrap
 * mechanism if the refresh token is also lost (e.g. after OS reinstall).
 */

import { Router } from "express";
import * as deviceAuthService from "../../services/deviceAuthService.js";
import * as deviceService from "../../services/deviceService.js";

const router = Router();

// POST /v1/devices/auth/challenge
router.post("/auth/challenge", async (req, res, next) => {
  try {
    const { deviceId, organizationId } = req.body as {
      deviceId?: string;
      organizationId?: string;
    };

    if (!deviceId || !organizationId) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "deviceId and organizationId are required",
        },
      });
      return;
    }

    // Must be called with a valid legacy bearer token (brokerAuthToken from Sprint 14)
    // to prevent challenge spam from unauthenticated callers.
    const authHeader = req.headers.authorization as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Bearer token required" } });
      return;
    }
    const legacyToken = authHeader.slice(7);
    const authResult = await deviceService.authenticateDevice(legacyToken);
    if (!authResult || authResult.device.id !== deviceId) {
      res.status(401).json({
        error: { code: "INVALID_CREDENTIALS", message: "Invalid or revoked device credentials" },
      });
      return;
    }

    const challenge = await deviceAuthService.createChallenge(deviceId, organizationId);
    res.json({ challengeId: challenge.challengeId, nonce: challenge.nonce, expiresAt: challenge.expiresAt });
  } catch (err: any) {
    if (err.code === "DEVICE_REVOKED") {
      res.status(403).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err.code === "NO_PUBLIC_KEY" || err.code === "DEVICE_NOT_FOUND") {
      res.status(400).json({ error: { code: err.code, message: err.message } });
      return;
    }
    next(err);
  }
});

// POST /v1/devices/auth/exchange
router.post("/auth/exchange", async (req, res, next) => {
  try {
    const { deviceId, organizationId, challengeId, signature } = req.body as {
      deviceId?: string;
      organizationId?: string;
      challengeId?: string;
      signature?: string;
    };

    if (!deviceId || !organizationId || !challengeId || !signature) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "deviceId, organizationId, challengeId, and signature are required",
        },
      });
      return;
    }

    const result = await deviceAuthService.exchangeChallenge({
      deviceId,
      organizationId,
      challengeId,
      signature,
    });

    res.json({
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
      refreshToken: result.refreshToken,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
      deviceId: result.deviceId,
      organizationId: result.organizationId,
    });
  } catch (err: any) {
    const clientErrors = new Set([
      "CHALLENGE_NOT_FOUND", "CHALLENGE_USED", "CHALLENGE_EXPIRED",
      "DEVICE_REVOKED", "INVALID_SIGNATURE", "NO_PUBLIC_KEY",
    ]);
    if (clientErrors.has(err.code)) {
      res.status(401).json({ error: { code: err.code, message: err.message } });
      return;
    }
    next(err);
  }
});

// POST /v1/devices/auth/refresh
router.post("/auth/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };

    if (!refreshToken) {
      res.status(422).json({
        error: { code: "VALIDATION_ERROR", message: "refreshToken is required" },
      });
      return;
    }

    const result = await deviceAuthService.refreshAccessToken(refreshToken);

    res.json({
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
      refreshToken: result.refreshToken,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
    });
  } catch (err: any) {
    const clientErrors = new Set([
      "INVALID_REFRESH_TOKEN", "REFRESH_TOKEN_REUSED",
      "REFRESH_TOKEN_EXPIRED", "DEVICE_REVOKED",
    ]);
    if (clientErrors.has(err.code)) {
      res.status(401).json({ error: { code: err.code, message: err.message } });
      return;
    }
    next(err);
  }
});

export default router;
