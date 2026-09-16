import { describe, expect, it } from "vitest";
import { addVerifiedDomain, newDomain } from "../api/account/domains.ts";
import { newSender } from "../api/account/senders.ts";
import { Unsupported } from "../http/respond.ts";
import { createRuntime } from "../runtime.ts";
import { createServer, type ServerSettings, testTokenContext } from "../state/servers.ts";
import { streamKey, suppressionKey } from "../state/store.ts";
import { batchItemError } from "./inactive.ts";
import {
  draftFromJson,
  type OutboundDraft,
  type SubmitResult,
  submitOutbound,
  validateOutbound,
} from "./submit.ts";

const draft = (fields: Partial<OutboundDraft>): OutboundDraft => ({
  From: "sender@example.com",
  To: "a@example.com",
  Cc: undefined,
  Bcc: undefined,
  ReplyTo: undefined,
  Subject: undefined,
  HtmlBody: undefined,
  TextBody: "Hi",
  Tag: undefined,
  Headers: [],
  Attachments: [],
  Metadata: {},
  TrackOpens: undefined,
  TrackLinks: undefined,
  MessageStream: undefined,
  ...fields,
});

function setup(settings: ServerSettings = {}) {
  const runtime = createRuntime();
  const server = createServer(runtime.store, runtime.clock.now(), settings);
  addVerifiedDomain(
    runtime.store.state,
    runtime.store.nextId("domain"),
    "example.com",
    runtime.clock.now(),
  );
  const sent: string[] = [];
  runtime.events.on("sent", ({ message }) => void sent.push(message.MessageID));
  const suppress = (email: string, stream = "outbound") =>
    runtime.store.state.suppressions.set(suppressionKey(server.ID, stream, email), {
      ServerID: server.ID,
      MessageStream: stream,
      EmailAddress: email,
      SuppressionReason: "HardBounce",
      Origin: "Recipient",
      CreatedAt: runtime.clock.now(),
    });
  const send = (fields: Partial<OutboundDraft>, channel: "rest" | "smtp" = "rest") =>
    submitOutbound(runtime, {
      auth: { kind: "server", server },
      channel,
      draft: draft(fields),
      request: {},
      rawSource: "",
      bulkRequestId: null,
      templateId: null,
    });
  return { runtime, server, sent, suppress, send };
}

const rejected = (ErrorCode: number, Message: string) => ({
  outcome: "rejected",
  error: { ErrorCode, Message },
});

const accepted = (result: SubmitResult) => {
  if (result.outcome !== "accepted") throw new Error(JSON.stringify(result));
  return result.message;
};

describe("submitOutbound", () => {
  it("parses address lists, stores the message and emits sent once", async () => {
    const { runtime, sent, send } = setup();
    const message = accepted(await send({ To: "Ann <a@example.com>, b@example.com" }));
    expect(message.To).toEqual([
      { Email: "a@example.com", Name: "Ann" },
      { Email: "b@example.com", Name: null },
    ]);
    expect(message.MessageStream).toBe("outbound");
    expect(sent).toEqual([message.MessageID]);
    expect(runtime.store.state.outbound.get(message.MessageID)).toBe(message);
  });

  it("validates for the test token and stores nothing", async () => {
    const runtime = createRuntime();
    const submit = (fields: Partial<OutboundDraft>) =>
      submitOutbound(runtime, {
        auth: testTokenContext(runtime.clock.now()),
        channel: "rest",
        draft: draft(fields),
        request: {},
        bulkRequestId: null,
        templateId: null,
      });
    expect((await submit({})).outcome).toBe("validated");
    // gem api_client_messages_spec.rb:62-68: an invalid send still fails with the test token.
    expect((await submit({ TextBody: undefined })).outcome).toBe("rejected");
    expect(await submit({ MessageStream: "nope" })).toMatchObject({ error: { ErrorCode: 1235 } });
    expect(runtime.store.state.outbound.size).toBe(0);
  });

  it("validateOutbound checks the data and changes no state", async () => {
    const { runtime, server, sent } = setup();
    const submission = (fields: Partial<OutboundDraft>) => ({
      auth: { kind: "server" as const, server },
      channel: "rest" as const,
      draft: draft(fields),
      request: {},
      rawSource: "",
      bulkRequestId: null,
      templateId: null,
    });
    expect(validateOutbound(runtime, submission({})).outcome).toBe("valid");
    expect(validateOutbound(runtime, submission({ To: "test" }))).toMatchObject({
      outcome: "rejected",
      error: { ErrorCode: 300 },
    });
    expect(runtime.store.state.outbound.size).toBe(0);
    expect(sent).toEqual([]);
  });

  it.each([
    [{ Subject: 5 }, 403, "Subject"],
    [{ MessageStream: "nope" }, 1235, "MessageStream"],
    [{ From: "test" }, 300, "From"],
    [{ Bcc: "nope" }, 300, "Bcc"],
    [{ TextBody: undefined }, 300, "TextBody"],
    [{ Tag: "x".repeat(1001) }, 300, "Tag"],
    [{ From: "a@elsewhere.org" }, 400, "From"],
    [{ Metadata: { ["k".repeat(21)]: "v" } }, 300, "Metadata"],
    [{ Attachments: [{ Name: "a.exe", Content: "aGk=", ContentType: "x/y" }] }, 411, "Attachments"],
  ])("a rejected validation names the field for the bulk Errors map: %j", (fields, code, field) => {
    const { runtime, server } = setup();
    const validation = validateOutbound(runtime, {
      auth: { kind: "server", server },
      channel: "rest",
      draft: draft(fields),
      request: {},
      bulkRequestId: null,
      templateId: null,
    });
    expect(validation).toMatchObject({ outcome: "rejected", field, error: { ErrorCode: code } });
  });

  it("stores the raw MIME source a channel gives", async () => {
    const { runtime, server } = setup();
    const result = await submitOutbound(runtime, {
      auth: { kind: "server", server },
      channel: "smtp",
      draft: draft({}),
      request: "MIME",
      rawSource: "MIME",
      bulkRequestId: null,
      templateId: null,
    });
    expect(accepted(result).rawSource).toBe("MIME");
  });

  it("draftFromJson folds key case at every level (docs/08 R8)", () => {
    const folded = draftFromJson({
      htmlbody: "<b>Hi</b>",
      Attachments: [{ name: "a.txt", Content: "aGk=", ContentType: "text/plain", ContentId: "x" }],
      Unknown: 1,
    });
    expect(folded.HtmlBody).toBe("<b>Hi</b>");
    expect(folded.Attachments).toEqual([
      { Name: "a.txt", Content: "aGk=", ContentType: "text/plain", ContentID: "x" },
    ]);
    expect(Object.keys(folded)).not.toContain("Unknown");
  });

  describe("field types (403)", () => {
    const invalid = (field: string) => rejected(403, `Invalid request field(s): '${field}'.`);

    it('R9: reads null and empty values as absent (php TrackLinks "", dotnet nulls)', async () => {
      const result = await setup().send({
        TrackLinks: "",
        Cc: null,
        Headers: null,
        TrackOpens: null,
      });
      expect(result.outcome).toBe("accepted");
    });

    it("rejects attachment content that is not base64", async () => {
      const attachment = { Name: "a.txt", Content: "not base64!", ContentType: "text/plain" };
      expect(await setup().send({ Attachments: [attachment] })).toEqual(invalid("Attachments"));
    });

    it("reads X-PM-TrackOpens text on SMTP (docs/07 §1.3)", async () => {
      expect(
        accepted(await setup().send({ HtmlBody: "<b>Hi</b>", TrackOpens: "True" }, "smtp"))
          .TrackOpens,
      ).toBe(true);
    });

    it.each([
      ["TrackOpens", "true"],
      ["TrackLinks", "Sometimes"],
      ["Headers", { Name: "X" }],
      ["Metadata", { n: 1 }],
      ["Subject", 5],
    ])("rejects a REST %s of the wrong type or value", async (field, value) => {
      expect(await setup().send({ [field]: value })).toEqual(invalid(field));
    });
  });

  describe("streams", () => {
    it("answers 1235 with the stream name (php PostmarkClientEmailTest.php:92-93)", async () => {
      expect(await setup().send({ MessageStream: "unknown-stream" })).toEqual(
        rejected(1235, "The stream provided: 'unknown-stream' does not exist on this server."),
      );
    });

    it("answers 1236 for the inbound stream", async () => {
      expect(await setup().send({ MessageStream: "inbound" })).toMatchObject({
        error: { ErrorCode: 1236 },
      });
    });

    it("sends on a broadcast stream", async () => {
      expect(accepted(await setup().send({ MessageStream: "broadcast" })).MessageStream).toBe(
        "broadcast",
      );
    });

    it("refuses to guess for an archived stream", async () => {
      const { runtime, server, send } = setup();
      const stream = runtime.store.state.streams.get(streamKey(server.ID, "broadcast"));
      if (stream) stream.ArchivedAt = runtime.clock.now();
      await expect(send({ MessageStream: "broadcast" })).rejects.toBeInstanceOf(Unsupported);
    });
  });

  describe("send validation (300)", () => {
    it.each([
      [{ From: undefined }, "Invalid 'From' address: ''."],
      [{ From: "test" }, "Invalid 'From' address: 'test'."],
      [
        { From: "a@example.com, b@example.com" },
        "Invalid 'From' address: 'a@example.com, b@example.com'.",
      ],
      [{ To: "test" }, "Invalid 'To' address: 'test'."],
      [{ Bcc: "a@example.com, nope" }, "Invalid 'Bcc' address: 'a@example.com, nope'."],
      [{ ReplyTo: "nope" }, "Invalid 'ReplyTo' address: 'nope'."],
      [{ To: undefined }, "Invalid 'To' address: ''."],
      [{ To: undefined, Cc: "c@example.com" }, "Invalid 'To' address: ''."],
      [{ To: " , " }, "Invalid 'To' address: ' , '."],
      [{ TextBody: undefined }, "Provide either email TextBody or HtmlBody or both."],
    ])("rejects %j", async (fields, message) => {
      expect(await setup().send(fields)).toEqual(rejected(300, message));
    });

    it("counts To, Cc and Bcc together against 50 recipients", async () => {
      const list = (n: number, prefix: string) =>
        Array.from({ length: n }, (_, i) => `${prefix}${i}@example.com`).join(", ");
      const { send } = setup();
      expect(
        (await send({ To: list(30, "t"), Cc: list(10, "c"), Bcc: list(10, "b") })).outcome,
      ).toBe("accepted");
      expect(
        await send({ To: list(30, "t"), Cc: list(10, "c"), Bcc: list(11, "b") }),
      ).toMatchObject({ error: { ErrorCode: 300 } });
    });

    it("counts Subject, From and Tag lengths in UTF-16 code units", async () => {
      const { send } = setup();
      // "𝄞" is one code point and two UTF-16 code units.
      expect((await send({ Subject: "𝄞".repeat(1000) })).outcome).toBe("accepted");
      expect((await send({ Subject: "𝄞".repeat(1001) })).outcome).toBe("rejected");
      expect((await send({ Tag: "x".repeat(1001) })).outcome).toBe("rejected");
      expect((await send({ From: `${"n".repeat(240)} <s@example.com>` })).outcome).toBe("rejected");
    });

    it.each([
      [Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"]))],
      [{ ["k".repeat(21)]: "v" }],
      [{ k: "v".repeat(81) }],
      [{ Color: "blue", color: "red" }],
    ])("enforces metadata limits: %j", async (metadata) => {
      expect(await setup().send({ Metadata: metadata })).toMatchObject({
        error: { ErrorCode: 300 },
      });
    });
  });

  it("reads Metadata [] as no metadata (php encodes an empty array as [])", async () => {
    expect(accepted(await setup().send({ Metadata: [] })).Metadata).toEqual({});
  });

  describe("attachments", () => {
    const attachment = (fields: Record<string, unknown>) => ({
      Name: "a.txt",
      Content: "aGk=",
      ContentType: "text/plain",
      ...fields,
    });

    it("answers 411 for a forbidden extension, in any case", async () => {
      expect(await setup().send({ Attachments: [attachment({ Name: "run.EXE" })] })).toEqual(
        rejected(411, "Attachment file type not allowed."),
      );
    });

    it("reads ContentID null, empty and absent as not inline", async () => {
      const message = accepted(
        await setup().send({
          Attachments: [
            attachment({ ContentID: null }),
            attachment({ ContentID: "" }),
            attachment({}),
            attachment({ ContentID: "cid:logo" }),
          ],
        }),
      );
      expect(message.Attachments.map((a) => a.ContentID)).toEqual([null, null, null, "cid:logo"]);
      expect(message.Attachments[0]).toMatchObject({ Content: "aGk=", ContentLength: 2 });
    });

    it("refuses to guess the 413 body for a message over 10 MB", async () => {
      const big = Buffer.alloc(8 * 1024 * 1024).toString("base64");
      await expect(
        setup().send({ Attachments: [attachment({ Content: big })] }),
      ).rejects.toBeInstanceOf(Unsupported);
    });
  });

  describe("tracking", () => {
    it("never tracks opens of a message without an HTML body (docs/07 §3)", async () => {
      const forced = setup({ TrackOpens: true });
      expect(accepted(await forced.send({ TextBody: "Hi" })).TrackOpens).toBe(false);
      expect(accepted(await setup().send({ TrackOpens: true })).TrackOpens).toBe(false);
    });

    it("keeps the message TrackOpens unless the server forces it on (docs/03 §5.3)", async () => {
      expect(accepted(await setup().send({ HtmlBody: "<b>Hi</b>" })).TrackOpens).toBe(false);
      expect(
        accepted(await setup().send({ HtmlBody: "<b>Hi</b>", TrackOpens: true })).TrackOpens,
      ).toBe(true);
      const forced = setup({ TrackOpens: true });
      expect(
        accepted(await forced.send({ HtmlBody: "<b>Hi</b>", TrackOpens: false })).TrackOpens,
      ).toBe(true);
    });

    it("lets the message TrackLinks override the server value (docs/03 §5.2)", async () => {
      const { send } = setup({ TrackLinks: "HtmlOnly" });
      expect(accepted(await send({})).TrackLinks).toBe("HtmlOnly");
      expect(accepted(await send({ TrackLinks: "None" })).TrackLinks).toBe("None");
    });
  });

  describe("sender (400)", () => {
    const notASignature = (address: string) =>
      rejected(
        400,
        `The 'From' address you supplied (${address}) is not a Sender Signature on your account. Please add and confirm this address in order to be able to use it in the 'From' field of your messages.`,
      );
    const signature = (runtime: ReturnType<typeof setup>["runtime"], email: string) => {
      const sender = newSender(
        runtime.store.nextId("sender"),
        {
          FromEmail: email,
          Name: "s",
          ReplyToEmail: "",
          ReturnPathDomain: "",
          ConfirmationPersonalNote: "",
        },
        runtime.clock.now(),
      );
      runtime.store.state.senders.set(sender.ID, sender);
      return sender;
    };

    it("rejects a From on no domain or signature of the account, on both channels", async () => {
      const { runtime, send, sent } = setup();
      expect(await send({ From: "probe@elsewhere.org" })).toEqual(
        notASignature("probe@elsewhere.org"),
      );
      expect(await send({ From: "probe@elsewhere.org" }, "smtp")).toEqual(
        notASignature("probe@elsewhere.org"),
      );
      expect(runtime.store.state.outbound.size).toBe(0);
      expect(sent).toEqual([]);
    });

    it("names the bare address of a named From", async () => {
      expect(await setup().send({ From: "Probe <probe@elsewhere.org>" })).toEqual(
        notASignature("probe@elsewhere.org"),
      );
    });

    it("accepts any local part on a verified domain, without case", async () => {
      const { send } = setup();
      expect((await send({ From: "never-registered@example.com" })).outcome).toBe("accepted");
      expect((await send({ From: "Someone <X@EXAMPLE.COM>" })).outcome).toBe("accepted");
      expect(await send({ From: "a@sub.example.com" })).toEqual(notASignature("a@sub.example.com"));
    });

    it("accepts a domain once DKIM or its Return-Path is verified", async () => {
      const { runtime, send } = setup();
      const domain = newDomain(
        runtime.store.nextId("domain"),
        "new.org",
        "pm.new.org",
        runtime.clock.now(),
      );
      runtime.store.state.domains.set(domain.ID, domain);
      expect(await send({ From: "a@new.org" })).toEqual(notASignature("a@new.org"));
      domain.ReturnPathDomainVerified = true;
      expect((await send({ From: "a@new.org" })).outcome).toBe("accepted");
    });

    it("accepts a confirmed signature's own address, without case", async () => {
      const { runtime, send } = setup();
      signature(runtime, "Me@Signed.org").Confirmed = true;
      expect((await send({ From: "me@SIGNED.org" })).outcome).toBe("accepted");
      expect(await send({ From: "other@signed.org" })).toEqual(notASignature("other@signed.org"));
    });

    it("refuses to guess the answer for an unconfirmed signature", async () => {
      const { runtime, send } = setup();
      signature(runtime, "me@signed.org");
      await expect(send({ From: "me@signed.org" })).rejects.toBeInstanceOf(Unsupported);
    });

    it("runs after the data checks", async () => {
      expect(
        await setup().send({ From: "probe@elsewhere.org", TextBody: undefined }),
      ).toMatchObject({ error: { ErrorCode: 300 } });
    });

    it("does not check the test token", async () => {
      const runtime = createRuntime();
      const result = await submitOutbound(runtime, {
        auth: testTokenContext(runtime.clock.now()),
        channel: "rest",
        draft: draft({ From: "sender@postmarkapp.com" }),
        request: {},
        bulkRequestId: null,
        templateId: null,
      });
      expect(result.outcome).toBe("validated");
    });
  });

  describe("account approval", () => {
    it("answers 413 when the account may not send", async () => {
      const { runtime, send } = setup();
      runtime.store.state.account.approval = "unapproved";
      expect(await send({})).toMatchObject({ error: { ErrorCode: 413 } });
    });

    it("answers 412 while pending for a recipient outside the From domain", async () => {
      const { runtime, send } = setup();
      runtime.store.state.account.approval = "pending";
      expect((await send({ To: "a@EXAMPLE.com" })).outcome).toBe("accepted");
      expect(await send({ To: "a@elsewhere.org" })).toMatchObject({ error: { ErrorCode: 412 } });
    });
  });

  describe("suppressions (docs/03 §3.2, docs/04 §3.3)", () => {
    // docs/01 §4.1: each regex an SDK uses to read the addresses.
    const sdkRegexes = [
      [/Found inactive addresses: (.+?)\.? Inactive/, ","], // postmark.js
      [/Found inactive addresses: (.+?)\. Inactive/, ", "], // gem
      [/Found inactive addresses:\s*(.+?)\.(?:\s|$)/, ","], // python
    ] as const;
    const parsedBy = (message: string) =>
      sdkRegexes.map(([regex, split]) =>
        regex
          .exec(message)?.[1]
          ?.split(split)
          .map((s) => s.trim()),
      );

    it("answers 406 when every recipient is inactive; every SDK regex reads the list", async () => {
      const { runtime, suppress, send, sent } = setup();
      suppress("a@example.com");
      suppress("b@example.com");
      const result = await send({ To: "A@example.com", Bcc: "b@example.com, a@example.com" });
      if (result.outcome !== "rejected") throw new Error(result.outcome);
      expect(result.error.ErrorCode).toBe(406);
      const list = ["A@example.com", "b@example.com"];
      expect(parsedBy(result.error.Message)).toEqual([list, list, list]);
      expect(runtime.store.state.outbound.size).toBe(0);
      expect(sent).toEqual([]);
    });

    it("keeps the list readable in the batch item wording, with its trailing space", async () => {
      const { suppress, send } = setup();
      suppress("a@example.com");
      const result = await send({});
      if (result.outcome !== "rejected") throw new Error(result.outcome);
      const item = batchItemError(result.error);
      expect(item.Message).toBe(
        "You tried to send to a recipient that has been marked as inactive. Found inactive addresses: a@example.com. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression. ",
      );
      expect(parsedBy(item.Message)).toEqual([
        ["a@example.com"],
        ["a@example.com"],
        ["a@example.com"],
      ]);
    });

    it("sends to the active recipients and answers 406 for a partial suppression", async () => {
      const { runtime, suppress, send, sent } = setup();
      suppress("b@example.com");
      const result = await send({ To: "a@example.com", Bcc: "b@example.com" });
      if (result.outcome !== "partiallySuppressed") throw new Error(result.outcome);
      expect(parsedBy(result.error.Message)[0]).toEqual(["b@example.com"]);
      expect(sent).toEqual([result.message.MessageID]);
      expect(runtime.store.state.outbound.size).toBe(1);
      expect(result.message.suppressedRecipients).toEqual(["b@example.com"]);
    });

    it("reads only the send stream's list", async () => {
      const { suppress, send } = setup();
      suppress("a@example.com", "broadcast");
      expect((await send({})).outcome).toBe("accepted");
      expect((await send({ MessageStream: "broadcast" })).outcome).toBe("rejected");
    });
  });
});
