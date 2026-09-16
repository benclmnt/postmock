// `pnpm conformance:check`: fails when a test listed in `conformance/<sdk>/baseline.json` does not
// pass in `conformance/results/<sdk>.json` (docs/11 §3.1, §4).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { type Baseline, compare, type ResultsFile } from "./results.ts";

const root = new URL("./", import.meta.url);
const readJson = <T>(url: URL): T => JSON.parse(readFileSync(url, "utf8")) as T;

let failed = false;
const sdks = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/baseline.json`, root)))
  .map((d) => d.name)
  .sort();

for (const sdk of sdks) {
  const resultsUrl = new URL(`results/${sdk}.json`, root);
  if (!existsSync(resultsUrl)) {
    console.error(`${sdk}: no results; run \`pnpm conformance ${sdk}\` first`);
    failed = true;
    continue;
  }
  const baseline = readJson<Baseline>(new URL(`${sdk}/baseline.json`, root));
  const { regressions, newlyPassing } = compare(baseline, readJson<ResultsFile>(resultsUrl));
  for (const id of regressions) console.error(`${sdk}: REGRESSION ${id}`);
  for (const id of newlyPassing) console.log(`${sdk}: newly passing, add to baseline: ${id}`);
  console.log(
    `${sdk}: ${baseline.passing.length - regressions.length}/${baseline.passing.length} baseline tests pass`,
  );
  failed ||= regressions.length > 0;
}
process.exit(failed ? 1 : 0);
