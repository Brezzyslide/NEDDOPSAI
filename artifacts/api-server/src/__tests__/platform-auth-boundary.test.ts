import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const routesDir = resolve(__dirname, "../routes/v1");

function readRoute(file: string): string {
  return readFileSync(resolve(routesDir, file), "utf8");
}

describe("platform auth boundaries", () => {
  it("mounts the master platform router before narrower platform subrouters", () => {
    const indexSource = readRoute("index.ts");
    const masterMount = indexSource.indexOf('router.use("/platform", platformRouter)');
    const capabilitiesMount = indexSource.indexOf('router.use("/platform", platformCapabilitiesRouter)');
    const packsMount = indexSource.indexOf('router.use("/platform/packs", platformPacksRouter)');
    const packRequestsMount = indexSource.indexOf('router.use("/platform/pack-access-requests", platformPackRequestsRouter)');

    expect(masterMount).toBeGreaterThan(-1);
    expect(masterMount).toBeLessThan(capabilitiesMount);
    expect(masterMount).toBeLessThan(packsMount);
    expect(masterMount).toBeLessThan(packRequestsMount);
  });

  it.each([
    "platformCapabilities.ts",
    "platformPacks.ts",
    "platformPackAccessRequests.ts",
  ])("%s hydrates req.appUser before platform role lookup", (file) => {
    const source = readRoute(file);

    expect(source).toContain('from "../../middlewares/tenantContext.js"');
    expect(source).toContain("requireAuth");
    expect(source).toContain("requirePlatformAuth");
    expect(source).not.toMatch(/router\.(?:get|post|patch|delete)\([^;\n]+,\s*requirePlatformAuth,/);
  });

  it("does not require the unassignable platform_owner role in route gates", () => {
    const gatedRouteSources = [
      "platformOrgs.ts",
      "platformDevices.ts",
      "platformCapabilities.ts",
      "platformPacks.ts",
      "platformPackAccessRequests.ts",
    ].map(readRoute).join("\n");

    expect(gatedRouteSources).not.toContain('requirePlatformRole("platform_owner")');
  });
});
