import { describe, expect, it } from "vitest";
import { applySkips, readBaseline, skippedAndBaselined } from "./baseline.ts";
import { compare, type ResultsFile, staleReason, type TestResult, totals } from "./results.ts";

const file = (tests: TestResult[]): ResultsFile => ({
  sdk: "x",
  sdkCommit: "c",
  postmock: { commit: "a".repeat(40), sourceHash: "h1" },
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
  const current = { postmock: { commit: "b".repeat(40), sourceHash: "h1" }, sdkCommit: "c" };

  it("accepts results from the same source and SDK commit, whatever the postmock commit", () => {
    expect(staleReason(file([]), current)).toBeUndefined();
  });

  it("refuses results from other postmock source", () => {
    expect(
      staleReason(file([]), { ...current, postmock: { commit: "b".repeat(40), sourceHash: "h2" } }),
    ).toBe("results come from other postmock source (aaaaaaa); source is now bbbbbbb");
  });

  it("refuses results from another SDK commit", () => {
    expect(staleReason(file([]), { ...current, sdkCommit: "d" })).toBe(
      "results come from SDK commit c; sdk/ is now at d",
    );
  });
});

describe("skippedAndBaselined", () => {
  it("lists tests in both a baseline and a skip file", () => {
    expect(skippedAndBaselined({ passing: ["f > a", "f > b"] }, ["f > b", "f > c"])).toEqual([
      "f > b",
    ]);
  });
});

describe("applySkips", () => {
  it("marks a listed test as skip, whether it failed or passed", () => {
    const tests: TestResult[] = [
      { id: "f > a", state: "fail", error: "boom" },
      { id: "f > b", state: "pass" },
      { id: "f > c", state: "fail", error: "boom" },
    ];
    expect(applySkips(tests, ["f > a", "f > b"])).toEqual([
      { id: "f > a", state: "skip" },
      { id: "f > b", state: "skip" },
      { id: "f > c", state: "fail", error: "boom" },
    ]);
  });

  it("refuses a skip for a test the suite lacks", () => {
    expect(() => applySkips([{ id: "f > a", state: "pass" }], ["f > gone"])).toThrow(
      "skip files name tests the suite lacks: f > gone",
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
