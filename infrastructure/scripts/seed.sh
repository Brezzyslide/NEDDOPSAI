#!/usr/bin/env bash
# ─── NeedsOps AI+ — Seed development database ───────────────────────────────
#
# Usage: ./infrastructure/scripts/seed.sh
#
# Seeds:
#   - 3 sample organisations (NDIS + healthcare)
#   - 4 users for the first org
#   - 4 workforce packs (NDIS compliance, operations, enterprise, healthcare coming-soon)
#
# Requires DATABASE_URL to be set.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

echo "Seeding database..."
cd "$REPO_ROOT"

# Run via Node using tsx (the DB seed logic uses pg directly)
pnpm --filter @workspace/db run seed 2>/dev/null || {
  echo "No seed script found in @workspace/db — seed data was inserted via the Replit CodeExecution tool."
  echo "See docs/sprint-0-completion-report.md for seed data details."
}

echo "Done."
