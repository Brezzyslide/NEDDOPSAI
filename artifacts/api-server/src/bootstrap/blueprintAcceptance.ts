import { BLUEPRINT_REGISTRY } from "../services/blueprintRegistry.js";
import { resolveRegistryCodeForNewWork } from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import type { MigrationDbClient } from "./platformMigrations.js";

export interface BlueprintAcceptanceResult {
  registryCodes: number;
  persistedExpectedBlueprints: number;
  expectedProfessionalSections: number;
  persistedTotalProfessionalSections: number;
  persistedMatchingProfessionalSections: number;
  titleDrift: string[];
  methodDrift: string[];
  serviceDeliveryReview: {
    present: boolean;
    status: string | null;
    isActive: boolean | null;
  };
  complianceImpactAssessmentRoute: string | null;
  compatibilityRoutes: Record<string, string | null>;
  legacyAliases: Record<string, string | null>;
  passed: boolean;
}

export const BLUEPRINT_ACCEPTANCE_TARGETS = {
  registryCodes: 75,
  professionalSections: 1_085,
} as const;

function expectedSectionId(blueprintCode: string, sectionCode: string): string {
  return `platform_blueprint_${blueprintCode}_section_${sectionCode.toLowerCase()}`;
}

export function expectedProfessionalSectionCount(): number {
  return BLUEPRINT_REGISTRY.reduce((total, entry) => total + (entry.sections?.length ?? 0), 0);
}

export async function checkBlueprintAcceptance(client: MigrationDbClient): Promise<BlueprintAcceptanceResult> {
  const expectedCodes = BLUEPRINT_REGISTRY.map((entry) => entry.code);
  const blueprintRows = await client.query<{
    code: string;
    id: string;
    title: string;
    status: string;
    isActive: boolean;
  }>(
    `
      SELECT code, id, title, status, is_active AS "isActive"
      FROM work_blueprints
      WHERE organization_id IS NULL
        AND code = ANY($1::text[])
    `,
    [expectedCodes],
  );

  const rowsByCode = new Map(blueprintRows.rows.map((row) => [row.code, row]));
  const blueprintIds = blueprintRows.rows.map((row) => row.id);
  const titleDrift = BLUEPRINT_REGISTRY
    .filter((entry) => rowsByCode.get(entry.code)?.title !== entry.title)
    .map((entry) => entry.code);

  const methodDrift: string[] = [];
  let persistedMatchingProfessionalSections = 0;

  for (const entry of BLUEPRINT_REGISTRY) {
    const blueprint = rowsByCode.get(entry.code);
    if (!blueprint) {
      methodDrift.push(entry.code);
      continue;
    }

    for (const section of entry.sections ?? []) {
      const row = await client.query<{
        sectionCode: string;
        title: string;
        description: string;
        instructions: string;
        sortOrder: number;
      }>(
        `
          SELECT section_code AS "sectionCode", title, description, instructions, sort_order AS "sortOrder"
          FROM blueprint_sections
          WHERE id = $1
            AND blueprint_id = $2
        `,
        [expectedSectionId(entry.code, section.sectionCode), blueprint.id],
      );

      const actual = row.rows[0];
      if (
        actual &&
        actual.sectionCode === section.sectionCode &&
        actual.title === section.title &&
        actual.description === section.description &&
        actual.instructions === section.instructions &&
        Number(actual.sortOrder) === section.sortOrder
      ) {
        persistedMatchingProfessionalSections += 1;
      } else {
        methodDrift.push(`${entry.code}.${section.sectionCode}`);
      }
    }
  }

  const totalSectionsRow = blueprintIds.length > 0
    ? await client.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM blueprint_sections
        WHERE blueprint_id = ANY($1::text[])
      `,
      [blueprintIds],
    )
    : { rows: [{ count: "0" }] };

  const serviceDeliveryReviewRow = rowsByCode.get("service_delivery_review");
  const complianceImpactAssessment = resolveIntent("compliance.impact_assessment");
  const compatibilityKeys = [
    "regulatory_change_impact",
    "regulatory_change_impact_assessment",
    "formal_stakeholder_correspondence",
  ];

  const compatibilityRoutes: Record<string, string | null> = {};
  for (const code of compatibilityKeys) {
    compatibilityRoutes[code] = rowsByCode.has(code) ? code : null;
  }
  const legacyAliases: Record<string, string | null> = {
    customer_response: resolveRegistryCodeForNewWork("customer_response"),
  };

  const expectedSections = expectedProfessionalSectionCount();
  const result: BlueprintAcceptanceResult = {
    registryCodes: BLUEPRINT_REGISTRY.length,
    persistedExpectedBlueprints: rowsByCode.size,
    expectedProfessionalSections: expectedSections,
    persistedTotalProfessionalSections: Number(totalSectionsRow.rows[0]?.count ?? 0),
    persistedMatchingProfessionalSections,
    titleDrift,
    methodDrift,
    serviceDeliveryReview: {
      present: Boolean(serviceDeliveryReviewRow),
      status: serviceDeliveryReviewRow?.status ?? null,
      isActive: serviceDeliveryReviewRow?.isActive ?? null,
    },
    complianceImpactAssessmentRoute: complianceImpactAssessment && !complianceImpactAssessment.isAction
      ? complianceImpactAssessment.code
      : null,
    compatibilityRoutes,
    legacyAliases,
    passed: false,
  };

  result.passed =
    result.registryCodes === BLUEPRINT_ACCEPTANCE_TARGETS.registryCodes &&
    result.persistedExpectedBlueprints === BLUEPRINT_ACCEPTANCE_TARGETS.registryCodes &&
    result.expectedProfessionalSections === BLUEPRINT_ACCEPTANCE_TARGETS.professionalSections &&
    result.persistedTotalProfessionalSections === BLUEPRINT_ACCEPTANCE_TARGETS.professionalSections &&
    result.persistedMatchingProfessionalSections === BLUEPRINT_ACCEPTANCE_TARGETS.professionalSections &&
    result.titleDrift.length === 0 &&
    result.methodDrift.length === 0 &&
    result.serviceDeliveryReview.present &&
    result.serviceDeliveryReview.status === "published" &&
    result.serviceDeliveryReview.isActive === true &&
    result.complianceImpactAssessmentRoute === "regulatory_change_impact_assessment" &&
    Object.values(result.compatibilityRoutes).every(Boolean) &&
    result.legacyAliases.customer_response === "formal_stakeholder_correspondence";

  return result;
}

export function assertBlueprintAcceptance(result: BlueprintAcceptanceResult): void {
  if (result.passed) return;

  throw new Error(
    [
      "Blueprint bootstrap acceptance failed.",
      `registry=${result.registryCodes}/${BLUEPRINT_ACCEPTANCE_TARGETS.registryCodes}`,
      `persisted=${result.persistedExpectedBlueprints}/${BLUEPRINT_ACCEPTANCE_TARGETS.registryCodes}`,
      `sections=${result.persistedMatchingProfessionalSections}/${result.expectedProfessionalSections}`,
      `totalSections=${result.persistedTotalProfessionalSections}/${BLUEPRINT_ACCEPTANCE_TARGETS.professionalSections}`,
      `titleDrift=${result.titleDrift.length}`,
      `methodDrift=${result.methodDrift.length}`,
      `service_delivery_review=${result.serviceDeliveryReview.present ? result.serviceDeliveryReview.status : "missing"}`,
      `compliance.impact_assessment=${result.complianceImpactAssessmentRoute ?? "missing"}`,
      `customer_response=${result.legacyAliases.customer_response ?? "missing"}`,
    ].join(" "),
  );
}
