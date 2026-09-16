import type { ErrorBody } from "../errors.ts";
import type { ServerAuth } from "../http/routes.ts";
import type { Runtime } from "../runtime.ts";
import { newMessageId } from "../state/ids.ts";
import type { Address, Attachment, Header, OutboundMessage, TrackLinks } from "../state/types.ts";

/**
 * One message on its way in, already parsed by its channel: `/email` and batch (T1), templates
 * and bulk after render (T3), SMTP after MIME parse (T6). Fields hold the sender's values;
 * `undefined` means the sender left the field out and the server setting applies (docs/03 §1.2).
 */
export interface OutboundDraft {
  From: string;
  To: Address[];
  Cc: Address[];
  Bcc: Address[];
  ReplyTo: string | undefined;
  Subject: string | undefined;
  HtmlBody: string | undefined;
  TextBody: string | undefined;
  Tag: string | undefined;
  Headers: Header[];
  Attachments: Attachment[];
  Metadata: Record<string, string>;
  TrackOpens: boolean | undefined;
  TrackLinks: TrackLinks | undefined;
  /** Absent means `outbound` (docs/03 §1.2). */
  MessageStream: string | undefined;
}

export interface Submission {
  /** `test` is `POSTMARK_API_TEST`: validate, never store or deliver (docs/02 §3.3). */
  auth: ServerAuth | { kind: "test" };
  channel: "rest" | "smtp";
  draft: OutboundDraft;
  /** Request JSON (REST) or raw MIME (SMTP), kept for `GET /control/messages`. */
  request: unknown;
  bulkRequestId: string | null;
  templateId: number | null;
}

export type SubmitResult =
  | { outcome: "accepted"; message: OutboundMessage }
  /** Test token: valid, not stored. */
  | { outcome: "validated"; messageId: string; submittedAt: Date }
  | { outcome: "rejected"; error: ErrorBody }
  /** Some recipients suppressed: the rest were accepted, the caller answers 406 (docs/04 §3.3). */
  | { outcome: "partiallySuppressed"; message: OutboundMessage; error: ErrorBody };

/**
 * Validate → suppression check → store → emit events (docs/11 §2).
 * W0 stub: no validation or suppression check; stores the message and emits `sent`. T1 owns the body.
 */
export function submitOutbound(runtime: Runtime, submission: Submission): SubmitResult {
  const { auth, draft } = submission;
  const now = runtime.clock.now();
  if (auth.kind === "test") {
    return { outcome: "validated", messageId: newMessageId(), submittedAt: now };
  }
  const message: OutboundMessage = {
    MessageID: newMessageId(),
    ServerID: auth.server.ID,
    MessageStream: draft.MessageStream ?? "outbound",
    From: draft.From,
    To: draft.To,
    Cc: draft.Cc,
    Bcc: draft.Bcc,
    ReplyTo: draft.ReplyTo ?? null,
    Subject: draft.Subject ?? null,
    HtmlBody: draft.HtmlBody ?? null,
    TextBody: draft.TextBody ?? null,
    Tag: draft.Tag ?? null,
    Headers: draft.Headers,
    Attachments: draft.Attachments,
    Metadata: draft.Metadata,
    TrackOpens: draft.TrackOpens ?? auth.server.TrackOpens,
    TrackLinks: draft.TrackLinks ?? auth.server.TrackLinks,
    Status: "Sent",
    Sandboxed: auth.server.DeliveryType === "Sandbox",
    ReceivedAt: now,
    MessageEvents: [],
    channel: submission.channel,
    request: submission.request,
    rawSource: "",
    bulkRequestId: submission.bulkRequestId,
    templateId: submission.templateId,
  };
  runtime.store.state.outbound.set(message.MessageID, message);
  runtime.events.emit("sent", { message });
  return { outcome: "accepted", message };
}
