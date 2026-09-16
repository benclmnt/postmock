// Maps mocha JSON reports (postmark.js, postmark-cli) to test results.
import type { TestResult } from "./results.ts";

export interface MochaTest {
  fullTitle: string;
  file: string;
  err: { message?: string } | Record<string, never>;
}

export interface MochaReport {
  tests: MochaTest[];
  passes: MochaTest[];
  pending: MochaTest[];
  failures: MochaTest[];
}

/**
 * `listed` comes from `mocha --dry-run`, `report` from the real run; both use the JSON reporter.
 * A failed hook stops the tests after it and mocha does not report them: they become failures with
 * the hook's error. `root` is the suite folder that test ids are relative to.
 */
export function mochaResults(listed: MochaReport, report: MochaReport, root: string): TestResult[] {
  const idOf = (t: MochaTest) => `${t.file.slice(root.length + 1)} > ${t.fullTitle}`;
  const firstLine = (t: MochaTest) =>
    ("message" in t.err ? (t.err.message ?? "") : "").split("\n")[0];
  const passed = new Set(report.passes.map(idOf));
  const pending = new Set(report.pending.map(idOf));
  const failures = new Map(report.failures.map((t) => [idOf(t), t]));
  const hookFailure = (file: string) =>
    report.failures.find((f) => f.file === file && f.fullTitle.includes('" hook'));

  return listed.tests.map((t) => {
    const id = idOf(t);
    if (passed.has(id)) return { id, state: "pass" };
    if (pending.has(id)) return { id, state: "skip" };
    const own = failures.get(id);
    const failure = own ?? hookFailure(t.file);
    const error = failure ? `${own ? "" : "not run: "}${firstLine(failure)}` : "not run";
    return { id, state: "fail", error };
  });
}
