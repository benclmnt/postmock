// `pnpm conformance <sdk>|all`: runs each SDK suite against postmock and writes
// `conformance/results/<sdk>.json`. A runner is `conformance/<sdk>/run.ts` exporting `run()`.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import type { ResultsFile } from "./results.ts";

const root = new URL("./", import.meta.url);
const runners = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/run.ts`, root)))
  .map((d) => d.name)
  .sort();

const arg = process.argv[2];
if (arg === undefined || (arg !== "all" && !runners.includes(arg))) {
  console.error(`usage: pnpm conformance <${[...runners, "all"].join("|")}>`);
  process.exit(2);
}

mkdirSync(new URL("results/", root), { recursive: true });
for (const sdk of arg === "all" ? runners : [arg]) {
  const { run } = (await import(new URL(`${sdk}/run.ts`, root).href)) as {
    run: () => Promise<ResultsFile>;
  };
  const results = await run();
  writeFileSync(new URL(`results/${sdk}.json`, root), `${JSON.stringify(results, null, 2)}\n`);
  const { pass, fail, skip } = results.totals;
  console.log(`${sdk}: ${pass} pass, ${fail} fail, ${skip} skip → conformance/results/${sdk}.json`);
}
