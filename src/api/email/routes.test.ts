import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { createApiApp } from "../../http/app.ts";
import { createRuntime } from "../../runtime.ts";
import { createServer } from "../../state/servers.ts";
import { suppressionKey } from "../../state/store.ts";
import { addVerifiedDomain } from "../account/domains.ts";

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}[+-]\d{2}:\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup() {
  const runtime = createRuntime();
  const server = createServer(runtime.store, runtime.clock.now(), { ApiTokens: ["token"] });
  addVerifiedDomain(
    runtime.store.state,
    runtime.store.nextId("domain"),
    "example.com",
    runtime.clock.now(),
  );
  const app = createApiApp(runtime);
  const post = (path: string, body: unknown, token = "token") =>
    app.request(`http://api.postmarkapp.com${path}`, {
      method: "POST",
      headers: { "X-Postmark-Server-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const suppress = (email: string) =>
    runtime.store.state.suppressions.set(suppressionKey(server.ID, "outbound", email), {
      ServerID: server.ID,
      MessageStream: "outbound",
      EmailAddress: email,
      SuppressionReason: "ManualSuppression",
      Origin: "Customer",
      CreatedAt: runtime.clock.now(),
    });
  return { runtime, post, suppress };
}

type Item = Record<string, string | number>;
const item = (res: Response) => res.json() as Promise<Item>;
const items = (res: Response) => res.json() as Promise<Item[]>;

const message = (fields: Record<string, unknown> = {}) => ({
  From: "sender@example.com",
  To: "Ann <a@example.com>",
  Subject: "Hi",
  TextBody: "Hello",
  ...fields,
});

describe("POST /email", () => {
  it("answers the documented response and stores the request (docs/03 §1.2)", async () => {
    const { runtime, post } = setup();
    const res = await post("/email", message());
    expect(res.status).toBe(200);
    const body = await item(res);
    expect(Object.keys(body)).toEqual(["To", "SubmittedAt", "MessageID", "ErrorCode", "Message"]);
    expect(body).toMatchObject({ To: "Ann <a@example.com>", ErrorCode: 0, Message: "OK" });
    expect(body.SubmittedAt).toMatch(TIMESTAMP);
    expect(body.MessageID).toMatch(UUID);
    expect(runtime.store.state.outbound.get(String(body.MessageID))?.request).toEqual(message());
  });

  it("writes a MIME source that the dump endpoint serves (gem api_client_resources_spec)", async () => {
    const { runtime, post } = setup();
    const fields = {
      Cc: "c@example.com",
      Bcc: "hidden@example.com",
      HtmlBody: "<p>Hello</p>",
      Tag: "orders",
      Headers: [{ Name: "X-Custom", Value: "1" }],
      Attachments: [{ Name: "a.txt", Content: "aGk=", ContentType: "text/plain" }],
    };
    const { MessageID } = await item(await post("/email", message(fields)));
    const dump = await createApiApp(runtime).request(
      `http://api.postmarkapp.com/messages/outbound/${MessageID}/dump`,
      { headers: { "X-Postmark-Server-Token": "token" } },
    );
    const source = ((await dump.json()) as { Body: string }).Body;
    const mail = await simpleParser(source);
    expect(mail.from?.text).toBe("sender@example.com");
    expect(mail.subject).toBe("Hi");
    expect(mail.text?.trim()).toBe("Hello");
    expect(mail.html).toBe("<p>Hello</p>");
    expect(mail.headers.get("x-custom")).toBe("1");
    expect(mail.headers.get("x-pm-tag")).toBe("orders");
    expect(mail.headers.get("x-pm-message-id")).toBe(MessageID);
    expect(mail.messageId).toMatch(/^<[0-9a-f-]{36}@mtasv\.net>$/);
    expect(mail.attachments.map((a) => a.content.toString())).toEqual(["hi"]);
    expect(source).not.toContain("hidden@example.com");
  });

  it("answers Test job accepted for POSTMARK_API_TEST and stores nothing (docs/03 §4)", async () => {
    const { runtime, post } = setup();
    const res = await post("/email", message(), "POSTMARK_API_TEST");
    expect(await res.json()).toMatchObject({ ErrorCode: 0, Message: "Test job accepted" });
    expect(runtime.store.state.outbound.size).toBe(0);
  });

  it("answers 422 with the envelope for a send error", async () => {
    const res = await setup().post("/email", message({ TextBody: undefined }));
    expect(res.status).toBe(422);
    expect(res.headers.get("X-PM-ApiErrorCode")).toBe("300");
    expect(await res.json()).toEqual({
      ErrorCode: 300,
      Message: "Provide either email TextBody or HtmlBody or both.",
    });
  });

  it("answers 422 / 400 with only ErrorCode and Message for a From no account holds", async () => {
    // captures/20260916T231736Z-from-verification/01-single-unverified-domain
    const res = await setup().post("/email", message({ From: "probe@elsewhere.org" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      ErrorCode: 400,
      Message:
        "The 'From' address you supplied (probe@elsewhere.org) is not a Sender Signature on your account. Please add and confirm this address in order to be able to use it in the 'From' field of your messages.",
    });
  });

  it("answers 422 / 406 for a partial suppression, and still sends", async () => {
    const { runtime, post, suppress } = setup();
    suppress("b@example.com");
    const res = await post("/email", message({ Bcc: "b@example.com" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ErrorCode: 406 });
    expect(runtime.store.state.outbound.size).toBe(1);
  });

  it("reads the php wire form: nulls dropped, empty strings, camelCase keys, ContentId", async () => {
    const { runtime, post } = setup();
    const res = await post("/email", {
      From: "sender@example.com",
      To: "a@example.com",
      Cc: "",
      Bcc: "",
      Tag: "",
      ReplyTo: "",
      TrackLinks: "",
      subject: "Hi",
      htmlBody: "<b>Hi</b>",
      TrackOpens: true,
      Headers: [{ Name: "X-Test-Header", Value: "Header." }],
      Attachments: [
        { Name: "hello.txt", Content: "aGk=", ContentType: "text/plain", ContentId: "hello.txt" },
      ],
      MessageStream: "outbound",
    });
    const { MessageID } = await item(res);
    expect(runtime.store.state.outbound.get(String(MessageID))).toMatchObject({
      Subject: "Hi",
      HtmlBody: "<b>Hi</b>",
      Tag: null,
      Headers: [{ Name: "X-Test-Header", Value: "Header." }],
      Attachments: [{ Name: "hello.txt", ContentID: "hello.txt" }],
    });
  });

  it("refuses to guess the answer to a body that is not an object", async () => {
    expect((await setup().post("/email", [message()])).status).toBe(501);
  });
});

describe("POST /email/batch", () => {
  it("answers one item per message, in order, with per-item errors (docs/03 §2)", async () => {
    const { runtime, post, suppress } = setup();
    suppress("gone@example.com");
    const res = await post("/email/batch", [
      message(),
      message({ To: "gone@example.com" }),
      message({ To: "test" }),
      message({ From: "probe@elsewhere.org" }),
    ]);
    expect(res.status).toBe(200);
    const [ok, inactive, invalid, sender] = await items(res);
    expect(ok).toMatchObject({ To: "Ann <a@example.com>", ErrorCode: 0, Message: "OK" });
    expect(inactive).toEqual({
      ErrorCode: 406,
      Message:
        "You tried to send to a recipient that has been marked as inactive. Found inactive addresses: gone@example.com. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression. ",
    });
    expect(invalid).toEqual({ ErrorCode: 300, Message: "Invalid 'To' address: 'test'." });
    // captures/20260916T231736Z-from-verification/02-batch-unverified-domain
    expect(sender).toEqual({
      ErrorCode: 400,
      Message:
        "The 'From' address you supplied (probe@elsewhere.org) is not a Sender Signature on your account. Please add and confirm this address in order to be able to use it in the 'From' field of your messages.",
    });
    expect([...runtime.store.state.outbound.keys()]).toEqual([ok?.MessageID]);
  });

  it("answers 501 and stores nothing for an item with a data error and the sender error", async () => {
    const { runtime, post } = setup();
    const res = await post("/email/batch", [
      message(),
      message({ From: "probe@elsewhere.org", TextBody: undefined }),
    ]);
    expect(res.status).toBe(501);
    expect(runtime.store.state.outbound.size).toBe(0);
  });

  it("answers per-message results for POSTMARK_API_TEST (gem api_client_messages_spec)", async () => {
    const res = await setup().post("/email/batch", [message(), message()], "POSTMARK_API_TEST");
    expect((await items(res)).map((i) => i.Message)).toEqual([
      "Test job accepted",
      "Test job accepted",
    ]);
  });

  it("validates every item before it sends any (an uncaptured item sends nothing)", async () => {
    const { runtime, post } = setup();
    const stream = runtime.store.state.streams.get("1/broadcast");
    if (stream === undefined) throw new Error("no broadcast stream");
    stream.ArchivedAt = runtime.clock.now();
    const res = await post("/email/batch", [message(), message({ MessageStream: "broadcast" })]);
    expect(res.status).toBe(501);
    expect(runtime.store.state.outbound.size).toBe(0);
  });

  it("stores every accepted item before any sent listener runs", async () => {
    const { runtime, post } = setup();
    const storedWhenSent: number[] = [];
    runtime.events.on("sent", () => {
      storedWhenSent.push(runtime.store.state.outbound.size);
      runtime.store.state.streams.delete("1/broadcast");
    });
    const res = await post("/email/batch", [message(), message({ MessageStream: "broadcast" })]);
    expect(res.status).toBe(200);
    expect(storedWhenSent).toEqual([2, 2]);
  });

  it("refuses to guess for an unknown stream in a batch (docs/03 §8 Q14)", async () => {
    const { runtime, post } = setup();
    const res = await post("/email/batch", [message(), message({ MessageStream: "nope" })]);
    expect(res.status).toBe(501);
    expect(runtime.store.state.outbound.size).toBe(0);
  });

  it("refuses to guess for a non-object item, and sends none of the batch", async () => {
    const { runtime, post } = setup();
    expect((await post("/email/batch", [message(), "x"])).status).toBe(501);
    expect(runtime.store.state.outbound.size).toBe(0);
  });

  it("answers an empty array for an empty batch", async () => {
    expect(await (await setup().post("/email/batch", [])).json()).toEqual([]);
  });

  it("answers 422 / 410 for more than 500 messages, and sends none", async () => {
    const { runtime, post } = setup();
    const ok = await post(
      "/email/batch",
      Array.from({ length: 500 }, () => message()),
    );
    expect(ok.status).toBe(200);
    runtime.store.state.outbound.clear();
    const res = await post(
      "/email/batch",
      Array.from({ length: 501 }, () => message()),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      ErrorCode: 410,
      Message: "You may only send up to 500 messages in a single batched request.",
    });
    expect(runtime.store.state.outbound.size).toBe(0);
  });
});
