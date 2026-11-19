#!/usr/bin/env python3
"""Verify authored blueprint registry sections against the authoritative workbook.

This intentionally checks the transcription fields cell-by-cell for the authored
spreadsheet set, excluding care_plan and the legacy one-row regulatory fragment.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = ROOT / "review-artifacts" / "needsops-blueprint-definitions-AUTHORITATIVE.xlsx"
API_DIR = ROOT / "artifacts" / "api-server"

TARGETS = [
    ("restrictive_practice_operation", "restrictive_practice_operationalisation"),
    ("restrictive_practice_risk_asses", "restrictive_practice_risk_assessment"),
    ("reporting_restrictive_practice", "reporting_restrictive_practice"),
    ("funding_utilisation_review", "funding_utilisation_review"),
    ("health_support_plan", "health_support_plan"),
    ("individual_support_plan", "individual_support_plan"),
    ("mealtime_risk_assessment", "mealtime_risk_assessment"),
    ("medication_management_review", "medication_management_review"),
    ("participant_goals_review", "participant_goals_review"),
    ("participant_periodic_summary", "participant_periodic_summary"),
    ("participant_transition_readines", "participant_transition_readiness"),
    ("participant_transition_monitori", "participant_transition_monitoring"),
    ("service_delivery_review", "service_delivery_review"),
    ("sil_support_plan", "sil_support_plan"),
    ("compliance_audit_readiness", "compliance_audit_readiness"),
    ("employment_compliance_review", "employment_compliance_review"),
    ("legislation_regulatory_review", "legislation_regulatory_review"),
    ("regulator_response_submission", "regulator_response_submission"),
    ("regulatory_change_impact_assess", "regulatory_change_impact_assessment"),
    ("schads_coverage_classification", "schads_coverage_and_classification"),
    ("schads_entitlement_treatment", "schads_entitlement_treatment_analysis"),
]

COLUMNS = {
    "sectionCode": "Section code",
    "title": "Section name",
    "fixedContent": "Fixed content - standing text emitted verbatim in every document",
    "fields": "Fields - declared placeholders, or table structure with columns and row count",
    "completionPrompt": "Completion prompt - guidance for the person filling it in",
    "sourceDocuments": "Source documents - what feeds this section",
    "mandatoryCondition": "Mandatory condition - always, or conditional on what",
    "authorityBoundary": "Authority boundary - what this section does NOT decide, and whose authority is needed",
}


def normal(value: Any) -> str:
    return "" if value is None else str(value).replace("\r\n", "\n").strip()


def field_lines(value: str) -> list[str]:
    return [line.rstrip() for line in value.splitlines() if line.strip()]


def workbook_rows(sheet: str) -> list[dict[str, str]]:
    wb = load_workbook(WORKBOOK, read_only=True, data_only=True)
    ws = wb[sheet]
    raw = list(ws.iter_rows(values_only=True))
    headers = [normal(v) for v in raw[0]]
    rows: list[dict[str, str]] = []
    for row in raw[1:]:
        if not any(normal(v) for v in row):
            continue
        rows.append({headers[i]: normal(row[i] if i < len(row) else "") for i in range(len(headers))})
    return rows


def registry_snapshot() -> dict[str, Any]:
    codes = [code for _, code in TARGETS]
    script = """
import { BLUEPRINT_REGISTRY } from './src/services/blueprintRegistry.ts';
const codes = new Set(JSON.parse(process.env.BLUEPRINT_CODES || '[]'));
const out = {};
for (const entry of BLUEPRINT_REGISTRY) {
  if (!codes.has(entry.code)) continue;
  out[entry.code] = {
    code: entry.code,
    sections: (entry.sections || []).map((section) => ({
      sectionCode: section.sectionCode,
      title: section.title,
      fixedContent: section.fixedContent || [],
      fields: section.fields || [],
      completionPrompt: section.completionPrompt ?? null,
      sourceDocuments: section.evidenceRequirements?.sourceDocuments ?? null,
      mandatoryCondition: section.evidenceRequirements?.mandatoryCondition ?? null,
      authorityBoundary: section.evidenceRequirements?.authorityBoundary ?? null,
    })),
  };
}
console.log(JSON.stringify(out));
"""
    result = subprocess.run(
        ["pnpm", "exec", "tsx", "-e", script],
        cwd=API_DIR,
        env={**os.environ, **{"BLUEPRINT_CODES": json.dumps(codes)}},
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    return json.loads(result.stdout)


def main() -> int:
    registry = registry_snapshot()
    errors: list[str] = []
    for sheet, code in TARGETS:
        expected_rows = workbook_rows(sheet)
        entry = registry.get(code)
        if entry is None:
            errors.append(f"missing registry entry for {code}")
            continue
        actual_sections = entry.get("sections") or []
        if len(actual_sections) != len(expected_rows):
            errors.append(f"{code}: section count {len(actual_sections)} != workbook {len(expected_rows)}")
            continue
        for idx, (expected, actual) in enumerate(zip(expected_rows, actual_sections), start=2):
            comparisons = {
                "sectionCode": normal(expected[COLUMNS["sectionCode"]]),
                "title": normal(expected[COLUMNS["title"]]),
                "fixedContent": normal(expected[COLUMNS["fixedContent"]]),
                "fields": field_lines(normal(expected[COLUMNS["fields"]])),
                "completionPrompt": normal(expected[COLUMNS["completionPrompt"]]),
                "sourceDocuments": normal(expected[COLUMNS["sourceDocuments"]]),
                "mandatoryCondition": normal(expected[COLUMNS["mandatoryCondition"]]),
                "authorityBoundary": normal(expected[COLUMNS["authorityBoundary"]]),
            }
            actual_values = {
                "sectionCode": normal(actual.get("sectionCode")),
                "title": normal(actual.get("title")),
                "fixedContent": normal((actual.get("fixedContent") or [""])[0]),
                "fields": [normal(v) for v in (actual.get("fields") or [])],
                "completionPrompt": normal(actual.get("completionPrompt")),
                "sourceDocuments": normal(actual.get("sourceDocuments")),
                "mandatoryCondition": normal(actual.get("mandatoryCondition")),
                "authorityBoundary": normal(actual.get("authorityBoundary")),
            }
            for key, expected_value in comparisons.items():
                if actual_values[key] != expected_value:
                    errors.append(f"{code} row {idx} {key} mismatch")
    if errors:
        print("Blueprint transcription fidelity FAILED")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Blueprint transcription fidelity passed for {len(TARGETS)} blueprints.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
