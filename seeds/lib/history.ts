import { randomUUID } from "node:crypto";
import { composeMime } from "../../src/mime/compose.ts";
import { inactiveRecipientsError } from "../../src/pipeline/inactive.ts";
import { recordBounceAt } from "../../src/recipients/transitions.ts";
import type { Runtime } from "../../src/runtime.ts";
import { smtpApiErrorBounce } from "../../src/smtp/receive.ts";
import { newMessageId } from "../../src/state/ids.ts";
import { findSuppression } from "../../src/state/suppressions.ts";
import type { Bounce, BounceType, InboundMessage, OutboundMessage } from "../../src/state/types.ts";
import { CONFORMANCE } from "./conformance.ts";

// Past traffic for seeds and tests: messages accepted and bounced before "now". Each record fires
// the event live traffic fires, so message events and stats follow.

/** MIME source for the dump endpoint, with the headers Postmark adds (refs/api_messages-api.md:276). */
const rawSource = (m: OutboundMessage): string =>
  composeMime(
    {
      from: m.From,
      to: m.To.map((a) => a.Email),
      cc: [],
      subject: m.Subject ?? "",
      text: m.TextBody ?? "",
      headers: [
        ...(m.Tag === null ? [] : [{ name: "X-PM-Tag", value: m.Tag }]),
        { name: "X-PM-Message-Id", value: m.MessageID },
        { name: "Message-ID", value: `<${randomUUID()}@mtasv.net>` },
      ],
      attachments: [],
    },
    m.ReceivedAt,
  );

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
    suppressedRecipients: [],
    ...fields,
  };
  message.rawSource = rawSource(message);
  runtime.store.state.outbound.set(message.MessageID, message);
  await runtime.events.emit("sent", { message });
  return message;
}

/**
 * The first To recipient's server bounces the message at `at`, through the recipient state machine
 * (a hard bounce suppresses the address). `id` comes from the caller's range (docs/11 §5).
 */
export const pastBounce = (
  runtime: Runtime,
  message: OutboundMessage,
  { id, type, at }: { id: number; type: BounceType; at: Date },
): Promise<Bounce> =>
  recordBounceAt(
    runtime,
    {
      message,
      email: message.To[0]?.Email as string,
      type,
      details: "smtp;550 5.1.1 The email account that you tried to reach does not exist.",
      content: `Return-Path: <>\r\nSubject: Undeliverable: ${message.Subject}\r\n\r\nbounce dump\r\n`,
    },
    { id: runtime.store.useId("bounce", id), at },
  );

/**
 * An SMTP message to a suppressed address: Postmark accepts no message and records an SMTP API
 * error bounce (docs/07 §1.4). `email` must be suppressed on `stream`.
 */
export async function pastSmtpApiError(
  runtime: Runtime,
  fields: {
    id: number;
    serverId: number;
    stream: string;
    email: string;
    tag: string | null;
    at: Date;
  },
): Promise<Bounce> {
  if (
    findSuppression(runtime.store.state, fields.serverId, fields.stream, fields.email) === undefined
  ) {
    throw new Error(`${fields.email} is not suppressed on ${fields.stream}`);
  }
  const subject = "History";
  const bounce = smtpApiErrorBounce(
    runtime.store.useId("bounce", fields.id),
    fields.at,
    {
      serverId: fields.serverId,
      stream: fields.stream,
      messageId: newMessageId(),
      tag: fields.tag,
      from: CONFORMANCE.senderEmail,
      subject,
      metadata: {},
      source: `From: ${CONFORMANCE.senderEmail}\r\nTo: ${fields.email}\r\nSubject: ${subject}\r\n\r\n${subject}\r\n`,
    },
    fields.email,
    inactiveRecipientsError([fields.email]),
  );
  runtime.store.state.bounces.set(bounce.ID, bounce);
  await runtime.events.emit("smtpApiError", { bounce });
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
