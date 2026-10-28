import { readFileSync } from "fs";
import {
  publishScopedRegistryBlueprint,
  restoreScopedBlueprintFromVerifiedArtifact,
  type VerifiedScopedBlueprintRestoreArtifact,
} from "../services/workBlueprintService.js";

function parseArgs(argv: string[]): { code: string; fromFile: string; dryRun: boolean } {
  let code = "";
  let fromFile = "";
  let dryRun = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--code") {
      code = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--code=")) {
      code = arg.slice("--code=".length);
      continue;
    }
    if (arg === "--from-file") {
      fromFile = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--from-file=")) {
      fromFile = arg.slice("--from-file=".length);
      continue;
    }
    if (arg === "--apply") {
      dryRun = false;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
  }

  if (!code.trim() && !fromFile.trim()) {
    throw new Error("Usage: tsx src/scripts/scoped-blueprint-publisher.ts (--code <blueprint_code> | --from-file <verified_rollback.json>) [--dry-run|--apply]");
  }
  return { code: code.trim(), fromFile: fromFile.trim(), dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = args.fromFile
    ? await restoreScopedBlueprintFromVerifiedArtifact({
      artifact: JSON.parse(readFileSync(args.fromFile, "utf8")) as VerifiedScopedBlueprintRestoreArtifact,
      code: args.code || undefined,
      dryRun: args.dryRun,
    })
    : await publishScopedRegistryBlueprint({ code: args.code, dryRun: args.dryRun });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
