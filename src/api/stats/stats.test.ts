import { describe, expect, it } from "vitest";
import { pastBounce, pastSend, pastSmtpApiError } from "../../../seeds/lib/history.ts";
import { createApiApp } from "../../http/app.ts";
import { createRuntime } from "../../runtime.ts";
import { Clock } from "../../state/clock.ts";
import { createServer } from "../../state/servers.ts";
import type { OutboundMessage } from "../../state/types.ts";
import { recordClick, recordDelivery, recordOpen } from "../../tracking.ts";

// biome-ignore lint/suspicious/noExplicitAny: a test reads response JSON loosely
type Json = any;

// 2026-06-15T16:00Z is noon in New York (EDT).
const NOW = Date.parse("2026-06-15T16:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const TOKEN = "stats-token";

function setup() {
  const runtime = createRuntime();
  runtime.clock = new Clock(() => NOW);
  const server = createServer(runtime.store, runtime.clock.now(), { ApiTokens: [TOKEN] });
  const api = createApiApp(runtime);
  const get = async (path: string) => {
    const res = await api.request(path, { headers: { "X-Postmark-Server-Token": TOKEN } });
    return { status: res.status, body: (await res.json()) as Json };
  };
  const sendOnly = (at: number, fields: Partial<OutboundMessage> = {}) =>
    pastSend(runtime, {
      ServerID: server.ID,
      ReceivedAt: new Date(at),
      To: [{ Email: "a@example.com", Name: null }],
      TrackOpens: true,
      TrackLinks: "TextOnly",
      TextBody: "Go https://example.com/1 or https://example.com/2",
      ...fields,
    });
  const send = async (at: number, fields: Partial<OutboundMessage> = {}) => {
    const m = await sendOnly(at, fields);
    const delivered = new Date(at + 60000);
    await recordDelivery(
      runtime,
      { messageId: m.MessageID, recipient: "a@example.com", details: "ok" },
      delivered,
    );
    return m;
  };
  const agent = {
    UserAgent: "UA",
    Client: { Name: "Apple Mail 16", Company: "Apple", Family: "Apple Mail" },
    OS: null,
    Platform: "Mobile" as const,
    Geo: null,
  };
  const open = (m: OutboundMessage, at: number, recipient = "a@example.com") =>
    recordOpen(runtime, { messageId: m.MessageID, recipient, agent, readSeconds: 4 }, new Date(at));
  const click = (m: OutboundMessage, at: number, link = "https://example.com/1") =>
    recordClick(
      runtime,
      { messageId: m.MessageID, recipient: "a@example.com", link, location: "Text", agent },
      new Date(at),
    );
  return { runtime, get, send, open, click };
}

describe("an empty server", () => {
  it("answers every documented total as 0 and no days", async () => {
    const { get } = setup();
    expect((await get("/stats/outbound/sends")).body).toEqual({ Days: [], Sent: 0 });
    expect((await get("/stats/outbound/bounces")).body).toEqual({
      Days: [],
      HardBounce: 0,
      SMTPApiError: 0,
      SoftBounce: 0,
      Transient: 0,
    });
    expect((await get("/stats/outbound/opens/emailClients")).body).toEqual({ Days: [] });
    expect((await get("/stats/outbound")).body).toMatchObject({ Sent: 0, BounceRate: 0 });
  });
});

describe("counts", () => {
  it("counts a send once per recipient, omits empty days and zero keys", async () => {
    const { get, send } = setup();
    await send(NOW - 2 * DAY, { Cc: [{ Email: "b@example.com", Name: null }] });
    await send(NOW, { TrackOpens: false, TrackLinks: "None" });
    expect((await get("/stats/outbound/sends")).body).toEqual({
      Days: [
        { Date: "2026-06-13", Sent: 2 },
        { Date: "2026-06-15", Sent: 1 },
      ],
      Sent: 3,
    });
    expect((await get("/stats/outbound/tracked")).body).toEqual({
      Days: [{ Date: "2026-06-13", Tracked: 2 }],
      Tracked: 2,
    });
  });

  it("keeps SMTP API errors out of Bounced and cuts rates to 3 decimals", async () => {
    const { get, send, runtime } = setup();
    const messages = [];
    for (let i = 0; i < 3; i++) messages.push(await send(NOW - DAY));
    const at = new Date(NOW - DAY);
    await pastBounce(runtime, messages[0] as OutboundMessage, { id: 1, type: "HardBounce", at });
    await pastBounce(runtime, messages[1] as OutboundMessage, { id: 2, type: "SoftBounce", at });
    await pastSmtpApiError(runtime, {
      id: 3,
      serverId: messages[0]?.ServerID as number,
      stream: "outbound",
      email: "a@example.com",
      tag: null,
      at,
    });
    expect((await get("/stats/outbound")).body).toMatchObject({
      Sent: 3,
      Bounced: 2,
      SMTPApiErrors: 1,
      BounceRate: 66.666,
      TotalTrackedLinksSent: 6,
    });
    expect((await get("/stats/outbound/bounces")).body.Days).toEqual([
      { Date: "2026-06-14", HardBounce: 1, SMTPApiError: 1, SoftBounce: 1 },
    ]);
  });

  it("counts unique opens and clicks on the day of the first one", async () => {
    const { get, send, open, click } = setup();
    const m = await send(NOW - 3 * DAY);
    await open(m, NOW - 2 * DAY);
    await open(m, NOW - DAY);
    await click(m, NOW - 2 * DAY);
    await click(m, NOW - DAY);
    await click(m, NOW - DAY, "https://example.com/2");
    expect((await get("/stats/outbound/opens")).body).toEqual({
      Days: [
        { Date: "2026-06-13", Opens: 1, Unique: 1 },
        { Date: "2026-06-14", Opens: 1 },
      ],
      Opens: 2,
      Unique: 1,
    });
    expect((await get("/stats/outbound/clicks")).body).toMatchObject({ Clicks: 3, Unique: 2 });
    const later = await get("/stats/outbound/opens?fromdate=2026-06-14");
    expect(later.body).toMatchObject({ Opens: 1, Unique: 0 });
    expect((await get("/stats/outbound/opens/platforms")).body).toMatchObject({
      Desktop: 0,
      Mobile: 1,
      Unknown: 0,
      WebMail: 0,
    });
    expect((await get("/stats/outbound/opens/emailclients")).body).toMatchObject({
      "Apple Mail": 1,
    });
    expect((await get("/stats/outbound/clicks/location")).body).toMatchObject({ HTML: 0, Text: 3 });
    expect((await get("/stats/outbound")).body).toMatchObject({
      Opens: 2,
      UniqueOpens: 1,
      TotalClicks: 3,
      UniqueLinksClicked: 2,
      WithClientRecorded: 1,
      WithPlatformRecorded: 1,
      WithReadTimeRecorded: 1,
    });
  });

  it("keeps counting messages that left the Messages API retention", async () => {
    const { get, send } = setup();
    await send(NOW - 200 * DAY);
    expect((await get("/stats/outbound/sends")).body.Sent).toBe(1);
    expect((await get("/messages/outbound?count=1&offset=0")).body.TotalCount).toBe(0);
  });
});

describe("filters", () => {
  it("filters by inclusive Eastern days, tag and stream", async () => {
    const { get, send } = setup();
    // 03:00Z on June 14 is 23:00 on June 13 in New York.
    await send(Date.parse("2026-06-14T03:00:00Z"), { Tag: "t" });
    await send(Date.parse("2026-06-14T12:00:00Z"));
    await send(Date.parse("2026-06-14T12:00:00Z"), { MessageStream: "broadcast" });
    const sent = async (q: string) => (await get(`/stats/outbound/sends?${q}`)).body.Sent;
    expect(await sent("fromdate=2026-06-13&todate=2026-6-13")).toBe(1);
    expect(await sent("fromDate=2026-06-14")).toBe(2);
    expect(await sent("tag=t")).toBe(1);
    expect(await sent("messageStream=broadcast")).toBe(1);
  });

  it.each([
    ["fromdate=bad", 900],
    ["todate=2026-02-30", 900],
    ["messagestream=nope", 1226],
    ["fromdate=2025-06-14", 1500],
    ["fromdate=2026-06-10&todate=2026-06-09", 1502],
  ])("rejects %s with ErrorCode %i", async (q, code) => {
    const { get } = setup();
    const res = await get(`/stats/outbound/opens?${q}`);
    expect([res.status, res.body.ErrorCode]).toEqual([422, code]);
  });
});

it("answers 501 for read times, whose body no doc gives", async () => {
  const { runtime } = setup();
  const res = await createApiApp(runtime).request("/stats/outbound/opens/readtimes", {
    headers: { "X-Postmark-Server-Token": TOKEN },
  });
  expect(res.status).toBe(501);
});
