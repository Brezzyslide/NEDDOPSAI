import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/sprint33i-authority-routing-provenance.test.ts"],
  },
});
