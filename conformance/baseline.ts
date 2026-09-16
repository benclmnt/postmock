import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Baseline, BaselineFile } from "./results.ts";

/** `conformance/<sdk>/skips/<test file>.json`: tests allowed to fail, each with a reason and a source. */
export interface SkipsFile {
  skipped: Array<{ title: string; reason: string; source: string }>;
}

/** Test ids from every `<test file>.json` under `conformance/<sdk>/<folder>/`. */
function readIds(sdkDir: URL, folder: string, titles: (json: unknown) => string[]): string[] {
  const dir = new URL(`${folder}/`, sdkDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) =>
      titles(JSON.parse(readFileSync(new URL(f, dir), "utf8"))).map(
        (title) => `${f.slice(0, -".json".length)} > ${title}`,
      ),
    );
}

export const readBaseline = (sdkDir: URL): Baseline => ({
  passing: readIds(sdkDir, "baseline", (json) => (json as BaselineFile).passing),
});

export const readSkips = (sdkDir: URL): string[] =>
  readIds(sdkDir, "skips", (json) => (json as SkipsFile).skipped.map((s) => s.title));

/** A test may be required to pass or allowed to fail, never both. */
export const skippedAndBaselined = (baseline: Baseline, skips: string[]): string[] =>
  baseline.passing.filter((id) => skips.includes(id));
