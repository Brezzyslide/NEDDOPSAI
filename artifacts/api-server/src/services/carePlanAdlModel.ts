export const CARE_PLAN_ADL_CANONICAL_ROWS = [
  "Personal hygiene and grooming",
  "Showering and bathing",
  "Dressing and undressing",
  "Toileting and continence",
  "Oral hygiene",
  "Eating and drinking",
  "Meal preparation",
  "Medication management",
  "Mobility within the home",
  "Transfers and positioning",
  "Bedtime and morning routines",
  "Household cleaning",
  "Laundry and clothing care",
  "Making and changing bedding",
  "Shopping for essential items",
  "Managing personal belongings",
  "Using household appliances",
  "Maintaining a safe home environment",
  "Managing daily routines",
  "Time awareness and task initiation",
  "Attending appointments",
  "Community access",
  "Transport and travel",
  "Money handling and everyday purchases",
  "Communication of daily needs",
  "Decision-making relating to daily activities",
] as const;

export const CARE_PLAN_ADL_SUPPORT_LEVELS = [
  "Independent",
  "Independent with prompting",
  "Independent with supervision",
  "Partial physical assistance",
  "Full physical assistance",
  "Unable to complete",
  "Not applicable / not assessed",
] as const;

export const CARE_PLAN_ADL_SOURCE_VALUE_SUPPORT_MAPPING = {
  "Without support": ["Independent"],
  "Support required": [
    "Independent with prompting",
    "Independent with supervision",
    "Partial physical assistance",
  ],
  "Completely unable to": ["Unable to complete"],
  Absent: ["Not applicable / not assessed"],
} as const;

export const CARE_PLAN_ADL_SOURCE_ITEM_MAPPINGS = [
  { sourceItem: "Brush teeth", canonicalRow: "Oral hygiene" },
  { sourceItem: "Take shower", canonicalRow: "Showering and bathing" },
  { sourceItem: "Comb/brush hair", canonicalRow: "Personal hygiene and grooming" },
  { sourceItem: "Shaving", canonicalRow: "Personal hygiene and grooming" },
  { sourceItem: "Dressing", canonicalRow: "Dressing and undressing" },
  { sourceItem: "Use toilet", canonicalRow: "Toileting and continence" },
  { sourceItem: "Post toilet hygiene", canonicalRow: "Toileting and continence" },
  { sourceItem: "Cooking", canonicalRow: "Meal preparation" },
  { sourceItem: "Cleaning", canonicalRow: "Household cleaning" },
  { sourceItem: "Washing dishes", canonicalRow: "Household cleaning" },
  { sourceItem: "Transfer to/from bed", canonicalRow: "Transfers and positioning" },
  { sourceItem: "Money handling", canonicalRow: "Money handling and everyday purchases" },
  { sourceItem: "Walk without aid", canonicalRow: "Mobility within the home" },
  { sourceItem: "Use public transport", canonicalRow: "Transport and travel" },
] as const;

export const CARE_PLAN_ADL_SOURCE_ITEM_MAPPING_GAPS = [
  "Home-safety checklist items are context for Maintaining a safe home environment, but they are not controlled ADL support-level values unless the source states a support state.",
] as const;

export type CarePlanAdlMappingMode = "VERIFIED_MAPPING" | "CITED_INTERPRETATION" | "NOT_ASSESSED";

export interface CarePlanAdlStructuredRow {
  activity: string;
  supportLevel: string;
  workerDescription: string;
  sourceValue: string;
  chunkId: string;
  mappingMode: CarePlanAdlMappingMode;
}

export function normaliseCarePlanAdlActivity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isCarePlanAdlSupportLevel(value: string): boolean {
  return CARE_PLAN_ADL_SUPPORT_LEVELS.includes(value as (typeof CARE_PLAN_ADL_SUPPORT_LEVELS)[number]);
}

export function expectedCarePlanAdlSupportLevelsForSourceValue(sourceValue: string): string[] {
  const normalised = normaliseCarePlanAdlActivity(sourceValue);
  if (normalised.includes("without support")) return [...CARE_PLAN_ADL_SOURCE_VALUE_SUPPORT_MAPPING["Without support"]];
  if (normalised.includes("support required")) return [...CARE_PLAN_ADL_SOURCE_VALUE_SUPPORT_MAPPING["Support required"]];
  if (normalised.includes("completely unable")) return [...CARE_PLAN_ADL_SOURCE_VALUE_SUPPORT_MAPPING["Completely unable to"]];
  if (normalised === "absent" || normalised.includes("not assessed")) return [...CARE_PLAN_ADL_SOURCE_VALUE_SUPPORT_MAPPING.Absent];
  return [];
}

export function isCanonicalCarePlanAdlActivity(value: string): boolean {
  const normalised = normaliseCarePlanAdlActivity(value);
  return CARE_PLAN_ADL_CANONICAL_ROWS.some((row) => normaliseCarePlanAdlActivity(row) === normalised);
}
