import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  isDiagnosticsAuthorized,
} from "../services/runtimeDiagnosticsService";
import {
  normaliseTenantStorageKey,
  S3StorageAdapter,
} from "../services/knowledgeStorageService";

describe("Sprint 35D API runtime deployment", () => {
  it("keeps tenant storage keys relative and rejects traversal", () => {
    expect(normaliseTenantStorageKey("/orgs/org-1/library/file.pdf")).toBe("orgs/org-1/library/file.pdf");
    expect(() => normaliseTenantStorageKey("../secret.txt")).toThrow(/invalid tenant storage key/i);
    expect(() => normaliseTenantStorageKey("orgs/../secret.txt")).toThrow(/invalid tenant storage key/i);
  });

  it("uses S3 adapter with tenant prefix and AES256 server-side encryption", async () => {
    const sent: unknown[] = [];
    const client = {
      send: async (command: unknown) => {
        sent.push(command);
        return {};
      },
    };
    const adapter = new S3StorageAdapter({
      bucketName: "needsops-dev-app-storage-test",
      keyPrefix: "knowledge",
      region: "ap-southeast-2",
      client: client as never,
    });

    await adapter.uploadFile("orgs/org-1/library/file.txt", Buffer.from("ok"), "text/plain");
    await adapter.deleteObject("orgs/org-1/library/file.txt");

    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect(sent[1]).toBeInstanceOf(DeleteObjectCommand);
    expect(JSON.stringify(sent[0])).toContain("knowledge/orgs/org-1/library/file.txt");
    expect(JSON.stringify(sent[0])).toContain("AES256");
  });

  it("protects runtime diagnostics with a constant-time token check", () => {
    const oldToken = process.env.INTERNAL_DIAGNOSTICS_TOKEN;
    process.env.INTERNAL_DIAGNOSTICS_TOKEN = "diagnostics-token";

    expect(isDiagnosticsAuthorized("diagnostics-token")).toBe(true);
    expect(isDiagnosticsAuthorized("wrong-token")).toBe(false);
    expect(isDiagnosticsAuthorized(undefined)).toBe(false);

    if (oldToken === undefined) delete process.env.INTERNAL_DIAGNOSTICS_TOKEN;
    else process.env.INTERNAL_DIAGNOSTICS_TOKEN = oldToken;
  });

  it("does not run catalogue or Blueprint seed work during production startup unless explicitly enabled", () => {
    const source = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

    expect(source).toContain('process.env["NEEDSOPS_RUN_STARTUP_SEEDS"] === "true"');
    expect(source).toContain("Startup seeds skipped; deployment bootstrap is authoritative");
    expect(source).toContain('process.env.NODE_ENV === "production" ? "external" : "in-process"');
  });

  it("lets Dev health diagnostics start before the web gate provides Clerk keys", () => {
    const appSource = readFileSync(join(process.cwd(), "src/app.ts"), "utf8");
    const clerkProxySource = readFileSync(join(process.cwd(), "src/middlewares/clerkProxyMiddleware.ts"), "utf8");
    const apiRuntimeTerraform = readFileSync(join(process.cwd(), "../../infrastructure/terraform/environments/dev/api-runtime.tf"), "utf8");

    expect(appSource).toContain('process.env["CLERK_PUBLISHABLE_KEY"] && process.env["CLERK_SECRET_KEY"]');
    expect(appSource).toContain("Clerk middleware disabled because Clerk keys are not configured");
    expect(appSource).toContain("app.use(clerkMiddleware())");
    expect(clerkProxySource).toContain("normaliseOrigin(process.env.NEEDSOPS_PUBLIC_ORIGIN)");
    expect(clerkProxySource).toContain("configuredOrigin");
    expect(apiRuntimeTerraform).toContain("NEEDSOPS_PUBLIC_ORIGIN");
    expect(apiRuntimeTerraform).toContain("https://${aws_cloudfront_distribution.api_dev.domain_name}");
  });

  it("production Docker image carries runtime identity and runs as non-root", () => {
    const dockerfile = readFileSync(join(process.cwd(), "../../Dockerfile"), "utf8");

    expect(dockerfile).toContain("FROM base AS api");
    expect(dockerfile).toContain("ARG SOURCE_VERSION=unknown");
    expect(dockerfile).toContain("ENV SOURCE_VERSION=${SOURCE_VERSION}");
    expect(dockerfile).toContain("ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}");
    expect(dockerfile).toContain("ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/aws-rds-global-bundle.pem");
    expect(dockerfile).toContain("COPY --from=builder /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules");
    expect(dockerfile).toContain("COPY --from=builder /app/lib ./lib");
    expect(dockerfile).toContain("WORKDIR /app/artifacts/api-server");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("CMD [\"node\", \"--enable-source-maps\", \"./dist/index.mjs\"]");
  });

  it("refuses AWS API image builds from a dirty Git tree by default", () => {
    const buildScript = readFileSync(join(process.cwd(), "../../scripts/build-api-image.sh"), "utf8");
    const rootPackage = readFileSync(join(process.cwd(), "../../package.json"), "utf8");

    expect(buildScript).toContain("git status --porcelain");
    expect(buildScript).toContain("Refusing to build an AWS API image from a dirty Git tree");
    expect(buildScript).toContain("SOURCE_VERSION=\"$(git rev-parse HEAD)\"");
    expect(buildScript).toContain("IMAGE_TAG=\"${IMAGE_TAG:-sha-${SOURCE_VERSION}${TAG_SUFFIX}}\"");
    expect(buildScript).toContain("--build-arg \"SOURCE_VERSION=${SOURCE_VERSION}\"");
    expect(rootPackage).toContain("\"docker:build-api\": \"bash scripts/build-api-image.sh\"");
  });

  it("DB package can derive a secure runtime connection from ECS-injected RDS fields", () => {
    const dbIndex = readFileSync(join(process.cwd(), "../../lib/db/src/index.ts"), "utf8");

    expect(dbIndex).toContain("process.env.DB_HOST");
    expect(dbIndex).toContain("process.env.DB_USERNAME");
    expect(dbIndex).toContain("process.env.DB_PASSWORD");
    expect(dbIndex).toContain("sslmode=verify-full");
    expect(dbIndex).not.toContain("console.log(process.env.DATABASE_URL");
  });
});
