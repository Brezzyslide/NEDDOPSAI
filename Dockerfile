# ─── NeedsOps AI+ Platform — Docker Build ────────────────────────────────────
#
# Multi-stage production build for the API server.
# Each service in the platform can be containerised independently.
#
# Build: docker build --target api -t needsops-api .
# Run:   docker run -p 5001:5001 --env-file .env needsops-api
#
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS base

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# ── Stage 2: deps ──────────────────────────────────────────────────────────────
FROM base AS deps

# Copy workspace manifests and lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.json tsconfig.base.json ./

# Copy lib package manifests
COPY lib/db/package.json lib/db/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/shared/package.json lib/shared/
COPY lib/validation/package.json lib/validation/

# Copy artifact package manifests
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/worker/package.json artifacts/worker/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# ── Stage 3: build ─────────────────────────────────────────────────────────────
FROM deps AS builder

# Copy full source
COPY . .

# Build the API server
RUN pnpm --filter @workspace/api-server run build

# ── Stage 4: api (production runtime) ─────────────────────────────────────────
FROM node:22-alpine AS api

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy built output and only production dependencies
COPY --from=builder /app/artifacts/api-server/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=5001

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5001/api/healthz || exit 1

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
