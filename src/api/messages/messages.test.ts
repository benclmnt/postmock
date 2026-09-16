import { describe, expect, it } from "vitest";
import { pastInbound, pastSend } from "../../../seeds/lib/history.ts";
import { createControlApp } from "../../control/app.ts";
import { createApiApp } from "../../http/app.ts";
import { createRuntime } from "../../runtime.ts";
import { Clock } from "../../state/clock.ts";
import { createServer } from "../../state/servers.ts";
import type { OutboundMessage } from "../../state/types.ts";

// biome-ignore lint/suspicious/noExplicitAny: a test reads response JSON loosely
type Json = any;

const NOW = Date.parse("2026-03-10T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const TOKEN = "messages-token";

function setup() {
  const runtime = createRuntime();
  runtime.clock = new Clock(() => NOW);
  const server = createServer(runtime.store, runtime.clock.now(), { ApiTokens: [TOKEN] });
  const other = createServer(runtime.store, runtime.clock.now(), { ApiTokens: ["other"] });
  const api = createApiApp(runtime);
  const control = createControlApp(runtime, "empty");
  const call = async (method: string, path: string) => {
    const res = await api.request(path, { method, headers: { "X-Postmark-Server-Token": TOKEN } });
    return { status: res.status, body: (await res.json()) as Json };
  };
  const get = (path: string) => call("GET", path);
  const post = async (path: string, body: unknown) => {
    const res = await control.request(path, { method: "POST", body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Json };
  };
  const send = (fields: Partial<OutboundMessage> & { daysAgo?: number } = {}) => {
    const { daysAgo = 1, ...rest } = fields;
    return pastSend(runtime, {
      ServerID: server.ID,
      ReceivedAt: new Date(NOW - daysAgo * DAY),
      To: [{ Email: "reader@example.com", Name: null }],
      ...rest,
    });
  };
  return { runtime, server, other, call, get, post, send };
}

const ids = (body: { Messages: Array<{ MessageID: string }> }) =>
  body.Messages.map((m) => m.MessageID);

describe("paging (docs/06 §1.1, §5.4)", () => {
  it.each([
    ["offset=0", "count missing"],
    ["count=0&offset=0", "count below 1"],
    ["count=501&offset=0", "count above 500"],
    ["count=x&offset=0", "count not an integer"],
    ["count=10", "offset missing"],
    ["count=10&offset=-1", "negative offset"],
    ["count=500&offset=9501", "count + offset above 10 000"],
  ])("rejects %s (%s) with 422 / 700 on every list", async (paging) => {
    const { get, send } = setup();
    const message = await send();
    for (const path of [
      "/messages/outbound",
      "/messages/inbound",
      "/messages/outbound/opens",
      "/messages/outbound/clicks",
      `/messages/outbound/opens/${message.MessageID}`,
      `/messages/outbound/clicks/${message.MessageID}`,
    ]) {
      const res = await get(`${path}?${paging}`);
      expect([path, res.status, res.body.ErrorCode]).toEqual([path, 422, 700]);
    }
  });

  it("accepts the last page below the cap and counts every match", async () => {
    const { get, send } = setup();
    for (let i = 0; i < 3; i++) await send({ daysAgo: i + 1 });
    const res = await get("/messages/outbound?count=500&offset=9500");
    expect(res.body).toEqual({ TotalCount: 3, Messages: [] });
    const page = await get("/messages/outbound?count=2&offset=1");
    expect(page.body.TotalCount).toBe(3);
    expect(page.body.Messages).toHaveLength(2);
  });
});

describe("GET /messages/outbound", () => {
  it("filters by recipient, fromemail, tag, subject, status, stream and metadata", async () => {
    const { get, send } = setup();
    const plain = await send({ daysAgo: 2 });
    const rich = await send({
      From: '"Shop" <Shop@Example.com>',
      Cc: [{ Email: "copy@example.com", Name: null }],
      Tag: "welcome",
      Subject: "Your Order #5",
      Metadata: { color: "blue" },
    });
    const queued = await send({ Status: "Queued" });
    await send({ MessageStream: "broadcast" });
    const q = (filter: string) => get(`/messages/outbound?count=50&offset=0&${filter}`);
    expect(ids((await q("recipient=COPY@example.com")).body)).toEqual([rich.MessageID]);
    expect(ids((await q("fromEmail=shop@example.com")).body)).toEqual([rich.MessageID]);
    expect(ids((await q("tag=welcome")).body)).toEqual([rich.MessageID]);
    expect(ids((await q("subject=order")).body)).toEqual([rich.MessageID]);
    expect(ids((await q("metadata_color=blue")).body)).toEqual([rich.MessageID]);
    expect(ids((await q("status=queued")).body)).toEqual([queued.MessageID]);
    expect(new Set(ids((await q("status=sent")).body))).toEqual(
      new Set([plain.MessageID, rich.MessageID]),
    );
    expect((await q("messageStream=broadcast")).body.TotalCount).toBe(1);
    expect((await q("status=gone")).body.ErrorCode).toBe(700);
  });

  it("reads inclusive Eastern dates; a date-only todate covers the whole day", async () => {
    const { get, send } = setup();
    // 2026-03-08T04:30Z is 23:30 on March 7 in New York (EST).
    const late = await send({ ReceivedAt: new Date("2026-03-08T04:30:00Z") });
    await send({ ReceivedAt: new Date("2026-03-09T12:00:00Z") });
    const res = await get(
      "/messages/outbound?count=10&offset=0&fromdate=2026-03-07&todate=2026-03-07",
    );
    expect(ids(res.body)).toEqual([late.MessageID]);
    expect((await get("/messages/outbound?count=1&offset=0&todate=nope")).body.ErrorCode).toBe(700);
  });

  it("lists newest first, hides other servers and messages past the 45-day retention", async () => {
    const { runtime, other, get, send } = setup();
    const older = await send({ daysAgo: 3 });
    const newer = await send({ daysAgo: 1 });
    await send({ daysAgo: 46 });
    await pastSend(runtime, {
      ServerID: other.ID,
      ReceivedAt: new Date(NOW),
      To: [{ Email: "x@example.com", Name: null }],
    });
    const res = await get("/messages/outbound?count=10&offset=0");
    expect(ids(res.body)).toEqual([newer.MessageID, older.MessageID]);
    expect(res.body.Messages[0]).toMatchObject({
      Tag: "",
      Recipients: ["reader@example.com"],
      ReceivedAt: "2026-03-09T11:00:00.0000000-04:00",
      Status: "Sent",
    });
  });

  it("answers 501 for two metadata filters, whose Postmark answer is unknown", async () => {
    const { runtime } = setup();
    const res = await createApiApp(runtime).request(
      "/messages/outbound?count=1&offset=0&metadata_a=1&metadata_b=2",
      { headers: { "X-Postmark-Server-Token": TOKEN } },
    );
    expect(res.status).toBe(501);
  });
});

describe("details and dump", () => {
  it("returns bodies, raw source and message events", async () => {
    const { get, post, send } = setup();
    const message = await send({ TextBody: "Hi", TrackOpens: true });
    await post("/control/events/delivery", {
      messageId: message.MessageID,
      recipient: "reader@example.com",
    });
    const details = await get(`/messages/outbound/${message.MessageID}/details`);
    expect(details.body).toMatchObject({
      TextBody: "Hi",
      HtmlBody: "",
      Body: message.rawSource,
      MessageID: message.MessageID,
      MessageEvents: [
        {
          Recipient: "reader@example.com",
          Type: "Delivered",
          Details: { DeliveryMessage: "smtp;250 2.0.0 OK" },
        },
      ],
    });
    const dump = await get(`/messages/outbound/${message.MessageID}/dump`);
    expect(dump.body).toEqual({ Body: message.rawSource });
  });

  it("answers 422 / 701 with 'not found' for an unknown, foreign or expired message", async () => {
    const { runtime, other, get, send } = setup();
    const expired = await send({ daysAgo: 46 });
    const foreign = await pastSend(runtime, {
      ServerID: other.ID,
      ReceivedAt: new Date(NOW),
      To: [{ Email: "x@example.com", Name: null }],
    });
    for (const id of ["nope", expired.MessageID, foreign.MessageID]) {
      for (const tail of ["details", "dump"]) {
        const res = await get(`/messages/outbound/${id}/${tail}`);
        expect(res.status).toBe(422);
        expect(res.body.ErrorCode).toBe(701);
        expect(res.body.Message).toMatch(/not found/);
      }
    }
  });
});

describe("inbound", () => {
  it("lists processed messages by default and filters by status", async () => {
    const { runtime, server, get } = setup();
    const at = (d: number) => new Date(NOW - d * DAY);
    const processed = pastInbound(runtime, {
      ServerID: server.ID,
      ReceivedAt: at(1),
      Status: "Processed",
    });
    const blocked = pastInbound(runtime, {
      ServerID: server.ID,
      ReceivedAt: at(2),
      Status: "Blocked",
    });
    const all = await get("/messages/inbound?count=10&offset=0");
    expect(all.body.TotalCount).toBe(1);
    expect(all.body.InboundMessages[0].MessageID).toBe(processed.MessageID);
    const res = await get("/messages/inbound?count=10&offset=0&status=blocked");
    expect(res.body.InboundMessages.map((m: { MessageID: string }) => m.MessageID)).toEqual([
      blocked.MessageID,
    ]);
    const details = await get(`/messages/inbound/${blocked.MessageID}/details`);
    expect(details.body).toMatchObject({ Status: "Blocked", BlockedReason: blocked.BlockedReason });
  });

  it("bypasses a blocked message once and fires inboundReceived", async () => {
    const { runtime, server, call } = setup();
    const blocked = pastInbound(runtime, {
      ServerID: server.ID,
      ReceivedAt: new Date(NOW),
      Status: "Blocked",
    });
    const received: string[] = [];
    runtime.events.on("inboundReceived", ({ message }) => {
      received.push(message.MessageID);
    });
    const res = await call("PUT", `/messages/inbound/${blocked.MessageID}/bypass`);
    expect(res.body).toEqual({
      ErrorCode: 0,
      Message: `Successfully bypassed message: ${blocked.MessageID}.`,
    });
    expect(received).toEqual([blocked.MessageID]);
    const again = await call("PUT", `/messages/inbound/${blocked.MessageID}/bypass`);
    expect([again.status, again.body.ErrorCode]).toEqual([422, 701]);
    const retry = await call("PUT", `/messages/inbound/${blocked.MessageID}/retry`);
    expect([retry.status, retry.body.ErrorCode]).toEqual([422, 701]);
  });
});

describe("opens and clicks", () => {
  const tracked = {
    TrackOpens: true,
    TrackLinks: "HtmlOnly" as const,
    HtmlBody: '<a href="https://example.com/a">a</a>',
  };

  it("keeps the first open per recipient and omits unknown client fields", async () => {
    const { get, post, send } = setup();
    const message = await send(tracked);
    const target = { messageId: message.MessageID, recipient: "READER@example.com" };
    const first = await post("/control/events/open", { ...target, platform: "Desktop" });
    const second = await post("/control/events/open", target);
    expect([first.body.FirstOpen, second.body.FirstOpen]).toEqual([true, false]);
    const list = await get("/messages/outbound/opens?count=10&offset=0");
    expect(list.body.TotalCount).toBe(1);
    expect(list.body.Opens[0]).toEqual({
      RecordType: "Open",
      Platform: "Desktop",
      UserAgent: "Mozilla/5.0 (postmock)",
      MessageID: message.MessageID,
      MessageStream: "outbound",
      ReceivedAt: "2026-03-10T11:00:00.0000000-04:00",
      Tag: "",
      Recipient: "reader@example.com",
    });
    const single = await get(`/messages/outbound/opens/${message.MessageID}?count=10&offset=0`);
    expect(single.body.TotalCount).toBe(1);
    expect(single.body.Opens[0]).not.toHaveProperty("RecordType");
  });

  it("filters opens by client and platform without case", async () => {
    const { get, post, send } = setup();
    const message = await send(tracked);
    await post("/control/events/open", {
      messageId: message.MessageID,
      recipient: "reader@example.com",
      client: { name: "Outlook 2019", company: "Microsoft", family: "Outlook" },
      platform: "WebMail",
    });
    const q = (filter: string) => get(`/messages/outbound/opens?count=10&offset=0&${filter}`);
    expect((await q("client_family=outlook&platform=webmail")).body.TotalCount).toBe(1);
    expect((await q("clientName=Gmail")).body.TotalCount).toBe(0);
  });

  it("keeps one click per recipient and link", async () => {
    const { get, post, send } = setup();
    const message = await send(tracked);
    const click = {
      messageId: message.MessageID,
      recipient: "reader@example.com",
      link: "https://example.com/a",
      clickLocation: "HTML",
    };
    expect((await post("/control/events/click", click)).status).toBe(200);
    expect((await post("/control/events/click", click)).status).toBe(200);
    const list = await get("/messages/outbound/clicks?count=10&offset=0");
    expect(list.body.TotalCount).toBe(1);
    expect(list.body.Clicks[0]).toMatchObject({
      RecordType: "Click",
      ClickLocation: "HTML",
      OriginalLink: "https://example.com/a",
    });
  });
});
