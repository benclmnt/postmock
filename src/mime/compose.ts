import { randomUUID } from "node:crypto";

/** An address as the control API takes it: `a@example.com` or `{email, name}`. */
export type MailAddress = string | { email: string; name?: string | undefined };

/** A message a real sender could write (CONTROL-API.md `POST /control/inbound`). */
export interface MailFields {
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  replyTo?: MailAddress | undefined;
  subject: string;
  text?: string | undefined;
  html?: string | undefined;
  headers: Array<{ name: string; value: string }>;
  attachments: Array<{
    name: string;
    /** Base64. */
    content: string;
    contentType: string;
    contentId?: string | undefined;
  }>;
}

const ascii = (text: string) => /^[\x20-\x7e]*$/.test(text);

/** RFC 2047 encoded word for non-ASCII header text. */
const word = (text: string) =>
  ascii(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;

const address = (a: MailAddress) => {
  const { email, name } = typeof a === "string" ? { email: a, name: undefined } : a;
  if (name === undefined || name === "") return email;
  return ascii(name)
    ? `"${name.replace(/["\\]/g, "\\$&")}" <${email}>`
    : `${word(name)} <${email}>`;
};

const base64Lines = (content: Buffer | string) =>
  (Buffer.isBuffer(content) ? content : Buffer.from(content))
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/** RFC 5322 date in UTC: `Thu, 05 Nov 2026 21:33:54 +0000`. */
export const rfc5322Date = (d: Date) =>
  `${DAYS[d.getUTCDay()]}, ${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
  `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} +0000`;

/**
 * Writes the MIME source a mail client would send for these fields. Inbound processing then parses
 * it like any received mail, so both control API input forms take one path.
 */
export function composeMime(fields: MailFields, now: Date): string {
  const boundary = () => `postmock-${randomUUID()}`;
  const textPart = (type: string, body: string) =>
    `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(body)}\r\n`;
  const multipart = (subtype: string, parts: string[]) => {
    const b = boundary();
    return `Content-Type: multipart/${subtype}; boundary="${b}"\r\n\r\n${parts.map((p) => `--${b}\r\n${p}`).join("")}--${b}--\r\n`;
  };

  const bodies = [
    ...(fields.text !== undefined ? [textPart("text/plain", fields.text)] : []),
    ...(fields.html !== undefined ? [textPart("text/html", fields.html)] : []),
  ];
  const content =
    bodies.length === 2
      ? multipart("alternative", bodies)
      : (bodies[0] ?? textPart("text/plain", ""));
  const attachments = fields.attachments.map(
    (a) =>
      `Content-Type: ${a.contentType}; name="${word(a.name)}"\r\n` +
      `Content-Disposition: ${a.contentId === undefined ? "attachment" : "inline"}; filename="${word(a.name)}"\r\n` +
      (a.contentId === undefined ? "" : `Content-ID: <${a.contentId}>\r\n`) +
      `Content-Transfer-Encoding: base64\r\n\r\n${base64Lines(Buffer.from(a.content, "base64"))}\r\n`,
  );

  const given = (name: string) => fields.headers.some((h) => h.name.toLowerCase() === name);
  const headers = [
    `From: ${address(fields.from)}`,
    ...(fields.to.length > 0 ? [`To: ${fields.to.map(address).join(", ")}`] : []),
    ...(fields.cc.length > 0 ? [`Cc: ${fields.cc.map(address).join(", ")}`] : []),
    ...(fields.replyTo !== undefined ? [`Reply-To: ${address(fields.replyTo)}`] : []),
    `Subject: ${word(fields.subject)}`,
    ...(given("date") ? [] : [`Date: ${rfc5322Date(now)}`]),
    ...(given("message-id") ? [] : [`Message-ID: <${randomUUID()}@postmock>`]),
    "MIME-Version: 1.0",
    ...fields.headers.map((h) => `${h.name}: ${word(h.value)}`),
  ];
  const body = attachments.length > 0 ? multipart("mixed", [content, ...attachments]) : content;
  return `${headers.join("\r\n")}\r\n${body}`;
}
