import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    // Workspace packages that build declarations-only (emitDeclarationOnly: true)
    // have no .js dist files. Vite/vitest resolves them from their TypeScript source
    // directly using these aliases.
    alias: {
      "@workspace/agent-runtime": resolve(__dirname, "../../lib/agent-runtime/src/index.ts"),
      "@workspace/openclaw":      resolve(__dirname, "../../lib/openclaw/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    globalSetup: "./src/__tests__/globalSetup.ts",
  },
});
