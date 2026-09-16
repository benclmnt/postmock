import { afterEach, describe, expect, it, vi } from "vitest";
import webhooksPlugin from "../plugins/webhooks.ts";
import { createRuntime, type Runtime } from "../runtime.ts";
import { Clock } from "../state/clock.ts";
import { newMessageId } from "../state/ids.ts";
import { createServer } from "../state/servers.ts";
import type {
  Bounce,
  OpenEvent,
  OutboundMessage,
  Webhook,
  WebhookTriggers,
} from "../state/types.ts";
import { startReceiver } from "./test-receiver.ts";

const MINUTE = 60_000;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const close of closers.splice(0)) await close();
});

async function setup(answer?: Parameters<typeof startReceiver>[0]) {
  const receiver = await startReceiver(answer);
  closers.push(receiver.close);
  // Real time stands still, so `advance` alone moves the clock and due times are exact.
  const runtime = createRuntime([webhooksPlugin], new Clock(() => 1_800_000_000_000));
  const server = createServer(runtime.store, runtime.clock.now(), { ApiTokens: ["token"] });
  return { runtime, server, receiver };
}

function addWebhook(
  runtime: Runtime,
  serverId: number,
  fields: Partial<Webhook>,
  triggers: Partial<WebhookTriggers> = {},
): Webhook {
  const off = { Enabled: false };
  const webhook: Webhook = {
    ID: runtime.store.nextId("webhook"),
    ServerID: serverId,
    Url: "",
    MessageStream: "outbound",
    Status: "verified",
    HttpAuth: null,
    HttpHeaders: [],
    Triggers: {
      Open: { ...off, PostFirstOpenOnly: false },
      Click: off,
      Delivery: off,
      Bounce: { ...off, IncludeContent: false },
      SpamComplaint: { ...off, IncludeContent: false },
      SubscriptionChange: off,
      ...triggers,
    },
    ...fields,
  };
  runtime.store.state.webhooks.set(webhook.ID, webhook);
  return webhook;
}

const message = (serverId: number): OutboundMessage =>
  ({
    MessageID: newMessageId(),
    ServerID: serverId,
    MessageStream: "outbound",
    Tag: null,
    Metadata: { order: "42" },
  }) as unknown as OutboundMessage;

const deliver = (runtime: Runtime, serverId: number) =>
  runtime.events.emit("delivered", {
    message: message(serverId),
    recipient: "to@example.com",
    deliveredAt: new Date("2026-11-05T16:33:54.907Z"),
    details: "250 OK",
  });

const bounce = (serverId: number, fields: Partial<Bounce> = {}): Bounce => ({
  ID: 7,
  ServerID: serverId,
  MessageStream: "outbound",
  MessageID: newMessageId(),
  Type: "HardBounce",
  Tag: "welcome",
  Description: "The server was unable to deliver your message.",
  Details: "550 no such user",
  Email: "to@example.com",
  From: "from@example.com",
  Subject: "Hi",
  BouncedAt: new Date("2026-11-05T16:33:54.907Z"),
  Inactive: true,
  CanActivate: true,
  Content: "dump",
  Metadata: {},
  ...fields,
});

describe("webhook emitter", () => {
  it("POSTs a Delivery event to the verified row with the trigger on and to the server hook URL", async () => {
    const { runtime, server, receiver } = await setup();
    const delivery = { Delivery: { Enabled: true } };
    const addRow = (fields: Partial<Webhook>, triggers: Partial<WebhookTriggers> = delivery) =>
      addWebhook(runtime, server.ID, fields, triggers);
    addRow({
      Url: `${receiver.url}/row?token=abc`,
      HttpAuth: { Username: "user", Password: "pass" },
      HttpHeaders: [{ Name: "X-Custom", Value: "1" }],
    });
    addRow({ Url: `${receiver.url}/off` }, {});
    addRow({ Url: `${receiver.url}/unverified`, Status: "unverified" });
    addRow({ Url: `${receiver.url}/broadcast`, MessageStream: "broadcast" });
    server.DeliveryHookUrl = `${receiver.url.replace("http://", "http://legacy:secret@")}/legacy`;

    await deliver(runtime, server.ID);

    expect(receiver.received.map((r) => r.path)).toEqual(["/row?token=abc", "/legacy"]);
    const [row, legacy] = receiver.received;
    expect(row?.headers).toMatchObject({
      "content-type": "application/json",
      "x-custom": "1",
      "x-pm-retries-remaining": "6",
      authorization: `Basic ${Buffer.from("user:pass").toString("base64")}`,
    });
    expect(row?.headers["x-pm-webhook-trace-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(legacy?.headers.authorization).toBe(
      `Basic ${Buffer.from("legacy:secret").toString("base64")}`,
    );
    expect(JSON.parse(row?.body ?? "")).toEqual({
      RecordType: "Delivery",
      MessageStream: "outbound",
      ServerID: server.ID,
      MessageID: expect.any(String),
      Recipient: "to@example.com",
      Tag: "",
      DeliveredAt: "2026-11-05T16:33:54.9070000Z",
      Details: "250 OK",
      Metadata: { order: "42" },
    });
  });

  it("retries a 500 after 1, 5, 10, 10, 10 and 15 minutes with the same body and trace ID, then drops it", async () => {
    const { runtime, server, receiver } = await setup(() => 500);
    server.DeliveryHookUrl = receiver.url;
    await deliver(runtime, server.ID);
    const counts = [receiver.received.length];
    for (const minutes of [1, 5, 10, 10, 10, 15, 24 * 60]) {
      await runtime.clock.advance(minutes * MINUTE - 1);
      counts.push(receiver.received.length);
      await runtime.clock.advance(1);
      counts.push(receiver.received.length);
    }
    expect(counts).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7]);
    expect(receiver.received.map((r) => r.headers["x-pm-retries-remaining"])).toEqual([
      "6",
      "5",
      "4",
      "3",
      "2",
      "1",
      "0",
    ]);
    expect(new Set(receiver.received.map((r) => r.body)).size).toBe(1);
    expect(new Set(receiver.received.map((r) => r.headers["x-pm-webhook-trace-id"])).size).toBe(1);
    expect(runtime.store.state.webhookAttempts.map((a) => a.result)).toEqual([
      ...Array(6).fill("retry"),
      "exhausted",
    ]);
  });

  it.each([
    [204, "success", 1],
    [404, "stop", 1],
    [429, "retry", 2],
  ])("reads an outbound %i as %s", async (status, result, attempts) => {
    const { runtime, server, receiver } = await setup(() => status);
    server.DeliveryHookUrl = receiver.url;
    await deliver(runtime, server.ID);
    await runtime.clock.advance(MINUTE);
    expect(receiver.received).toHaveLength(attempts);
    expect(runtime.store.state.webhookAttempts[0]?.result).toBe(result);
  });

  it("retries an unreachable URL", async () => {
    const { runtime, server, receiver } = await setup();
    await receiver.close();
    server.DeliveryHookUrl = receiver.url;
    await deliver(runtime, server.ID);
    expect(runtime.store.state.webhookAttempts[0]).toMatchObject({
      outcome: { error: expect.any(String) },
      result: "retry",
    });
  });

  it("follows redirects up to 10 hops", async () => {
    const { runtime, server, receiver } = await setup((req) => {
      const hop = Number(req.path.slice(1));
      return hop < 3 ? { redirect: `/${hop + 1}` } : 200;
    });
    server.DeliveryHookUrl = `${receiver.url}/0`;
    await deliver(runtime, server.ID);
    expect(receiver.received.map((r) => r.path)).toEqual(["/0", "/1", "/2", "/3"]);
    expect(runtime.store.state.webhookAttempts[0]?.result).toBe("success");
  });

  it("retries after an eleventh redirect", async () => {
    const { runtime, server, receiver } = await setup(() => ({ redirect: "/again" }));
    server.DeliveryHookUrl = receiver.url;
    await deliver(runtime, server.ID);
    expect(receiver.received).toHaveLength(11);
    expect(runtime.store.state.webhookAttempts[0]).toMatchObject({
      outcome: { error: "more than 10 redirects" },
      result: "retry",
    });
  });

  it("adds bounce Content only for a hook that includes it", async () => {
    const { runtime, server, receiver } = await setup();
    addWebhook(
      runtime,
      server.ID,
      { Url: `${receiver.url}/with` },
      { Bounce: { Enabled: true, IncludeContent: true } },
    );
    server.BounceHookUrl = `${receiver.url}/without`;
    await runtime.events.emit("bounced", { bounce: bounce(server.ID) });
    const bodies = receiver.received.map((r) => JSON.parse(r.body));
    expect(bodies[0]).toMatchObject({
      RecordType: "Bounce",
      TypeCode: 1,
      Content: "dump",
      Tag: "welcome",
    });
    expect(bodies[1]).not.toHaveProperty("Content");
  });

  it("sends SMTP API errors to bounce hooks only with EnableSmtpApiErrorHooks", async () => {
    const { runtime, server, receiver } = await setup();
    server.BounceHookUrl = receiver.url;
    const error = bounce(server.ID, { Type: "SMTPApiError" });
    await runtime.events.emit("smtpApiError", { bounce: error });
    expect(receiver.received).toHaveLength(0);
    server.EnableSmtpApiErrorHooks = true;
    await runtime.events.emit("smtpApiError", { bounce: error });
    expect(JSON.parse(receiver.received[0]?.body ?? "")).toMatchObject({
      Type: "SMTPApiError",
      TypeCode: 100007,
    });
  });

  it("skips a repeat open for a hook with PostFirstOpenOnly", async () => {
    const { runtime, server, receiver } = await setup();
    server.OpenHookUrl = receiver.url;
    server.PostFirstOpenOnly = true;
    const open = {
      ServerID: server.ID,
      MessageStream: "outbound",
      FirstOpen: false,
      Client: null,
      OS: null,
      Platform: null,
      Geo: null,
      ReceivedAt: new Date(),
      Tag: null,
      Metadata: {},
    } as unknown as OpenEvent;
    await runtime.events.emit("opened", { open });
    await runtime.events.emit("opened", { open: { ...open, FirstOpen: true } });
    expect(receiver.received).toHaveLength(1);
    expect(JSON.parse(receiver.received[0]?.body ?? "")).not.toHaveProperty("Client");
  });

  it("refuses a host that is not loopback: no socket, an egress-refused attempt, no retry", async () => {
    const { runtime, server } = await setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    server.DeliveryHookUrl = "https://www.example.com/hook";
    await deliver(runtime, server.ID);
    await runtime.clock.advance(60 * MINUTE);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runtime.store.state.webhookAttempts).toMatchObject([
      {
        outcome: { error: expect.stringMatching(/^egress refused: host www\.example\.com/) },
        result: "stop",
      },
    ]);
  });

  it("refuses a redirect to a host that is not loopback", async () => {
    const { runtime, server, receiver } = await setup(() => ({
      redirect: "http://www.postmark.com/x",
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    server.DeliveryHookUrl = receiver.url;
    await deliver(runtime, server.ID);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(runtime.store.state.webhookAttempts[0]).toMatchObject({
      outcome: { error: expect.stringMatching(/^egress refused: host www\.postmark\.com/) },
      result: "stop",
    });
  });

  it("reaches a host listed in POSTMOCK_WEBHOOKS_ALLOW_HOSTS", async () => {
    vi.stubEnv("POSTMOCK_WEBHOOKS_ALLOW_HOSTS", " other.example , Hooks.Example.com");
    const { runtime, server } = await setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    server.DeliveryHookUrl = "https://hooks.example.com/hook";
    await deliver(runtime, server.ID);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://hooks.example.com/hook");
    expect(runtime.store.state.webhookAttempts[0]?.result).toBe("success");
  });

  it("stops retries once the webhook row is deleted", async () => {
    const { runtime, server, receiver } = await setup(() => 500);
    const webhook = addWebhook(
      runtime,
      server.ID,
      { Url: receiver.url },
      { Delivery: { Enabled: true } },
    );
    await deliver(runtime, server.ID);
    runtime.store.state.webhooks.delete(webhook.ID);
    await runtime.clock.advance(60 * MINUTE);
    expect(receiver.received).toHaveLength(1);
  });

  it("stops retries once the server is deleted", async () => {
    const { runtime, server, receiver } = await setup(() => 500);
    server.DeliveryHookUrl = receiver.url;
    await deliver(runtime, server.ID);
    runtime.store.state.servers.delete(server.ID);
    await runtime.clock.advance(60 * MINUTE);
    expect(receiver.received).toHaveLength(1);
  });
});
