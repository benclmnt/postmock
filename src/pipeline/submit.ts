import { type ErrorBody, errorBody } from "../errors.ts";
import { Unsupported } from "../http/respond.ts";
import type { ServerAuth } from "../http/routes.ts";
import type { Runtime } from "../runtime.ts";
import { newMessageId } from "../state/ids.ts";
import type { TestTokenContext } from "../state/servers.ts";
import type { Address, OutboundMessage, TrackLinks } from "../state/types.ts";
import { parseAddressList } from "./addresses.ts";

/**
 * One message as its channel received it: `/email` and batch (T1), templates and bulk after render
 * (T3), SMTP after MIME parse (T6). Values are the sender's raw text. `submitOutbound` owns every
 * Postmark check (address syntax, required fields, limits, enums), so each ErrorCode has one source.
 * `undefined` means the sender left the field out; the server setting or Postmark default applies.
 */
export interface OutboundDraft {
  From: string | undefined;
  /** Comma-separated address lists. */
  To: string | undefined;
  Cc: string | undefined;
  Bcc: string | undefined;
  ReplyTo: string | undefined;
  Subject: string | undefined;
  HtmlBody: string | undefined;
  TextBody: string | undefined;
  Tag: string | undefined;
  Headers: Array<{ Name: string; Value: string }>;
  /** `Content` is base64. */
  Attachments: Array<{
    Name: string;
    Content: string;
    ContentType: string;
    ContentID: string | null;
  }>;
  Metadata: Record<string, string>;
  TrackOpens: boolean | undefined;
  TrackLinks: string | undefined;
  MessageStream: string | undefined;
}

export interface Submission {
  /** A test context is `POSTMARK_API_TEST`: validate, never store or deliver (docs/02 §3.3). */
  auth: ServerAuth | TestTokenContext;
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
  /**
   * Some recipients suppressed: the rest were accepted, the caller answers 406. INFERRED from an
   * unverified integrator report (docs/04 §3.3, Q6).
   */
  | { outcome: "partiallySuppressed"; message: OutboundMessage; error: ErrorBody };

const TRACK_LINKS: readonly string[] = ["None", "HtmlAndText", "HtmlOnly", "TextOnly"];

/**
 * Validate → suppression check → store → emit events (docs/11 §2).
 * W0 stub: parses addresses only, with no other validation and no suppression check; stores the
 * message and emits `sent`. T1 owns the body.
 */
export async function submitOutbound(
  runtime: Runtime,
  submission: Submission,
): Promise<SubmitResult> {
  const { auth, draft } = submission;
  const now = runtime.clock.now();
  const lists: Record<"To" | "Cc" | "Bcc", Address[]> = { To: [], Cc: [], Bcc: [] };
  for (const field of ["To", "Cc", "Bcc"] as const) {
    const raw = draft[field] ?? "";
    const parsed = parseAddressList(raw);
    // Message text: refs/api_bulk-email.md:220-229 example.
    if (parsed === undefined) {
      return {
        outcome: "rejected",
        error: errorBody(300, { message: `Invalid '${field}' address: '${raw}'.` }),
      };
    }
    lists[field] = parsed;
  }
  if (draft.From === undefined) throw new Unsupported("From validation is not built (T1)");
  if (draft.TrackLinks !== undefined && !TRACK_LINKS.includes(draft.TrackLinks)) {
    throw new Unsupported("TrackLinks validation is not built (T1)");
  }
  if (auth.kind === "test") {
    return { outcome: "validated", messageId: newMessageId(), submittedAt: now };
  }
  const message: OutboundMessage = {
    MessageID: newMessageId(),
    ServerID: auth.server.ID,
    MessageStream: draft.MessageStream ?? "outbound",
    From: draft.From,
    ...lists,
    ReplyTo: draft.ReplyTo ?? null,
    Subject: draft.Subject ?? null,
    HtmlBody: draft.HtmlBody ?? null,
    TextBody: draft.TextBody ?? null,
    Tag: draft.Tag ?? null,
    Headers: draft.Headers,
    Attachments: draft.Attachments.map((a) => ({
      ...a,
      ContentLength: Buffer.from(a.Content, "base64").length,
    })),
    Metadata: draft.Metadata,
    TrackOpens: draft.TrackOpens ?? auth.server.TrackOpens,
    TrackLinks: (draft.TrackLinks as TrackLinks | undefined) ?? auth.server.TrackLinks,
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
  await runtime.events.emit("sent", { message });
  return { outcome: "accepted", message };
}
