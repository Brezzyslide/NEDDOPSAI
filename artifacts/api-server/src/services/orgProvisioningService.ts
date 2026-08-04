/**
 * orgProvisioningService
 *
 * Orchestrates platform-console org creation in discrete, tracked steps:
 *   1. create_org       — insert org + tenant_settings + owner membership
 *   2. provision_packs  — auto-grant Core pack
 *   3. send_invitation  — (optional) send cold invite to initial admin
 *
 * Each run is persisted in organisation_provisioning_jobs so the console can
 * poll progress and retry failed steps without duplicating completed ones.
 */

import { randomUUID } from "crypto";
import { db, organizationsTable, orgProvisioningJobsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { createOrg } from "./orgService.js";
import { provisionPacksForNewOrg } from "./packProvisioningService.js";
import * as invitationService from "./invitationService.js";
import type { MembershipRole } from "@workspace/shared";

export interface ProvisionOrgParams {
  name: string;
  type?: string;
  industry?: string;
  country?: string;
  state?: string;
  timezone?: string;
  abn?: string;
  ndisRegistrationNumber?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  /** If provided, a cold invitation is sent to this email after org creation */
  initialAdminEmail?: string;
  /** Pack codes to grant in addition to Core; defaults to [] */
  additionalPackCodes?: string[];
}

export interface ProvisionStepStatus {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  error?: string;
}

export interface ProvisionSteps {
  create_org: ProvisionStepStatus;
  provision_packs: ProvisionStepStatus;
  send_invitation: ProvisionStepStatus;
}

// ─── Rate-limit registry (in-process, per owner staff member) ─────────────────
const rl = new Map<string, number[]>();
const RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RL_MAX = 10;

export function checkRateLimit(userId: string): void {
  const now = Date.now();
  const times = (rl.get(userId) ?? []).filter(t => now - t < RL_WINDOW_MS);
  if (times.length >= RL_MAX) {
    throw Object.assign(new Error("Rate limit: max 10 org creations per hour per staff member."), {
      code: "RATE_LIMITED",
      status: 429,
    });
  }
  rl.set(userId, [...times, now]);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function updateJob(
  jobId: string,
  patch: Partial<{
    status: string;
    steps: Partial<ProvisionSteps>;
    errorMessage: string | null;
    completedAt: Date | null;
  }>,
) {
  await db
    .update(orgProvisioningJobsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(orgProvisioningJobsTable.id, jobId));
}

// ─── main ─────────────────────────────────────────────────────────────────────

export async function provisionOrganisation(
  params: ProvisionOrgParams,
  initiatorUserId: string,
): Promise<{ jobId: string; orgId: string | null; error?: string }> {
  // NOTE: Rate limit is enforced by the caller (platformOrgs route) before
  // reaching here. Do NOT call checkRateLimit again inside this function —
  // doing so would double-count each create and halve the effective allowance.

  const jobId = `pj_${randomUUID()}`;
  const initialSteps: ProvisionSteps = {
    create_org:       { status: "pending" },
    provision_packs:  { status: "pending" },
    send_invitation:  params.initialAdminEmail ? { status: "pending" } : { status: "skipped" },
  };

  // Create the job record — organizationId is null until create_org completes
  await db.insert(orgProvisioningJobsTable).values({
    id: jobId,
    organizationId: null,
    initiatedBy: initiatorUserId,
    status: "running",
    steps: initialSteps,
  });

  let orgId: string | null = null;

  try {
    // ── Step 1: create_org ───────────────────────────────────────────────────
    await updateJob(jobId, {
      steps: { ...initialSteps, create_org: { status: "running" } },
    });

    const { org } = await createOrg(
      {
        name: params.name,
        type: params.type,
        industry: params.industry,
        country: params.country ?? "AU",
        state: params.state,
        timezone: params.timezone ?? "Australia/Sydney",
        abn: params.abn,
        ndisRegistrationNumber: params.ndisRegistrationNumber,
        primaryContactName: params.primaryContactName,
        primaryContactEmail: params.primaryContactEmail,
      },
      initiatorUserId,
    );
    orgId = org.id;

    // Update organizationId now that we have it
    await db
      .update(orgProvisioningJobsTable)
      .set({ organizationId: orgId, updatedAt: new Date() })
      .where(eq(orgProvisioningJobsTable.id, jobId));

    const stepsAfterCreate: ProvisionSteps = {
      ...initialSteps,
      create_org: { status: "completed" },
    };
    await updateJob(jobId, { steps: stepsAfterCreate });

    // ── Step 2: provision_packs ──────────────────────────────────────────────
    const stepsRunningPacks: ProvisionSteps = {
      ...stepsAfterCreate,
      provision_packs: { status: "running" },
    };
    await updateJob(jobId, { steps: stepsRunningPacks });

    try {
      await provisionPacksForNewOrg(
        orgId,
        initiatorUserId,
        params.additionalPackCodes ?? [],
      );
      const stepsAfterPacks: ProvisionSteps = {
        ...stepsRunningPacks,
        provision_packs: { status: "completed" },
      };
      await updateJob(jobId, { steps: stepsAfterPacks });

      // ── Step 3: send_invitation (optional) ────────────────────────────────
      if (params.initialAdminEmail) {
        const stepsRunningInvite: ProvisionSteps = {
          ...stepsAfterPacks,
          send_invitation: { status: "running" },
        };
        await updateJob(jobId, { steps: stepsRunningInvite });

        try {
          await invitationService.createInvitation({
            organizationId: orgId,
            email: params.initialAdminEmail,
            role: "administrator" as MembershipRole,
            invitedByUserId: initiatorUserId,
          });
          const finalSteps: ProvisionSteps = {
            ...stepsRunningInvite,
            send_invitation: { status: "completed" },
          };
          await updateJob(jobId, {
            status: "completed",
            steps: finalSteps,
            completedAt: new Date(),
          });
        } catch (invErr: any) {
          const finalSteps: ProvisionSteps = {
            ...stepsRunningInvite,
            send_invitation: { status: "failed", error: invErr.message ?? String(invErr) },
          };
          // Invitation failure is non-fatal — org + packs succeeded
          await updateJob(jobId, {
            status: "completed",
            steps: finalSteps,
            errorMessage: `Invitation failed: ${invErr.message}`,
            completedAt: new Date(),
          });
        }
      } else {
        await updateJob(jobId, {
          status: "completed",
          steps: { ...stepsAfterPacks, send_invitation: { status: "skipped" } },
          completedAt: new Date(),
        });
      }
    } catch (packErr: any) {
      const failedSteps: ProvisionSteps = {
        ...stepsRunningPacks,
        provision_packs: { status: "failed", error: packErr.message ?? String(packErr) },
      };
      await updateJob(jobId, {
        status: "failed",
        steps: failedSteps,
        errorMessage: `Pack provisioning failed: ${packErr.message}`,
      });
      return { jobId, orgId, error: failedSteps.provision_packs.error };
    }
  } catch (orgErr: any) {
    const failedSteps: ProvisionSteps = {
      ...initialSteps,
      create_org: { status: "failed", error: orgErr.message ?? String(orgErr) },
    };
    await updateJob(jobId, {
      status: "failed",
      steps: failedSteps,
      errorMessage: `Org creation failed: ${orgErr.message}`,
    });
    return { jobId, orgId: null, error: failedSteps.create_org.error };
  }

  return { jobId, orgId };
}

export async function getProvisioningJob(jobId: string) {
  const [job] = await db
    .select()
    .from(orgProvisioningJobsTable)
    .where(eq(orgProvisioningJobsTable.id, jobId))
    .limit(1);
  return job ?? null;
}

export async function getLatestProvisioningJobForOrg(orgId: string) {
  const [job] = await db
    .select()
    .from(orgProvisioningJobsTable)
    .where(eq(orgProvisioningJobsTable.organizationId, orgId))
    .orderBy(desc(orgProvisioningJobsTable.createdAt))
    .limit(1);
  return job ?? null;
}

/** Retry only the failed steps of an existing provisioning job */
export async function retryProvisioningJob(
  jobId: string,
  initiatorUserId: string,
): Promise<{ success: boolean; error?: string }> {
  const job = await getProvisioningJob(jobId);
  if (!job) throw Object.assign(new Error("Provisioning job not found."), { status: 404 });
  if (job.status === "completed") {
    return { success: true }; // already done
  }
  if (job.status === "running") {
    throw Object.assign(new Error("Provisioning job is already running."), { status: 409 });
  }

  const steps = job.steps as ProvisionSteps;
  const orgId = job.organizationId;

  // Mark running
  await updateJob(jobId, { status: "running" });

  // ── Retry pack provisioning if it failed ────────────────────────────────────
  if (steps.provision_packs?.status === "failed" || steps.provision_packs?.status === "pending") {
    await updateJob(jobId, {
      steps: { ...steps, provision_packs: { status: "running" } },
    });
    try {
      await provisionPacksForNewOrg(orgId, initiatorUserId, []);
      steps.provision_packs = { status: "completed" };
      await updateJob(jobId, { steps });
    } catch (e: any) {
      steps.provision_packs = { status: "failed", error: e.message };
      await updateJob(jobId, { status: "failed", steps, errorMessage: e.message });
      return { success: false, error: e.message };
    }
  }

  // ── Retry send_invitation if it failed ──────────────────────────────────────
  if (steps.send_invitation?.status === "failed" || steps.send_invitation?.status === "pending") {
    // We don't have the email stored — invitation retry is a no-op unless the
    // platform staff resends from the invitations panel. Mark skipped.
    steps.send_invitation = { status: "skipped" };
    await updateJob(jobId, { steps });
  }

  // Check if all non-skipped steps are completed
  const allDone = Object.values(steps).every(
    (s: ProvisionStepStatus) => s.status === "completed" || s.status === "skipped",
  );
  await updateJob(jobId, {
    status: allDone ? "completed" : "failed",
    completedAt: allDone ? new Date() : null,
  });

  return { success: allDone };
}
