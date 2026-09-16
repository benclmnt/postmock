import { describe, expect, it } from "vitest";
import { readBaseline } from "./baseline.ts";
import { compare, type ResultsFile, staleReason, type TestResult, totals } from "./results.ts";

const file = (tests: TestResult[]): ResultsFile => ({
  sdk: "x",
  sdkCommit: "c",
  postmock: { commit: "a".repeat(40), dirty: false, sourceHash: "h1" },
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

describe("staleReason", () => {
  it("accepts results from the same source", () => {
    expect(
      staleReason(file([]), { commit: "a".repeat(40), dirty: false, sourceHash: "h1" }),
    ).toBeUndefined();
  });

  it("refuses results from other source", () => {
    expect(staleReason(file([]), { commit: "b".repeat(40), dirty: true, sourceHash: "h2" })).toBe(
      "results come from postmock aaaaaaa, source is now bbbbbbb+changes",
    );
  });
});

describe("readBaseline", () => {
  it("joins each baseline file path with its titles", () => {
    expect(readBaseline(new URL("./postmark.js/", import.meta.url)).passing).toContain(
      "test/integration/Server.test.ts > Server getServer",
    );
  });
});
