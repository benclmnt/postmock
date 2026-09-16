import { describe, expect, it } from "vitest";
import { parseJUnit, parseTrx } from "./reports.ts";

describe("parseJUnit", () => {
  it("reads pass, failure, error and skip cases with their attributes", () => {
    const xml = `<?xml version="1.0"?>
<testsuites><testsuite name="s">
  <testcase name="passes" classname="integration.BounceTest" time="0.1"/>
  <testcase name="fails" classname="integration.BounceTest">
    <failure message="expected &lt;1&gt; but was &quot;2&quot;" type="AssertionError">stack</failure>
  </testcase>
  <testcase name="errors" class="Postmark\\Tests\\EmailTest" file="/suite/tests/EmailTest.php">
    <error type="PostmarkException">Postmark\\Tests\\EmailTest::errors
PostmarkException: There was an unknown error.</error>
  </testcase>
  <testcase name="skips" classname="x"><skipped/></testcase>
</testsuite></testsuites>`;
    expect(parseJUnit(xml)).toEqual([
      {
        attrs: { name: "passes", classname: "integration.BounceTest", time: "0.1" },
        state: "pass",
      },
      {
        attrs: { name: "fails", classname: "integration.BounceTest" },
        state: "fail",
        error: 'expected <1> but was "2"',
      },
      {
        attrs: {
          name: "errors",
          class: "Postmark\\Tests\\EmailTest",
          file: "/suite/tests/EmailTest.php",
        },
        state: "fail",
        error: "Postmark\\Tests\\EmailTest::errors\nPostmarkException: There was an unknown error.",
      },
      { attrs: { name: "skips", classname: "x" }, state: "skip" },
    ]);
  });
});

describe("parseTrx", () => {
  it("maps outcomes and reads the error message", () => {
    const xml = `<TestRun><Results>
  <UnitTestResult testName="Postmark.Tests.A.Passes" outcome="Passed" />
  <UnitTestResult testName="Postmark.Tests.A.Skipped" outcome="NotExecuted"><Output /></UnitTestResult>
  <UnitTestResult testName="Postmark.Tests.A.Fails" outcome="Failed">
    <Output><ErrorInfo><Message>Assert.Equal() Failure&#xD;
Expected: 1</Message><StackTrace>at A</StackTrace></ErrorInfo></Output>
  </UnitTestResult>
</Results></TestRun>`;
    expect(parseTrx(xml).map((c) => [c.attrs.testName, c.state, c.error])).toEqual([
      ["Postmark.Tests.A.Passes", "pass", undefined],
      ["Postmark.Tests.A.Skipped", "skip", undefined],
      ["Postmark.Tests.A.Fails", "fail", "Assert.Equal() Failure\r\nExpected: 1"],
    ]);
  });
});
