// `pnpm compat-table`: writes the SDK compatibility table from `conformance/results/<sdk>.json` into
// README.md, between the compat-table markers. Stale results stop it: run the suite again first.
// `--check` (CI) writes nothing to README.md: it fails when a row README.md lists as run differs from
// the results. A `not run` row enters README.md only after a real run.
// Both write the full table to $GITHUB_STEP_SUMMARY when it is set.
// The table holds no timestamps or postmock commits, so CI can compare it with its own results.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { readBaseline } from "../conformance/baseline.ts";
import { type ResultsFile, runnerNames, staleReason } from "../conformance/results.ts";
import { currentStamp, sdkCommit } from "../conformance/stamp.ts";

const START = "<!-- compat-table:start -->";
const END = "<!-- compat-table:end -->";
const conformance = new URL("../conformance/", import.meta.url);
const readme = new URL("../README.md", import.meta.url);

const mode = process.argv[2];
if (mode !== undefined && mode !== "--check") {
  console.error("usage: pnpm compat-table [--check]");
  process.exit(2);
}

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
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary !== undefined) appendFileSync(summary, `## SDK compatibility\n\n${table}\n`);
console.log(table);

if (mode === "--check") {
  const sdkOf = (row: string) => row.split("|")[1]?.trim();
  const listedRun = text
    .slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("| postmark") && !line.includes("| not run |"));
  const differing = listedRun.filter((line) => !rows.includes(line));
  for (const line of differing) {
    const sdk = sdkOf(line);
    console.error(`README.md: ${line}\nresults:   ${rows.find((row) => sdkOf(row) === sdk)}`);
  }
  if (differing.length > 0) {
    console.error("README.md rows differ from the results; run `pnpm compat-table` and commit");
    process.exit(1);
  }
} else {
  writeFileSync(readme, `${text.slice(0, start)}${table}${text.slice(end + END.length)}`);
}
