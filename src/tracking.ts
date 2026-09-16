import type { Runtime } from "./runtime.ts";
import type { ClickEvent, ClientInfo, Geo, OpenEvent, OutboundMessage } from "./state/types.ts";

// What a real recipient can do with a delivered message: its server accepts it, the recipient
// opens it, the recipient clicks a tracked link (CONTROL-API.md principle). Control endpoints and
// seeds record these here; the Messages API and the stats plugin read the result.

/** A recipient action that real Postmark could not record. The control API answers 400. */
export class TrackingRefused extends Error {}

export type Platform = NonNullable<OpenEvent["Platform"]>;

/** What the recipient's client tells Postmark. Postmark derives Client, OS, Platform from it. */
export interface RecipientAgent {
  UserAgent: string;
  Client: ClientInfo | null;
  OS: ClientInfo | null;
  Platform: Platform | null;
  Geo: Geo | null;
}

const LINK = /https?:\/\/[^\s"'<>]+/g;

/**
 * The unique http(s) links Postmark rewrites for the message's `TrackLinks` mode. The same URL in
 * the HTML and the text body is one link (refs/api_stats-api.md:648). The URL pattern is INFERRED.
 */
export function trackedLinks(message: OutboundMessage, location?: ClickEvent["ClickLocation"]) {
  const mode = message.TrackLinks;
  const html = mode === "HtmlAndText" || mode === "HtmlOnly";
  const text = mode === "HtmlAndText" || mode === "TextOnly";
  const parts = [
    html && location !== "Text" ? (message.HtmlBody ?? "") : "",
    text && location !== "HTML" ? (message.TextBody ?? "") : "",
  ];
  return [...new Set(parts.flatMap((part) => part.match(LINK) ?? []))];
}

/** Every address the message went to, as sent. */
export const recipientsOf = (message: OutboundMessage): string[] =>
  [...message.To, ...message.Cc, ...message.Bcc].map((a) => a.Email);

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The delivered recipient of a stored message, spelled as sent. */
function reachedRecipient(runtime: Runtime, messageId: string, recipient: string) {
  const message = runtime.store.state.outbound.get(messageId);
  if (message === undefined) throw new TrackingRefused(`no outbound message ${messageId}`);
  // A sandbox server delivers nothing (docs/07).
  if (message.Sandboxed) throw new TrackingRefused(`message ${messageId} is sandboxed`);
  const address = recipientsOf(message).find((r) => same(r, recipient));
  if (address === undefined) {
    throw new TrackingRefused(`message ${messageId} was not sent to ${recipient}`);
  }
  const bounced = [...runtime.store.state.bounces.values()].some(
    (b) => b.MessageID === messageId && same(b.Email, address) && b.Type !== "Transient",
  );
  if (bounced) throw new TrackingRefused(`message ${messageId} bounced for ${address}`);
  return { message, address };
}

/** The recipient's mail server accepts the message (docs/05 §2.3). */
export async function recordDelivery(
  runtime: Runtime,
  input: { messageId: string; recipient: string; details: string },
  at: Date = runtime.clock.now(),
): Promise<{ MessageID: string; Recipient: string; ReceivedAt: Date }> {
  const { message, address } = reachedRecipient(runtime, input.messageId, input.recipient);
  const delivered = message.MessageEvents.some(
    (e) => e.Type === "Delivered" && same(e.Recipient, address),
  );
  if (delivered)
    throw new TrackingRefused(`message ${message.MessageID} already reached ${address}`);
  await runtime.events.emit("delivered", {
    message,
    recipient: address,
    deliveredAt: at,
    details: input.details,
  });
  return { MessageID: message.MessageID, Recipient: address, ReceivedAt: at };
}

/**
 * The recipient opens the message. Every open fires `opened` (webhook, stats). The Messages API
 * keeps only the first open per recipient (refs/api_messages-api.md:753-754).
 */
export async function recordOpen(
  runtime: Runtime,
  input: { messageId: string; recipient: string; agent: RecipientAgent; readSeconds: number },
  at: Date = runtime.clock.now(),
): Promise<OpenEvent> {
  const { message, address } = reachedRecipient(runtime, input.messageId, input.recipient);
  if (!message.TrackOpens) {
    throw new TrackingRefused(`message ${message.MessageID} has no open tracking`);
  }
  const opens = runtime.store.state.opens;
  const first = !opens.some((o) => o.MessageID === message.MessageID && same(o.Recipient, address));
  const open: OpenEvent = {
    ...eventBase(message, address, at),
    FirstOpen: first,
    ReadSeconds: input.readSeconds,
    ...input.agent,
  };
  if (first) opens.push(open);
  await runtime.events.emit("opened", { open });
  return open;
}

/**
 * The recipient clicks a tracked link. Every click fires `clicked`. The Messages API keeps one
 * click per recipient and unique link (refs/api_messages-api.md:864).
 */
export async function recordClick(
  runtime: Runtime,
  input: {
    messageId: string;
    recipient: string;
    link: string;
    location: ClickEvent["ClickLocation"];
    agent: RecipientAgent;
  },
  at: Date = runtime.clock.now(),
): Promise<ClickEvent> {
  const { message, address } = reachedRecipient(runtime, input.messageId, input.recipient);
  if (!trackedLinks(message, input.location).includes(input.link)) {
    throw new TrackingRefused(
      `message ${message.MessageID} has no tracked link ${input.link} in its ${input.location} body (TrackLinks ${message.TrackLinks})`,
    );
  }
  const clicks = runtime.store.state.clicks;
  const first = !clicks.some(
    (c) =>
      c.MessageID === message.MessageID &&
      same(c.Recipient, address) &&
      c.OriginalLink === input.link,
  );
  const click: ClickEvent = {
    ...eventBase(message, address, at),
    ClickLocation: input.location,
    OriginalLink: input.link,
    ...input.agent,
  };
  if (first) clicks.push(click);
  await runtime.events.emit("clicked", { click });
  return click;
}

const eventBase = (message: OutboundMessage, recipient: string, at: Date) => ({
  ServerID: message.ServerID,
  MessageID: message.MessageID,
  MessageStream: message.MessageStream,
  Recipient: recipient,
  Tag: message.Tag,
  Metadata: message.Metadata,
  ReceivedAt: at,
});
