/**
 * Controlled WorkforceDNA publication reconciliation.
 *
 * Default mode is dry-run. Use --apply only during an approved maintenance
 * window against the intended database environment.
 */

import {
  reconcileWorkforceDnaPublication,
} from "../services/dnaStorageService.js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const publishedBy = process.env["WORKFORCE_DNA_RECONCILED_BY"] ?? "controlled_reconciliation_script";

const result = await reconcileWorkforceDnaPublication({ apply, publishedBy });

console.log(JSON.stringify(result, null, 2));

if (result.summary.ERROR > 0 || result.summary.INVALID > 0) {
  process.exitCode = 1;
}
