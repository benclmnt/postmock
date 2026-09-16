import type { Seed } from "../../src/control/seed.ts";
import type { Runtime } from "../../src/runtime.ts";
import { newMessageId } from "../../src/state/ids.ts";
import type {
  Address,
  Bounce,
  BounceType,
  InboundMessage,
  InboundStatus,
  OutboundMessage,
} from "../../src/state/types.ts";
import { recordClick, recordDelivery, recordOpen } from "../../src/tracking.ts";
import { CONFORMANCE } from "../lib/conformance.ts";

// Message history on server 1 for the read suites (docs/08 §5.3; T4 ID range 4000–4999):
// ≥ 33 outbound messages in the retention window, some tagged `test_tag`, with deliveries,
// bounces, opens and clicks; inbound messages in several statuses; and older sends that make the
// stats windows of the dotnet live test decrease strictly
// (sdk/postmark-dotnet/src/Postmark.Tests/ClientStatisticsTests.cs:43-66).
// History fires the same events as live traffic, so message events and stats follow.
// Recipients use their own addresses, so bounces here suppress nobody another suite sends to.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LINK = "https://example.com/welcome";

const address = (Email: string): Address => ({ Email, Name: null });

function rawSource(m: OutboundMessage): string {
  const to = m.To.map((a) => a.Email).join(", ");
  return [
    `From: ${m.From}`,
    `To: ${to}`,
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

async function sent(
  runtime: Runtime,
  at: Date,
  fields: { to: string[]; cc?: string[]; subject: string; tag: string | null; tracked: boolean },
): Promise<OutboundMessage> {
  const message: OutboundMessage = {
    MessageID: newMessageId(),
    ServerID: CONFORMANCE.serverId,
    MessageStream: "outbound",
    From: CONFORMANCE.senderEmail,
    To: fields.to.map(address),
    Cc: (fields.cc ?? []).map(address),
    Bcc: [],
    ReplyTo: null,
    Subject: fields.subject,
    HtmlBody: `<p>${fields.subject}</p><p><a href="${LINK}">Start</a></p>`,
    TextBody: `${fields.subject}\n\nStart: ${LINK}`,
    Tag: fields.tag,
    Headers: [],
    Attachments: [],
    Metadata: { seed: "t4" },
    TrackOpens: fields.tracked,
    TrackLinks: fields.tracked ? "HtmlAndText" : "None",
    Status: "Sent",
    Sandboxed: false,
    ReceivedAt: at,
    MessageEvents: [],
    channel: "rest",
    request: null,
    rawSource: "",
    bulkRequestId: null,
    templateId: null,
  };
  message.rawSource = rawSource(message);
  runtime.store.state.outbound.set(message.MessageID, message);
  await runtime.events.emit("sent", { message });
  return message;
}

async function bounce(
  runtime: Runtime,
  id: number,
  message: OutboundMessage,
  type: BounceType,
  at: Date,
): Promise<void> {
  const record: Bounce = {
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
  runtime.store.state.bounces.set(record.ID, record);
  await runtime.events.emit(type === "SMTPApiError" ? "smtpApiError" : "bounced", {
    bounce: record,
  });
}

function inbound(runtime: Runtime, at: Date, n: number, status: InboundStatus): void {
  const server = runtime.store.state.servers.get(CONFORMANCE.serverId);
  if (server === undefined) throw new Error("the core seed part creates server 1");
  const from = { Email: `writer-${n}@example.com`, Name: `Writer ${n}`, MailboxHash: "" };
  const to = { Email: server.InboundAddress, Name: "", MailboxHash: "" };
  const message: InboundMessage = {
    MessageID: newMessageId(),
    ServerID: server.ID,
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
    Subject: `Inbound ${n}`,
    MailboxHash: "",
    Date: at.toUTCString().replace("GMT", "+0000"),
    TextBody: `Inbound message ${n}.`,
    HtmlBody: "",
    StrippedTextReply: "",
    Tag: "",
    Headers: [{ Name: "MIME-Version", Value: "1.0" }],
    Attachments: [],
    Status: status,
    BlockedReason:
      status === "Blocked" ? `Inbound request blocked by domain rule: ${from.Email}` : null,
    ReceivedAt: at,
    rawEmail: `From: ${from.Email}\r\nTo: ${to.Email}\r\nSubject: Inbound ${n}\r\n\r\nInbound message ${n}.\r\n`,
  };
  runtime.store.state.inbound.set(message.MessageID, message);
}

const CLIENTS = [
  { Name: "Apple Mail 16.0", Company: "Apple Inc.", Family: "Apple Mail" },
  { Name: "Outlook 2019", Company: "Microsoft Corporation", Family: "Outlook" },
  { Name: "Chrome 120.0", Company: "Google Inc.", Family: "Chrome" },
  { Name: "Safari 17.1", Company: "Apple Inc.", Family: "Safari" },
];

/** A mail client for opens (`browser` false) or a browser for clicks. */
const agent = (n: number, browser: boolean) => ({
  UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
  Client: CLIENTS[(browser ? 2 : 0) + (n % 3 === 0 ? 1 : 0)] ?? null,
  OS: { Name: "OS X 10.15 Catalina", Company: "Apple Computer, Inc.", Family: "OS X" },
  Platform: n % 3 === 0 ? ("Mobile" as const) : ("Desktop" as const),
  Geo: { CountryISOCode: "DK", Country: "Denmark", City: "Copenhagen" },
});

const messages: Seed = async (runtime) => {
  const now = runtime.clock.now().getTime();
  const ago = (ms: number) => new Date(now - ms);

  const recent: OutboundMessage[] = [];
  for (let i = 0; i < 40; i++) {
    recent.push(
      await sent(runtime, ago(i * 15 * HOUR + HOUR), {
        to: [`reader-${i % 5}@example.com`],
        ...(i % 7 === 0 && { cc: ["reader-cc@example.com"] }),
        subject: `Order update ${i}`,
        tag: i % 3 === 0 ? "test_tag" : null,
        tracked: i % 4 !== 3,
      }),
    );
  }
  // Older sends: the stats windows [35 days ago, 30 days ago] and before (see header).
  for (const [days, tag] of [
    [32, "test_tag"],
    [32, null],
    [33, null],
    [40, null],
    [41, null],
    [60, null],
  ] as const) {
    await sent(runtime, ago(days * DAY), {
      to: ["reader-archive@example.com"],
      subject: "Archived notice",
      tag,
      tracked: false,
    });
  }

  const bounces: Array<[number, BounceType]> = [
    [4, "HardBounce"],
    [8, "SoftBounce"],
    [12, "Transient"],
    [16, "SMTPApiError"],
  ];
  for (const [n, [i, type]] of bounces.entries()) {
    const message = recent[i] as OutboundMessage;
    await bounce(runtime, 4000 + n, message, type, new Date(message.ReceivedAt.getTime() + HOUR));
  }

  const bounced = new Set(bounces.filter(([, t]) => t !== "Transient").map(([i]) => i));
  for (const [i, message] of recent.entries()) {
    if (bounced.has(i)) continue;
    const later = (hours: number) => new Date(message.ReceivedAt.getTime() + (hours * HOUR) / 4);
    const recipient = message.To[0]?.Email as string;
    await recordDelivery(
      runtime,
      { messageId: message.MessageID, recipient, details: "smtp;250 2.0.0 OK" },
      later(1),
    );
    if (!message.TrackOpens || i % 2 === 1) continue;
    await recordOpen(
      runtime,
      { messageId: message.MessageID, recipient, agent: agent(i, false), readSeconds: 5 + i },
      later(2),
    );
    if (i % 4 === 0) {
      await recordOpen(
        runtime,
        { messageId: message.MessageID, recipient, agent: agent(i, false), readSeconds: 3 },
        later(3),
      );
      await recordClick(
        runtime,
        {
          messageId: message.MessageID,
          recipient,
          link: LINK,
          location: i % 8 === 0 ? "HTML" : "Text",
          agent: agent(i, true),
        },
        later(3),
      );
    }
  }

  const statuses: InboundStatus[] = ["Processed", "Processed", "Processed", "Blocked", "Failed"];
  for (const [n, status] of statuses.entries())
    inbound(runtime, ago((n + 1) * 6 * HOUR), n, status);
};
export default messages;
