// `pnpm conformance:check`: fails when a baseline test (`conformance/<sdk>/baseline/`) does not pass
// in `conformance/results/<sdk>.json`, or when that results file is stale (docs/11 §3.1, §4).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readBaseline, readSkips, skippedAndBaselined } from "./baseline.ts";
import { compare, type ResultsFile, staleReason } from "./results.ts";
import { currentStamp, sdkCommit } from "./stamp.ts";

const root = new URL("./", import.meta.url);
let failed = false;
const sdks = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/run.ts`, root)))
  .map((d) => d.name)
  .sort();

for (const sdk of sdks) {
  const resultsUrl = new URL(`results/${sdk}.json`, root);
  if (!existsSync(resultsUrl)) {
    console.error(`${sdk}: no results; run \`pnpm conformance ${sdk}\` first`);
    failed = true;
    continue;
  }
  const results = JSON.parse(readFileSync(resultsUrl, "utf8")) as ResultsFile;
  const stale = staleReason(results, { postmock: currentStamp(sdk), sdkCommit: sdkCommit(sdk) });
  if (stale) {
    console.error(`${sdk}: stale: ${stale}; run \`pnpm conformance ${sdk}\` again`);
    failed = true;
    continue;
  }
  const baseline = readBaseline(new URL(`${sdk}/`, root));
  const both = skippedAndBaselined(baseline, readSkips(new URL(`${sdk}/`, root)));
  for (const id of both) console.error(`${sdk}: both in a baseline and a skip file: ${id}`);
  failed ||= both.length > 0;
  const { regressions, newlyPassing } = compare(baseline, results);
  for (const id of regressions) console.error(`${sdk}: REGRESSION ${id}`);
  for (const id of newlyPassing) console.log(`${sdk}: newly passing, add to baseline: ${id}`);
  const kept = baseline.passing.length - regressions.length;
  console.log(`${sdk}: ${kept}/${baseline.passing.length} baseline tests pass`);
  failed ||= regressions.length > 0;
}
process.exit(failed ? 1 : 0);
