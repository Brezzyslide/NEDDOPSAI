/**
 * ResendEmailService — used when EMAIL_DELIVERY_MODE=resend.
 *
 * Requires RESEND_API_KEY, EMAIL_FROM_ADDRESS env vars.
 * Sends real transactional email via the Resend API.
 * Handles provider errors safely — never exposes the API key in logs or responses.
 */

import { Resend } from "resend";
import type { TransactionalEmailService, InvitationEmailInput, EmailDeliveryResult } from "./types.js";
import { invitationEmailSubject, invitationEmailHtml, invitationEmailText } from "./templates.js";

export class ResendEmailService implements TransactionalEmailService {
  private readonly client: Resend;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "EMAIL_DELIVERY_MODE is set to 'resend' but RESEND_API_KEY is not configured. " +
        "Set RESEND_API_KEY in your environment secrets.",
      );
    }

    const fromAddress = process.env.EMAIL_FROM_ADDRESS;
    if (!fromAddress) {
      throw new Error(
        "EMAIL_DELIVERY_MODE is set to 'resend' but EMAIL_FROM_ADDRESS is not configured. " +
        "Set EMAIL_FROM_ADDRESS to a verified sender address (e.g. invitations@yourdomain.com.au).",
      );
    }

    this.client = new Resend(apiKey);
    this.fromAddress = fromAddress;
    this.fromName = process.env.EMAIL_FROM_NAME ?? "NeedsOps AI+";
  }

  async sendInvitationEmail(input: InvitationEmailInput): Promise<EmailDeliveryResult> {
    const attemptedAt = new Date();

    try {
      const { data, error } = await this.client.emails.send({
        from: `${this.fromName} <${this.fromAddress}>`,
        to: [input.toEmail],
        subject: invitationEmailSubject(input.orgName),
        html: invitationEmailHtml(input),
        text: invitationEmailText(input),
      });

      if (error || !data) {
        // Log the category but never the API key
        const summary = error?.message ?? "Unknown provider error";
        console.error(`[ResendEmailService] Delivery failed for ${input.toEmail}: ${summary}`);
        return {
          state: "failed",
          provider: "resend",
          providerMessageId: null,
          sentAt: null,
          failureCategory: "provider_error",
          failureSummary: summary,
        };
      }

      console.log(`[ResendEmailService] Invitation sent to ${input.toEmail} — message ID: ${data.id}`);
      return {
        state: "sent",
        provider: "resend",
        providerMessageId: data.id,
        sentAt: new Date(),
        failureCategory: null,
        failureSummary: null,
      };
    } catch (err) {
      const isNetworkError = err instanceof Error && (
        err.message.includes("fetch") ||
        err.message.includes("network") ||
        err.message.includes("ECONNREFUSED")
      );
      const category = isNetworkError ? "network_error" : "provider_error";
      // Safe: log the error class/message but not env vars or tokens
      const summary = err instanceof Error ? err.message : "Unexpected error contacting email provider";
      console.error(`[ResendEmailService] ${category} for ${input.toEmail}: ${summary}`);
      return {
        state: "failed",
        provider: "resend",
        providerMessageId: null,
        sentAt: null,
        failureCategory: category,
        failureSummary: summary,
      };
    }
  }
}
