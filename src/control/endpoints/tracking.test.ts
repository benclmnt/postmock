import { describe, expect, it } from "vitest";
import { pastBounce, pastSend } from "../../../seeds/lib/history.ts";
import { createRuntime } from "../../runtime.ts";
import { createServer } from "../../state/servers.ts";
import type { OutboundMessage } from "../../state/types.ts";
import { createControlApp } from "../app.ts";

// biome-ignore lint/suspicious/noExplicitAny: a test reads response JSON loosely
type Json = any;

async function setup(fields: Partial<OutboundMessage> = {}) {
  const runtime = createRuntime();
  const server = createServer(runtime.store, runtime.clock.now());
  const message = await pastSend(runtime, {
    ServerID: server.ID,
    ReceivedAt: runtime.clock.now(),
    To: [{ Email: "reader@example.com", Name: null }],
    TrackOpens: true,
    TrackLinks: "HtmlOnly",
    HtmlBody: '<a href="https://example.com/a">a</a>',
    TextBody: "https://example.com/text",
    ...fields,
  });
  const control = createControlApp(runtime, "empty");
  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await control.request(`/control/events/${path}`, {
      method: "POST",
      body: JSON.stringify({
        messageId: message.MessageID,
        recipient: "reader@example.com",
        ...body,
      }),
    });
    return { status: res.status, body: (await res.json()) as Json };
  };
  return { runtime, message, post };
}

describe("recipient events a real recipient could not produce", () => {
  it.each([
    ["open", {}, { TrackOpens: false }, "has no open tracking"],
    ["open", { recipient: "stranger@example.com" }, {}, "was not sent to"],
    ["open", { messageId: "nope" }, {}, "no outbound message"],
    ["open", {}, { Sandboxed: true }, "is sandboxed"],
    ["open", {}, { suppressedRecipients: ["READER@example.com"] }, "was suppressed when"],
    [
      "click",
      { link: "https://example.com/text", clickLocation: "Text" },
      {},
      "has no tracked link",
    ],
    ["click", { link: "https://example.com/b", clickLocation: "HTML" }, {}, "has no tracked link"],
  ])("refuses %s %j on a message with %j", async (kind, body, fields, error) => {
    const { post, runtime } = await setup(fields);
    await post("delivery", {});
    const res = await post(kind, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(error);
    expect(runtime.store.state.stats.filter((f) => f.kind !== "sent")).toEqual([]);
  });

  it("refuses an open or click before delivery, and any event on a queued message", async () => {
    const { post } = await setup();
    expect((await post("open", {})).body.error).toContain("was not delivered");
    const click = { link: "https://example.com/a", clickLocation: "HTML" };
    expect((await post("click", click)).body.error).toContain("was not delivered");
    const queued = await setup({ Status: "Queued" });
    expect((await queued.post("delivery", {})).body.error).toContain("is queued");
  });

  it("refuses an empty geo", async () => {
    const { post } = await setup();
    await post("delivery", {});
    expect((await post("open", { geo: {} })).status).toBe(400);
  });

  it("refuses an open after a hard bounce and a second delivery", async () => {
    const { post, runtime, message } = await setup();
    expect((await post("delivery", {})).status).toBe(200);
    expect((await post("delivery", {})).body.error).toContain("already reached");
    await pastBounce(runtime, message, { id: 1, type: "HardBounce", at: runtime.clock.now() });
    expect((await post("open", {})).body.error).toContain("bounced");
  });
});

describe("message events", () => {
  it("records the first open, each first click per link and bounces on the message", async () => {
    const { post, runtime, message } = await setup({
      To: [
        { Email: "reader@example.com", Name: null },
        { Email: "gone@example.com", Name: null },
      ],
    });
    await post("delivery", {});
    await post("open", { userAgent: "Mail/1" });
    await post("open", { userAgent: "Mail/2" });
    const click = { link: "https://example.com/a", clickLocation: "HTML" };
    await post("click", click);
    await post("click", click);
    const bounce = await pastBounce(
      runtime,
      { ...message, To: [{ Email: "gone@example.com", Name: null }] },
      { id: 7, type: "HardBounce", at: runtime.clock.now() },
    );
    expect(message.MessageEvents.map((e) => [e.Type, e.Details])).toEqual([
      ["Delivered", { DeliveryMessage: "smtp;250 2.0.0 OK" }],
      ["Opened", { Summary: "Email opened with Mail/1" }],
      [
        "LinkClicked",
        {
          Summary: "Tracked Link 'https://example.com/a' was clicked from the HTMLBody.",
          Link: "https://example.com/a",
          ClickLocation: "HTML",
        },
      ],
      ["Bounced", { Summary: bounce.Details, BounceID: "7" }],
      ["SubscriptionChanged", { Origin: "Recipient", SuppressSending: "True" }],
    ]);
    const kinds = runtime.store.state.stats.map((f) => f.kind);
    expect(kinds).toEqual(["sent", "sent", "open", "open", "click", "click", "bounce"]);
  });

  it("records a spam complaint as a Bounced event", async () => {
    const { post, runtime, message } = await setup();
    await post("delivery", {});
    const complaint = await pastBounce(runtime, message, {
      id: 9,
      type: "SpamComplaint",
      at: runtime.clock.now(),
    });
    expect(message.MessageEvents.map((e) => [e.Type, e.Details])).toContainEqual([
      "Bounced",
      { Summary: complaint.Description, BounceID: "9" },
    ]);
  });
});
