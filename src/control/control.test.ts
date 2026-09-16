import { describe, expect, it } from "vitest";
import { CONFORMANCE } from "../../seeds/lib/conformance.ts";
import { createApiApp } from "../http/app.ts";
import { submitOutbound } from "../pipeline/submit.ts";
import { createRuntime } from "../runtime.ts";
import { createControlApp } from "./app.ts";
import { applySeed } from "./seed.ts";

async function setup() {
  const runtime = createRuntime();
  await applySeed(runtime, "conformance");
  const control = createControlApp(runtime, "conformance");
  const api = createApiApp(runtime);
  const post = (path: string, body: unknown) =>
    control.request(path, { method: "POST", body: JSON.stringify(body) });
  const getServer = () =>
    api.request("/server", { headers: { "X-Postmark-Server-Token": CONFORMANCE.serverToken } });
  return { runtime, control, post, getServer };
}

describe("POST /control/reset", () => {
  it("empties the account and applies the startup seed again", async () => {
    const { runtime, post } = await setup();
    runtime.store.state.account.tokens.push("extra");
    const res = await post("/control/reset", {});
    expect(await res.json()).toEqual({ seed: "conformance" });
    expect(runtime.store.state.account.tokens).toEqual([CONFORMANCE.accountToken]);
  });

  it("applies a named seed instead", async () => {
    const { runtime, post, getServer } = await setup();
    await post("/control/reset", { seed: "empty" });
    expect(runtime.store.state.servers.size).toBe(0);
    expect((await getServer()).status).toBe(401);
  });

  it("keeps the state when the seed is unknown", async () => {
    const { runtime, post } = await setup();
    const res = await post("/control/reset", { seed: "nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown seed 'nope'; seeds: conformance, empty" });
    expect(runtime.store.state.servers.has(CONFORMANCE.serverId)).toBe(true);
  });
});

describe("POST /control/seed", () => {
  it("adds a seed on top of the state", async () => {
    const { runtime, post } = await setup();
    await post("/control/reset", { seed: "empty" });
    expect((await post("/control/seed", { name: "conformance" })).status).toBe(200);
    expect(runtime.store.state.servers.has(CONFORMANCE.serverId)).toBe(true);
  });

  it("refuses a seed that clashes with the state and keeps the state unchanged", async () => {
    const { runtime, post } = await setup();
    const servers = [...runtime.store.state.servers.keys()];
    const res = await post("/control/seed", { name: "conformance" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "seed 'conformance' failed: account token postmock-account-token exists",
    });
    expect(runtime.store.state.account.tokens).toEqual([CONFORMANCE.accountToken]);
    expect([...runtime.store.state.servers.keys()]).toEqual(servers);
  });

  it("names missing fields", async () => {
    const res = await (await setup()).post("/control/seed", {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("name") });
  });
});

describe("POST /control/clock/advance", () => {
  it("moves the clock and runs due tasks", async () => {
    const { runtime, post } = await setup();
    const before = runtime.clock.now().getTime();
    let ran = false;
    runtime.clock.schedule(60_000, () => {
      ran = true;
    });
    const res = await post("/control/clock/advance", { ms: 60_000 });
    expect(res.status).toBe(200);
    expect(ran).toBe(true);
    expect(runtime.clock.now().getTime() - before).toBeGreaterThanOrEqual(60_000);
  });
});

describe("POST /control/faults", () => {
  it("answers matching API requests with the fault, `times` times", async () => {
    const { post, getServer } = await setup();
    const res = await post("/control/faults", {
      match: { method: "get", path: "/SERVER" },
      times: 2,
      reply: { errorCode: 100 },
    });
    expect(res.status).toBe(200);
    for (const _ of [1, 2]) {
      const faulted = await getServer();
      expect(faulted.status).toBe(503);
      expect(faulted.headers.get("X-PM-ApiErrorCode")).toBe("100");
    }
    expect((await getServer()).status).toBe(200);
  });

  it.each([
    [{ status: 599, errorCode: 402 }, "ErrorCode 402 needs a status from 422"],
    [{ errorCode: 614 }, "ErrorCode 614 needs a family"],
    [{ errorCode: 300 }, "pass the exact message"],
    [{ errorCode: 9999 }, "not in docs/02"],
    [{ errorCode: 402, message: "Other text" }, "message only for a summary row"],
    [{ errorCode: 1226, family: "nope" }, "family"],
  ])("refuses a reply Postmark cannot give: %j", async (reply, error) => {
    const { runtime, post } = await setup();
    const res = await post("/control/faults", { match: { method: "GET", path: "/server" }, reply });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringContaining(error) });
    expect(runtime.store.state.faults).toEqual([]);
  });

  it("faults a code listed under several families", async () => {
    const { post, getServer } = await setup();
    await post("/control/faults", {
      match: { method: "GET", path: "/server" },
      reply: { errorCode: 1226, family: "stats" },
    });
    const res = await getServer();
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ErrorCode: 1226 });
  });
});

describe("GET /control/messages", () => {
  it("lists stored messages with filters", async () => {
    const { runtime, control } = await setup();
    const server = [...runtime.store.state.servers.values()][0];
    if (!server) throw new Error("seed has no server");
    const draft = {
      From: "sender@example.com",
      To: "A@example.com",
      Cc: undefined,
      Bcc: undefined,
      ReplyTo: undefined,
      Subject: "Hi",
      HtmlBody: undefined,
      TextBody: "Hi",
      Tag: "welcome",
      Headers: [],
      Attachments: [],
      Metadata: {},
      TrackOpens: undefined,
      TrackLinks: undefined,
      MessageStream: undefined,
    };
    await submitOutbound(runtime, {
      auth: { kind: "server", server },
      channel: "rest",
      draft,
      request: { To: "A@example.com" },
      bulkRequestId: null,
      templateId: null,
    });
    const list = async (qs: string) =>
      ((await (await control.request(`/control/messages${qs}`)).json()) as { Messages: unknown[] })
        .Messages;
    expect(await list("?to=a@example.com&tag=welcome&channel=rest")).toMatchObject([
      { MessageStream: "outbound", Channel: "rest", Request: { To: "A@example.com" } },
    ]);
    expect(await list("?channel=smtp")).toEqual([]);
    expect((await control.request("/control/messages?channel=fax")).status).toBe(400);
  });
});

it("answers an unknown control route with 404 JSON", async () => {
  const res = await (await setup()).control.request("/control/nope");
  expect(res.status).toBe(404);
});
