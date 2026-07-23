import { RESERVED_SLUGS } from "@workspace/shared";

/**
 * Converts a string to a URL-safe, lowercase organisation slug.
 *
 * Rules:
 * - Lowercase
 * - Alphanumeric + hyphens only
 * - No leading/trailing hyphens
 * - Max 63 characters (DNS label limit)
 * - Protected against reserved words
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")    // strip non-alphanumeric
    .trim()
    .replace(/[\s_]+/g, "-")          // spaces/underscores → hyphens
    .replace(/-+/g, "-")              // collapse multiple hyphens
    .replace(/^-+|-+$/g, "")          // strip leading/trailing hyphens
    .slice(0, 63);
}

/**
 * Generates a unique org slug, appending a numeric suffix if the base slug
 * is already taken or is reserved.
 *
 * @param name - The organisation name to derive the slug from
 * @param exists - Async function that returns true if the slug is already in use
 * @param maxAttempts - Maximum number of suffix attempts (default 10)
 */
export async function generateUniqueSlug(
  name: string,
  exists: (slug: string) => Promise<boolean>,
  maxAttempts = 10,
): Promise<string> {
  const base = slugify(name);

  if (!base) {
    throw new Error("Cannot generate a slug from the provided name.");
  }

  // Check the base slug first
  const baseReserved = RESERVED_SLUGS.has(base);
  if (!baseReserved && !(await exists(base))) {
    return base;
  }

  // Try with numeric suffix
  for (let i = 2; i <= maxAttempts + 1; i++) {
    const candidate = `${base}-${i}`.slice(0, 63);
    if (!RESERVED_SLUGS.has(candidate) && !(await exists(candidate))) {
      return candidate;
    }
  }

  // Last resort: append a random 4-char suffix
  const { randomBytes } = await import("crypto");
  const suffix = randomBytes(2).toString("hex");
  const fallback = `${base}-${suffix}`.slice(0, 63);
  if (await exists(fallback)) {
    throw new Error("Could not generate a unique slug after multiple attempts.");
  }
  return fallback;
}

export { RESERVED_SLUGS };
