import { describe, expect, it } from "vitest";
import { createRuntime } from "../../runtime.ts";
import { createServer } from "../../state/servers.ts";
import { streamKey } from "../../state/store.ts";
import { apiClient } from "../../webhooks/test-api.ts";

function setup() {
  const runtime = createRuntime([]);
  const now = runtime.clock.now();
  const server = createServer(runtime.store, now, { ApiTokens: ["token"] });
  createServer(runtime.store, now, { ApiTokens: ["other"] });
  return { runtime, server, api: apiClient(runtime, "token"), other: apiClient(runtime, "other") };
}

describe("webhooks API", () => {
  it("creates with defaults: stream outbound, verified, every unnamed trigger off", async () => {
    const { api } = setup();
    const res = await api("POST", "/webhooks/", {
      url: "https://hooks.example.com/pm",
      Triggers: { Open: { Enabled: true }, Click: null },
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      ID: 1,
      Url: "https://hooks.example.com/pm",
      MessageStream: "outbound",
      Status: "verified",
      HttpAuth: null,
      HttpHeaders: [],
      Triggers: {
        Open: { Enabled: true, PostFirstOpenOnly: false },
        Click: { Enabled: false },
        Delivery: { Enabled: false },
        Bounce: { Enabled: false, IncludeContent: false },
        SpamComplaint: { Enabled: false, IncludeContent: false },
        SubscriptionChange: { Enabled: false },
      },
    });
  });

  it("edit changes only the given fields and triggers", async () => {
    const { api } = setup();
    const created = await api("POST", "/webhooks", {
      Url: "https://hooks.example.com/a",
      HttpAuth: { Username: "u", Password: "p" },
      HttpHeaders: [{ Name: "X-A", Value: "1" }],
      Triggers: { Bounce: { Enabled: true, IncludeContent: true }, Click: { Enabled: true } },
    });
    const edited = await api("PUT", `/webhooks/${created.json.ID}`, {
      Url: null,
      HttpHeaders: [],
      Triggers: { Click: { Enabled: false }, Bounce: null },
    });
    expect(edited.json).toMatchObject({
      Url: "https://hooks.example.com/a",
      HttpAuth: { Username: "u", Password: "p" },
      HttpHeaders: [],
      Triggers: { Click: { Enabled: false }, Bounce: { Enabled: true, IncludeContent: true } },
    });
    expect((await api("GET", `/webhooks/${created.json.ID}`)).json).toEqual(edited.json);
  });

  it("lists by server and filters by stream in either key case", async () => {
    const { runtime, server, api, other } = setup();
    const broadcast = runtime.store.state.streams.get(streamKey(server.ID, "broadcast"));
    if (broadcast === undefined) throw new Error("no broadcast stream");
    runtime.store.state.streams.set(streamKey(server.ID, "news"), { ...broadcast, ID: "news" });
    await api("POST", "/webhooks", { Url: "https://a.example.com" });
    await api("POST", "/webhooks", { Url: "https://b.example.com", MessageStream: "news" });
    await other("POST", "/webhooks", { Url: "https://c.example.com" });
    expect((await api("GET", "/webhooks")).json.Webhooks).toHaveLength(2);
    const filtered = await api("GET", "/webhooks?messageStream=news");
    expect(filtered.json.Webhooks).toMatchObject([{ Url: "https://b.example.com" }]);
  });

  it("deletes, then answers 1352 for the gone ID and for another server's webhook", async () => {
    const { api, other } = setup();
    const created = await api("POST", "/webhooks", { Url: "https://a.example.com" });
    expect((await other("GET", `/webhooks/${created.json.ID}`)).json.ErrorCode).toBe(1352);
    expect((await api("DELETE", `/webhooks/${created.json.ID}`)).json).toEqual({
      ErrorCode: 0,
      Message: `Webhook ${created.json.ID} removed.`,
    });
    expect((await api("GET", `/webhooks/${created.json.ID}`)).json.ErrorCode).toBe(1352);
  });

  it("saves Verify: false as unverified", async () => {
    const { api } = setup();
    const res = await api("POST", "/webhooks", { Url: "https://a.example.com", Verify: false });
    expect(res.json.Status).toBe("unverified");
  });

  it.each<[string, unknown, number]>([
    ["no body", undefined, 1355],
    ["no Url", { Triggers: {} }, 1354],
    ["a bad Url", { Url: "not a url" }, 1354],
    ["an ID", { ID: 5, Url: "https://a.example.com" }, 1356],
    ["a Status", { Url: "https://a.example.com", Status: "verified" }, 1363],
    [
      "a bad header name",
      { Url: "https://a.example.com", HttpHeaders: [{ Name: "a b", Value: "" }] },
      1358,
    ],
    ["an inbound stream", { Url: "https://a.example.com", MessageStream: "inbound" }, 1351],
    [
      "a wrongly typed field",
      { Url: "https://a.example.com", Triggers: { Open: { Enabled: "yes" } } },
      1361,
    ],
  ])("create with %s answers %i", async (_, body, code) => {
    const { api } = setup();
    const res = await api("POST", "/webhooks", body);
    expect(res.status).toBe(422);
    expect(res.json.ErrorCode).toBe(code);
  });

  it("edit refuses a MessageStream change with 1357", async () => {
    const { api } = setup();
    const created = await api("POST", "/webhooks", { Url: "https://a.example.com" });
    const res = await api("PUT", `/webhooks/${created.json.ID}`, { MessageStream: "broadcast" });
    expect(res.json.ErrorCode).toBe(1357);
  });

  it("answers 501 for a verification probe, whose body is not captured", async () => {
    const { api } = setup();
    const res = await api("POST", "/webhooks", { Url: "https://a.example.com", Verify: true });
    expect(res.status).toBe(501);
  });
});
