import nodemailer from "nodemailer";
import { afterEach, describe, expect, it } from "vitest";
import { CONFORMANCE } from "../../seeds/lib/conformance.ts";
import webhooksPlugin from "../plugins/webhooks.ts";
import { recipientsKit } from "../recipients/testkit.ts";
import { startPostmock } from "../server.ts";
import { startSmtp } from "../smtp/listener.ts";
import { startReceiver } from "./test-receiver.ts";

// The payloads T2 (bounces, suppressions) and T6 (SMTP) events produce, end to end.

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const ALL_TRIGGERS = {
  Bounce: { Enabled: true, IncludeContent: true },
  SpamComplaint: { Enabled: true, IncludeContent: true },
  SubscriptionChange: { Enabled: true },
};
const UTC_7 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/;

async function setup() {
  const receiver = await startReceiver();
  closers.push(receiver.close);
  const kit = await recipientsKit();
  const created = await kit.call("POST", "/webhooks", {
    Url: receiver.url,
    Triggers: ALL_TRIGGERS,
  });
  expect(created.status).toBe(200);
  const message = kit.deliver("to@example.com");
  const bodies = () => receiver.received.map((r) => JSON.parse(r.body) as Record<string, unknown>);
  return { ...kit, message, bodies };
}

describe("recipient events reach webhooks", () => {
  it("a hard bounce posts Bounce, then SubscriptionChange", async () => {
    const { controlPost, message, bodies } = await setup();
    const res = await controlPost("/control/bounces", {
      messageId: message.MessageID,
      recipient: "to@example.com",
      type: "HardBounce",
      details: "550 no such user",
      dump: "raw dump",
    });
    expect(bodies()).toEqual([
      {
        RecordType: "Bounce",
        MessageStream: "outbound",
        ID: res.body.ID,
        Type: "HardBounce",
        TypeCode: 1,
        Name: "Hard bounce",
        Tag: "welcome",
        MessageID: message.MessageID,
        Metadata: { a: "1" },
        ServerID: CONFORMANCE.serverId,
        Description: expect.any(String),
        Details: "550 no such user",
        Email: "to@example.com",
        From: CONFORMANCE.senderEmail,
        BouncedAt: expect.stringMatching(UTC_7),
        DumpAvailable: true,
        Inactive: true,
        CanActivate: true,
        Subject: "Hi",
        Content: "raw dump",
      },
      {
        RecordType: "SubscriptionChange",
        MessageID: message.MessageID,
        ServerID: CONFORMANCE.serverId,
        MessageStream: "outbound",
        ChangedAt: expect.stringMatching(UTC_7),
        Recipient: "to@example.com",
        Origin: "Recipient",
        SuppressSending: true,
        SuppressionReason: "HardBounce",
        Tag: "welcome",
        Metadata: { a: "1" },
      },
    ]);
  });

  it("a spam complaint posts SpamComplaint, then SubscriptionChange", async () => {
    const { controlPost, message, bodies } = await setup();
    await controlPost("/control/events/spam-complaint", {
      messageId: message.MessageID,
      recipient: "to@example.com",
    });
    expect(bodies()).toMatchObject([
      {
        RecordType: "SpamComplaint",
        Type: "SpamComplaint",
        TypeCode: 100001,
        Name: "Spam complaint",
        Inactive: true,
        CanActivate: false,
        Content: expect.stringContaining("Feedback-Type: abuse"),
      },
      { RecordType: "SubscriptionChange", SuppressionReason: "SpamComplaint", Origin: "Recipient" },
    ]);
  });

  it("a bounce activation posts a SubscriptionChange with the reactivation nulls", async () => {
    const { call, controlPost, message, bodies } = await setup();
    const res = await controlPost("/control/bounces", {
      messageId: message.MessageID,
      recipient: "to@example.com",
      type: "HardBounce",
    });
    expect((await call("PUT", `/bounces/${res.body.ID}/activate`)).status).toBe(200);
    expect(bodies().at(-1)).toEqual({
      RecordType: "SubscriptionChange",
      MessageID: null,
      ServerID: CONFORMANCE.serverId,
      MessageStream: "outbound",
      ChangedAt: expect.stringMatching(UTC_7),
      Recipient: "to@example.com",
      Origin: "Customer",
      SuppressSending: false,
      SuppressionReason: null,
      Tag: null,
      Metadata: {},
    });
  });
});

describe("SMTP API errors reach bounce hooks", () => {
  it("posts a Bounce payload of type SMTPApiError when the server enables it", async () => {
    const receiver = await startReceiver();
    closers.push(receiver.close);
    const postmock = await startPostmock({
      host: "127.0.0.1",
      apiPort: 0,
      controlPort: 0,
      seed: "conformance",
      plugins: [webhooksPlugin],
    });
    const smtp = await startSmtp(postmock.runtime, { host: "127.0.0.1", ports: [0], tls: null });
    closers.push(async () => {
      await smtp.close();
      await postmock.close();
    });
    const server = postmock.runtime.store.state.servers.get(CONFORMANCE.serverId);
    if (server === undefined) throw new Error("no conformance server");
    server.BounceHookUrl = receiver.url;
    server.EnableSmtpApiErrorHooks = true;

    await nodemailer
      .createTransport({
        host: "127.0.0.1",
        port: Number(new URL(smtp.url).port),
        secure: false,
        auth: { user: CONFORMANCE.serverToken, pass: CONFORMANCE.serverToken },
      })
      .sendMail({
        from: CONFORMANCE.senderEmail,
        to: "to@example.com",
        subject: "Bad",
        text: "Hi",
        headers: { "X-PM-TrackOpens": "maybe", "X-PM-Tag": "t" },
      });

    expect(receiver.received.map((r) => JSON.parse(r.body))).toMatchObject([
      {
        RecordType: "Bounce",
        Type: "SMTPApiError",
        TypeCode: 100007,
        Email: "to@example.com",
        Tag: "t",
        Subject: "Bad",
        ServerID: CONFORMANCE.serverId,
      },
    ]);
  });
});
