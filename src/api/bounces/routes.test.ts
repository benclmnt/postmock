import { describe, expect, it } from "vitest";
import { recipientsKit } from "../../recipients/testkit.ts";

describe("bounces", () => {
  it("lists seeded bounces newest first with the list shape", async () => {
    const { call } = await recipientsKit();
    const res = await call("GET", "/bounces/?count=100&offset=0");
    expect(res.body.TotalCount).toBe(2);
    expect(res.body.Bounces.map((b: { ID: number }) => b.ID)).toEqual([2002, 2001]);
    expect(res.body.Bounces[0]).toMatchObject({
      RecordType: "Bounce",
      DumpAvailable: true,
      TypeCode: 4096,
    });
    expect(res.body.Bounces[0].BouncedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/);
    expect(res.body.Bounces[0]).not.toHaveProperty("Content");
  });

  it.each([
    ["count=5&offset=0&type=HardBounce", [2001]],
    ["count=5&offset=0&inactive=True", [2001]],
    ["count=5&offset=0&inactive=false", [2002]],
    ["count=5&offset=0&emailFilter=BOUNCE@", [2002, 2001]],
    ["count=5&offset=0&emailFilter=notexist292random", []],
    ["count=5&offset=0&messagestream=broadcast", []],
    ["count=1&offset=1", [2001]],
    ["count=5&offset=0&fromdate=2000-01-01&todate=2000-01-02", []],
  ])("filters %s", async (query, ids) => {
    const { call } = await recipientsKit();
    const res = await call("GET", `/bounces?${query}`);
    expect(res.body.Bounces.map((b: { ID: number }) => b.ID)).toEqual(ids);
  });

  it.each([
    "offset=0",
    "count=-1&offset=0",
    "count=501&offset=0",
    "count=500&offset=9501",
    "count=1&offset=0&type=Nope",
  ])("refuses %s with 1000", async (query) => {
    const { call } = await recipientsKit();
    expect(await call("GET", `/bounces?${query}`)).toMatchObject({
      status: 422,
      body: { ErrorCode: 1000 },
    });
  });

  it("reads a bounce with Content and its dump; an unknown id is 1001", async () => {
    const { call } = await recipientsKit();
    const bounce = await call("GET", "/bounces/2001");
    expect(bounce.body.Content).toContain("Return-Path");
    expect(bounce.body.BouncedAt).toMatch(/-0[45]:00$/);
    expect((await call("GET", "/bounces/2001/dump")).body.Body).toBe(bounce.body.Content);
    expect((await call("GET", "/bounces/99")).body.ErrorCode).toBe(1001);
  });

  it("delivery stats count All first, then each type present in TypeCode order", async () => {
    const { call } = await recipientsKit();
    expect((await call("GET", "/deliveryStats")).body).toEqual({
      InactiveMails: 1,
      Bounces: [
        { Name: "All", Count: 2 },
        { Type: "HardBounce", Name: "Hard bounce", Count: 1 },
        { Type: "SoftBounce", Name: "Soft bounce", Count: 1 },
      ],
    });
  });
});
