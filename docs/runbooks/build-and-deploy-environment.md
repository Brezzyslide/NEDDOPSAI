# Build and Deploy Environment

## Web Bundle

Build command:

```sh
scripts/build-web-bundle.sh
```

The production web bundle is static. Vite replaces `import.meta.env.*` values at build time, so missing public configuration is not recoverable at runtime.

Required build-time variables:

- `BASE_PATH` - Vite base path. Dev value: `/`. Missing value can place static assets under the wrong path.
- `VITE_NEEDSOPS_ENV` - Public web environment label. Dev value: `dev`. Missing value makes the bundle report Vite's mode instead of the intended deployed environment.
- `VITE_GIT_SHA` - Git SHA embedded in `window.__NEEDSOPS_WEB_BUILD__`. Source: current clean checkout. Missing value removes deploy provenance.
- `VITE_BUILD_TIMESTAMP` - UTC ISO build timestamp embedded in `window.__NEEDSOPS_WEB_BUILD__`. Source: build script. Missing value removes deploy provenance.
- `VITE_CLERK_PUBLISHABLE_KEY` - Clerk public publishable key. Dev source: Secrets Manager `needsops-dev/api/clerk` field `CLERK_PUBLISHABLE_KEY`. Missing value breaks authentication.

Optional build-time variables:

- `VITE_CLERK_PROXY_URL` - Clerk frontend API proxy path or absolute URL. Dev proxy path is `/api/__clerk` if proxy mode is needed. The last known working Dev bundle did not set this and loaded Clerk directly from the Clerk frontend API host.

The web package has a `prebuild` check that fails if any required variable is missing. Do not bypass it for deployed bundles.

## API Image

Build command:

```sh
scripts/build-api-image.sh
```

Required or derived build-time values:

- `AWS_PROFILE` - AWS profile used for ECR login and repository lookup. Default: `needsops-dev`.
- `AWS_REGION` - AWS region. Default: `ap-southeast-2`.
- `SOURCE_VERSION` - Derived from `git rev-parse HEAD` and embedded in the image as `SOURCE_VERSION` and `GIT_SHA`.
- `BUILD_TIMESTAMP` - UTC ISO timestamp. Defaults to the current time if not supplied.
- `API_VERSION` - Public API version string. Defaults to `0.0.0`; deployment should set the intended release version.
- `IMAGE_TAG` - ECR tag. Defaults to `sha-<SOURCE_VERSION>`.
- `ECR_REPOSITORY_URI` - Optional override. If absent, the script reads ECR repository `needsops-dev/api`.

Runtime values are supplied by ECS task definitions and Secrets Manager, not by the Docker build:

- Database host/name/port and RDS credentials.
- `SESSION_SECRET` and `INTERNAL_DIAGNOSTICS_TOKEN`.
- `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
- `OPENAI_API_KEY`.
- `NEEDSOPS_PUBLIC_ORIGIN`.

If the API image build metadata is missing or wrong, `/api/readyz` reports misleading provenance. If runtime secrets are missing, authenticated route handling fails closed or service startup logs warnings.
