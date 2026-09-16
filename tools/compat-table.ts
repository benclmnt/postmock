// `pnpm compat-table`: writes the SDK compatibility table from `conformance/results/<sdk>.json` into
// README.md, between the compat-table markers. Stale results stop it: run the suite again first.
// The table holds no timestamps or postmock commits, so CI can compare it with its own results.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readBaseline } from "../conformance/baseline.ts";
import { type ResultsFile, runnerNames, staleReason } from "../conformance/results.ts";
import { currentStamp, sdkCommit } from "../conformance/stamp.ts";

const START = "<!-- compat-table:start -->";
const END = "<!-- compat-table:end -->";
const conformance = new URL("../conformance/", import.meta.url);
const readme = new URL("../README.md", import.meta.url);

const rows = runnerNames().map((sdk) => {
  const baseline = readBaseline(new URL(`${sdk}/`, conformance)).passing.length;
  const file = new URL(`results/${sdk}.json`, conformance);
  if (!existsSync(file)) return `| ${sdk} | ${sdkCommit(sdk)} | not run | | | ${baseline} |`;
  const results = JSON.parse(readFileSync(file, "utf8")) as ResultsFile;
  const stale = staleReason(results, { postmock: currentStamp(sdk), sdkCommit: sdkCommit(sdk) });
  if (stale) throw new Error(`${sdk}: stale: ${stale}; run \`pnpm conformance ${sdk}\` again`);
  const { pass, fail, skip } = results.totals;
  const total = pass + fail + skip;
  return `| ${sdk} | ${results.sdkCommit} | ${pass}/${total} | ${fail} | ${skip} | ${baseline} |`;
});

const table = [
  START,
  "| SDK | SDK commit | Pass | Fail | Skip | Baseline |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows,
  END,
].join("\n");

const text = readFileSync(readme, "utf8");
const [start, end] = [text.indexOf(START), text.indexOf(END)];
if (start === -1 || end === -1) throw new Error(`README.md needs the ${START} and ${END} markers`);
writeFileSync(readme, `${text.slice(0, start)}${table}${text.slice(end + END.length)}`);
console.log(table);
