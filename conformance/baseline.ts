import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Baseline, BaselineFile } from "./results.ts";

/** Reads every `<test file>.json` under `conformance/<sdk>/baseline/` into test ids. */
export function readBaseline(sdkDir: URL): Baseline {
  const dir = new URL("baseline/", sdkDir);
  if (!existsSync(dir)) return { passing: [] };
  const passing = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      const file = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as BaselineFile;
      return file.passing.map((title) => `${f.slice(0, -".json".length)} > ${title}`);
    });
  return { passing };
}
