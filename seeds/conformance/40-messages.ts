import type { Seed } from "../../src/control/seed.ts";
import type { InboundStatus, OutboundMessage } from "../../src/state/types.ts";
import { recordClick, recordDelivery, recordOpen } from "../../src/tracking.ts";
import { CONFORMANCE } from "../lib/conformance.ts";
import { pastBounce, pastInbound, pastSend, pastSmtpApiError } from "../lib/history.ts";

// Message history on server 1 for the read suites (docs/08 §5.3; T4 ID range 4000–4999):
// ≥ 33 outbound messages in the retention window, some tagged `test_tag`, with deliveries,
// bounces, opens and clicks; inbound messages in several statuses; and older sends that make the
// stats windows of the dotnet live test decrease strictly
// (sdk/postmark-dotnet/src/Postmark.Tests/ClientStatisticsTests.cs:40-62).
// Recipients use their own addresses, so the hard bounce here suppresses nobody another suite sends
// to. Bounces 4000–4003: hard (suppresses reader-4), soft, transient, SMTP API error.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LINK = "https://example.com/welcome";

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

const send = (
  runtime: Parameters<Seed>[0],
  at: Date,
  fields: { to: string[]; cc?: string[]; subject: string; tag: string | null; tracked: boolean },
) =>
  pastSend(runtime, {
    ServerID: CONFORMANCE.serverId,
    ReceivedAt: at,
    From: CONFORMANCE.senderEmail,
    To: fields.to.map((Email) => ({ Email, Name: null })),
    Cc: (fields.cc ?? []).map((Email) => ({ Email, Name: null })),
    Subject: fields.subject,
    HtmlBody: `<p>${fields.subject}</p><p><a href="${LINK}">Start</a></p>`,
    TextBody: `${fields.subject}\n\nStart: ${LINK}`,
    Tag: fields.tag,
    Metadata: { seed: "t4" },
    TrackOpens: fields.tracked,
    TrackLinks: fields.tracked ? "HtmlAndText" : "None",
  });

const messages: Seed = async (runtime) => {
  const now = runtime.clock.now().getTime();
  const ago = (ms: number) => new Date(now - ms);

  const recent: OutboundMessage[] = [];
  for (let i = 0; i < 40; i++) {
    recent.push(
      await send(runtime, ago(i * 15 * HOUR + HOUR), {
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
    await send(runtime, ago(days * DAY), {
      to: ["reader-archive@example.com"],
      subject: "Archived notice",
      tag,
      tracked: false,
    });
  }

  const minutes = (m: OutboundMessage, n: number) => new Date(m.ReceivedAt.getTime() + n * 60000);
  const hard = recent[4] as OutboundMessage;
  await pastBounce(runtime, hard, { id: 4000, type: "HardBounce", at: minutes(hard, 60) });
  const soft = recent[8] as OutboundMessage;
  await pastBounce(runtime, soft, { id: 4001, type: "SoftBounce", at: minutes(soft, 60) });
  // A delay notice comes before the delivery below.
  const delayed = recent[12] as OutboundMessage;
  await pastBounce(runtime, delayed, { id: 4002, type: "Transient", at: minutes(delayed, 5) });
  // A later SMTP send to the address the hard bounce suppressed.
  await pastSmtpApiError(runtime, {
    id: 4003,
    serverId: CONFORMANCE.serverId,
    stream: "outbound",
    email: hard.To[0]?.Email as string,
    tag: null,
    at: minutes(hard, 120),
  });

  for (const [i, message] of recent.entries()) {
    if (message === hard || message === soft) continue;
    const later = (n: number) => minutes(message, n);
    const target = { messageId: message.MessageID, recipient: message.To[0]?.Email as string };
    await recordDelivery(runtime, { ...target, details: "smtp;250 2.0.0 OK" }, later(15));
    if (!message.TrackOpens || i % 2 === 1) continue;
    await recordOpen(runtime, { ...target, agent: agent(i, false), readSeconds: 5 + i }, later(30));
    if (i % 4 !== 0) continue;
    await recordOpen(runtime, { ...target, agent: agent(i, false), readSeconds: 3 }, later(45));
    const location = i % 8 === 0 ? "HTML" : "Text";
    await recordClick(
      runtime,
      { ...target, link: LINK, location, agent: agent(i, true) },
      later(45),
    );
  }

  const statuses: InboundStatus[] = ["Processed", "Processed", "Processed", "Blocked", "Failed"];
  for (const [n, Status] of statuses.entries()) {
    pastInbound(runtime, {
      ServerID: CONFORMANCE.serverId,
      ReceivedAt: ago((n + 1) * 6 * HOUR),
      Status,
      Subject: `Inbound ${n}`,
    });
  }
};
export default messages;
