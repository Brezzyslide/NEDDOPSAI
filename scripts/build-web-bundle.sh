#!/usr/bin/env bash
set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-needsops-dev}"
AWS_REGION="${AWS_REGION:-ap-southeast-2}"
CLERK_SECRET_ID="${CLERK_SECRET_ID:-needsops-dev/api/clerk}"

export BASE_PATH="${BASE_PATH:-/}"
export VITE_NEEDSOPS_ENV="${VITE_NEEDSOPS_ENV:-dev}"
export VITE_GIT_SHA="${VITE_GIT_SHA:-$(git rev-parse HEAD)}"
export VITE_BUILD_TIMESTAMP="${VITE_BUILD_TIMESTAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
export PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN="${PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN:-false}"

if [[ -z "${VITE_CLERK_PUBLISHABLE_KEY:-}" ]]; then
  secret_json="$(
    AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" \
      aws secretsmanager get-secret-value \
        --secret-id "$CLERK_SECRET_ID" \
        --query SecretString \
        --output text
  )"
  VITE_CLERK_PUBLISHABLE_KEY="$(
    SECRET_JSON="$secret_json" node -e '
      const secret = JSON.parse(process.env.SECRET_JSON || "{}");
      const value = secret.CLERK_PUBLISHABLE_KEY;
      if (!value) {
        console.error("Secret is missing CLERK_PUBLISHABLE_KEY");
        process.exit(1);
      }
      process.stdout.write(value);
    '
  )"
  export VITE_CLERK_PUBLISHABLE_KEY
fi

pnpm --dir artifacts/needsops-web build
