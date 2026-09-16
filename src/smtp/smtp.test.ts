import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import nodemailer from "nodemailer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFORMANCE } from "../../seeds/lib/conformance.ts";
import { suppressionKey } from "../state/store.ts";
import type { Bounce, OutboundMessage } from "../state/types.ts";
import { MAX_MESSAGE_BYTES } from "./listener.ts";
import { plain, rawSmtp, startWithSmtp, testCertificate } from "./test-support.ts";

// docs/07 "Mock must", driven by nodemailer 9 (the common Node SMTP client) and a raw client.

type Setup = Awaited<ReturnType<typeof startWithSmtp>>;
let mock: Setup;
beforeEach(async () => {
  mock = await startWithSmtp();
});
afterEach(async () => {
  await mock.close();
  vi.restoreAllMocks();
});

const TOKEN = CONFORMANCE.serverToken;
const FROM = CONFORMANCE.senderEmail;
const TO = CONFORMANCE.recipientEmail;

type TransportOptions = Parameters<typeof nodemailer.createTransport>[0] & object;
const transport = (options: Record<string, unknown> = {}, port = mock.port) =>
  nodemailer.createTransport({
    host: "127.0.0.1",
    port,
    secure: false,
    auth: { user: TOKEN, pass: TOKEN },
    ...options,
  } as TransportOptions);

// The conformance seed stores REST history; these tests look at SMTP traffic only.
const messages = (): OutboundMessage[] =>
  [...mock.runtime.store.state.outbound.values()].filter((message) => message.channel === "smtp");
const only = (): OutboundMessage => {
  const all = messages();
  expect(all).toHaveLength(1);
  return all[0] as OutboundMessage;
};
const bounces = (): Bounce[] =>
  [...mock.runtime.store.state.bounces.values()].filter((bounce) => bounce.Type === "SMTPApiError");

describe("transport and EHLO", () => {
  it("advertises AUTH PLAIN LOGIN CRAM-MD5 and SIZE, and no STARTTLS without a cert", async () => {
    const client = await rawSmtp(mock.port);
    const ehlo = await client.command("EHLO client.example.com");
    expect(ehlo).toContain("AUTH PLAIN LOGIN CRAM-MD5");
    expect(ehlo).toContain(`SIZE ${MAX_MESSAGE_BYTES}`);
    expect(ehlo).not.toContain("STARTTLS");
    expect(ehlo).not.toContain("DIGEST-MD5");
    expect(ehlo).not.toContain("8BITMIME");
    client.close();
  });

  it("answers AUTH DIGEST-MD5 with 504 (docs/07 §4)", async () => {
    const client = await rawSmtp(mock.port);
    await client.command("EHLO client.example.com");
    expect(await client.command("AUTH DIGEST-MD5")).toMatch(/^504 /);
    client.close();
  });

  it("refuses MAIL FROM before AUTH", async () => {
    const client = await rawSmtp(mock.port);
    await client.command("EHLO client.example.com");
    expect(await client.command(`MAIL FROM:<${FROM}>`)).toMatch(/^530 /);
    client.close();
  });

  describe("with a certificate", () => {
    let certificate: { key: string; cert: string };
    beforeAll(() => {
      certificate = testCertificate();
    });

    it("offers STARTTLS without requiring it", async () => {
      const tls = await startWithSmtp(certificate);
      try {
        const client = await rawSmtp(tls.port);
        expect(await client.command("EHLO client.example.com")).toContain("STARTTLS");
        expect(await client.command(`AUTH PLAIN ${plain(TOKEN, TOKEN)}`)).toMatch(/^235 /);
        client.close();

        const mailer = nodemailer.createTransport({
          host: "127.0.0.1",
          port: tls.port,
          requireTLS: true,
          tls: { ca: certificate.cert, servername: "smtp.postmarkapp.com" },
          auth: { user: TOKEN, pass: TOKEN },
        });
        await mailer.sendMail({ from: FROM, to: TO, subject: "tls", text: "Hi" });
        expect(
          [...tls.runtime.store.state.outbound.values()].filter((m) => m.channel === "smtp"),
        ).toHaveLength(1);
      } finally {
        await tls.close();
      }
    });
  });
});

describe("authentication", () => {
  it.each(["PLAIN", "LOGIN", "CRAM-MD5"])(
    "sends with the server token as username and password over %s, before TLS",
    async (method) => {
      const info = await transport({ authMethod: method, ignoreTLS: true }).sendMail({
        from: FROM,
        to: TO,
        subject: method,
        text: "Hi",
      });
      const message = only();
      expect(message).toMatchObject({
        channel: "smtp",
        MessageStream: "outbound",
        ServerID: CONFORMANCE.serverId,
      });
      expect(info.response).toBe(`250 Ok: queued as ${message.MessageID}`);
    },
  );

  it("routes a server-token send by X-PM-Message-Stream, header name in any case", async () => {
    await transport().sendMail({
      from: FROM,
      to: TO,
      text: "Hi",
      headers: { "x-pm-message-STREAM": "broadcast" },
    });
    expect(only().MessageStream).toBe("broadcast");
  });

  it("routes an SMTP token to its stream, and fails AUTH once it is revoked", async () => {
    const created = await mock.control("POST", "/control/smtp/tokens", {
      serverId: CONFORMANCE.serverId,
      messageStream: "broadcast",
    });
    expect(created.status).toBe(200);
    const { AccessKey, SecretKey } = created.body as { AccessKey: string; SecretKey: string };
    for (const authMethod of ["PLAIN", "LOGIN", "CRAM-MD5"]) {
      await transport({ auth: { user: AccessKey, pass: SecretKey }, authMethod }).sendMail({
        from: FROM,
        to: TO,
        text: "Hi",
      });
    }
    expect(messages().map((m) => m.MessageStream)).toEqual(["broadcast", "broadcast", "broadcast"]);

    await mock.control("DELETE", `/control/smtp/tokens/${AccessKey}`);
    await expect(
      transport({ auth: { user: AccessKey, pass: SecretKey } }).sendMail({ from: FROM, to: TO }),
    ).rejects.toMatchObject({ code: "EAUTH", responseCode: 535 });
  });

  it("answers an SMTP token with a header naming another stream as not captured (Q13)", async () => {
    const { body } = await mock.control("POST", "/control/smtp/tokens", {
      serverId: CONFORMANCE.serverId,
      messageStream: "outbound",
    });
    const auth = { user: body.AccessKey, pass: body.SecretKey };
    await expect(
      transport({ auth }).sendMail({
        from: FROM,
        to: TO,
        headers: { "X-PM-Message-Stream": "broadcast" },
      }),
    ).rejects.toMatchObject({ code: "EMESSAGE", responseCode: 502 });
    expect(messages()).toEqual([]);
  });

  it("refuses SMTP tokens the UI refuses", async () => {
    const inbound = await mock.control("POST", "/control/smtp/tokens", {
      serverId: CONFORMANCE.serverId,
      messageStream: "inbound",
    });
    expect(inbound).toEqual({
      status: 400,
      body: { error: "Tokens cannot be used with inbound streams." },
    });
  });

  it.each([
    ["an account token", CONFORMANCE.accountToken, CONFORMANCE.accountToken],
    ["an unknown token", "nope", "nope"],
    ["a server token with another password", TOKEN, "other"],
  ])("fails AUTH with 535 for %s", async (_case, user, pass) => {
    await expect(
      transport({ auth: { user, pass } }).sendMail({ from: FROM, to: TO }),
    ).rejects.toMatchObject({ code: "EAUTH", responseCode: 535 });
  });

  it.each(["PLAIN", "CRAM-MD5"])(
    "fails AUTH with 535 for a wrong SMTP secret over %s",
    async (authMethod) => {
      const { body } = await mock.control("POST", "/control/smtp/tokens", {
        serverId: CONFORMANCE.serverId,
        messageStream: "outbound",
      });
      const auth = { user: body.AccessKey, pass: `${body.SecretKey}x` };
      await expect(
        transport({ auth, authMethod }).sendMail({ from: FROM, to: TO }),
      ).rejects.toMatchObject({ code: "EAUTH", responseCode: 535 });
    },
  );

  it("fails AUTH with 535 when SMTP is off for the server", async () => {
    (
      mock.runtime.store.state.servers.get(CONFORMANCE.serverId) as { SmtpApiActivated: boolean }
    ).SmtpApiActivated = false;
    await expect(transport().sendMail({ from: FROM, to: TO })).rejects.toMatchObject({
      responseCode: 535,
    });
  });

  it("answers POSTMARK_API_TEST as not captured (Q4)", async () => {
    const auth = { user: "POSTMARK_API_TEST", pass: "POSTMARK_API_TEST" };
    await expect(transport({ auth }).sendMail({ from: FROM, to: TO })).rejects.toMatchObject({
      code: "EAUTH",
      responseCode: 502,
    });
  });

  it("stops an open pooled connection after a reset removes its token", async () => {
    const pool = transport({ pool: true, maxConnections: 1 });
    await pool.sendMail({ from: FROM, to: TO, text: "1" });
    expect((await mock.control("POST", "/control/reset", { seed: "empty" })).status).toBe(200);
    await expect(pool.sendMail({ from: FROM, to: TO, text: "2" })).rejects.toMatchObject({
      responseCode: 535,
    });
    pool.close();
  });
});

describe("session", () => {
  it("takes 5 connections × 100 messages with no RSET, and a close without QUIT is no error", async () => {
    const errors = vi.spyOn(console, "error");
    const pool = transport({ pool: true, maxConnections: 5, maxMessages: 100 });
    const count = 501;
    const infos = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        pool.sendMail({ from: FROM, to: TO, subject: `m${i}`, text: "Hi" }),
      ),
    );
    pool.close();
    expect(infos.every((info) => info.response.startsWith("250 "))).toBe(true);
    expect(new Set(messages().map((m) => m.Subject)).size).toBe(count);
    expect(errors).not.toHaveBeenCalled();
  }, 30_000);

  it("accepts RSET between transactions", async () => {
    const client = await rawSmtp(mock.port);
    await client.command("EHLO client.example.com");
    await client.command(`AUTH PLAIN ${plain(TOKEN, TOKEN)}`);
    await client.command(`MAIL FROM:<${FROM}>`);
    expect(await client.command("RSET")).toMatch(/^250 /);
    await client.command(`MAIL FROM:<${FROM}>`);
    await client.command(`RCPT TO:<${TO}>`);
    await client.command("DATA");
    const reply = await client.data(`From: ${FROM}\r\nTo: ${TO}\r\nSubject: s\r\n\r\nHi`);
    expect(reply).toMatch(/^250 /);
    expect(await client.command("QUIT")).toMatch(/^221 /);
    expect(messages()).toHaveLength(1);
  });

  it("keeps one transaction as one message; a Bcc exists only in the envelope", async () => {
    await transport().sendMail({
      from: FROM,
      to: "To Person <to@example.com>",
      cc: "cc@example.com",
      bcc: "hidden@example.com",
      text: "Hi",
    });
    const message = only();
    expect(message.request).not.toMatch(/^Bcc:/im);
    expect(message.To).toEqual([{ Email: "to@example.com", Name: "To Person" }]);
    expect(message.Cc).toEqual([{ Email: "cc@example.com", Name: null }]);
    expect(message.Bcc).toEqual([{ Email: "hidden@example.com", Name: null }]);
  });

  it("takes recipients from RCPT TO only; a header address outside the envelope is dropped", async () => {
    await transport().sendMail({
      from: FROM,
      to: "Header Only <header-only@example.com>, Both <both@example.com>",
      envelope: { from: FROM, to: ["both@example.com", "envelope-only@example.com"] },
      text: "Hi",
    });
    const message = only();
    expect(message.To).toEqual([{ Email: "both@example.com", Name: "Both" }]);
    expect(message.Bcc).toEqual([{ Email: "envelope-only@example.com", Name: null }]);
  });

  it("routes a blank X-PM-Message-Stream to outbound", async () => {
    const client = await rawSmtp(mock.port);
    await client.command("EHLO client.example.com");
    await client.command(`AUTH PLAIN ${plain(TOKEN, TOKEN)}`);
    await client.command(`MAIL FROM:<${FROM}>`);
    await client.command(`RCPT TO:<${TO}>`);
    await client.command("DATA");
    await client.data(`From: ${FROM}\r\nTo: ${TO}\r\nX-PM-Message-Stream:\r\n\r\nHi`);
    client.close();
    expect(only().MessageStream).toBe("outbound");
  });

  it.each([
    ["connect", "421"],
    ["mail", "451"],
    ["rcpt", "550"],
    ["data", "421"],
  ] as const)("a control fault at %s answers %s once", async (stage, code) => {
    const fault = { stage, reply: { code: Number(code), message: "Service unavailable" } };
    expect((await mock.control("POST", "/control/smtp/faults", fault)).status).toBe(200);
    await expect(transport().sendMail({ from: FROM, to: TO, text: "1" })).rejects.toMatchObject({
      responseCode: Number(code),
    });
    await transport().sendMail({ from: FROM, to: TO, text: "2" });
    // The CRLF before the terminating dot ends the last body line.
    expect(messages().map((m) => m.TextBody)).toEqual(["2\n"]);
  });

  it("a 421 fault closes the connection", async () => {
    await mock.control("POST", "/control/smtp/faults", {
      stage: "mail",
      reply: { code: 421, message: "Closing" },
    });
    const client = await rawSmtp(mock.port);
    await client.command("EHLO client.example.com");
    await client.command(`AUTH PLAIN ${plain(TOKEN, TOKEN)}`);
    expect(await client.command(`MAIL FROM:<${FROM}>`)).toMatch(/^421 /);
    await client.closed;
  });

  it("answers a message over 10 MB with 552 (INFERRED, Q3)", async () => {
    const big = Buffer.alloc(MAX_MESSAGE_BYTES, "a");
    await expect(
      transport().sendMail({
        from: FROM,
        to: TO,
        attachments: [{ filename: "a.bin", content: big }],
      }),
    ).rejects.toMatchObject({ responseCode: 552 });
    expect(messages()).toEqual([]);
  });
});

describe("content", () => {
  it("decodes encoded-word headers and QP/base64 bodies; keeps the raw DATA unchanged", async () => {
    const client = await rawSmtp(mock.port);
    await client.command("EHLO client.example.com");
    await client.command(`AUTH PLAIN ${plain(TOKEN, TOKEN)}`);
    await client.command(`MAIL FROM:<${FROM}>`);
    await client.command(`RCPT TO:<${TO}>`);
    await client.command("DATA");
    const raw = [
      "From: =?UTF-8?B?SsO2cmc=?= <sender@example.com>",
      `To: ${TO}`,
      "Subject: =?UTF-8?Q?=E3=80=90Order=E3=80=91_It=E2=80=99s_here?=",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Gr=C3=BC=C3=9Fe",
      ".leading dot",
      "--b",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("<p>Grüße</p>").toString("base64"),
      "--b--",
    ].join("\r\n");
    expect(await client.data(raw)).toMatch(/^250 /);
    client.close();
    const message = only();
    expect(message.Subject).toBe("【Order】 It’s here");
    expect(message.From).toBe('"Jörg" <sender@example.com>');
    expect(message.TextBody).toBe("Grüße\n.leading dot");
    expect(message.HtmlBody).toBe("<p>Grüße</p>");
    expect(message.request).toBe(`${raw}\r\n`);

    const listed = await mock.control("GET", "/control/messages?channel=smtp");
    expect(listed.body.Messages).toMatchObject([{ Channel: "smtp", Request: `${raw}\r\n` }]);
  });

  it("parses a calendar invite: text/calendar alternative, application/ics attachment, Content-Class kept", async () => {
    await transport().sendMail({
      from: FROM,
      to: TO,
      subject: "Invite",
      text: "Join",
      html: "<p>Join</p>",
      headers: { "Content-Class": "urn:content-classes:calendarmessage" },
      icalEvent: { method: "REQUEST", content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" },
      attachments: [{ filename: "notes.txt", content: "notes" }],
    });
    const message = only();
    expect(message.TextBody).toBe("Join");
    expect(message.HtmlBody).toBe("<p>Join</p>");
    expect(message.Attachments.map((a) => [a.Name, a.ContentType])).toEqual([
      ["notes.txt", "text/plain"],
      ["invite.ics", "application/ics"],
    ]);
    expect(message.request).toMatch(/^Content-Class: urn:content-classes:calendarmessage\r$/m);
    expect(message.request).toMatch(/Content-Type: text\/calendar; charset=utf-8; method=REQUEST/);
    expect(message.rawSource).toMatch(
      /Content-Type: text\/calendar; charset=utf-8; method=REQUEST/,
    );
    expect(message.rawSource).toMatch(/^Content-Class: urn:content-classes:calendarmessage\r$/m);
  });

  it("reads X-PM-Tag, X-PM-Metadata-* with duplicate suffixes, and tracking headers", async () => {
    const info = await transport().sendMail({
      from: FROM,
      to: TO,
      html: "<p>Hi</p>",
      headers: [
        { key: "X-PM-Tag", value: "welcome" },
        { key: "X-PM-Metadata-color", value: "blue" },
        { key: "X-PM-Metadata-color", value: "red" },
        { key: "X-PM-Metadata-client-id", value: "12345" },
        { key: "X-PM-TrackOpens", value: "true" },
        { key: "X-PM-TrackLinks", value: "HtmlOnly" },
        { key: "X-Custom", value: "kept" },
      ],
    });
    const message = only();
    // nodemailer writes header names in title case, so metadata keys arrive that way.
    expect(message).toMatchObject({
      Tag: "welcome",
      Metadata: { Color: "blue", Color1: "red", "Client-ID": "12345" },
      TrackOpens: true,
      TrackLinks: "HtmlOnly",
      Headers: [{ Name: "X-Custom", Value: "kept" }],
    });
    expect(message.rawSource).not.toMatch(/^X-Pm-(Metadata|TrackOpens|TrackLinks)/im);
    expect(message.rawSource).toContain("X-PM-Tag: welcome");
    expect(message.rawSource).toMatch(/^Message-ID: <[0-9a-f-]{36}@mtasv\.net>\r$/m);
    expect(message.rawSource).not.toContain(info.messageId);
  });

  it("decodes non-ASCII X-PM-Tag, metadata and custom header values", async () => {
    await transport().sendMail({
      from: FROM,
      to: TO,
      text: "Hi",
      headers: { "X-PM-Tag": "Grüße", "X-PM-Metadata-name": "Jörg", "X-Custom": "【x】" },
    });
    expect(only()).toMatchObject({
      Tag: "Grüße",
      Metadata: { Name: "Jörg" },
      Headers: [{ Name: "X-Custom", Value: "【x】" }],
    });
    expect(only().request).toContain("=?UTF-8?Q?Gr=C3=BC=C3=9Fe?=");
  });

  it("keeps an inline image that has only a Content-ID as an attachment", async () => {
    const client = await rawSmtp(mock.port);
    await client.command("EHLO client.example.com");
    await client.command(`AUTH PLAIN ${plain(TOKEN, TOKEN)}`);
    await client.command(`MAIL FROM:<${FROM}>`);
    await client.command(`RCPT TO:<${TO}>`);
    await client.command("DATA");
    const raw = [
      `From: ${FROM}`,
      `To: ${TO}`,
      'Content-Type: multipart/related; boundary="r"',
      "",
      "--r",
      "Content-Type: text/html",
      "",
      '<img src="cid:logo">',
      "--r",
      "Content-Type: image/png",
      "Content-ID: <logo>",
      "Content-Transfer-Encoding: base64",
      "",
      "AQID",
      "--r--",
    ].join("\r\n");
    expect(await client.data(raw)).toMatch(/^250 /);
    client.close();
    expect(only().Attachments).toMatchObject([
      { Name: "", ContentType: "image/png", ContentID: "cid:logo", Content: "AQID" },
    ]);
  });

  it("keeps the client Message-ID with X-PM-KeepID: true", async () => {
    const info = await transport().sendMail({
      from: FROM,
      to: TO,
      text: "Hi",
      headers: { "X-PM-KeepID": "true" },
    });
    const message = only();
    expect(message.rawSource).toContain(`Message-ID: ${info.messageId}`);
    expect(message.rawSource).not.toContain("@mtasv.net");
    expect(message.Headers).toContainEqual({ Name: "Message-ID", Value: info.messageId });
  });
});

describe("results", () => {
  // No suppressions control endpoint exists yet; this is the state a hard bounce leaves.
  const suppress = (email: string) =>
    mock.runtime.store.state.suppressions.set(
      suppressionKey(CONFORMANCE.serverId, "outbound", email),
      {
        ServerID: CONFORMANCE.serverId,
        MessageStream: "outbound",
        EmailAddress: email,
        SuppressionReason: "HardBounce",
        Origin: "Recipient",
        CreatedAt: mock.runtime.clock.now(),
      },
    );

  it("delivers to active recipients and bounces a suppressed one with the message's MessageID", async () => {
    suppress("gone@example.com");
    const info = await transport().sendMail({
      from: FROM,
      to: TO,
      cc: "Gone@example.com",
      text: "Hi",
    });
    const message = only();
    expect(info.response).toBe(`250 Ok: queued as ${message.MessageID}`);
    expect(bounces()).toMatchObject([
      { Email: "Gone@example.com", MessageID: message.MessageID, Type: "SMTPApiError" },
    ]);
    expect(bounces()[0]?.Description).toContain("Found inactive addresses: Gone@example.com.");
  });

  it("bounces every recipient when all are suppressed, and stores no message", async () => {
    suppress(TO);
    const info = await transport().sendMail({ from: FROM, to: TO, text: "Hi" });
    expect(messages()).toEqual([]);
    const [bounce] = bounces() as [Bounce];
    expect(bounces()).toHaveLength(1);
    expect(bounce).toMatchObject({ Email: TO, Type: "SMTPApiError" });
    expect(bounce.Content).toMatch(/^ErrorCode: 406\r\n/);
    expect(info.response).toBe(`250 Ok: queued as ${bounce.MessageID}`);
  });

  it("accepts a message the pipeline rejects and records an SMTPApiError bounce per recipient", async () => {
    const emitted: Bounce[] = [];
    mock.runtime.events.on("smtpApiError", ({ bounce }) => {
      emitted.push(bounce);
    });
    const info = await transport().sendMail({
      from: FROM,
      to: TO,
      bcc: "hidden@example.com",
      subject: "Bad",
      text: "Hi",
      headers: { "X-PM-TrackOpens": "maybe", "X-PM-Tag": "t" },
    });
    expect(info.response).toMatch(/^250 /);
    expect(messages()).toEqual([]);
    const recorded = bounces();
    expect(recorded.map((b) => b.Email)).toEqual([TO, "hidden@example.com"]);
    expect(emitted).toEqual(recorded);
    const [first] = recorded as [Bounce];
    expect(first).toMatchObject({
      Type: "SMTPApiError",
      ServerID: CONFORMANCE.serverId,
      MessageStream: "outbound",
      Tag: "t",
      Subject: "Bad",
      Description: "Invalid request field(s): 'TrackOpens'.",
    });
    expect(info.response).toBe(`250 Ok: queued as ${first.MessageID}`);
    expect(first.Content).toMatch(/^ErrorCode: 403\r\nMessage: Invalid request field/);
    expect(first.Content).toContain("X-Pm-Trackopens: maybe");
  });

  it("records a malformed header address as an SMTPApiError bounce, not an SMTP reject", async () => {
    const client = await rawSmtp(mock.port);
    await client.command("EHLO client.example.com");
    await client.command(`AUTH PLAIN ${plain(TOKEN, TOKEN)}`);
    await client.command(`MAIL FROM:<${FROM}>`);
    await client.command(`RCPT TO:<${TO}>`);
    await client.command("DATA");
    expect(await client.data(`From: ${FROM}\r\nTo: test\r\n\r\nHi`)).toMatch(/^250 /);
    client.close();
    expect(bounces().map((b) => b.Description)).toEqual(["Invalid 'To' address: 'test'."]);
  });
});

describe("examples/node", () => {
  it("smtp-send.ts sends through the listener with plain configuration", async () => {
    const script = fileURLToPath(new URL("../../examples/node/smtp-send.ts", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [script], {
      env: {
        ...process.env,
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(mock.port),
        POSTMARK_SERVER_TOKEN: TOKEN,
        MAIL_FROM: FROM,
        MAIL_TO: TO,
      },
    });
    const message = only();
    expect(stdout.trim()).toBe(`250 Ok: queued as ${message.MessageID}`);
    expect(message).toMatchObject({ Tag: "example", MessageStream: "outbound" });
  });
});
