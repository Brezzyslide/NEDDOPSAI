/**
 * Organisation Structure Service — Platform Completion Sprint
 *
 * Manages the organisational hierarchy: departments, teams, positions,
 * reporting lines, delegated authority, and escalation paths.
 *
 * All data is persisted in the platform DB via:
 *   org_departments, org_teams, org_positions, org_reporting_lines,
 *   org_delegated_authority, org_escalation_paths
 *
 * Tables are exported from @workspace/db once the schema is built.
 */

import { randomUUID } from "crypto";
import {
  db,
  orgDepartmentsTable,
  orgTeamsTable,
  orgPositionsTable,
  orgReportingLinesTable,
  orgDelegatedAuthorityTable,
  orgEscalationPathsTable,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

// ─── Public Interface Types ───────────────────────────────────────────────────

export interface Department {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description?: string;
  parentDepartmentId?: string;
  managerUserId?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Team {
  id: string;
  organizationId: string;
  departmentId?: string;
  name: string;
  code: string;
  description?: string;
  teamLeadUserId?: string;
  status: string;
}

export interface Position {
  id: string;
  organizationId: string;
  departmentId?: string;
  teamId?: string;
  title: string;
  code: string;
  reportsToPosId?: string;
  authorityLevel: number;
  isManager: boolean;
  canApproveUpToAmount?: number;
  status: string;
}

export interface ReportingLine {
  id: string;
  organizationId: string;
  userId: string;
  reportsToUserId: string;
  positionId?: string;
  relationshipType: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
}

export interface DelegatedAuthority {
  id: string;
  organizationId: string;
  delegatingUserId: string;
  delegateUserId: string;
  authorityScope: string;
  maxApprovalAmount?: number;
  delegatedFrom: Date;
  delegatedUntil?: Date;
  reason?: string;
  status: string;
}

export interface EscalationPath {
  id: string;
  organizationId: string;
  name: string;
  triggerType: string;
  stepOrder: number;
  escalateToRole?: string;
  escalateToUserId?: string;
  notificationMethod: string;
  timeLimitHours?: number;
  isActive: boolean;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapDepartment(r: typeof orgDepartmentsTable.$inferSelect): Department {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    code: r.code,
    description: r.description ?? undefined,
    parentDepartmentId: r.parentDepartmentId ?? undefined,
    managerUserId: r.managerUserId ?? undefined,
    status: r.status ?? "active",
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapTeam(r: typeof orgTeamsTable.$inferSelect): Team {
  return {
    id: r.id,
    organizationId: r.organizationId,
    departmentId: r.departmentId ?? undefined,
    name: r.name,
    code: r.code,
    description: r.description ?? undefined,
    teamLeadUserId: r.teamLeadUserId ?? undefined,
    status: r.status ?? "active",
  };
}

function mapPosition(r: typeof orgPositionsTable.$inferSelect): Position {
  return {
    id: r.id,
    organizationId: r.organizationId,
    departmentId: r.departmentId ?? undefined,
    teamId: r.teamId ?? undefined,
    title: r.title,
    code: r.code,
    reportsToPosId: r.reportsToPositionId ?? undefined,
    authorityLevel: r.authorityLevel ?? 1,
    isManager: r.isManager ?? false,
    canApproveUpToAmount: r.canApproveUpToAmount ?? undefined,
    status: r.status ?? "active",
  };
}

function mapReportingLine(r: typeof orgReportingLinesTable.$inferSelect): ReportingLine {
  return {
    id: r.id,
    organizationId: r.organizationId,
    userId: r.userId,
    reportsToUserId: r.reportsToUserId,
    positionId: r.positionId ?? undefined,
    relationshipType: r.relationshipType ?? "direct",
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? undefined,
  };
}

function mapDelegatedAuthority(r: typeof orgDelegatedAuthorityTable.$inferSelect): DelegatedAuthority {
  return {
    id: r.id,
    organizationId: r.organizationId,
    delegatingUserId: r.delegatingUserId,
    delegateUserId: r.delegateUserId,
    authorityScope: r.authorityScope,
    maxApprovalAmount: r.maxApprovalAmount ?? undefined,
    delegatedFrom: r.delegatedFrom,
    delegatedUntil: r.delegatedUntil ?? undefined,
    reason: r.reason ?? undefined,
    status: r.status ?? "active",
  };
}

function mapEscalationPath(r: typeof orgEscalationPathsTable.$inferSelect): EscalationPath {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    triggerType: r.triggerType,
    stepOrder: r.stepOrder,
    escalateToRole: r.escalateToRole ?? undefined,
    escalateToUserId: r.escalateToUserId ?? undefined,
    notificationMethod: r.notificationMethod,
    timeLimitHours: r.timeLimitHours ?? undefined,
    isActive: r.isActive,
  };
}

// ─── Departments ──────────────────────────────────────────────────────────────

export async function createDepartment(
  organizationId: string,
  data: Omit<Department, "id" | "createdAt" | "updatedAt">,
): Promise<Department> {
  const [row] = await db
    .insert(orgDepartmentsTable)
    .values({
      id: randomUUID(),
      organizationId,
      name: data.name,
      code: data.code,
      description: data.description ?? null,
      parentDepartmentId: data.parentDepartmentId ?? null,
      managerUserId: data.managerUserId ?? null,
      status: data.status ?? "active",
    })
    .returning();
  return mapDepartment(row!);
}

export async function getDepartments(organizationId: string): Promise<Department[]> {
  const rows = await db
    .select()
    .from(orgDepartmentsTable)
    .where(eq(orgDepartmentsTable.organizationId, organizationId));
  return rows.map(mapDepartment);
}

export async function getDepartment(
  organizationId: string,
  departmentId: string,
): Promise<Department | null> {
  const [row] = await db
    .select()
    .from(orgDepartmentsTable)
    .where(
      and(
        eq(orgDepartmentsTable.organizationId, organizationId),
        eq(orgDepartmentsTable.id, departmentId),
      ),
    )
    .limit(1);
  return row ? mapDepartment(row) : null;
}

// ─── Teams ────────────────────────────────────────────────────────────────────

export async function createTeam(
  organizationId: string,
  data: Omit<Team, "id">,
): Promise<Team> {
  const [row] = await db
    .insert(orgTeamsTable)
    .values({
      id: randomUUID(),
      organizationId,
      departmentId: data.departmentId ?? null,
      name: data.name,
      code: data.code,
      description: data.description ?? null,
      teamLeadUserId: data.teamLeadUserId ?? null,
      status: data.status ?? "active",
    })
    .returning();
  return mapTeam(row!);
}

export async function getTeams(
  organizationId: string,
  departmentId?: string,
): Promise<Team[]> {
  if (departmentId) {
    const rows = await db
      .select()
      .from(orgTeamsTable)
      .where(
        and(
          eq(orgTeamsTable.organizationId, organizationId),
          eq(orgTeamsTable.departmentId, departmentId),
        ),
      );
    return rows.map(mapTeam);
  }
  const rows = await db
    .select()
    .from(orgTeamsTable)
    .where(eq(orgTeamsTable.organizationId, organizationId));
  return rows.map(mapTeam);
}

// ─── Positions ────────────────────────────────────────────────────────────────

export async function createPosition(
  organizationId: string,
  data: Omit<Position, "id">,
): Promise<Position> {
  const [row] = await db
    .insert(orgPositionsTable)
    .values({
      id: randomUUID(),
      organizationId,
      departmentId: data.departmentId ?? null,
      teamId: data.teamId ?? null,
      title: data.title,
      code: data.code,
      reportsToPositionId: data.reportsToPosId ?? null,
      authorityLevel: data.authorityLevel ?? 1,
      isManager: data.isManager ?? false,
      canApproveUpToAmount: data.canApproveUpToAmount ?? null,
      status: data.status ?? "active",
    })
    .returning();
  return mapPosition(row!);
}

export async function getPositions(
  organizationId: string,
  departmentId?: string,
): Promise<Position[]> {
  if (departmentId) {
    const rows = await db
      .select()
      .from(orgPositionsTable)
      .where(
        and(
          eq(orgPositionsTable.organizationId, organizationId),
          eq(orgPositionsTable.departmentId, departmentId),
        ),
      );
    return rows.map(mapPosition);
  }
  const rows = await db
    .select()
    .from(orgPositionsTable)
    .where(eq(orgPositionsTable.organizationId, organizationId));
  return rows.map(mapPosition);
}

// ─── Reporting Lines ──────────────────────────────────────────────────────────

export async function setReportingLine(
  organizationId: string,
  data: Omit<ReportingLine, "id">,
): Promise<ReportingLine> {
  const [row] = await db
    .insert(orgReportingLinesTable)
    .values({
      id: randomUUID(),
      organizationId,
      userId: data.userId,
      reportsToUserId: data.reportsToUserId,
      positionId: data.positionId ?? null,
      relationshipType: data.relationshipType ?? "direct",
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo ?? null,
    })
    .returning();
  return mapReportingLine(row!);
}

export async function getReportingChain(
  organizationId: string,
  userId: string,
): Promise<ReportingLine[]> {
  const rows = await db
    .select()
    .from(orgReportingLinesTable)
    .where(
      and(
        eq(orgReportingLinesTable.organizationId, organizationId),
        eq(orgReportingLinesTable.userId, userId),
        isNull(orgReportingLinesTable.effectiveTo),
      ),
    );
  return rows.map(mapReportingLine);
}

// ─── Delegated Authority ──────────────────────────────────────────────────────

export async function grantDelegatedAuthority(
  organizationId: string,
  data: Omit<DelegatedAuthority, "id">,
): Promise<DelegatedAuthority> {
  const [row] = await db
    .insert(orgDelegatedAuthorityTable)
    .values({
      id: randomUUID(),
      organizationId,
      delegatingUserId: data.delegatingUserId,
      delegateUserId: data.delegateUserId,
      authorityScope: data.authorityScope,
      maxApprovalAmount: data.maxApprovalAmount ?? null,
      delegatedFrom: data.delegatedFrom,
      delegatedUntil: data.delegatedUntil ?? null,
      reason: data.reason ?? null,
      status: data.status ?? "active",
    })
    .returning();
  return mapDelegatedAuthority(row!);
}

export async function getActiveDelegations(
  organizationId: string,
  userId: string,
): Promise<DelegatedAuthority[]> {
  const rows = await db
    .select()
    .from(orgDelegatedAuthorityTable)
    .where(
      and(
        eq(orgDelegatedAuthorityTable.organizationId, organizationId),
        eq(orgDelegatedAuthorityTable.delegateUserId, userId),
        eq(orgDelegatedAuthorityTable.status, "active"),
      ),
    );
  return rows.map(mapDelegatedAuthority);
}

// ─── Escalation Paths ─────────────────────────────────────────────────────────

export async function createEscalationPath(
  organizationId: string,
  data: Omit<EscalationPath, "id">,
): Promise<EscalationPath> {
  const [row] = await db
    .insert(orgEscalationPathsTable)
    .values({
      id: randomUUID(),
      organizationId,
      name: data.name,
      triggerType: data.triggerType,
      stepOrder: data.stepOrder ?? 1,
      escalateToRole: data.escalateToRole ?? null,
      escalateToUserId: data.escalateToUserId ?? null,
      notificationMethod: data.notificationMethod ?? "in_app",
      timeLimitHours: data.timeLimitHours ?? null,
      isActive: data.isActive ?? true,
    })
    .returning();
  return mapEscalationPath(row!);
}

export async function getEscalationPaths(
  organizationId: string,
  triggerType?: string,
): Promise<EscalationPath[]> {
  if (triggerType) {
    const rows = await db
      .select()
      .from(orgEscalationPathsTable)
      .where(
        and(
          eq(orgEscalationPathsTable.organizationId, organizationId),
          eq(orgEscalationPathsTable.triggerType, triggerType),
          eq(orgEscalationPathsTable.isActive, true),
        ),
      );
    return rows.map(mapEscalationPath);
  }
  const rows = await db
    .select()
    .from(orgEscalationPathsTable)
    .where(
      and(
        eq(orgEscalationPathsTable.organizationId, organizationId),
        eq(orgEscalationPathsTable.isActive, true),
      ),
    );
  return rows.map(mapEscalationPath);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getOrgStructureSummary(organizationId: string): Promise<{
  departmentCount: number;
  teamCount: number;
  positionCount: number;
  escalationPathCount: number;
  reportingLineCount: number;
  activeDelegationCount: number;
}> {
  const [departments, teams, positions, escalationPaths, reportingLines, delegations] =
    await Promise.all([
      db
        .select()
        .from(orgDepartmentsTable)
        .where(eq(orgDepartmentsTable.organizationId, organizationId)),
      db
        .select()
        .from(orgTeamsTable)
        .where(eq(orgTeamsTable.organizationId, organizationId)),
      db
        .select()
        .from(orgPositionsTable)
        .where(eq(orgPositionsTable.organizationId, organizationId)),
      db
        .select()
        .from(orgEscalationPathsTable)
        .where(
          and(
            eq(orgEscalationPathsTable.organizationId, organizationId),
            eq(orgEscalationPathsTable.isActive, true),
          ),
        ),
      db
        .select()
        .from(orgReportingLinesTable)
        .where(eq(orgReportingLinesTable.organizationId, organizationId)),
      db
        .select()
        .from(orgDelegatedAuthorityTable)
        .where(
          and(
            eq(orgDelegatedAuthorityTable.organizationId, organizationId),
            eq(orgDelegatedAuthorityTable.status, "active"),
          ),
        ),
    ]);

  return {
    departmentCount: departments.length,
    teamCount: teams.length,
    positionCount: positions.length,
    escalationPathCount: escalationPaths.length,
    reportingLineCount: reportingLines.length,
    activeDelegationCount: delegations.length,
  };
}
