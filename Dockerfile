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
RUN apk add --no-cache ca-certificates wget \
  && wget -qO /etc/ssl/certs/aws-rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/aws-rds-global-bundle.pem

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
COPY lib ./lib

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
RUN PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @workspace/api-server run build

# ── Stage 4: api (production runtime) ─────────────────────────────────────────
FROM base AS api

ARG SOURCE_VERSION=unknown
ARG BUILD_TIMESTAMP=unknown
ARG API_VERSION=0.0.0

WORKDIR /app

# Preserve pnpm's workspace symlink layout for runtime module resolution.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY --from=builder /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist

# The runtime container drops to the non-root node user. Normalize read
# permissions for bundled source artifacts so bootstrap migrations and bundled
# entrypoints remain readable even when local file modes are restrictive.
RUN chmod -R a+rX /app/lib /app/artifacts/api-server/dist

ENV NODE_ENV=production
ENV PORT=5001
ENV SOURCE_VERSION=${SOURCE_VERSION}
ENV GIT_SHA=${SOURCE_VERSION}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV API_VERSION=${API_VERSION}

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5001/api/healthz || exit 1

USER node

WORKDIR /app/artifacts/api-server

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]

# ── Stage 5: api-bootstrap (one-off DB bootstrap runner) ──────────────────────
FROM builder AS api-bootstrap

ARG SOURCE_VERSION=unknown
ARG BUILD_TIMESTAMP=unknown
ARG API_VERSION=0.0.0

ENV NODE_ENV=production
ENV NEEDSOPS_DB_BOOTSTRAP_ENV=dev
ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false
ENV SOURCE_VERSION=${SOURCE_VERSION}
ENV GIT_SHA=${SOURCE_VERSION}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV API_VERSION=${API_VERSION}

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "db:bootstrap"]
