import type { KnowledgeItemCurrentness } from "./IKnowledgeProvider.js";

export interface KnowledgeCurrentnessInput {
  isCurrent?: boolean | null;
  sourceVersionIsCurrent?: boolean | null;
  sourceVersionStatus?: string | null;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
  checkedAt?: Date | string;
  version?: string | null;
  historicalEvidenceAllowed?: boolean;
}

export function mapKnowledgeCurrentness(input: KnowledgeCurrentnessInput): KnowledgeItemCurrentness {
  const checkedAt = toIso(input.checkedAt ?? new Date());
  const status = normaliseStatus(input.sourceVersionStatus);
  const effectiveTo = toDate(input.effectiveTo);

  if (effectiveTo && effectiveTo <= new Date(checkedAt)) {
    return withCommonFields("EXPIRED", input, checkedAt, status);
  }

  if (status === "historical") {
    return withCommonFields("HISTORICAL", input, checkedAt, status);
  }

  if (status === "superseded") {
    return withCommonFields(
      input.historicalEvidenceAllowed ? "HISTORICAL" : "SUPERSEDED",
      input,
      checkedAt,
      status,
    );
  }

  if (status === "archived" || status === "revoked" || status === "failed") {
    return withCommonFields("UNKNOWN", input, checkedAt, status);
  }

  if (input.isCurrent === false || input.sourceVersionIsCurrent === false) {
    return withCommonFields(
      input.historicalEvidenceAllowed ? "HISTORICAL" : "SUPERSEDED",
      input,
      checkedAt,
      status ?? "not_current",
    );
  }

  if (input.isCurrent === true && input.sourceVersionIsCurrent !== false && isApprovedCurrentStatus(status)) {
    return withCommonFields("CURRENT", input, checkedAt, null);
  }

  return withCommonFields("UNKNOWN", input, checkedAt, status);
}

function withCommonFields(
  status: KnowledgeItemCurrentness["status"],
  input: KnowledgeCurrentnessInput,
  checkedAt: string,
  supersededStatus: string | null | undefined,
): KnowledgeItemCurrentness {
  return {
    status,
    checkedAt,
    version: input.version ?? null,
    supersededStatus: status === "CURRENT" ? null : (supersededStatus ?? null),
  };
}

function isApprovedCurrentStatus(status: string | null): boolean {
  return status === null || status === "approved" || status === "current" || status === "active" || status === "complete";
}

function normaliseStatus(status: string | null | undefined): string | null {
  const value = status?.trim().toLowerCase();
  return value && value.length > 0 ? value : null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
