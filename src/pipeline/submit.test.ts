import { describe, expect, it } from "vitest";
import { createRuntime } from "../runtime.ts";
import { createServer, testTokenContext } from "../state/servers.ts";
import { type OutboundDraft, submitOutbound } from "./submit.ts";

const draft = (fields: Partial<OutboundDraft>): OutboundDraft => ({
  From: "sender@example.com",
  To: undefined,
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

const submission = (auth: Parameters<typeof submitOutbound>[1]["auth"], d: OutboundDraft) => ({
  auth,
  channel: "rest" as const,
  draft: d,
  request: {},
  bulkRequestId: null,
  templateId: null,
});

describe("submitOutbound stub", () => {
  it("parses raw address lists, stores the message and emits sent", async () => {
    const runtime = createRuntime();
    const server = createServer(runtime.store, runtime.clock.now());
    const sent: string[] = [];
    runtime.events.on("sent", ({ message }) => {
      sent.push(message.MessageID);
    });
    const result = await submitOutbound(
      runtime,
      submission({ kind: "server", server }, draft({ To: "Ann <a@example.com>, b@example.com" })),
    );
    if (result.outcome !== "accepted") throw new Error(result.outcome);
    expect(result.message.To).toEqual([
      { Email: "a@example.com", Name: "Ann" },
      { Email: "b@example.com", Name: null },
    ]);
    expect(sent).toEqual([result.message.MessageID]);
    expect(runtime.store.state.outbound.size).toBe(1);
  });

  it("answers a malformed address with ErrorCode 300", async () => {
    const runtime = createRuntime();
    const server = createServer(runtime.store, runtime.clock.now());
    expect(
      await submitOutbound(runtime, submission({ kind: "server", server }, draft({ To: "test" }))),
    ).toEqual({
      outcome: "rejected",
      error: { ErrorCode: 300, Message: "Invalid 'To' address: 'test'." },
    });
  });

  it("stores nothing for the test token", async () => {
    const runtime = createRuntime();
    const result = await submitOutbound(
      runtime,
      submission(testTokenContext(runtime.clock.now()), draft({ To: "a@example.com" })),
    );
    expect(result.outcome).toBe("validated");
    expect(runtime.store.state.outbound.size).toBe(0);
  });

  describe("raw fields are validated here, for every channel", () => {
    const setup = () => {
      const runtime = createRuntime();
      const server = createServer(runtime.store, runtime.clock.now());
      const send = (fields: Partial<OutboundDraft>, channel: "rest" | "smtp" = "rest") =>
        submitOutbound(runtime, {
          ...submission({ kind: "server", server }, draft({ To: "a@example.com", ...fields })),
          channel,
        });
      return { send };
    };
    const invalid = (field: string) => ({
      outcome: "rejected",
      error: { ErrorCode: 403, Message: `Invalid request field(s): '${field}'.` },
    });

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
      const result = await setup().send({ TrackOpens: "True" }, "smtp");
      expect(result.outcome === "accepted" && result.message.TrackOpens).toBe(true);
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
});
