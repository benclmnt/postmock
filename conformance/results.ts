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
  finishedAt: string;
  totals: { pass: number; fail: number; skip: number };
  tests: TestResult[];
}

/** `conformance/<sdk>/baseline.json`: tests that passed once and must keep passing. */
export interface Baseline {
  passing: string[];
}

export function totals(tests: TestResult[]): ResultsFile["totals"] {
  const count = (state: TestResult["state"]) => tests.filter((t) => t.state === state).length;
  return { pass: count("pass"), fail: count("fail"), skip: count("skip") };
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
