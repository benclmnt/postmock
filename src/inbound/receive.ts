import type { Runtime } from "../runtime.ts";
import { newMessageId } from "../state/ids.ts";
import type { InboundMessage, Server } from "../state/types.ts";
import { legacyList, mailboxHash, parseMime } from "./parse.ts";

/** A message as it reaches Postmark's MX: its source, the SMTP envelope and SpamAssassin's verdict. */
export interface ReceivedMail {
  mime: string;
  /** RCPT TO addresses; a recipient outside the headers is a Bcc. */
  rcptTo: string[];
  spamScore: number;
  spamTests: string[];
}

/** Whether `email` is an inbound address of `server`: its hash address or its inbound domain. */
function isInboundAddress(server: Server, email: string): boolean {
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at).toLowerCase().split("+")[0];
  const domain = email.slice(at + 1).toLowerCase();
  return (
    (domain === "inbound.postmarkapp.com" && local === server.InboundHash.toLowerCase()) ||
    (server.InboundDomain !== "" && domain === server.InboundDomain.toLowerCase())
  );
}

/**
 * Receives one mail: one inbound message per server it reaches, with that server's first inbound
 * recipient as `OriginalRecipient` (INFERRED). A sender that matches an inbound rule, or a spam score
 * above a set `InboundSpamThreshold`, blocks the message (docs/05 §4.1). Emits `inboundReceived` per
 * message; the webhooks plugin posts every message that is not blocked.
 */
export async function receiveInbound(
  runtime: Runtime,
  mail: ReceivedMail,
): Promise<InboundMessage[]> {
  const { state } = runtime.store;
  const parsed = await parseMime(mail.mime);
  const now = runtime.clock.now();
  const spamHeaders = [
    { Name: "X-Spam-Status", Value: mail.spamScore > 5 ? "Yes" : "No" },
    { Name: "X-Spam-Score", Value: String(mail.spamScore) },
    { Name: "X-Spam-Tests", Value: mail.spamTests.join(",") },
  ];
  const messages: InboundMessage[] = [];
  for (const server of state.servers.values()) {
    const recipient = mail.rcptTo.find((r) => isInboundAddress(server, r));
    const stream = [...state.streams.values()].find(
      (s) => s.ServerID === server.ID && s.MessageStreamType === "Inbound",
    );
    if (recipient === undefined || stream === undefined) continue;
    const inHeaders = [...parsed.to, ...parsed.cc].some(
      (a) => a.Email.toLowerCase() === recipient.toLowerCase(),
    );
    // docs/05 §4.2 Bcc rules: the inbound address shows as Bcc only when no To or Cc names it.
    const bcc = inHeaders
      ? []
      : [{ Email: recipient, Name: "", MailboxHash: mailboxHash(recipient) }];
    const blockedReason = blockReason(runtime, server, parsed.from.Email, mail.spamScore);
    const message: InboundMessage = {
      MessageID: newMessageId(),
      ServerID: server.ID,
      MessageStream: stream.ID,
      From: parsed.from.Email,
      FromName: parsed.from.Name,
      FromFull: parsed.from,
      To: legacyList(parsed.to),
      ToFull: parsed.to,
      Cc: legacyList(parsed.cc),
      CcFull: parsed.cc,
      Bcc: legacyList(bcc),
      BccFull: bcc,
      OriginalRecipient: recipient,
      ReplyTo: parsed.replyTo,
      Subject: parsed.subject,
      MailboxHash: mailboxHash(recipient),
      Date: parsed.date,
      TextBody: parsed.textBody,
      HtmlBody: parsed.htmlBody,
      StrippedTextReply: parsed.strippedTextReply,
      Tag: "",
      Headers: [...spamHeaders, ...parsed.headers],
      Attachments: parsed.attachments,
      Status: blockedReason === null ? "Queued" : "Blocked",
      BlockedReason: blockedReason,
      ReceivedAt: now,
      rawEmail: mail.mime,
    };
    state.inbound.set(message.MessageID, message);
    messages.push(message);
  }
  for (const message of messages) await runtime.events.emit("inboundReceived", { message });
  return messages;
}

/** Why a message is blocked, or null. The reason texts are INFERRED. */
function blockReason(runtime: Runtime, server: Server, from: string, spamScore: number) {
  const sender = from.toLowerCase();
  const rule = [...runtime.store.state.inboundRules.values()].find((r) => {
    const value = r.Rule.toLowerCase();
    return (
      r.ServerID === server.ID &&
      (value.includes("@") ? sender === value : sender.slice(sender.lastIndexOf("@") + 1) === value)
    );
  });
  if (rule !== undefined) return `Blocked by inbound rule '${rule.Rule}'.`;
  // A threshold of 0 blocks nothing (INFERRED).
  if (server.InboundSpamThreshold > 0 && spamScore > server.InboundSpamThreshold) {
    return `Spam score ${spamScore} is above the threshold ${server.InboundSpamThreshold}.`;
  }
  return null;
}
