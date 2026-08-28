import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@workspace/agent-runtime": resolve(__dirname, "../../lib/agent-runtime/src/index.ts"),
      "@workspace/openclaw":      resolve(__dirname, "../../lib/openclaw/src/index.ts"),
      "@workspace/permissions":   resolve(__dirname, "../../lib/permissions/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    testTimeout: 10_000,
    exclude: [
      "src/__tests__/integration/**",
      "**/node_modules/**",
    ],
  },
});
