import type { AddressObject, EmailAddress, ParsedMail } from "mailparser";
import { Unsupported } from "../http/respond.ts";
import type { OutboundDraft } from "../pipeline/submit.ts";
import type { SmtpSender } from "./auth.ts";

/** mailparser options: keep the bodies as sent; derive nothing. */
export const PARSE_OPTIONS = {
  skipHtmlToText: true,
  skipTextToHtml: true,
  skipTextLinks: true,
  skipImageLinks: true,
} as const;

/** Header lines that become draft fields or MIME structure, not custom `Headers` (INFERRED). */
const STRUCTURAL = new Set([
  "from",
  "to",
  "cc",
  "bcc",
  "reply-to",
  "subject",
  "date",
  "message-id",
  "mime-version",
  "content-type",
  "content-transfer-encoding",
]);

/** X-PM-* headers that set draft fields (docs/07 §1.3). Other X-PM-* go to `Headers`. */
const FIELD_HEADERS = new Set([
  "x-pm-message-stream",
  "x-pm-tag",
  "x-pm-trackopens",
  "x-pm-tracklinks",
  "x-pm-keepid",
]);
const METADATA_PREFIX = "x-pm-metadata-";

export interface SmtpDraft {
  draft: OutboundDraft & {
    From: string | undefined;
    Tag: string | undefined;
    Metadata: Record<string, string>;
  };
  /** The stream the message goes to, for an `SMTPApiError` bounce when the draft is rejected. */
  stream: string;
  keepId: boolean;
}

interface RawHeader {
  name: string;
  value: string;
}

/** Header lines in order, unfolded, values undecoded. */
function rawHeaders(mail: ParsedMail): RawHeader[] {
  return mail.headerLines.map(({ line }) => {
    const colon = line.indexOf(":");
    return {
      name: line.slice(0, colon).trim(),
      value: line
        .slice(colon + 1)
        .replace(/\r?\n(?=[ \t])/g, "")
        .trim(),
    };
  });
}

const flatten = (list: EmailAddress[]): EmailAddress[] =>
  list.flatMap((a) => (a.group === undefined ? [a] : flatten(a.group)));

const addresses = (field: AddressObject | AddressObject[] | undefined): EmailAddress[] =>
  field === undefined ? [] : flatten([field].flat().flatMap((o) => o.value));

/**
 * A Postmark address list: `"Name" <a@b>, c@d` (docs/03 §1.8), with decoded display names.
 * An entry mailparser found no address in stays as its text, so the pipeline rejects it.
 */
const addressText = (list: EmailAddress[]): string | undefined =>
  list.length === 0
    ? undefined
    : list
        .map((a) => {
          if (!a.address) return a.name;
          if (a.name === "") return a.address;
          return `"${a.name.replace(/["\\]/g, "\\$&")}" <${a.address}>`;
        })
        .join(", ");

/**
 * Maps one parsed SMTP transaction to a raw draft. `submitOutbound` checks every value
 * (docs/11 §2). Recipients come from the envelope: an `RCPT TO` address that no `To` or `Cc`
 * header names is a Bcc, since clients strip the `Bcc` header (docs/07 §1.1).
 */
export function draftFromMime(mail: ParsedMail, rcptTo: string[], sender: SmtpSender): SmtpDraft {
  const headers = rawHeaders(mail);
  const first = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value;
  const to = addresses(mail.to);
  const cc = addresses(mail.cc);
  const named = new Set([...to, ...cc].map((a) => a.address?.toLowerCase()));
  const bcc = rcptTo.filter((r) => !named.has(r.toLowerCase()));

  const streamHeader = first("x-pm-message-stream");
  let stream = streamHeader ?? "outbound";
  if (sender.tokenStream !== null) {
    // docs/07 Q13: an SMTP token with a header naming another stream is not captured.
    if (streamHeader !== undefined && streamHeader !== sender.tokenStream) {
      throw new Unsupported(
        `X-PM-Message-Stream '${streamHeader}' with an SMTP token for '${sender.tokenStream}' is not captured (docs/07 Q13)`,
      );
    }
    stream = sender.tokenStream;
  }

  const metadata: Record<string, string> = {};
  const custom: RawHeader[] = [];
  const keepId = first("x-pm-keepid")?.toLowerCase() === "true";
  for (const header of headers) {
    const lower = header.name.toLowerCase();
    if (lower.startsWith(METADATA_PREFIX)) {
      addMetadata(metadata, header.name.slice(METADATA_PREFIX.length), header.value);
    } else if (lower === "message-id" && keepId) {
      custom.push(header);
    } else if (!STRUCTURAL.has(lower) && !FIELD_HEADERS.has(lower)) {
      custom.push(header);
    }
  }

  const draft: SmtpDraft["draft"] = {
    From: addressText(addresses(mail.from)),
    To: addressText(to),
    Cc: addressText(cc),
    Bcc: bcc.length === 0 ? undefined : bcc.join(", "),
    ReplyTo: addressText(addresses(mail.replyTo)),
    Subject: mail.subject,
    HtmlBody: mail.html === false ? undefined : mail.html,
    TextBody: mail.text,
    Tag: first("x-pm-tag"),
    MessageStream: stream,
    Headers: custom.map((h) => ({ Name: h.name, Value: h.value })),
    // A part with neither a file name nor a disposition is a body alternative (for example
    // `text/calendar; method=REQUEST`), not an attachment; it stays in the raw source.
    Attachments: mail.attachments
      .filter((a) => a.filename !== undefined || a.contentDisposition !== undefined)
      .map((a) => ({
        Name: a.filename ?? "",
        Content: a.content.toString("base64"),
        ContentType: a.contentType,
        ContentID: a.cid === undefined ? null : `cid:${a.cid}`,
      })),
    Metadata: metadata,
    TrackOpens: first("x-pm-trackopens"),
    TrackLinks: first("x-pm-tracklinks"),
  };
  return { draft, stream, keepId };
}

/**
 * "When sending with SMTP, if you add duplicate keys, we will append the additional keys with an
 * incremental number" (refs/support_article_1125-custom-metadata-faq.md:70). Duplicates compare
 * without case, as on the API (`:68-69`). The suffix form `key1`, `key2` is INFERRED.
 */
function addMetadata(metadata: Record<string, string>, key: string, value: string): void {
  const taken = (k: string) =>
    Object.keys(metadata).some((m) => m.toLowerCase() === k.toLowerCase());
  let name = key;
  for (let n = 1; taken(name); n += 1) name = `${key}${n}`;
  metadata[name] = value;
}

/**
 * The copy Postmark delivers and serves as the raw source: incoming `X-PM-*` headers removed
 * (docs/07 §1.3), `X-PM-Message-Id` and `X-PM-Tag` added as in the dump example
 * (refs/api_messages-api.md:276), and every `Message-ID` replaced unless `X-PM-KeepID: true`
 * (refs/user-guide_send-email-with-smtp.md:101). The replacement form `<MessageID@mtasv.net>`
 * is INFERRED. The body bytes stay unchanged.
 */
export function deliveredSource(
  raw: string,
  message: { MessageID: string; Tag: string | null },
  keepId: boolean,
): string {
  const split = /\r?\n\r?\n/.exec(raw);
  const head = split === null ? raw : raw.slice(0, split.index);
  const body = split === null ? "" : raw.slice(split.index);
  const eol = head.includes("\r\n") ? "\r\n" : "\n";
  const lines = head.split(/\r?\n(?![ \t])/);
  const kept = lines.filter((line) => {
    const name = line.slice(0, line.indexOf(":")).trim().toLowerCase();
    return !name.startsWith("x-pm-") && (keepId || name !== "message-id");
  });
  const added = [
    ...(message.Tag === null ? [] : [`X-PM-Tag: ${message.Tag}`]),
    `X-PM-Message-Id: ${message.MessageID}`,
    ...(keepId && kept.some((l) => /^message-id\s*:/i.test(l))
      ? []
      : [`Message-ID: <${message.MessageID}@mtasv.net>`]),
  ];
  return [...kept, ...added].join(eol) + body;
}
