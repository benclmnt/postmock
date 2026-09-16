import { describe, expect, it } from "vitest";
import { type MochaReport, type MochaTest, mochaResults } from "./mocha.ts";

const test = (fullTitle: string, message?: string): MochaTest => ({
  fullTitle,
  file: "/suite/test/a.test.ts",
  err: message === undefined ? {} : { message },
});
const report = (parts: Partial<MochaReport>): MochaReport => ({
  tests: [],
  passes: [],
  pending: [],
  failures: [],
  ...parts,
});

describe("mochaResults", () => {
  it("lists every dry-run test and marks tests a failed hook stopped as not run", () => {
    const listed = report({
      tests: [test("A passes"), test("A skips"), test("A fails"), test("A stopped")],
    });
    const run = report({
      passes: [test("A passes")],
      pending: [test("A skips")],
      failures: [
        test("A fails", "404\nstack"),
        test('A "before each" hook for "A stopped"', "boom"),
      ],
    });
    expect(mochaResults(listed, run, "/suite")).toEqual([
      { id: "test/a.test.ts > A passes", state: "pass" },
      { id: "test/a.test.ts > A skips", state: "skip" },
      { id: "test/a.test.ts > A fails", state: "fail", error: "404" },
      { id: "test/a.test.ts > A stopped", state: "fail", error: "not run: boom" },
    ]);
  });
});
