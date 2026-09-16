import { type AddressObject, type EmailAddress, simpleParser } from "mailparser";
import type { Header, InboundAddress, InboundAttachment } from "../state/types.ts";

/** What inbound processing reads from a received MIME message (docs/05 §4.2). */
export interface ParsedMail {
  from: InboundAddress;
  to: InboundAddress[];
  cc: InboundAddress[];
  replyTo: string;
  subject: string;
  /** The `Date` header as the sender wrote it. */
  date: string;
  textBody: string;
  htmlBody: string;
  strippedTextReply: string;
  headers: Header[];
  attachments: InboundAttachment[];
}

/** Text after `+` in the local part, or `""` (docs/05 §4.2). */
export const mailboxHash = (email: string): string => {
  const local = email.slice(0, email.lastIndexOf("@"));
  const plus = local.indexOf("+");
  return plus === -1 ? "" : local.slice(plus + 1);
};

const full = (a: EmailAddress): InboundAddress => ({
  Email: a.address ?? "",
  Name: a.name,
  MailboxHash: mailboxHash(a.address ?? ""),
});

const addresses = (field: AddressObject | AddressObject[] | undefined): InboundAddress[] =>
  (Array.isArray(field) ? field : field === undefined ? [] : [field])
    .flatMap((o) => o.value)
    .flatMap((a) => a.group ?? [a])
    .map(full);

/** The legacy string form: `"Name" <email>` or a bare `email`, comma-separated (docs/05 §4.2). */
export const legacyList = (list: InboundAddress[]): string =>
  list.map((a) => (a.Name === "" ? a.Email : `"${a.Name}" <${a.Email}>`)).join(", ");

// The doc example `Headers` holds MIME-Version, Message-ID and trace headers, but not the headers
// that have their own field (refs/user-guide_inbound_parse-an-email.md:113-146; INFERRED).
const OWN_FIELD = new Set([
  "from",
  "to",
  "cc",
  "bcc",
  "reply-to",
  "subject",
  "date",
  "content-type",
  "content-transfer-encoding",
]);

// A reply's quoted part starts at an attribution line or the first quoted line (INFERRED).
const QUOTE_START = /^(On .+ wrote:|>)/m;

export async function parseMime(mime: string): Promise<ParsedMail> {
  const mail = await simpleParser(mime, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
  });
  const text = mail.text ?? "";
  const isReply = mail.headers.has("in-reply-to") || mail.headers.has("references");
  const quote = QUOTE_START.exec(text);
  const lineOf = (key: string) => mail.headerLines.find((h) => h.key === key)?.line;
  const headerValue = (line: string) =>
    line
      .slice(line.indexOf(":") + 1)
      .replace(/\r?\n/g, "")
      .trim();
  return {
    from: addresses(mail.from)[0] ?? { Email: "", Name: "", MailboxHash: "" },
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    replyTo: legacyList(addresses(mail.replyTo)),
    subject: mail.subject ?? "",
    date: headerValue(lineOf("date") ?? ":"),
    textBody: text,
    htmlBody: mail.html === false ? "" : mail.html,
    // docs/05 §4.2: only a reply with a plain part gets one.
    strippedTextReply: isReply ? (quote === null ? text : text.slice(0, quote.index)).trim() : "",
    headers: mail.headerLines
      .filter((h) => !OWN_FIELD.has(h.key))
      .map((h) => ({ Name: h.line.slice(0, h.line.indexOf(":")), Value: headerValue(h.line) })),
    attachments: mail.attachments.map((a) => ({
      Name: a.filename ?? "",
      Content: a.content.toString("base64"),
      ContentType: a.contentType,
      ContentLength: a.content.length,
      ContentID: a.cid ?? "",
    })),
  };
}
