/**
 * Test helper — verify an inbound HMAC-SHA256 webhook signature.
 * Mirrors the verification logic in RuntimeBrokerClient.verifyWebhookSignature
 * in lib/openclaw/src/runtimeBrokerClient.ts.
 */

import { createHmac, timingSafeEqual } from "crypto";

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = signatureHeader.replace(/^sha256=/, "");

  if (expected.length !== actual.length) return false;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return timingSafeEqual(a, b);
}
