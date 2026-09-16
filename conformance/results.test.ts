import { describe, expect, it } from "vitest";
import { compare, type ResultsFile, type TestResult, totals } from "./results.ts";

const file = (tests: TestResult[]): ResultsFile => ({
  sdk: "x",
  sdkCommit: "c",
  finishedAt: "t",
  totals: totals(tests),
  tests,
});

describe("compare", () => {
  it("passes when every baseline test still passes", () => {
    const results = file([
      { id: "a", state: "pass" },
      { id: "b", state: "pass" },
    ]);
    expect(compare({ passing: ["a"] }, results)).toEqual({ regressions: [], newlyPassing: ["b"] });
  });

  it("reports a baseline test that now fails, skips or is missing", () => {
    const results = file([
      { id: "a", state: "fail", error: "boom" },
      { id: "b", state: "skip" },
    ]);
    expect(compare({ passing: ["a", "b", "gone"] }, results).regressions).toEqual([
      "a",
      "b",
      "gone",
    ]);
  });

  it("counts totals per state", () => {
    expect(
      totals([
        { id: "a", state: "pass" },
        { id: "b", state: "fail" },
        { id: "c", state: "fail" },
      ]),
    ).toEqual({ pass: 1, fail: 2, skip: 0 });
  });
});
