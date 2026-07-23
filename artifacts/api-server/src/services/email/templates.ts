/**
 * NeedsOps AI+ email templates.
 * All styles are inline — required for email client compatibility.
 */

import type { InvitationEmailInput } from "./types.js";

const BRAND_COLOR = "#00D4FF";
const BG_DARK = "#0B1829";
const BG_CARD = "#112033";
const BORDER = "#1E3A5F";
const TEXT_PRIMARY = "#E2E8F0";
const TEXT_MUTED = "#94A3B8";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Invitation email ─────────────────────────────────────────────────────────

export function invitationEmailSubject(orgName: string): string {
  return `You have been invited to join ${orgName} on NeedsOps AI+`;
}

export function invitationEmailHtml(input: InvitationEmailInput): string {
  const { toEmail, orgName, inviterName, role, expiresAt, acceptanceUrl } = input;
  const inviterLine = inviterName
    ? `<p style="margin:0 0 8px;color:${TEXT_MUTED};font-size:15px;line-height:1.6;">
         <strong style="color:${TEXT_PRIMARY};">${inviterName}</strong> has invited you to join
       </p>`
    : `<p style="margin:0 0 8px;color:${TEXT_MUTED};font-size:15px;line-height:1.6;">
         You have been invited to join
       </p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invitation to join ${orgName} on NeedsOps AI+</title>
</head>
<body style="margin:0;padding:0;background-color:${BG_DARK};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG_DARK};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / brand -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:${BRAND_COLOR};letter-spacing:-0.5px;">
                NeedsOps AI+
              </p>
              <p style="margin:4px 0 0;font-size:12px;color:${TEXT_MUTED};letter-spacing:2px;text-transform:uppercase;">
                NDIS Operations Platform
              </p>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:${BG_CARD};border:1px solid ${BORDER};border-radius:16px;padding:40px 36px;">

              <!-- Heading -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:24px;">
                    ${inviterLine}
                    <h1 style="margin:0 0 4px;font-size:24px;font-weight:700;color:${TEXT_PRIMARY};line-height:1.3;">
                      ${orgName}
                    </h1>
                    <p style="margin:0;font-size:14px;color:${TEXT_MUTED};">as a team member on NeedsOps AI+</p>
                  </td>
                </tr>

                <!-- Role badge -->
                <tr>
                  <td style="padding-bottom:28px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background-color:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.3);border-radius:6px;padding:6px 14px;">
                          <span style="font-size:13px;font-weight:600;color:${BRAND_COLOR};">
                            Role: ${capitalise(role)}
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- CTA -->
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <a href="${acceptanceUrl}"
                       style="display:inline-block;background-color:${BRAND_COLOR};color:#0B1829;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;padding:14px 36px;letter-spacing:0.2px;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>

                <!-- Expiry -->
                <tr>
                  <td style="padding-bottom:28px;">
                    <p style="margin:0;font-size:13px;color:${TEXT_MUTED};text-align:center;">
                      This invitation expires on <strong style="color:${TEXT_PRIMARY};">${formatDate(expiresAt)}</strong>
                    </p>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="padding-bottom:24px;">
                    <hr style="border:none;border-top:1px solid ${BORDER};margin:0;" />
                  </td>
                </tr>

                <!-- Plain link fallback -->
                <tr>
                  <td style="padding-bottom:24px;">
                    <p style="margin:0 0 8px;font-size:13px;color:${TEXT_MUTED};">
                      If the button doesn't work, copy and paste this link into your browser:
                    </p>
                    <p style="margin:0;font-size:12px;word-break:break-all;">
                      <a href="${acceptanceUrl}" style="color:${BRAND_COLOR};text-decoration:none;">${acceptanceUrl}</a>
                    </p>
                  </td>
                </tr>

                <!-- Privacy notice -->
                <tr>
                  <td style="background-color:rgba(30,58,95,0.4);border-radius:8px;padding:12px 16px;">
                    <p style="margin:0;font-size:12px;color:${TEXT_MUTED};line-height:1.6;">
                      ⚠️ This invitation was intended for
                      <strong style="color:${TEXT_PRIMARY};">${toEmail}</strong>.
                      If you received this in error, please disregard it — no action is required.
                      The link will expire automatically.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:${TEXT_MUTED};">
                NeedsOps AI+ · Australian NDIS Operations Platform
              </p>
              <p style="margin:0;font-size:12px;color:${TEXT_MUTED};">
                Need help? Contact your organisation administrator or reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function invitationEmailText(input: InvitationEmailInput): string {
  const { toEmail, orgName, inviterName, role, expiresAt, acceptanceUrl } = input;
  const inviterLine = inviterName
    ? `${inviterName} has invited you to join ${orgName} on NeedsOps AI+.`
    : `You have been invited to join ${orgName} on NeedsOps AI+.`;

  return `
NeedsOps AI+ — Invitation

${inviterLine}

Your role: ${capitalise(role)}

Accept your invitation here:
${acceptanceUrl}

This invitation expires on ${formatDate(expiresAt)}.

---
This invitation was intended for ${toEmail}.
If you received this in error, please disregard it — no action is required.

NeedsOps AI+ · Australian NDIS Operations Platform
`.trim();
}
