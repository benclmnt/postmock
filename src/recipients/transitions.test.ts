import { describe, expect, it } from "vitest";
import { CONFORMANCE } from "../../seeds/lib/conformance.ts";
import type { EventMap } from "../events.ts";
import { suppressedAddresses } from "../state/suppressions.ts";
import { recipientsKit } from "./testkit.ts";

const DAY = 24 * 60 * 60 * 1000;
const suppressions = "/message-streams/outbound/suppressions";

async function kit() {
  const k = await recipientsKit();
  const seen: string[] = [];
  const changes: EventMap["subscriptionChange"]["change"][] = [];
  k.runtime.events.on("bounced", ({ bounce }) => void seen.push(`bounced ${bounce.Email}`));
  k.runtime.events.on("spamComplaint", ({ bounce }) => void seen.push(`spam ${bounce.Email}`));
  k.runtime.events.on("subscriptionChange", ({ change }) => {
    seen.push(`change ${change.Recipient} ${change.SuppressSending}`);
    changes.push(change);
  });
  const suppressed = (email: string, stream = "outbound") =>
    suppressedAddresses(k.runtime.store.state, CONFORMANCE.serverId, stream, [email]).length === 1;
  return { ...k, seen, changes, suppressed };
}

describe("T1, T2: hard bounce", () => {
  it("adds an inactive bounce and a Recipient row on the send stream only, then emits both events", async () => {
    const { deliver, controlPost, call, seen, changes, suppressed } = await kit();
    const message = deliver("Ann@Example.com");
    const res = await controlPost("/control/bounces", {
      messageId: message.MessageID,
      recipient: "ann@example.com",
      type: "HardBounce",
    });
    expect(res.status).toBe(200);
    const bounce = (await call("GET", `/bounces/${res.body.ID}`)).body;
    expect(bounce).toMatchObject({
      Email: "Ann@Example.com",
      Inactive: true,
      CanActivate: true,
      TypeCode: 1,
    });
    expect(suppressed("ann@EXAMPLE.com")).toBe(true);
    expect(suppressed("ann@example.com", "broadcast")).toBe(false);
    expect(seen).toEqual(["bounced Ann@Example.com", "change Ann@Example.com true"]);
    expect(changes[0]).toMatchObject({
      MessageID: message.MessageID,
      Origin: "Recipient",
      SuppressionReason: "HardBounce",
      Tag: "welcome",
      Metadata: { a: "1" },
    });
  });

  it("refuses a recipient the message did not have and a type with an unknown effect", async () => {
    const { deliver, controlPost } = await kit();
    const message = deliver("a@example.com");
    const base = { messageId: message.MessageID, recipient: "b@example.com", type: "HardBounce" };
    expect((await controlPost("/control/bounces", base)).status).toBe(400);
    const unknown = { ...base, recipient: "a@example.com", type: "Blocked" };
    expect((await controlPost("/control/bounces", unknown)).status).toBe(400);
  });
});

describe("T4: soft bounce", () => {
  it("stays active and suppresses nothing", async () => {
    const { deliver, controlPost, call, suppressed, seen } = await kit();
    const message = deliver("soft@example.com");
    const { body } = await controlPost("/control/bounces", {
      messageId: message.MessageID,
      recipient: "soft@example.com",
      type: "SoftBounce",
    });
    expect((await call("GET", `/bounces/${body.ID}`)).body.Inactive).toBe(false);
    expect(suppressed("soft@example.com")).toBe(false);
    expect(seen).toEqual(["bounced soft@example.com"]);
  });
});

describe("Flow A: Suppressions API reactivation (T7, T9)", () => {
  it("delete lifts a HardBounce row and turns its bounce active", async () => {
    const { deliver, controlPost, call, suppressed, changes } = await kit();
    const message = deliver("hb@example.com");
    const { body } = await controlPost("/control/bounces", {
      messageId: message.MessageID,
      recipient: "hb@example.com",
      type: "HardBounce",
    });
    const dump = await call("GET", `${suppressions}/dump?emailAddress=hb@example.com`);
    expect(dump.body.Suppressions).toMatchObject([
      { SuppressionReason: "HardBounce", Origin: "Recipient" },
    ]);
    const deleted = await call("POST", `${suppressions}/delete`, {
      Suppressions: [{ EmailAddress: "hb@example.com" }],
    });
    expect(deleted.body).toEqual({
      Suppressions: [{ EmailAddress: "hb@example.com", Status: "Deleted", Message: null }],
    });
    expect(suppressed("hb@example.com")).toBe(false);
    expect((await call("GET", `/bounces/${body.ID}`)).body.Inactive).toBe(false);
    expect(changes.at(-1)).toMatchObject({
      MessageID: null,
      SuppressSending: false,
      SuppressionReason: null,
      Tag: null,
      Metadata: {},
    });
  });

  it("a spam complaint cannot be lifted by delete or by suppressing again", async () => {
    const { deliver, controlPost, call, suppressed, seen } = await kit();
    const message = deliver("spam@example.com");
    const complaint = await controlPost("/control/events/spam-complaint", {
      messageId: message.MessageID,
      recipient: "spam@example.com",
    });
    expect(seen).toEqual(["spam spam@example.com", "change spam@example.com true"]);
    const item = { Suppressions: [{ EmailAddress: "spam@example.com" }] };
    const authority = "You do not have the required authority to change this suppression.";
    expect((await call("POST", `${suppressions}/delete`, item)).body.Suppressions[0]).toEqual({
      EmailAddress: "spam@example.com",
      Status: "Failed",
      Message: authority,
    });
    expect((await call("POST", suppressions, item)).body.Suppressions[0].Status).toBe("Failed");
    expect(suppressed("spam@example.com")).toBe(true);
    const activate = await call("PUT", `/bounces/${complaint.body.ID}/activate`);
    expect(activate).toMatchObject({ status: 422, body: { ErrorCode: 1003 } });
  });
});

describe("Flow B: Bounce API reactivation (T11)", () => {
  it("activate removes the row, keeps the bounce listed, and answers OK with Content", async () => {
    const { deliver, controlPost, call, suppressed } = await kit();
    const message = deliver("act@example.com");
    const { body } = await controlPost("/control/bounces", {
      messageId: message.MessageID,
      recipient: "act@example.com",
      type: "HardBounce",
      dump: "raw dump",
    });
    const res = await call("PUT", `/bounces/${body.ID}/activate`, {});
    expect(res.body).toMatchObject({
      Message: "OK",
      Bounce: { ID: body.ID, Inactive: false, Content: "raw dump" },
    });
    expect(suppressed("act@example.com")).toBe(false);
    const list = await call("GET", "/bounces?count=10&offset=0&emailFilter=act@");
    expect(list.body.Bounces.map((b: { ID: number }) => b.ID)).toEqual([body.ID]);
  });
});

describe("T5: unsubscribe", () => {
  it("adds a ManualSuppression/Recipient row on a Postmark-handled Broadcasts stream only", async () => {
    const { deliver, controlPost, call } = await kit();
    const broadcast = deliver("u@example.com", "broadcast");
    const res = await controlPost("/control/events/unsubscribe", {
      messageId: broadcast.MessageID,
      recipient: "u@example.com",
    });
    expect(res.body).toEqual({ suppressed: true });
    const dump = await call("GET", "/message-streams/broadcast/suppressions/dump");
    expect(dump.body.Suppressions).toMatchObject([
      {
        EmailAddress: "u@example.com",
        SuppressionReason: "ManualSuppression",
        Origin: "Recipient",
      },
    ]);
    const transactional = deliver("u@example.com");
    const refused = await controlPost("/control/events/unsubscribe", {
      messageId: transactional.MessageID,
      recipient: "u@example.com",
    });
    expect(refused.status).toBe(400);
  });
});

describe("T14: retention", () => {
  it("drops a bounce after 45 days and its dump after 30; the row stays", async () => {
    const { deliver, controlPost, call, runtime, suppressed } = await kit();
    const message = deliver("old@example.com");
    const { body } = await controlPost("/control/bounces", {
      messageId: message.MessageID,
      recipient: "old@example.com",
      type: "HardBounce",
    });
    await runtime.clock.advance(31 * DAY);
    expect((await call("GET", `/bounces/${body.ID}`)).body.DumpAvailable).toBe(false);
    expect((await call("GET", `/bounces/${body.ID}/dump`)).body.ErrorCode).toBe(1001);
    await runtime.clock.advance(15 * DAY);
    expect((await call("GET", `/bounces/${body.ID}`)).body.ErrorCode).toBe(1001);
    expect(suppressed("old@example.com")).toBe(true);
  });
});

describe("control refusals: only states a real recipient event can produce", () => {
  it("refuses an address suppressed at send time, a bounce after a final one, a stream purged since the send, and a queued message", async () => {
    const { deliver, controlPost, call, runtime } = await kit();
    const skipped = deliver("hardbounce@example.com");
    skipped.suppressedRecipients = ["HardBounce@example.com"];
    const bounce = (messageId: string, recipient: string) =>
      controlPost("/control/bounces", { messageId, recipient, type: "HardBounce" });
    expect((await bounce(skipped.MessageID, "hardbounce@example.com")).status).toBe(400);
    await call("POST", `${suppressions}/delete`, {
      Suppressions: [{ EmailAddress: "hardbounce@example.com" }],
    });
    expect((await bounce(skipped.MessageID, "hardbounce@example.com")).status).toBe(400);
    const message = deliver("twice@example.com");
    const soft = { messageId: message.MessageID, recipient: "twice@example.com" };
    expect((await controlPost("/control/bounces", { ...soft, type: "Transient" })).status).toBe(
      200,
    );
    expect((await bounce(message.MessageID, "twice@example.com")).status).toBe(200);
    expect((await controlPost("/control/bounces", { ...soft, type: "SoftBounce" })).status).toBe(
      400,
    );
    await call("POST", "/message-streams", {
      ID: "promo",
      Name: "Promo",
      MessageStreamType: "Broadcasts",
    });
    const onPromo = deliver("promo@example.com", "promo");
    await call("POST", "/message-streams/promo/archive");
    await runtime.clock.advance(45 * DAY);
    await call("POST", "/message-streams", {
      ID: "promo",
      Name: "Promo",
      MessageStreamType: "Broadcasts",
    });
    expect((await bounce(onPromo.MessageID, "promo@example.com")).status).toBe(400);
    const queued = deliver("queued@example.com");
    queued.Status = "Queued";
    expect((await bounce(queued.MessageID, "queued@example.com")).status).toBe(400);
  });
});

describe("T13: bounce after reactivation", () => {
  it("adds a new inactive bounce and a new row", async () => {
    const { deliver, controlPost, call, suppressed, runtime } = await kit();
    const first = deliver("again@example.com");
    const one = await controlPost("/control/bounces", {
      messageId: first.MessageID,
      recipient: "again@example.com",
      type: "HardBounce",
    });
    await call("PUT", `/bounces/${one.body.ID}/activate`);
    await runtime.clock.advance(1000);
    const second = deliver("again@example.com");
    const two = await controlPost("/control/bounces", {
      messageId: second.MessageID,
      recipient: "again@example.com",
      type: "HardBounce",
    });
    expect(two.body.ID).toBeGreaterThan(one.body.ID);
    expect(suppressed("again@example.com")).toBe(true);
    expect((await call("GET", `/bounces/${one.body.ID}`)).body.Inactive).toBe(false);
    expect((await call("GET", `/bounces/${two.body.ID}`)).body.Inactive).toBe(true);
  });
});

describe("uncaptured effects answer 501", () => {
  it("T10: delete of an unsubscribe row; activate of an active bounce; archived or inbound suppressions", async () => {
    const { deliver, controlPost, call } = await kit();
    const broadcast = deliver("u@example.com", "broadcast");
    await controlPost("/control/events/unsubscribe", {
      messageId: broadcast.MessageID,
      recipient: "u@example.com",
    });
    const item = { Suppressions: [{ EmailAddress: "u@example.com" }] };
    expect(
      (await call("POST", "/message-streams/broadcast/suppressions/delete", item)).status,
    ).toBe(501);
    expect((await call("PUT", "/bounces/2002/activate")).status).toBe(501);
    expect((await call("GET", "/message-streams/inbound/suppressions/dump")).status).toBe(501);
    await call("POST", "/message-streams/broadcast/archive");
    expect((await call("GET", "/message-streams/broadcast/suppressions/dump")).status).toBe(501);
  });
});
