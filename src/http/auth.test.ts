import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.ts";
import { createServer, findStream } from "../state/servers.ts";
import { Store } from "../state/store.ts";
import { authenticate } from "./auth.ts";
import { Unsupported } from "./respond.ts";

function setup() {
  const store = new Store();
  store.state.account.tokens.push("account-token");
  const server = createServer(store, new Date(), { ApiTokens: ["server-token"] });
  return { state: store.state, server };
}

const headers = (h: Record<string, string>) => new Headers(h);

function errorCodeOf(fn: () => unknown): { status: number; code: number } {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, code: error.body.ErrorCode };
    throw error;
  }
  throw new Error("expected an ApiError");
}

describe("server token", () => {
  it("resolves the server; header name and value match without case (docs/02 §3.1)", () => {
    const { state, server } = setup();
    const h = headers({ "x-postmark-server-token": "SERVER-TOKEN" });
    expect(authenticate("server", h, state, "GET /server", new Date())).toEqual({
      kind: "server",
      server,
    });
  });

  it.each([
    ["missing", {}],
    ["unknown", { "X-Postmark-Server-Token": "nope" }],
    ["empty", { "X-Postmark-Server-Token": "" }],
    ["an account token", { "X-Postmark-Server-Token": "account-token" }],
    ["only the account header", { "X-Postmark-Account-Token": "account-token" }],
  ])("answers 401/10 when %s", (_, h) => {
    const { state } = setup();
    expect(
      errorCodeOf(() => authenticate("server", headers(h), state, "GET /server", new Date())),
    ).toEqual({
      status: 401,
      code: 10,
    });
  });
});

describe("account token", () => {
  it("accepts the account token", () => {
    const { state } = setup();
    const h = headers({ "X-Postmark-Account-Token": "Account-Token" });
    expect(authenticate("account", h, state, "GET /servers", new Date())).toEqual({
      kind: "account",
    });
  });

  it("answers 401/10 for a server token (docs/02 §3.4)", () => {
    const { state } = setup();
    const h = headers({ "X-Postmark-Server-Token": "server-token" });
    expect(
      errorCodeOf(() => authenticate("account", h, state, "GET /servers", new Date())),
    ).toEqual({
      status: 401,
      code: 10,
    });
  });
});

describe("R15 POSTMARK_API_TEST", () => {
  const h = headers({ "X-Postmark-Server-Token": "POSTMARK_API_TEST" });

  it("gets a stored-nowhere server with the default streams where the route accepts it", () => {
    const { state } = setup();
    const auth = authenticate("serverOrTest", h, state, "POST /email", new Date());
    if (auth.kind !== "test") throw new Error("expected the test context");
    expect(auth.server).toMatchObject({ ID: 0, DeliveryType: "Live", TrackLinks: "None" });
    expect(findStream(state, auth, "outbound")?.MessageStreamType).toBe("Transactional");
    expect(findStream(state, auth, "nope")).toBeUndefined();
    expect(state.servers.has(0)).toBe(false);
  });

  it("is Unsupported where its behavior is not captured", () => {
    const { state } = setup();
    expect(() => authenticate("server", h, state, "GET /server", new Date())).toThrow(Unsupported);
  });

  it("is not an account token", () => {
    const { state } = setup();
    const account = headers({ "X-Postmark-Account-Token": "POSTMARK_API_TEST" });
    expect(
      errorCodeOf(() => authenticate("account", account, state, "GET /servers", new Date())).code,
    ).toBe(10);
  });
});
