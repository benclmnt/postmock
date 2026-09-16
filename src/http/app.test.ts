import { describe, expect, it, vi } from "vitest";
import { apiError } from "../errors.ts";
import { createRuntime } from "../runtime.ts";
import { newMessageId } from "../state/ids.ts";
import { createServer } from "../state/servers.ts";
import { createApiApp } from "./app.ts";
import { paged, Unsupported } from "./respond.ts";
import { defineRoute } from "./routes.ts";

// Test-only routes; each test file has its own module registry.
defineRoute({
  method: "GET",
  path: "/test/echo",
  auth: "server",
  handler: (ctx) => ({
    Query: ctx.query.get("fromDate") ?? null,
    Body: ctx.body ?? null,
  }),
});
defineRoute({
  method: "POST",
  path: "/test/batch",
  auth: "serverOrTest",
  handler: () => [
    { ErrorCode: 0, Message: "OK" },
    { ErrorCode: 406, Message: "inactive" },
  ],
});
defineRoute({
  method: "GET",
  path: "/test/empty",
  auth: "server",
  handler: ({ query }) =>
    paged("Messages", [], Number(query.get("count")), Number(query.get("offset"))),
});
defineRoute({
  method: "GET",
  path: "/test/error",
  auth: "server",
  handler: () => {
    throw apiError(1226, { family: "streams" });
  },
});
defineRoute({
  method: "GET",
  path: "/test/unsupported",
  auth: "server",
  handler: () => {
    throw new Unsupported("shape not captured");
  },
});
defineRoute({
  method: "GET",
  path: "/test/date",
  auth: "server",
  handler: () => ({ At: new Date() }),
});

function setup() {
  const runtime = createRuntime();
  createServer(runtime.store, runtime.clock.now(), { ApiTokens: ["token"] });
  const app = createApiApp(runtime);
  const request = (path: string, init: RequestInit = {}) =>
    app.request(`http://api.postmarkapp.com${path}`, {
      ...init,
      headers: { "X-Postmark-Server-Token": "token", ...init.headers },
    });
  return { runtime, request };
}

describe("emit rules", () => {
  it("E1, E2: success is 200 with application/json", async () => {
    const res = await setup().request("/test/echo");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("E3: an error is the envelope plus X-PM-ApiErrorCode", async () => {
    const res = await setup().request("/test/error");
    expect(res.status).toBe(422);
    expect(res.headers.get("X-PM-ApiErrorCode")).toBe("1226");
    expect(await res.json()).toEqual({
      ErrorCode: 1226,
      Message: "The message stream for the provided 'ID' was not found.",
    });
  });

  it("E3: a bad token is 401 with the envelope", async () => {
    const res = await setup().request("/test/echo", {
      headers: { "X-Postmark-Server-Token": "x" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("X-PM-ApiErrorCode")).toBe("10");
    expect(await res.json()).toMatchObject({ ErrorCode: 10 });
  });

  it("E7: MessageID is a lowercase UUID", () => {
    expect(newMessageId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("E9: an empty page keeps the wrapper key and TotalCount", async () => {
    const res = await setup().request("/test/empty?count=10&offset=0");
    expect(await res.json()).toEqual({ TotalCount: 0, Messages: [] });
    expect(paged("Opens", [1, 2, 3], 2, 1)).toEqual({ TotalCount: 3, Opens: [2, 3] });
  });

  it("E11: a batch answers 200 with an array", async () => {
    const res = await setup().request("/test/batch", { method: "POST", body: "[]" });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(2);
  });

  it("E13: no compression, even when asked", async () => {
    const res = await setup().request("/test/echo", { headers: { "Accept-Encoding": "gzip" } });
    expect(res.headers.get("Content-Encoding")).toBeNull();
  });

  it("E2: refuses a handler that returns no body", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const res = await setup().request("/test/undefined");
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("response body is undefined");
  });

  it("refuses to serialize an unformatted Date (docs/02 §7.1)", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const res = await setup().request("/test/date");
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("unformatted Date at key 'At'");
  });
});

describe("accept rules end to end", () => {
  it("R1: serves any host at the root path", async () => {
    const { runtime } = setup();
    const app = createApiApp(runtime);
    const res = await app.request("http://localhost:4567/test/echo", {
      headers: { "X-Postmark-Server-Token": "token" },
    });
    expect(res.status).toBe(200);
  });

  it("R2, R3: path and query key case", async () => {
    const res = await setup().request("/TEST/Echo/?FROMDATE=2020-01-01");
    expect(await res.json()).toEqual({ Query: "2020-01-01", Body: null });
  });

  it("R7: GET with a literal null body and no Content-Type", async () => {
    const res = await setup().request("/test/echo", { method: "GET", body: null });
    expect(res.status).toBe(200);
  });

  it("R7: malformed JSON is 422/402, after auth", async () => {
    const { request } = setup();
    const bad = await request("/test/batch", { method: "POST", body: "{" });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ ErrorCode: 402 });
    const noToken = await request("/test/batch", {
      method: "POST",
      body: "{",
      headers: { "X-Postmark-Server-Token": "" },
    });
    expect(noToken.status).toBe(401);
  });

  it("R14: extra headers change nothing", async () => {
    const res = await setup().request("/test/echo", {
      headers: {
        "X-Postmark-Client": "postmark-python",
        "X-Postmark-Correlation-Id": "c0ffee",
        "X-Agent-Label": "a",
        "User-Agent": "Postmark.JS - 5.1.0",
      },
    });
    expect(res.status).toBe(200);
  });

  it("R15: POSTMARK_API_TEST on a test route", async () => {
    const res = await setup().request("/test/batch", {
      method: "POST",
      headers: { "X-Postmark-Server-Token": "POSTMARK_API_TEST" },
    });
    expect(res.status).toBe(200);
  });
});

describe("unknown behavior fails loudly", () => {
  it("an unknown route is 404 text", async () => {
    const res = await setup().request("/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("postmock: no route for GET /nope");
  });

  it("Unsupported is 501 text", async () => {
    const res = await setup().request("/test/unsupported");
    expect(res.status).toBe(501);
    expect(await res.text()).toBe("postmock: shape not captured");
  });
});

describe("GET /server", () => {
  it("E5, E6, E10: every doc field, PascalCase, numeric ID", async () => {
    const res = await setup().request("/server");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual([
      "ID",
      "Name",
      "ApiTokens",
      "Color",
      "SmtpApiActivated",
      "RawEmailEnabled",
      "DeliveryType",
      "ServerLink",
      "InboundAddress",
      "InboundHookUrl",
      "BounceHookUrl",
      "OpenHookUrl",
      "DeliveryHookUrl",
      "PostFirstOpenOnly",
      "InboundDomain",
      "InboundHash",
      "InboundSpamThreshold",
      "TrackOpens",
      "TrackLinks",
      "IncludeBounceContentInHook",
      "ClickHookUrl",
      "EnableSmtpApiErrorHooks",
    ]);
    expect(body.ID).toBe(1);
    expect(body.ApiTokens).toEqual(["token"]);
  });
});
