import { afterEach, describe, expect, it } from "vitest";
import { createControlApp } from "../control/app.ts";
import webhooksPlugin from "../plugins/webhooks.ts";
import { createRuntime } from "../runtime.ts";
import { Clock } from "../state/clock.ts";
import { createServer } from "../state/servers.ts";
import { apiClient } from "../webhooks/test-api.ts";
import { startReceiver } from "../webhooks/test-receiver.ts";

const MINUTE = 60_000;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup(answer?: Parameters<typeof startReceiver>[0]) {
  const receiver = await startReceiver(answer);
  closers.push(receiver.close);
  // Real time stands still, so `advance` alone moves the clock and due times are exact.
  const runtime = createRuntime([webhooksPlugin], new Clock(() => 1_800_000_000_000));
  const server = createServer(runtime.store, runtime.clock.now(), {
    ApiTokens: ["token"],
    InboundHash: "abc123",
    InboundHookUrl: `${receiver.url}/inbound`,
  });
  const control = createControlApp(runtime, "empty");
  const inbound = async (body: unknown) => {
    const res = await control.request("http://control/control/inbound", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      json: (await res.json()) as {
        Messages: Array<{ MessageID: string; Status: string }>;
        error?: string;
      },
    };
  };
  const payloads = () =>
    receiver.received.map((r) => JSON.parse(r.body) as Record<string, unknown>);
  return { runtime, server, receiver, inbound, payloads, api: apiClient(runtime, "token") };
}

const mail = {
  from: { email: "alan@example.com", name: "Alan Turing" },
  to: [{ email: "abc123+ticket-7@inbound.postmarkapp.com", name: "Support" }],
  cc: ["katherine@example.com"],
  subject: "Saying Hello",
  text: "Hello text",
  html: "<p>Hello html</p>",
  headers: [{ name: "X-Custom", value: "1" }],
  attachments: [
    {
      name: "a.txt",
      content: Buffer.from("attached").toString("base64"),
      contentType: "text/plain",
    },
  ],
};

describe("inbound", () => {
  it("parses a received mail into the inbound payload and posts it to InboundHookUrl", async () => {
    const { runtime, inbound, payloads } = await setup();
    const res = await inbound({ ...mail, spamScore: -0.1, spamTests: ["SPF_PASS"] });
    expect(res.json.Messages).toMatchObject([{ Status: "Processed" }]);
    const [payload] = payloads();
    expect(payload).toMatchObject({
      FromName: "Alan Turing",
      MessageStream: "inbound",
      From: "alan@example.com",
      FromFull: { Email: "alan@example.com", Name: "Alan Turing", MailboxHash: "" },
      To: '"Support" <abc123+ticket-7@inbound.postmarkapp.com>',
      ToFull: [
        {
          Email: "abc123+ticket-7@inbound.postmarkapp.com",
          Name: "Support",
          MailboxHash: "ticket-7",
        },
      ],
      Cc: "katherine@example.com",
      CcFull: [{ Email: "katherine@example.com", Name: "", MailboxHash: "" }],
      Bcc: "",
      BccFull: [],
      OriginalRecipient: "abc123+ticket-7@inbound.postmarkapp.com",
      Subject: "Saying Hello",
      MessageID: res.json.Messages[0]?.MessageID,
      ReplyTo: "",
      MailboxHash: "ticket-7",
      Date: expect.stringMatching(/^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} \+0000$/),
      TextBody: "Hello text",
      HtmlBody: "<p>Hello html</p>",
      StrippedTextReply: "",
      Tag: "",
      Attachments: [
        {
          Name: "a.txt",
          Content: Buffer.from("attached").toString("base64"),
          ContentType: "text/plain",
          ContentLength: 8,
          ContentID: "",
        },
      ],
    });
    expect(payload?.Headers).toEqual(
      expect.arrayContaining([
        { Name: "X-Spam-Status", Value: "No" },
        { Name: "X-Spam-Score", Value: "-0.1" },
        { Name: "X-Spam-Tests", Value: "SPF_PASS" },
        { Name: "X-Custom", Value: "1" },
        { Name: "MIME-Version", Value: "1.0" },
      ]),
    );
    expect(payload?.Headers).not.toContainEqual(expect.objectContaining({ Name: "Subject" }));
    expect(payload).not.toHaveProperty("RawEmail");
    expect(payload).not.toHaveProperty("RecordType");
    expect(runtime.store.state.webhookAttempts[0]?.headers).not.toContainEqual(
      expect.objectContaining({ Name: "x-pm-retries-remaining" }),
    );
  });

  it("shows the inbound address as Bcc only when no To or Cc names it, and adds RawEmail when enabled", async () => {
    const { server, inbound, payloads } = await setup();
    server.RawEmailEnabled = true;
    await inbound({
      ...mail,
      to: ["someone@example.com"],
      cc: [],
      bcc: ["abc123@inbound.postmarkapp.com"],
    });
    const [payload] = payloads();
    expect(payload).toMatchObject({
      BccFull: [{ Email: "abc123@inbound.postmarkapp.com", Name: "", MailboxHash: "" }],
      Bcc: "abc123@inbound.postmarkapp.com",
      RawEmail: expect.stringContaining("Subject: Saying Hello"),
    });
    expect(payload?.RawEmail).not.toContain("abc123@inbound");
  });

  it("parses raw MIME with its envelope and strips the quoted part of a reply", async () => {
    const { inbound, payloads } = await setup();
    const mime = [
      "From: bob@example.com",
      "To: support@in.example.com",
      "Subject: Re: order",
      "Date: Thu, 5 Nov 2026 16:33:54 -0500",
      "In-Reply-To: <x@example.com>",
      "Content-Type: text/plain",
      "",
      "Ok, thanks!",
      "",
      "On Wed, Nov 4, 2026 at 9:00 AM Support wrote:",
      "> Your order shipped.",
      "",
    ].join("\r\n");
    const res = await inbound({ mime, rcptTo: ["abc123@inbound.postmarkapp.com"] });
    expect(res.status).toBe(200);
    expect(payloads()[0]).toMatchObject({
      Date: "Thu, 5 Nov 2026 16:33:54 -0500",
      StrippedTextReply: "Ok, thanks!",
      OriginalRecipient: "abc123@inbound.postmarkapp.com",
      BccFull: [{ Email: "abc123@inbound.postmarkapp.com" }],
    });
  });

  it("answers 400 when no server owns a recipient", async () => {
    const { inbound } = await setup();
    const res = await inbound({ ...mail, to: ["nobody@example.com"] });
    expect(res.status).toBe(400);
  });

  it("blocks a sender that matches an inbound rule until a bypass", async () => {
    const { runtime, inbound, payloads, api } = await setup();
    await api("POST", "/triggers/inboundrules", { Rule: "EXAMPLE.com" });
    const res = await inbound(mail);
    const id = res.json.Messages[0]?.MessageID;
    expect(res.json.Messages[0]?.Status).toBe("Blocked");
    expect(payloads()).toHaveLength(0);
    expect((await api("PUT", `/messages/inbound/${id}/retry`)).json.ErrorCode).toBe(701);
    expect((await api("PUT", `/messages/inbound/${id}/bypass`)).json).toEqual({
      ErrorCode: 0,
      Message: `Successfully bypassed message: ${id}.`,
    });
    expect(payloads()).toHaveLength(1);
    expect(runtime.store.state.inbound.get(id ?? "")?.Status).toBe("Processed");
  });

  it("blocks a spam score above a set threshold", async () => {
    const { server, inbound } = await setup();
    server.InboundSpamThreshold = 5;
    expect((await inbound({ ...mail, spamScore: 5 })).json.Messages[0]?.Status).toBe("Processed");
    expect((await inbound({ ...mail, spamScore: 5.1 })).json.Messages[0]?.Status).toBe("Blocked");
  });

  it("retries a 204 ten times over 10 h 21 min, then fails; a retry sends it again", async () => {
    const { runtime, inbound, receiver, api } = await setup(() => 204);
    const res = await inbound(mail);
    const id = res.json.Messages[0]?.MessageID ?? "";
    expect(runtime.store.state.inbound.get(id)?.Status).toBe("Scheduled");
    await runtime.clock.advance(621 * MINUTE - 1);
    expect(receiver.received).toHaveLength(10);
    await runtime.clock.advance(1);
    expect(receiver.received).toHaveLength(11);
    expect(runtime.store.state.inbound.get(id)?.Status).toBe("Failed");
    expect((await api("PUT", `/messages/inbound/${id}/retry`)).json.Message).toBe(
      `Successfully rescheduled failed message: ${id}.`,
    );
    expect(receiver.received).toHaveLength(12);
  });

  it("stops at a 403", async () => {
    const { runtime, inbound, receiver } = await setup(() => 403);
    const res = await inbound(mail);
    await runtime.clock.advance(24 * 60 * MINUTE);
    expect(receiver.received).toHaveLength(1);
    expect(res.json.Messages[0]?.Status).toBe("Failed");
  });

  it("lists each attempt in the control API delivery log", async () => {
    const { runtime, inbound, receiver } = await setup(() => 500);
    await inbound(mail);
    await runtime.clock.advance(MINUTE);
    const res = await createControlApp(runtime, "empty").request(
      "http://control/control/webhooks/attempts?recordType=Inbound&serverId=1",
    );
    const { Attempts } = (await res.json()) as { Attempts: Array<Record<string, unknown>> };
    expect(Attempts).toMatchObject([
      {
        WebhookID: null,
        Url: `${receiver.url}/inbound`,
        Attempt: 1,
        HttpStatus: 500,
        Result: "retry",
      },
      { Attempt: 2, HttpStatus: 500, Result: "retry" },
    ]);
    expect(Attempts[0]?.Body).toMatchObject({ Subject: "Saying Hello" });
    expect(Attempts[0]?.TraceID).toBe(Attempts[1]?.TraceID);
  });
});
