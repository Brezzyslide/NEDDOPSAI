#!/usr/bin/env bash
# ─── NeedsOps AI+ — Push DB schema to development database ──────────────────
#
# Usage: ./infrastructure/scripts/db-push.sh
#
# Requires DATABASE_URL to be set in the environment or a .env file at root.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Load .env if present (dev convenience — never do this in CI)
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

echo "Pushing DB schema..."
cd "$REPO_ROOT"
pnpm --filter @workspace/db run push

echo "Done."
