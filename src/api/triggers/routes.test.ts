import { describe, expect, it } from "vitest";
import { createRuntime } from "../../runtime.ts";
import { createServer } from "../../state/servers.ts";
import { apiClient } from "../../webhooks/test-api.ts";

function setup() {
  const runtime = createRuntime([]);
  createServer(runtime.store, runtime.clock.now(), { ApiTokens: ["token"] });
  return apiClient(runtime, "token");
}

describe("inbound rule triggers API", () => {
  it("creates, lists a page with TotalCount, and deletes", async () => {
    const api = setup();
    const a = await api("POST", "/triggers/inboundRules", { Rule: "spam.example.com" });
    await api("POST", "/triggers/inboundrules/", { rule: "someone@example.com" });
    expect(a.json).toEqual({ ID: 1, Rule: "spam.example.com" });
    const page = await api("GET", "/triggers/inboundRules?count=1&offset=1");
    expect(page.json).toEqual({
      TotalCount: 2,
      InboundRules: [{ ID: 2, Rule: "someone@example.com" }],
    });
    expect((await api("DELETE", "/triggers/inboundRules/1")).json).toEqual({
      ErrorCode: 0,
      Message: "Rule spam.example.com removed.",
    });
    expect((await api("DELETE", "/triggers/inboundRules/1")).json.ErrorCode).toBe(812);
  });

  it.each<[string, string, string, unknown, number]>([
    ["list without count", "GET", "/triggers/inboundrules?offset=0", undefined, 800],
    ["list over 500", "GET", "/triggers/inboundrules?count=501&offset=0", undefined, 800],
    ["create without body", "POST", "/triggers/inboundrules", undefined, 809],
  ])("%s answers %i", async (_, method, path, body, code) => {
    const res = await setup()(method, path, body);
    expect(res.json.ErrorCode).toBe(code);
  });

  it("refuses a duplicate rule with 810", async () => {
    const api = setup();
    await api("POST", "/triggers/inboundrules", { Rule: "a@example.com" });
    expect(
      (await api("POST", "/triggers/inboundrules", { Rule: "A@example.com" })).json.ErrorCode,
    ).toBe(810);
  });
});
