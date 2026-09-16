import type { Runtime } from "../../src/runtime.ts";
import { newMessageId } from "../../src/state/ids.ts";
import type { Bounce, BounceType, InboundMessage, OutboundMessage } from "../../src/state/types.ts";

// Past traffic for seeds and tests: messages accepted and bounced before "now". Each record fires
// the event live traffic fires, so message events and stats follow.

/** MIME source for the dump endpoint: headers and the text body. */
function rawSource(m: OutboundMessage): string {
  return [
    `From: ${m.From}`,
    `To: ${m.To.map((a) => a.Email).join(", ")}`,
    `Subject: ${m.Subject ?? ""}`,
    `Date: ${m.ReceivedAt.toUTCString()}`,
    `X-PM-Message-Id: ${m.MessageID}`,
    ...(m.Tag === null ? [] : [`X-PM-Tag: ${m.Tag}`]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    m.TextBody ?? "",
    "",
  ].join("\r\n");
}

/** An outbound message accepted at `ReceivedAt`. */
export async function pastSend(
  runtime: Runtime,
  fields: Partial<OutboundMessage> & Pick<OutboundMessage, "ServerID" | "ReceivedAt" | "To">,
): Promise<OutboundMessage> {
  const message: OutboundMessage = {
    MessageID: newMessageId(),
    MessageStream: "outbound",
    From: "sender@example.com",
    Cc: [],
    Bcc: [],
    ReplyTo: null,
    Subject: "History",
    HtmlBody: null,
    TextBody: "History",
    Tag: null,
    Headers: [],
    Attachments: [],
    Metadata: {},
    TrackOpens: false,
    TrackLinks: "None",
    Status: "Sent",
    Sandboxed: false,
    MessageEvents: [],
    channel: "rest",
    request: null,
    rawSource: "",
    bulkRequestId: null,
    templateId: null,
    ...fields,
  };
  message.rawSource = rawSource(message);
  runtime.store.state.outbound.set(message.MessageID, message);
  await runtime.events.emit("sent", { message });
  return message;
}

/** The first To recipient's server bounces the message. `ID` is fixed (docs/11 §5). */
export async function pastBounce(
  runtime: Runtime,
  message: OutboundMessage,
  { id, type, at }: { id: number; type: BounceType; at: Date },
): Promise<Bounce> {
  const bounce: Bounce = {
    ID: runtime.store.useId("bounce", id),
    ServerID: message.ServerID,
    MessageStream: message.MessageStream,
    MessageID: message.MessageID,
    Type: type,
    Tag: message.Tag,
    Description: "The server was unable to deliver your message.",
    Details: "smtp;550 5.1.1 The email account that you tried to reach does not exist.",
    Email: message.To[0]?.Email as string,
    From: message.From,
    Subject: message.Subject ?? "",
    BouncedAt: at,
    Inactive: type === "HardBounce",
    CanActivate: true,
    Content: `Return-Path: <>\r\nSubject: Undeliverable: ${message.Subject}\r\n\r\nbounce dump\r\n`,
    Metadata: message.Metadata,
  };
  runtime.store.state.bounces.set(bounce.ID, bounce);
  await runtime.events.emit(type === "SMTPApiError" ? "smtpApiError" : "bounced", { bounce });
  return bounce;
}

/** An inbound message stored as already processed, blocked or failed; no event fires. */
export function pastInbound(
  runtime: Runtime,
  fields: Partial<InboundMessage> & Pick<InboundMessage, "ServerID" | "ReceivedAt" | "Status">,
): InboundMessage {
  const server = runtime.store.state.servers.get(fields.ServerID);
  if (server === undefined) throw new Error(`no server ${fields.ServerID}`);
  const from = { Email: "writer@example.com", Name: "Writer", MailboxHash: "" };
  const to = { Email: server.InboundAddress, Name: "", MailboxHash: "" };
  const message: InboundMessage = {
    MessageID: newMessageId(),
    MessageStream: "inbound",
    From: from.Email,
    FromName: from.Name,
    FromFull: from,
    To: to.Email,
    ToFull: [to],
    Cc: "",
    CcFull: [],
    Bcc: "",
    BccFull: [],
    OriginalRecipient: to.Email,
    ReplyTo: "",
    Subject: "Inbound",
    MailboxHash: "",
    Date: fields.ReceivedAt.toUTCString().replace("GMT", "+0000"),
    TextBody: "Inbound message.",
    HtmlBody: "",
    StrippedTextReply: "",
    Tag: "",
    Headers: [{ Name: "MIME-Version", Value: "1.0" }],
    Attachments: [],
    BlockedReason:
      fields.Status === "Blocked" ? `Inbound request blocked by domain rule: ${from.Email}` : null,
    rawEmail: `From: ${from.Email}\r\nTo: ${to.Email}\r\nSubject: Inbound\r\n\r\nInbound message.\r\n`,
    ...fields,
  };
  runtime.store.state.inbound.set(message.MessageID, message);
  return message;
}
