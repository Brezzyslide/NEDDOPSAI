import { PROHIBITED_EMPLOYEE_FILE_REFERENCES } from "./types.js";

// ─── EmployeeFileResourceValidationResult ─────────────────────────────────────

export interface EmployeeFileResourceValidationResult {
  valid: boolean;
  errors: string[];
  prohibitedReferencesFound: string[];
}

/**
 * Validates that an Employee File section does not contain direct references
 * to physical storage technologies, URLs, or execution runtimes.
 *
 * Called during validateEmployeeFile() to enforce the platform standard.
 */
export function validateNoDirectResourceReferences(
  content: string,
  fieldName: string,
): { errors: string[]; prohibitedReferencesFound: string[] } {
  const lower = content.toLowerCase();
  const found: string[] = [];

  for (const ref of PROHIBITED_EMPLOYEE_FILE_REFERENCES) {
    if (lower.includes(ref)) found.push(ref);
  }

  const errors = found.map(
    (ref) =>
      `${fieldName} contains a prohibited direct resource reference: "${ref}". Use Organisation Resource abstractions instead.`
  );

  return { errors, prohibitedReferencesFound: found };
}
