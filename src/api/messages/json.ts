import type {
  ClickEvent,
  InboundMessage,
  MessageEvent,
  OpenEvent,
  OutboundMessage,
} from "../../state/types.ts";
import { formatTimestamp } from "../../time.ts";
import { recipientsOf } from "../../tracking.ts";

// Wire shapes of the Messages API, in doc field order. A null string field is sent as "", as the
// inbound examples show for `Tag` and `MailboxHash` (INFERRED for outbound).

/** Search item (refs/api_messages-api.md:62-89). `Attachments` are names (docs/06 §1.5, Q3). */
export const outboundJson = (m: OutboundMessage) => ({
  Tag: m.Tag ?? "",
  MessageID: m.MessageID,
  MessageStream: m.MessageStream,
  To: m.To,
  Cc: m.Cc,
  Bcc: m.Bcc,
  // Cc and Bcc addresses in `Recipients` are INFERRED; the example has To only.
  Recipients: recipientsOf(m),
  ReceivedAt: formatTimestamp(m.ReceivedAt),
  From: m.From,
  Subject: m.Subject ?? "",
  Attachments: m.Attachments.map((a) => a.Name),
  Status: m.Status,
  TrackOpens: m.TrackOpens,
  TrackLinks: m.TrackLinks,
  Metadata: m.Metadata,
  Sandboxed: m.Sandboxed,
});

const messageEventJson = (e: MessageEvent) => ({
  Recipient: e.Recipient,
  Type: e.Type,
  ReceivedAt: formatTimestamp(e.ReceivedAt),
  Details: e.Details,
});

/** Details (refs/api_messages-api.md:147-238). */
export const outboundDetailsJson = (m: OutboundMessage) => ({
  TextBody: m.TextBody ?? "",
  HtmlBody: m.HtmlBody ?? "",
  Body: m.rawSource,
  ...outboundJson(m),
  MessageEvents: m.MessageEvents.map(messageEventJson),
});

/**
 * Search item (refs/api_messages-api.md:335-372). postmark.js also reads `Bcc`, `BccFull` and
 * `MessageStream` (sdk/postmark.js/src/client/models/messages/InboundMessage.ts:8-28).
 */
export const inboundJson = (m: InboundMessage) => ({
  From: m.From,
  FromName: m.FromName,
  FromFull: { Email: m.FromFull.Email, Name: m.FromFull.Name },
  To: m.To,
  ToFull: m.ToFull,
  CcFull: m.CcFull,
  Cc: m.Cc,
  Bcc: m.Bcc,
  BccFull: m.BccFull,
  ReplyTo: m.ReplyTo,
  OriginalRecipient: m.OriginalRecipient,
  Subject: m.Subject,
  Date: m.Date,
  MailboxHash: m.MailboxHash,
  Tag: m.Tag,
  Attachments: m.Attachments.map((a) => ({
    Name: a.Name,
    ContentID: a.ContentID,
    ContentType: a.ContentType,
    ContentLength: a.ContentLength,
  })),
  MessageID: m.MessageID,
  MessageStream: m.MessageStream,
  Status: m.Status,
});

/** Details (refs/api_messages-api.md:431-518). */
export const inboundDetailsJson = (m: InboundMessage) => {
  const { MessageID, Status, ...rest } = inboundJson(m);
  return {
    ...rest,
    TextBody: m.TextBody,
    HtmlBody: m.HtmlBody,
    StrippedTextReply: m.StrippedTextReply,
    Headers: m.Headers,
    MessageID,
    BlockedReason: m.BlockedReason ?? "",
    Status,
  };
};

/** Client, OS, Platform and Geo are left out when unknown (refs/api_messages-api.md:707). */
const agentJson = (e: OpenEvent | ClickEvent) => ({
  ...(e.Client && { Client: e.Client }),
  ...(e.OS && { OS: e.OS }),
  ...(e.Platform && { Platform: e.Platform }),
  UserAgent: e.UserAgent,
  ...(e.Geo && { Geo: e.Geo }),
});

const tail = (e: OpenEvent | ClickEvent) => ({
  MessageID: e.MessageID,
  MessageStream: e.MessageStream,
  ReceivedAt: formatTimestamp(e.ReceivedAt),
  Tag: e.Tag ?? "",
  Recipient: e.Recipient,
});

/**
 * An open (refs/api_messages-api.md:671-699). The single-message example has no `RecordType`
 * (:769-797). `FirstOpen` and `ReadSeconds` are not in the Messages API docs; they stay out.
 */
export const openJson = (o: OpenEvent, single: boolean) => ({
  ...(!single && { RecordType: "Open" }),
  ...agentJson(o),
  ...tail(o),
});

/** A click (refs/api_messages-api.md:879-909, :979-1009). */
export const clickJson = (c: ClickEvent, single: boolean) => ({
  ...(!single && { RecordType: "Click" }),
  ClickLocation: c.ClickLocation,
  ...agentJson(c),
  OriginalLink: c.OriginalLink,
  ...tail(c),
});
