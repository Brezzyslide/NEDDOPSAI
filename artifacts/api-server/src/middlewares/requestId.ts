import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Assigns a unique request ID to every incoming request.
 * Uses X-Request-ID header if provided by an upstream proxy, otherwise generates a UUID.
 * The ID is echoed back in the X-Request-ID response header for correlation.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const existing = req.headers["x-request-id"];
  const requestId = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
  req.headers["x-request-id"] = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}
