import { z } from "zod";
import { type ErrorBody, errorBody } from "../errors.ts";
import { absent, base64 } from "../http/normalize.ts";
import { Unsupported } from "../http/respond.ts";
import type { ServerAuth } from "../http/routes.ts";
import type { Runtime } from "../runtime.ts";
import { newMessageId } from "../state/ids.ts";
import type { TestTokenContext } from "../state/servers.ts";
import type { Address, OutboundMessage } from "../state/types.ts";
import { parseAddressList } from "./addresses.ts";

/**
 * One message exactly as its channel received it: `/email` and batch JSON values (T1), templates
 * and bulk after render (T3), SMTP header text and MIME parts (T6). `submitOutbound` owns every
 * Postmark check (types, address syntax, required fields, limits, enums), so each ErrorCode has one
 * source. `undefined` means the sender left the field out.
 */
export type OutboundDraft = Record<keyof ReturnType<typeof draftSchema>["shape"], unknown>;

// R9: null and "" are absent for optional values (docs/08; php, dotnet, gem send them).
const text = absent(z.string());
const nullable = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (v === null ? undefined : v), schema.optional());
const TRACK_LINKS = z.enum(["None", "HtmlAndText", "HtmlOnly", "TextOnly"]);

/** Field shape checks, in draft field order. REST sends JSON types; SMTP sends header text (docs/07 §1.3). */
const draftSchema = (channel: "rest" | "smtp") =>
  z.object({
    From: text,
    To: text,
    Cc: text,
    Bcc: text,
    ReplyTo: text,
    Subject: text,
    HtmlBody: text,
    TextBody: text,
    Tag: text,
    MessageStream: text,
    Headers: nullable(z.array(z.object({ Name: z.string(), Value: z.string() }))),
    Attachments: nullable(
      z.array(
        z.object({
          Name: z.string(),
          Content: base64,
          ContentType: z.string(),
          ContentID: z.string().nullable().optional(),
        }),
      ),
    ),
    Metadata: nullable(z.record(z.string(), z.string())),
    // SMTP: `X-PM-TrackOpens: true`; absent or false means no tracking (docs/07 §1.3).
    TrackOpens:
      channel === "rest"
        ? absent(z.boolean())
        : absent(
            z
              .string()
              .regex(/^(true|false)$/i)
              .transform((v) => v.toLowerCase() === "true"),
          ),
    TrackLinks: absent(TRACK_LINKS),
  });

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

/**
 * Validate → suppression check → store → emit events (docs/11 §2).
 * W0 stub: checks field types and address syntax only, with no limits and no suppression check;
 * stores the message and emits `sent`. T1 owns the body.
 */
export async function submitOutbound(
  runtime: Runtime,
  submission: Submission,
): Promise<SubmitResult> {
  const { auth, channel } = submission;
  const now = runtime.clock.now();
  const result = draftSchema(channel).safeParse(submission.draft);
  // ErrorCode 403 for a field of the wrong type is INFERRED (docs/02 §9 Q13); text shape from
  // refs/api_overview.md:43-50. The first failing field is named.
  if (!result.success) {
    const field = String(result.error.issues[0]?.path[0]);
    return {
      outcome: "rejected",
      error: errorBody(403, { message: `Invalid request field(s): '${field}'.` }),
    };
  }
  const draft = result.data;
  const lists: Record<"To" | "Cc" | "Bcc", Address[]> = { To: [], Cc: [], Bcc: [] };
  for (const field of ["To", "Cc", "Bcc"] as const) {
    const raw = draft[field] ?? "";
    const addresses = parseAddressList(raw);
    // Message text: refs/api_bulk-email.md:220-229 example.
    if (addresses === undefined) {
      return {
        outcome: "rejected",
        error: errorBody(300, { message: `Invalid '${field}' address: '${raw}'.` }),
      };
    }
    lists[field] = addresses;
  }
  if (draft.From === undefined) throw new Unsupported("From validation is not built (T1)");
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
    Headers: draft.Headers ?? [],
    Attachments: (draft.Attachments ?? []).map((a) => ({
      Name: a.Name,
      Content: a.Content.toString("base64"),
      ContentType: a.ContentType,
      ContentID: a.ContentID ?? null,
      ContentLength: a.Content.length,
    })),
    Metadata: draft.Metadata ?? {},
    TrackOpens: draft.TrackOpens ?? auth.server.TrackOpens,
    TrackLinks: draft.TrackLinks ?? auth.server.TrackLinks,
    Status: "Sent",
    Sandboxed: auth.server.DeliveryType === "Sandbox",
    ReceivedAt: now,
    MessageEvents: [],
    channel,
    request: submission.request,
    rawSource: "",
    bulkRequestId: submission.bulkRequestId,
    templateId: submission.templateId,
  };
  runtime.store.state.outbound.set(message.MessageID, message);
  await runtime.events.emit("sent", { message });
  return { outcome: "accepted", message };
}
