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
 * Tests that share a full title get ` (2)`, ` (3)` suffixes; they pass only if all of them pass,
 * because the report cannot tell them apart.
 */
export function mochaResults(listed: MochaReport, report: MochaReport, root: string): TestResult[] {
  const idOf = (t: MochaTest) => `${t.file.slice(root.length + 1)} > ${t.fullTitle}`;
  const message = (t: MochaTest) =>
    ("message" in t.err ? (t.err.message ?? "") : "").split("\n")[0] ?? "";
  const count = (tests: MochaTest[], id: string) => tests.filter((t) => idOf(t) === id).length;
  const hookFailure = (file: string) =>
    report.failures.find((f) => f.file === file && f.fullTitle.includes('" hook'));

  const seen = new Map<string, number>();
  return listed.tests.map((t) => {
    const base = idOf(t);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n > 1 ? `${base} (${n})` : base;
    const copies = count(listed.tests, base);
    if (count(report.passes, base) === copies) return { id, state: "pass" };
    if (count(report.pending, base) === copies) return { id, state: "skip" };
    const own = report.failures.find((f) => idOf(f) === base);
    if (own) return { id, state: "fail", error: message(own) };
    if (copies > 1 && count(report.passes, base) + count(report.pending, base) > 0) {
      return { id, state: "fail", error: `another test titled ${base} did not pass` };
    }
    const hook = hookFailure(t.file);
    return { id, state: "fail", error: hook ? `not run: ${message(hook)}` : "not run" };
  });
}
