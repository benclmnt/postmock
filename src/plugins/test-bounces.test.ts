import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFORMANCE } from "../../seeds/lib/conformance.ts";
import { recipientsKit } from "../recipients/testkit.ts";
import { startPostmock } from "../server.ts";
import { startSmtp } from "../smtp/listener.ts";
import { startReceiver } from "../webhooks/test-receiver.ts";
import testBounces from "./test-bounces.ts";

type Header = { Name: string; Value: string };
const DOMAIN = "bounce-testing.postmarkapp.com";
const send = (fields: { To: string; Cc?: string; Bcc?: string; Headers?: Header[] }) => ({
  From: CONFORMANCE.senderEmail,
  Subject: "Hi",
  TextBody: "Hi",
  ...fields,
});

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function kit() {
  const k = await recipientsKit();
  const bouncesOf = async (messageId: string) =>
    (await k.call("GET", "/bounces?count=50&offset=0")).body.Bounces.filter(
      (b: { MessageID: string }) => b.MessageID === messageId,
    );
  return { ...k, bouncesOf };
}

describe("bounce-testing.postmarkapp.com", () => {
  it("answers the send first, then bounces and suppresses a HardBounce address", async () => {
    const { call, runtime, bouncesOf } = await kit();
    const to = `HardBounce@${DOMAIN}`;
    const sent = await call("POST", "/email", send({ To: to }));
    expect(sent.status).toBe(200);
    expect(await bouncesOf(sent.body.MessageID)).toEqual([]);
    await runtime.clock.advance(0);
    expect(await bouncesOf(sent.body.MessageID)).toEqual([
      expect.objectContaining({ Type: "HardBounce", Email: to, Inactive: true, CanActivate: true }),
    ]);
    expect((await call("POST", "/email", send({ To: to }))).body.ErrorCode).toBe(406);
  });

  it("takes the type from the header or the local part, without case or underscores", async () => {
    const { call, runtime, bouncesOf } = await kit();
    const typeOf = async (To: string, Headers: Header[] = []) => {
      const sent = await call("POST", "/email", send({ To, Headers }));
      await runtime.clock.advance(0);
      return (await bouncesOf(sent.body.MessageID)).map((b: { Type: string }) => b.Type);
    };
    expect(await typeOf(`soft_bounce@${DOMAIN}`)).toEqual(["SoftBounce"]);
    expect(
      await typeOf(`hardbounce@Bounce-Testing.postmarkapp.com`, [
        { Name: "X-PM-Bounce-Type", Value: "transient" },
      ]),
    ).toEqual(["Transient"]);
    expect(await typeOf(`spamcomplaint@${DOMAIN}`)).toEqual(["HardBounce"]);
    expect(await typeOf(`anyone@${DOMAIN}`)).toEqual(["HardBounce"]);
    expect(await typeOf("recipient@example.com")).toEqual([]);
  });

  it("bounces every Cc and Bcc recipient on the domain, and no other", async () => {
    const { call, runtime, bouncesOf } = await kit();
    const sent = await call(
      "POST",
      "/email",
      send({ To: "recipient@example.com", Cc: `softbounce@${DOMAIN}`, Bcc: `transient@${DOMAIN}` }),
    );
    await runtime.clock.advance(0);
    const bounces = await bouncesOf(sent.body.MessageID);
    expect(bounces.map((b: { Email: string; Type: string }) => [b.Email, b.Type]).sort()).toEqual([
      [`softbounce@${DOMAIN}`, "SoftBounce"],
      [`transient@${DOMAIN}`, "Transient"],
    ]);
  });

  it.each([
    ["an uncaptured type", `Blocked@${DOMAIN}`, []],
    [
      "an unknown header value",
      `hardbounce@${DOMAIN}`,
      [{ Name: "X-PM-Bounce-Type", Value: "nope" }],
    ],
  ])("answers 501 for %s and stores no message and no stat", async (_, To, Headers) => {
    const { call, runtime } = await kit();
    const { outbound, stats } = runtime.store.state;
    const before = { messages: outbound.size, stats: stats.length };
    expect((await call("POST", "/email", send({ To, Headers }))).status).toBe(501);
    const batch = await call("POST", "/email/batch", [
      send({ To: "recipient@example.com" }),
      send({ To, Headers }),
    ]);
    expect(batch.status).toBe(501);
    expect({ messages: outbound.size, stats: stats.length }).toEqual(before);
  });

  it("answers the captured 400 for an unknown sender before an uncaptured type", async () => {
    const { call, runtime } = await kit();
    const before = runtime.store.state.outbound.size;
    const res = await call("POST", "/email", {
      ...send({ To: `Blocked@${DOMAIN}` }),
      From: "probe@elsewhere.org",
    });
    expect(res.status).toBe(422);
    expect(res.body.ErrorCode).toBe(400);
    expect(res.body.Message).toContain("(probe@elsewhere.org) is not a Sender Signature");
    expect(runtime.store.state.outbound.size).toBe(before);
  });

  it("logs and skips a bounce whose effect became uncaptured after the send", async () => {
    const { call, runtime, bouncesOf } = await kit();
    const to = `hardbounce@${DOMAIN}`;
    const sent = await call("POST", "/email", send({ To: to }));
    const suppressed = await call("POST", "/message-streams/outbound/suppressions", {
      Suppressions: [{ EmailAddress: to }],
    });
    expect(suppressed.status).toBe(200);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await runtime.clock.advance(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`fake bounce for ${to} skipped`));
    log.mockRestore();
    expect(await bouncesOf(sent.body.MessageID)).toEqual([]);
  });

  it("fires the Bounce webhook", async () => {
    const receiver = await startReceiver();
    closers.push(receiver.close);
    const { call, runtime } = await kit();
    const hook = await call("POST", "/webhooks", {
      Url: receiver.url,
      Triggers: { Bounce: { Enabled: true } },
    });
    expect(hook.status).toBe(200);
    const sent = await call("POST", "/email", send({ To: `softbounce@${DOMAIN}` }));
    await runtime.clock.advance(0);
    expect(receiver.received.map((r) => JSON.parse(r.body))).toEqual([
      expect.objectContaining({
        RecordType: "Bounce",
        Type: "SoftBounce",
        MessageID: sent.body.MessageID,
      }),
    ]);
  });

  it("reads X-PM-Bounce-Type on SMTP", async () => {
    const postmock = await startPostmock({
      host: "127.0.0.1",
      apiPort: 0,
      controlPort: 0,
      seed: "conformance",
      clock: "real",
      plugins: [testBounces],
    });
    const smtp = await startSmtp(postmock.runtime, { host: "127.0.0.1", ports: [0], tls: null });
    closers.push(async () => {
      await smtp.close();
      await postmock.close();
    });
    await nodemailer
      .createTransport({
        host: "127.0.0.1",
        port: Number(new URL(smtp.url).port),
        secure: false,
        auth: { user: CONFORMANCE.serverToken, pass: CONFORMANCE.serverToken },
      })
      .sendMail({
        from: CONFORMANCE.senderEmail,
        to: `someone@${DOMAIN}`,
        subject: "Hi",
        text: "Hi",
        headers: { "X-PM-Bounce-Type": "DnsError" },
      });
    await postmock.runtime.clock.advance(0);
    const bounces = [...postmock.runtime.store.state.bounces.values()].filter(
      (b) => b.Email === `someone@${DOMAIN}`,
    );
    expect(bounces.map((b) => b.Type)).toEqual(["DnsError"]);
  });
});
