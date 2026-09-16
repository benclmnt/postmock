// `pnpm conformance <sdk>|all`: runs each SDK suite against postmock and writes
// `conformance/results/<sdk>.json`. A runner is `conformance/<sdk>/run.ts` exporting `run()`.
import { mkdirSync, writeFileSync } from "node:fs";
import { type ResultsFile, runnerNames } from "./results.ts";

const root = new URL("./", import.meta.url);
const runners = runnerNames();

const arg = process.argv[2];
if (arg === undefined || (arg !== "all" && !runners.includes(arg))) {
  console.error(`usage: pnpm conformance <${[...runners, "all"].join("|")}>`);
  process.exit(2);
}

mkdirSync(new URL("results/", root), { recursive: true });
// A runner that throws writes no results; `all` still runs the others, then exits non-zero.
const broken: string[] = [];
for (const sdk of arg === "all" ? runners : [arg]) {
  const { run } = (await import(new URL(`${sdk}/run.ts`, root).href)) as {
    run: () => Promise<ResultsFile>;
  };
  try {
    const results = await run();
    writeFileSync(new URL(`results/${sdk}.json`, root), `${JSON.stringify(results, null, 2)}\n`);
    const { pass, fail, skip } = results.totals;
    console.log(
      `${sdk}: ${pass} pass, ${fail} fail, ${skip} skip → conformance/results/${sdk}.json`,
    );
  } catch (error) {
    if (arg !== "all") throw error;
    console.error(`${sdk}: runner failed:`, error);
    broken.push(sdk);
  }
}
if (broken.length > 0) {
  console.error(`runners failed: ${broken.join(", ")}`);
  process.exit(1);
}
