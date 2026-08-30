const required = [
  "BASE_PATH",
  "VITE_NEEDSOPS_ENV",
  "VITE_GIT_SHA",
  "VITE_BUILD_TIMESTAMP",
  "VITE_CLERK_PUBLISHABLE_KEY",
];

const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error(
    [
      "NeedsOps web build is missing required environment variables:",
      ...missing.map((name) => `- ${name}`),
      "",
      "Set these explicitly before running the production web build.",
      "For Dev, VITE_CLERK_PUBLISHABLE_KEY must come from Secrets Manager secret needsops-dev/api/clerk field CLERK_PUBLISHABLE_KEY.",
    ].join("\n"),
  );
  process.exit(1);
}

const publishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!/^pk_(test|live)_[A-Za-z0-9_-]+$/.test(publishableKey)) {
  console.error("VITE_CLERK_PUBLISHABLE_KEY must be a valid Clerk publishable key beginning with pk_test_ or pk_live_.");
  process.exit(1);
}

const proxyUrl = process.env.VITE_CLERK_PROXY_URL?.trim();
if (proxyUrl && !proxyUrl.startsWith("/") && !/^https?:\/\//.test(proxyUrl)) {
  console.error("VITE_CLERK_PROXY_URL must be either a leading-slash path or an absolute http(s) URL when set.");
  process.exit(1);
}
