import type { PostmockStamp } from "./stamp.ts";

/** One test of an SDK suite. `id` is `<file> > <full title>` and stays stable across runs. */
export interface TestResult {
  id: string;
  state: "pass" | "fail" | "skip";
  /** First line of the failure, for triage. */
  error?: string;
}

/** `conformance/results/<sdk>.json`. */
export interface ResultsFile {
  sdk: string;
  sdkCommit: string;
  postmock: PostmockStamp;
  finishedAt: string;
  totals: { pass: number; fail: number; skip: number };
  tests: TestResult[];
}

/**
 * `conformance/<sdk>/baseline/<test file>.json`: `{"passing": [full titles]}` of tests in that file
 * that passed once and must keep passing. One file per test file, so tracks never co-edit one.
 */
export interface BaselineFile {
  passing: string[];
}

/** Every baseline test id (`<test file> > <full title>`) of an SDK. */
export interface Baseline {
  passing: string[];
}

export function totals(tests: TestResult[]): ResultsFile["totals"] {
  const count = (state: TestResult["state"]) => tests.filter((t) => t.state === state).length;
  return { pass: count("pass"), fail: count("fail"), skip: count("skip") };
}

/**
 * A reason to distrust a results file: it came from other postmock source or another SDK commit.
 * A commit of the same source, or a docs edit, keeps it fresh.
 */
export function staleReason(
  results: ResultsFile,
  current: { postmock: PostmockStamp; sdkCommit: string },
): string | undefined {
  if (results.sdkCommit !== current.sdkCommit) {
    return `results come from SDK commit ${results.sdkCommit}; sdk/ is now at ${current.sdkCommit}`;
  }
  if (results.postmock.sourceHash !== current.postmock.sourceHash) {
    return `results come from other postmock source (${results.postmock.commit.slice(0, 7)}); source is now ${current.postmock.commit.slice(0, 7)}`;
  }
  return undefined;
}

/**
 * The ratchet (docs/11 §3.3): every baseline test must still pass. A test missing from the results
 * counts as a regression. `newlyPassing` lists tests to add to the baseline.
 */
export function compare(
  baseline: Baseline,
  results: ResultsFile,
): { regressions: string[]; newlyPassing: string[] } {
  const passing = new Set(results.tests.filter((t) => t.state === "pass").map((t) => t.id));
  const expected = new Set(baseline.passing);
  return {
    regressions: baseline.passing.filter((id) => !passing.has(id)),
    newlyPassing: [...passing].filter((id) => !expected.has(id)).sort(),
  };
}
