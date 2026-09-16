import type { Seed } from "../../src/control/seed.ts";
import { BOUNCE_DESCRIPTIONS } from "../../src/recipients/transitions.ts";
import { suppressionKey } from "../../src/state/store.ts";
import type { Bounce, BounceType, OutboundMessage } from "../../src/state/types.ts";
import { CONFORMANCE } from "../lib/conformance.ts";

// The conformance server received two bounces: SDK suites read the first bounce, its dump, and activate an
// inactive one (docs/08 §5.3). The messages carry the bounced addresses, never the recipient that
// sending tests use. Bounce IDs come from the T2 range (docs/11 §5).

const MINUTE = 60_000;

const bounced = (
  now: Date,
  id: number,
  messageId: string,
  email: string,
  type: BounceType,
  details: string,
  minutesAgo: number,
): [OutboundMessage, Bounce] => {
  const sentAt = new Date(now.getTime() - (minutesAgo + 1) * MINUTE);
  const bouncedAt = new Date(now.getTime() - minutesAgo * MINUTE);
  const subject = "postmock seeded bounce";
  const message: OutboundMessage = {
    MessageID: messageId,
    ServerID: CONFORMANCE.serverId,
    MessageStream: "outbound",
    From: CONFORMANCE.senderEmail,
    To: [{ Email: email, Name: null }],
    Cc: [],
    Bcc: [],
    ReplyTo: null,
    Subject: subject,
    HtmlBody: null,
    TextBody: "Hello",
    Tag: "postmock-bounce",
    Headers: [],
    Attachments: [],
    Metadata: {},
    TrackOpens: false,
    TrackLinks: "None",
    Status: "Sent",
    Sandboxed: false,
    ReceivedAt: sentAt,
    // docs/06 §1.6; a hard bounce also suppresses the address.
    MessageEvents: [
      {
        Recipient: email,
        Type: "Bounced",
        ReceivedAt: bouncedAt,
        Details: { Summary: details, BounceID: String(id) },
      },
      ...(type === "HardBounce"
        ? [
            {
              Recipient: email,
              Type: "SubscriptionChanged" as const,
              ReceivedAt: bouncedAt,
              Details: { Origin: "Recipient", SuppressSending: "True" },
            },
          ]
        : []),
    ],
    channel: "rest",
    request: {
      From: CONFORMANCE.senderEmail,
      To: email,
      Subject: subject,
      TextBody: "Hello",
      Tag: "postmock-bounce",
      MessageStream: "outbound",
    },
    rawSource: "",
    bulkRequestId: null,
    templateId: null,
    suppressedRecipients: [],
  };
  const bounce: Bounce = {
    ID: id,
    ServerID: CONFORMANCE.serverId,
    MessageStream: "outbound",
    MessageID: messageId,
    Type: type,
    Tag: message.Tag,
    Description: BOUNCE_DESCRIPTIONS[type],
    Details: details,
    Email: email,
    From: CONFORMANCE.senderEmail,
    Subject: subject,
    BouncedAt: bouncedAt,
    Inactive: type === "HardBounce",
    CanActivate: true,
    Content: `Return-Path: <>\r\nSubject: Undelivered Mail Returned to Sender\r\n\r\n${details}\r\n`,
    Metadata: {},
  };
  return [message, bounce];
};

const bounces: Seed = ({ store, clock }) => {
  const now = clock.now();
  const seeded = [
    bounced(
      now,
      2001,
      "6f1c2a0e-2b7d-4c55-9a51-0c3f2d7e2001",
      "hardbounce@example.com",
      "HardBounce",
      "smtp;550 5.1.1 The email account does not exist.",
      120,
    ),
    bounced(
      now,
      2002,
      "6f1c2a0e-2b7d-4c55-9a51-0c3f2d7e2002",
      "softbounce@example.com",
      "SoftBounce",
      "smtp;452 4.2.2 The mailbox is full.",
      60,
    ),
  ];
  for (const [message, bounce] of seeded) {
    store.useId("bounce", bounce.ID);
    store.state.outbound.set(message.MessageID, message);
    store.state.bounces.set(bounce.ID, bounce);
    if (bounce.Inactive) {
      store.state.suppressions.set(
        suppressionKey(bounce.ServerID, bounce.MessageStream, bounce.Email),
        {
          ServerID: bounce.ServerID,
          MessageStream: bounce.MessageStream,
          EmailAddress: bounce.Email,
          SuppressionReason: "HardBounce",
          Origin: "Recipient",
          CreatedAt: bounce.BouncedAt,
        },
      );
    }
  }
};
export default bounces;
