/**
 * @workspace/validation
 *
 * Shared Zod schemas for domain entities used across the NeedsOps AI+ platform.
 * These are the canonical validation definitions — import them in route handlers
 * and form validation.
 */

import { z } from "zod/v4";

// ─── Pagination ───────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

// ─── Organization ─────────────────────────────────────────────────────────────

export const organizationStatusSchema = z.enum([
  "onboarding",
  "active",
  "suspended",
  "closed",
]);

export const subscriptionTierSchema = z.enum([
  "starter",
  "professional",
  "enterprise",
]);

export const createOrganizationSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  industry: z.string().optional(),
  subscriptionTier: subscriptionTierSchema,
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).optional(),
  industry: z.string().optional(),
  status: organizationStatusSchema.optional(),
  subscriptionTier: subscriptionTierSchema.optional(),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// ─── User ─────────────────────────────────────────────────────────────────────

export const userRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export const userStatusSchema = z.enum(["active", "invited", "suspended"]);

export const createUserSchema = z.object({
  email: z.string().min(1, "Email is required"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: userRoleSchema,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

// ─── Workforce pack ───────────────────────────────────────────────────────────

export const packTierSchema = z.enum(["starter", "professional", "enterprise"]);
export const packStatusSchema = z.enum(["available", "coming_soon"]);

export const workerSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()),
});

export type Worker = z.infer<typeof workerSchema>;

export const createWorkforcePackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2),
  description: z.string().min(1),
  industry: z.string().min(1),
  workers: z.array(workerSchema),
  tier: packTierSchema,
  status: packStatusSchema,
});

export type CreateWorkforcePackInput = z.infer<typeof createWorkforcePackSchema>;

// ─── ID param ─────────────────────────────────────────────────────────────────

export const idParamSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

export const orgIdParamSchema = z.object({
  orgId: z.string().min(1, "Organization ID is required"),
});
