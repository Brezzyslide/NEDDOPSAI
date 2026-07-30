/**
 * Format a raw 16-char code as XXXX-XXXX-XXXX-XXXX
 */
export function formatActivationCode(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16);
  return clean.match(/.{1,4}/g)?.join("-") ?? clean;
}

export function stripCodeFormatting(formatted: string): string {
  return formatted.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}
