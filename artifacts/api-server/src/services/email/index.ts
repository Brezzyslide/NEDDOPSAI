/**
 * Email service factory.
 * Selects the correct implementation based on EMAIL_DELIVERY_MODE env var.
 *
 * Supported modes:
 *   development  — logs preview to stdout, no real delivery (default)
 *   resend       — sends via Resend API (requires RESEND_API_KEY + EMAIL_FROM_ADDRESS)
 */

import type { TransactionalEmailService } from "./types.js";
import { DevelopmentEmailService } from "./developmentEmailService.js";
import { ResendEmailService } from "./resendEmailService.js";

export type { TransactionalEmailService, EmailDeliveryResult, InvitationEmailInput } from "./types.js";

let _instance: TransactionalEmailService | null = null;

export function getEmailService(): TransactionalEmailService {
  if (_instance) return _instance;

  const mode = process.env.EMAIL_DELIVERY_MODE ?? "development";

  switch (mode) {
    case "resend":
      _instance = new ResendEmailService();
      break;
    case "development":
    default:
      _instance = new DevelopmentEmailService();
      break;
  }

  return _instance;
}

/** Reset the singleton — used in tests only */
export function _resetEmailServiceForTest(): void {
  _instance = null;
}
