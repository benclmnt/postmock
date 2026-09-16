import { describe, expect, it } from "vitest";
import { CONFORMANCE } from "../../../seeds/lib/conformance.ts";
import { recipientsKit } from "../../recipients/testkit.ts";

const request = {
  RequestedBy: "a@example.com",
  RequestedFor: "b@example.com",
  NotifyWhenCompleted: false,
};

describe("data removals", () => {
  it("creates a Pending request and reads it back by ID with the account token", async () => {
    const { call } = await recipientsKit();
    const created = await call("POST", "/data-removals", request, CONFORMANCE.accountToken);
    expect(created.body).toEqual({ ID: expect.any(Number), Status: "Pending" });
    const read = await call(
      "GET",
      `/data-removals/${created.body.ID}`,
      undefined,
      CONFORMANCE.accountToken,
    );
    expect(read.body).toEqual(created.body);
  });

  it("answers 1300, 1301, 1302 and 401 for a server token", async () => {
    const { call, runtime } = await recipientsKit();
    const account = CONFORMANCE.accountToken;
    expect((await call("POST", "/data-removals", {}, account)).body.ErrorCode).toBe(1300);
    expect((await call("GET", "/data-removals/77", undefined, account)).body.ErrorCode).toBe(1301);
    expect((await call("GET", "/data-removals/abc", undefined, account)).body.ErrorCode).toBe(1301);
    expect((await call("POST", "/data-removals", request)).status).toBe(401);
    runtime.store.state.account.dataRemovalsEnabled = false;
    expect((await call("POST", "/data-removals", request, account)).body.ErrorCode).toBe(1302);
  });
});
