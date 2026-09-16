import { describe, expect, it, vi } from "vitest";
import { createControlApp } from "../../control/app.ts";
import { createApiApp } from "../../http/app.ts";
import { createRuntime } from "../../runtime.ts";
import { createServer } from "../../state/servers.ts";
import { BULK_START_MS, BULK_STEP_MS } from "./bulk.ts";

function setup() {
  const runtime = createRuntime();
  const now = runtime.clock.now();
  createServer(runtime.store, now, { ApiTokens: ["token"] });
  createServer(runtime.store, now, { ApiTokens: ["other"] });
  const app = createApiApp(runtime);
  const control = createControlApp(runtime, "empty");
  const call = async (method: string, path: string, body?: unknown, token = "token") => {
    const res = await app.request(`http://api.postmarkapp.com${path}`, {
      method,
      headers: { "X-Postmark-Server-Token": token, "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    // biome-ignore lint/suspicious/noExplicitAny: the tests read nested response JSON.
    return { status: res.status, json: (await res.json()) as any };
  };
  const finish = (messages: number) =>
    runtime.clock.advance(BULK_START_MS + messages * BULK_STEP_MS);
  return { runtime, call, control, finish };
}

const request = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
  From: "sender@example.com",
  Subject: "Hi {{FirstName}}",
  TextBody: "Hi, {{FirstName}}!",
  MessageStream: "broadcast",
  Metadata: { campaign: "july", shared: "request" },
  Headers: [{ Name: "X-Campaign", Value: "request" }],
  Messages: messages,
  ...extra,
});

describe("bulk send (docs/03 §1.6)", () => {
  it("accepts, then releases each rendered message on the clock", async () => {
    const { runtime, call, finish } = setup();
    const sent = await call(
      "POST",
      "/email/bulk",
      request([
        { To: "a@example.com", TemplateModel: { FirstName: "Ann" } },
        {
          To: "b@example.com",
          Metadata: { shared: "message" },
          Headers: [{ Name: "x-campaign", Value: "message" }],
        },
      ]),
    );
    expect(sent.json).toMatchObject({
      Status: "Accepted",
      TotalMessages: 2,
      PercentageCompleted: 0,
      ReleasedCount: 0,
      FailedCount: 0,
      Subject: "Hi {{FirstName}}",
    });
    expect(sent.json.SubmittedAt).toMatch(/Z$/);
    expect(runtime.store.state.outbound.size).toBe(0);

    await finish(2);
    expect((await call("GET", `/email/bulk/${sent.json.Id}`)).json).toMatchObject({
      Status: "Completed",
      PercentageCompleted: 100,
      ReleasedCount: 2,
      FailedCount: 0,
    });
    const [ann, second] = runtime.store.state.outbound.values();
    expect(ann).toMatchObject({ Subject: "Hi Ann", bulkRequestId: sent.json.Id });
    expect(second).toMatchObject({
      TextBody: "Hi, !",
      Metadata: { campaign: "july", shared: "message" },
      Headers: [{ Name: "x-campaign", Value: "message" }],
    });
  });

  it("counts a message that fails to render as failed, not as a 422", async () => {
    const { call, finish } = setup();
    const sent = await call(
      "POST",
      "/email/bulk",
      request([{ To: "a@example.com" }], { Subject: "{{#open}}" }),
    );
    expect(sent.status).toBe(200);
    await finish(1);
    expect((await call("GET", `/email/bulk/${sent.json.Id}`)).json).toMatchObject({
      Status: "Completed",
      FailedCount: 1,
    });
  });

  it("rejects the whole request: one error with its code, several with ErrorCode 11", async () => {
    const { runtime, call } = setup();
    const one = await call(
      "POST",
      "/email/bulk",
      request([{ To: "a@example.com" }, { To: "bad" }]),
    );
    expect(one.status).toBe(422);
    expect(one.json).toEqual({ ErrorCode: 300, Message: "Invalid 'To' address: 'bad'." });
    const two = await call("POST", "/email/bulk", request([{ To: "bad1" }, { To: "bad2" }]));
    expect(two.json).toEqual({
      ErrorCode: 11,
      Message: "Multiple errors occurred. Inspect the Errors property for more information.",
      Errors: {
        To: [
          { ErrorCode: 300, Message: "Invalid 'To' address: 'bad1'." },
          { ErrorCode: 300, Message: "Invalid 'To' address: 'bad2'." },
        ],
      },
    });
    expect(runtime.store.state.bulkRequests.size).toBe(0);
  });

  it("answers 1226 for an unknown stream and 404 / 12 for another server's request", async () => {
    const { call } = setup();
    const unknown = await call(
      "POST",
      "/email/bulk",
      request([{ To: "a@example.com" }], { MessageStream: "nope" }),
    );
    expect(unknown.json.ErrorCode).toBe(1226);
    const sent = await call("POST", "/email/bulk", request([{ To: "a@example.com" }]));
    const other = await call("GET", `/email/bulk/${sent.json.Id}`, undefined, "other");
    expect(other.status).toBe(404);
    expect(other.json.ErrorCode).toBe(12);
  });

  it("answers 14 on every endpoint until the account is approved", async () => {
    const { runtime, call } = setup();
    runtime.store.state.account.bulkApiEnabled = false;
    for (const [method, path] of [
      ["POST", "/email/bulk"],
      ["GET", "/email/bulk/x"],
      ["GET", "/email/bulk?count=10"],
    ] as const) {
      expect(
        (await call(method, path, method === "POST" ? request([]) : undefined)).json.ErrorCode,
      ).toBe(14);
    }
  });

  it("stops releasing after a cancel", async () => {
    const { call, control, finish } = setup();
    const sent = await call("POST", "/email/bulk", request([{ To: "a@example.com" }]));
    const res = await control.request(`/control/bulk/${sent.json.Id}/cancel`, { method: "POST" });
    expect(await res.json()).toMatchObject({ Status: "Cancelled" });
    await finish(1);
    expect((await call("GET", `/email/bulk/${sent.json.Id}`)).json).toMatchObject({
      Status: "Cancelled",
      ReleasedCount: 0,
    });
  });

  it("stops and reports a request that reaches uncaptured behavior on the clock", async () => {
    const { runtime, call, control, finish } = setup();
    const sent = await call("POST", "/email/bulk", request([{ To: "a@example.com" }]));
    for (const stream of runtime.store.state.streams.values()) {
      if (stream.ID === "broadcast") stream.ArchivedAt = runtime.clock.now();
    }
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await finish(1);
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
    const res = await control.request(`/control/bulk/${sent.json.Id}`);
    expect(await res.json()).toMatchObject({
      Status: "Processing",
      ReleasedCount: 0,
      FailedCount: 0,
      Unsupported: expect.stringContaining("archived"),
    });
  });

  it("lists newest first with an unpadded pagination key", async () => {
    const { runtime, call } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await call("POST", "/email/bulk", request([{ To: "a@example.com" }]))).json.Id);
      await runtime.clock.advance(1);
    }
    const first = await call("GET", "/email/bulk?count=2");
    expect(first.json.Requests.map((r: { Id: string }) => r.Id)).toEqual([ids[2], ids[1]]);
    expect(first.json.PaginationKey).not.toMatch(/=/);
    const second = await call(
      "GET",
      `/email/bulk?count=2&paginationKey=${first.json.PaginationKey}`,
    );
    expect(second.json).toEqual({ Requests: [expect.objectContaining({ Id: ids[0] })] });
    const padded = await call(
      "GET",
      `/email/bulk?count=2&paginationKey=${first.json.PaginationKey}%3D`,
    );
    expect(padded.json.ErrorCode).toBe(13);
  });
});
