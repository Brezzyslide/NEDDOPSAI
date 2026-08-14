import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@workspace/agent-runtime": resolve(__dirname, "../../lib/agent-runtime/src/index.ts"),
      "@workspace/openclaw": resolve(__dirname, "../../lib/openclaw/src/index.ts"),
      "@workspace/permissions": resolve(__dirname, "../../lib/permissions/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: [
      "src/__tests__/sprint33j-conversation-control.test.ts",
      "src/__tests__/sprint272-message-ingress.test.ts",
    ],
  },
});
