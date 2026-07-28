/**
 * Runs all `*.test.ts` files in this folder sequentially.
 * Usage: npm run test:marking
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(dir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort();

if (tests.length === 0) {
  console.error("No *.test.ts files found in scripts/marking/");
  process.exit(1);
}

let failed = 0;
for (const file of tests) {
  console.info(`\n── ${file} ──`);
  const result = spawnSync(process.execPath, ["--import", "tsx", join(dir, file)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed}/${tests.length} marking test file(s) failed.`);
  process.exit(1);
}
console.info(`\nAll ${tests.length} marking test file(s) passed.`);
