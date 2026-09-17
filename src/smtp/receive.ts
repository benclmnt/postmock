import { simpleParser } from "mailparser";
import type { ErrorBody } from "../errors.ts";
import { submitOutbound } from "../pipeline/submit.ts";
import type { Runtime } from "../runtime.ts";
import { newMessageId } from "../state/ids.ts";
import { suppressionKey } from "../state/store.ts";
import { BOUNCE_TYPES, type Bounce } from "../state/types.ts";
import type { SmtpSender } from "./auth.ts";
import { deliveredSource, draftFromMime, PARSE_OPTIONS } from "./mime.ts";

/**
 * One accepted DATA transaction. Postmark accepts every message at SMTP and turns each
 * message-level error into an `SMTPApiError` bounce (docs/07 §1.4). Returns the Postmark MessageID.
 */
export async function receive(
  runtime: Runtime,
  sender: SmtpSender,
  raw: Buffer,
  rcptTo: string[],
): Promise<string> {
  // Raw MIME as text. nodemailer writes 7-bit ASCII unless the content needs 8BITMIME/SMTPUTF8
  // (docs/07 §1.7); UTF-8 is the only 8-bit form kept readable.
  const source = raw.toString("utf8");
  const mail = await simpleParser(raw, PARSE_OPTIONS);
  const { draft, stream, keepId } = draftFromMime(mail, rcptTo, sender);
  const result = await submitOutbound(runtime, {
    auth: { kind: "server", server: sender.server },
    channel: "smtp",
    draft,
    request: source,
    rawSource: deliveredSource(source, draft.Tag, keepId),
    bulkRequestId: null,
    templateId: null,
  });
  const failure = {
    serverId: sender.server.ID,
    stream,
    tag: draft.Tag ?? null,
    from: draft.From ?? null,
    subject: mail.subject ?? "",
    metadata: draft.Metadata,
    source,
  };
  switch (result.outcome) {
    case "accepted":
      return result.message.MessageID;
    case "partiallySuppressed": {
      const { message } = result;
      const suppressed = [...message.To, ...message.Cc, ...message.Bcc]
        .map((a) => a.Email)
        .filter((email) =>
          runtime.store.state.suppressions.has(
            suppressionKey(message.ServerID, message.MessageStream, email),
          ),
        );
      await bounce(runtime, { ...failure, messageId: message.MessageID }, suppressed, result.error);
      return message.MessageID;
    }
    case "rejected": {
      const messageId = newMessageId();
      await bounce(runtime, { ...failure, messageId }, rcptTo, result.error);
      return messageId;
    }
    case "validated":
      throw new Error("SMTP never authenticates with the test token");
  }
}

export interface Failure {
  serverId: number;
  stream: string;
  messageId: string;
  tag: string | null;
  from: string | null;
  subject: string;
  metadata: Record<string, string>;
  source: string;
}

/**
 * One `SMTPApiError` (100007) bounce per affected recipient. Description is the short error; the
 * raw content holds the error code, the long error and the SMTP message
 * (refs/user-guide_send-email-with-smtp.md:87). One bounce per recipient, the content layout, and
 * `Inactive`/`CanActivate` false are INFERRED (docs/07 Q9).
 */
async function bounce(
  runtime: Runtime,
  failure: Failure,
  recipients: string[],
  error: ErrorBody,
): Promise<void> {
  const { store, clock, events } = runtime;
  for (const email of recipients) {
    const record = smtpApiErrorBounce(store.nextId("bounce"), clock.now(), failure, email, error);
    store.state.bounces.set(record.ID, record);
    await events.emit("smtpApiError", { bounce: record });
  }
}

/** The `SMTPApiError` bounce of one recipient; a seed builds past ones with it. */
export function smtpApiErrorBounce(
  id: number,
  at: Date,
  failure: Failure,
  email: string,
  error: ErrorBody,
): Bounce {
  return {
    ID: id,
    ServerID: failure.serverId,
    MessageStream: failure.stream,
    MessageID: failure.messageId,
    Type: "SMTPApiError",
    Tag: failure.tag,
    Description: error.Message,
    Details: BOUNCE_TYPES.SMTPApiError.Name,
    Email: email,
    From: failure.from,
    Subject: failure.subject,
    BouncedAt: at,
    Inactive: false,
    CanActivate: false,
    Content: `ErrorCode: ${error.ErrorCode}\r\nMessage: ${error.Message}\r\n\r\n${failure.source}`,
    Metadata: failure.metadata,
  };
}
