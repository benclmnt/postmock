import { describe, expect, it } from "vitest";
import { createApiApp } from "../../http/app.ts";
import { createRuntime } from "../../runtime.ts";
import { createServer } from "../../state/servers.ts";

function setup() {
  const runtime = createRuntime([]);
  const server = createServer(runtime.store, runtime.clock.now(), { ApiTokens: ["token"] });
  createServer(runtime.store, runtime.clock.now(), {
    Name: "taken",
    InboundDomain: "in.example.com",
  });
  const app = createApiApp(runtime);
  const put = async (body: unknown) => {
    const res = await app.request("http://api.postmarkapp.com/server", {
      method: "PUT",
      headers: { "X-Postmark-Server-Token": "token" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  return { server, put };
}

describe("PUT /server", () => {
  it("changes the given fields, keeps null and absent ones, and answers the server", async () => {
    const { server, put } = setup();
    server.InboundHookUrl = "https://hooks.example.com/inbound";
    const res = await put({
      name: "renamed",
      Color: "Purple",
      BounceHookUrl: "https://hooks.example.com/bounce",
      InboundHookUrl: null,
      InboundSpamThreshold: 9,
      TrackLinks: "HtmlOnly",
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      Name: "renamed",
      Color: "purple",
      BounceHookUrl: "https://hooks.example.com/bounce",
      InboundHookUrl: "https://hooks.example.com/inbound",
      InboundSpamThreshold: 9,
      TrackLinks: "HtmlOnly",
    });
    expect(server.BounceHookUrl).toBe("https://hooks.example.com/bounce");
  });

  // The dotnet server test resets hook URLs to "" (ClientServerInformationTests.cs:87-94).
  it("clears a hook URL with an empty string", async () => {
    const { server, put } = setup();
    await put({ OpenHookUrl: "http://hooks.example.com/open" });
    const res = await put({ OpenHookUrl: "" });
    expect(res.json.OpenHookUrl).toBe("");
    expect(server.OpenHookUrl).toBe("");
  });

  it.each<[unknown, number]>([
    [undefined, 609],
    [{ Name: "taken" }, 603],
    [{ Color: "pink" }, 607],
    [{ ClickHookUrl: "ftp://example.com" }, 606],
    [{ InboundSpamThreshold: 31 }, 611],
    [{ TrackLinks: "Everything" }, 612],
    [{ InboundDomain: "IN.example.com" }, 602],
  ])("rejects %j with ErrorCode %i and changes nothing", async (body, code) => {
    const { server, put } = setup();
    const before = structuredClone(server);
    const res = await put(body);
    expect(res.status).toBe(422);
    expect(res.json.ErrorCode).toBe(code);
    expect(server).toEqual(before);
  });
});
