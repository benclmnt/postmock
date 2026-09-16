import { describe, expect, it } from "vitest";
import { applySeed } from "../../src/control/seed.ts";
import { createApiApp } from "../../src/http/app.ts";
import { createRuntime } from "../../src/runtime.ts";
import { Clock } from "../../src/state/clock.ts";
import { formatEasternDate } from "../../src/time.ts";
import { READ_SERVER } from "../lib/read-server.ts";

// The read suites need this history (sdk/postmark-dotnet/src/Postmark.Tests/
// ClientMessageSearchingTests.cs, ClientStatisticsTests.cs, ClientMessage*QueryTests.cs).

const NOW = Date.parse("2026-09-17T16:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const runtime = createRuntime();
  runtime.clock = new Clock(() => NOW);
  await applySeed(runtime, "conformance");
  const api = createApiApp(runtime);
  return async (path: string) => {
    const res = await api.request(path, {
      headers: { "X-Postmark-Server-Token": READ_SERVER.token },
    });
    expect(res.status).toBe(200);
    // biome-ignore lint/suspicious/noExplicitAny: a test reads response JSON loosely
    return (await res.json()) as any;
  };
}

describe("conformance message history", () => {
  it("has 51 sent messages, tagged ones, 10 processed inbound, opens and clicks", async () => {
    const get = await setup();
    expect((await get("/messages/outbound?count=33&offset=0&status=sent")).Messages).toHaveLength(
      33,
    );
    expect((await get("/messages/outbound?count=1&offset=50")).Messages).toHaveLength(1);
    expect((await get("/messages/inbound?count=10&offset=0")).InboundMessages).toHaveLength(10);
    expect(
      (await get("/messages/outbound?count=20&offset=0&tag=test_tag")).TotalCount,
    ).toBeGreaterThan(0);
    expect((await get("/messages/inbound?count=10&offset=0")).TotalCount).toBeGreaterThan(0);
    expect((await get("/messages/outbound/opens?count=10&offset=0")).TotalCount).toBeGreaterThan(0);
    expect((await get("/messages/outbound/clicks?count=10&offset=0")).TotalCount).toBeGreaterThan(
      0,
    );
  });

  it("gives every overview count the dotnet test reads", async () => {
    const get = await setup();
    const overview = await get("/stats/outbound");
    for (const key of [
      "Bounced",
      "BounceRate",
      "Opens",
      "Sent",
      "SMTPApiErrors",
      "Tracked",
      "UniqueOpens",
      "WithClientRecorded",
      "WithPlatformRecorded",
      "WithReadTimeRecorded",
    ]) {
      expect([key, overview[key] > 0]).toEqual([key, true]);
    }
  });

  it("makes the dotnet stats windows decrease strictly", async () => {
    const get = await setup();
    const day = (daysAgo: number) => formatEasternDate(new Date(NOW - daysAgo * DAY));
    const sent = async (q: string) => (await get(`/stats/outbound?${q}`)).Sent as number;
    const counts = [
      await sent(""),
      await sent(`todate=${day(30)}`),
      await sent(`fromdate=${day(35)}&todate=${day(30)}`),
      await sent(`tag=test_tag&fromdate=${day(35)}&todate=${day(30)}`),
    ];
    expect(counts[3]).toBeGreaterThan(0);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(new Set(counts).size).toBe(4);
  });
});
