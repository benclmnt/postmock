import { describe, expect, it } from "vitest";
import { applySeed } from "../src/control/seed.ts";
import { createApiApp } from "../src/http/app.ts";
import { createRuntime } from "../src/runtime.ts";
import { CONFORMANCE } from "./lib/conformance.ts";

describe("server seed", () => {
  it("sends from example.com and holds no mail history", async () => {
    const runtime = createRuntime();
    await applySeed(runtime, "server");
    const res = await createApiApp(runtime).request("/email", {
      method: "POST",
      headers: { "X-Postmark-Server-Token": CONFORMANCE.serverToken },
      body: JSON.stringify({
        From: CONFORMANCE.senderEmail,
        To: CONFORMANCE.recipientEmail,
        TextBody: "Hi",
      }),
    });
    expect(res.status).toBe(200);
    const { state } = runtime.store;
    expect(state.outbound.size).toBe(1);
    expect(state.bounces.size).toBe(0);
    expect(state.suppressions.size).toBe(0);
  });
});
