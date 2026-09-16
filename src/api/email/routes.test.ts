import { describe, expect, it } from "vitest";
import { createApiApp } from "../../http/app.ts";
import { createRuntime } from "../../runtime.ts";
import { createServer } from "../../state/servers.ts";
import { suppressionKey } from "../../state/store.ts";

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}[+-]\d{2}:\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup() {
  const runtime = createRuntime();
  const server = createServer(runtime.store, runtime.clock.now(), { ApiTokens: ["token"] });
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
      message({ MessageStream: "nope" }),
    ]);
    expect(res.status).toBe(200);
    const [ok, inactive, stream] = await items(res);
    expect(ok).toMatchObject({ To: "Ann <a@example.com>", ErrorCode: 0, Message: "OK" });
    expect(inactive).toEqual({
      ErrorCode: 406,
      Message:
        "You tried to send to a recipient that has been marked as inactive. Found inactive addresses: gone@example.com. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression. ",
    });
    expect(stream).toEqual({
      ErrorCode: 1235,
      Message: "The stream provided: 'nope' does not exist on this server.",
    });
    expect([...runtime.store.state.outbound.keys()]).toEqual([ok?.MessageID]);
  });

  it("answers per-message results for POSTMARK_API_TEST (gem api_client_messages_spec)", async () => {
    const res = await setup().post("/email/batch", [message(), message()], "POSTMARK_API_TEST");
    expect((await items(res)).map((i) => i.Message)).toEqual([
      "Test job accepted",
      "Test job accepted",
    ]);
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
