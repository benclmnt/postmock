import type { EventMap } from "../events.ts";
import {
  BOUNCE_TYPES,
  type Bounce,
  type ClickEvent,
  type InboundMessage,
  type OpenEvent,
  type SubscriptionChange,
} from "../state/types.ts";
import { formatTimestamp } from "../time.ts";

// Webhook bodies per RecordType, keys in doc order (docs/05 §2). Dates use the `Z` form of the doc
// examples. A send without a tag gives `Tag: ""`, as inbound does (INFERRED).

const at = (instant: Date) => formatTimestamp(instant, "utc");
const tag = (value: string | null) => value ?? "";

/** docs/05 §2.1, §2.2, §2.8. `Content` only when the hook asks for it. */
export function bouncePayload(
  recordType: "Bounce" | "SpamComplaint",
  bounce: Bounce,
  includeContent: boolean,
) {
  return {
    RecordType: recordType,
    MessageStream: bounce.MessageStream,
    ID: bounce.ID,
    Type: bounce.Type,
    TypeCode: BOUNCE_TYPES[bounce.Type].TypeCode,
    Name: BOUNCE_TYPES[bounce.Type].Name,
    Tag: tag(bounce.Tag),
    MessageID: bounce.MessageID,
    Metadata: bounce.Metadata,
    ServerID: bounce.ServerID,
    Description: bounce.Description,
    Details: bounce.Details,
    Email: bounce.Email,
    From: bounce.From,
    BouncedAt: at(bounce.BouncedAt),
    DumpAvailable: bounce.Content !== "",
    Inactive: bounce.Inactive,
    CanActivate: bounce.CanActivate,
    Subject: bounce.Subject,
    ...(includeContent && { Content: bounce.Content }),
  };
}

/** docs/05 §2.3: one event per recipient. */
export function deliveryPayload({
  message,
  recipient,
  deliveredAt,
  details,
}: EventMap["delivered"]) {
  return {
    RecordType: "Delivery",
    MessageStream: message.MessageStream,
    ServerID: message.ServerID,
    MessageID: message.MessageID,
    Recipient: recipient,
    Tag: tag(message.Tag),
    DeliveredAt: at(deliveredAt),
    Details: details,
    Metadata: message.Metadata,
  };
}

/** Client, OS, Platform and Geo are left out when unknown (docs/05 §2.4). */
const reader = (e: OpenEvent | ClickEvent) => ({
  ...(e.Client !== null && { Client: e.Client }),
  ...(e.OS !== null && { OS: e.OS }),
  ...(e.Platform !== null && { Platform: e.Platform }),
  UserAgent: e.UserAgent,
});

/** docs/05 §2.4. No `ServerID`. */
export function openPayload(open: OpenEvent) {
  return {
    RecordType: "Open",
    MessageStream: open.MessageStream,
    FirstOpen: open.FirstOpen,
    ...reader(open),
    ReadSeconds: open.ReadSeconds,
    ...(open.Geo !== null && { Geo: open.Geo }),
    MessageID: open.MessageID,
    Metadata: open.Metadata,
    ReceivedAt: at(open.ReceivedAt),
    Tag: tag(open.Tag),
    Recipient: open.Recipient,
  };
}

/** docs/05 §2.5. No `ServerID`. */
export function clickPayload(click: ClickEvent) {
  return {
    RecordType: "Click",
    MessageStream: click.MessageStream,
    ClickLocation: click.ClickLocation,
    ...reader(click),
    OriginalLink: click.OriginalLink,
    ...(click.Geo !== null && { Geo: click.Geo }),
    MessageID: click.MessageID,
    Metadata: click.Metadata,
    ReceivedAt: at(click.ReceivedAt),
    Tag: tag(click.Tag),
    Recipient: click.Recipient,
  };
}

/** docs/05 §2.6. `MessageID`, `SuppressionReason` and `Tag` stay null where the change has none. */
export function subscriptionChangePayload(change: SubscriptionChange) {
  return {
    RecordType: "SubscriptionChange",
    MessageID: change.MessageID,
    ServerID: change.ServerID,
    MessageStream: change.MessageStream,
    ChangedAt: at(change.ChangedAt),
    Recipient: change.Recipient,
    Origin: change.Origin,
    SuppressSending: change.SuppressSending,
    SuppressionReason: change.SuppressionReason,
    Tag: change.Tag,
    Metadata: change.Metadata,
  };
}

/** docs/05 §2.7, §4.2. No `RecordType`. `RawEmail` only with the server's `RawEmailEnabled`. */
export function inboundPayload(message: InboundMessage, rawEmailEnabled: boolean) {
  return {
    FromName: message.FromName,
    MessageStream: message.MessageStream,
    From: message.From,
    FromFull: message.FromFull,
    To: message.To,
    ToFull: message.ToFull,
    Cc: message.Cc,
    CcFull: message.CcFull,
    Bcc: message.Bcc,
    BccFull: message.BccFull,
    OriginalRecipient: message.OriginalRecipient,
    Subject: message.Subject,
    MessageID: message.MessageID,
    ReplyTo: message.ReplyTo,
    MailboxHash: message.MailboxHash,
    Date: message.Date,
    TextBody: message.TextBody,
    HtmlBody: message.HtmlBody,
    StrippedTextReply: message.StrippedTextReply,
    Tag: message.Tag,
    Headers: message.Headers,
    Attachments: message.Attachments,
    ...(rawEmailEnabled && { RawEmail: message.rawEmail }),
  };
}
