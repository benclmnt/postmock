import { describe, expect, it } from "vitest";
import { easternWallTime, formatEasternDate, formatTimestamp } from "./time.ts";

describe("E8 timestamps", () => {
  it("formats 7 fraction digits with the Eastern offset (winter -05:00, summer -04:00)", () => {
    expect(formatTimestamp(new Date("2014-02-17T12:25:01.417Z"))).toBe(
      "2014-02-17T07:25:01.4170000-05:00",
    );
    expect(formatTimestamp(new Date("2020-07-01T04:00:00.000Z"))).toBe(
      "2020-07-01T00:00:00.0000000-04:00",
    );
  });

  it("formats the Z form", () => {
    expect(formatTimestamp(new Date("2026-03-17T07:25:01.417Z"), "utc")).toBe(
      "2026-03-17T07:25:01.4170000Z",
    );
  });

  it("formats a stats date in Eastern time", () => {
    expect(formatEasternDate(new Date("2014-01-02T03:00:00Z"))).toBe("2014-01-01");
  });

  it("maps an Eastern wall time to its instant across DST", () => {
    expect(easternWallTime(2021, 1, 1, 12).toISOString()).toBe("2021-01-01T17:00:00.000Z");
    expect(easternWallTime(2021, 7, 1, 12).toISOString()).toBe("2021-07-01T16:00:00.000Z");
  });
});
