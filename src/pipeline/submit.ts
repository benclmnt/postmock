import { z } from "zod";
import { type ErrorBody, errorBody } from "../errors.ts";
import { absent, base64, canonicalizeKeys } from "../http/normalize.ts";
import { Unsupported } from "../http/respond.ts";
import type { ServerAuth } from "../http/routes.ts";
import type { Runtime } from "../runtime.ts";
import { newMessageId } from "../state/ids.ts";
import { findStream, type TestTokenContext } from "../state/servers.ts";
import { suppressionKey } from "../state/store.ts";
import type { Address, OutboundMessage } from "../state/types.ts";
import { parseAddressList } from "./addresses.ts";
import { inactiveRecipientsError } from "./inactive.ts";

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
          // postmark.js sends null, php and gem a name or a `cid:` url (docs/03 §1.7).
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

type Draft = z.output<ReturnType<typeof draftSchema>>;

/**
 * The draft of one JSON message object. Keys match without case at every level, `ContentId` too
 * (docs/08 R8); unknown keys are ignored (R12). Every JSON channel builds its draft here.
 */
export function draftFromJson(body: Record<string, unknown>): OutboundDraft {
  const canonical = canonicalizeKeys(draftSchema("rest"), body) as Record<string, unknown>;
  const keys = Object.keys(draftSchema("rest").shape) as Array<keyof OutboundDraft>;
  return Object.fromEntries(keys.map((key) => [key, canonical[key]])) as OutboundDraft;
}

export interface Submission {
  /** A test context is `POSTMARK_API_TEST`: validate, never store or deliver (docs/02 §3.3). */
  auth: ServerAuth | TestTokenContext;
  channel: "rest" | "smtp";
  draft: OutboundDraft;
  /** Request JSON (REST) or raw MIME (SMTP), kept for `GET /control/messages`. */
  request: unknown;
  /** The MIME source the dump endpoint serves: SMTP sets it; REST sends leave it out for now. */
  rawSource?: string;
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

// Limits: docs/03 §1.2, docs/07 §3. Lengths count UTF-16 code units (docs/03 §1.9).
const MB = 1024 * 1024;
const MAX_BODY_BYTES = 5 * MB;
const MAX_MESSAGE_BYTES = 10 * MB;
const MAX_RECIPIENTS = 50;
const MAX_FROM = 255;
const MAX_SUBJECT = 2000;
const MAX_TAG = 1000;
const MAX_METADATA_FIELDS = 10;
const MAX_METADATA_KEY = 20;
const MAX_METADATA_VALUE = 80;
// refs/user-guide_send-email-with-api.md:176 (docs/07 §3).
const FORBIDDEN_EXTENSIONS = new Set(
  "vbs exe bin bat chm com cpl crt hlp hta inf ins isp jse lnk mdb pcd pif reg scr sct shs vbe vba wsf wsh wsl msc msi msp mst".split(
    " ",
  ),
);

const reject = (error: ErrorBody) => ({ outcome: "rejected" as const, error });
// ErrorCode 300 is documented for each case below (refs/api_overview.md:69). Only the address
// texts are documented (refs/api_bulk-email.md:221-227); the other texts are INFERRED (docs/03 Q4).
const invalid = (message: string) => reject(errorBody(300, { message }));
const invalidAddress = (field: string, raw: string) =>
  invalid(`Invalid '${field}' address: '${raw}'.`);

/** A draft that passed every data check, ready for `acceptOutbound`. */
export interface ValidOutbound {
  submission: Submission;
  draft: Draft & { From: string; To: string };
  streamId: string;
  from: Address;
  lists: Record<"To" | "Cc" | "Bcc" | "ReplyTo", Address[]>;
  recipients: Address[];
}

export type Validation =
  | { outcome: "valid"; outbound: ValidOutbound }
  | { outcome: "rejected"; error: ErrorBody };

/**
 * The data checks of a send, with no state change: field types, size, stream, addresses,
 * recipients, content, limits, attachments. Check order follows docs/03 §3.3 (INFERRED). Account
 * approval and suppressions belong to `acceptOutbound`. Throws `Unsupported` for uncaptured cases.
 */
export function validateOutbound(runtime: Runtime, submission: Submission): Validation {
  const parsed = draftSchema(submission.channel).safeParse(submission.draft);
  // ErrorCode 403 for a field of the wrong type is INFERRED (docs/02 §9 Q13); text shape from
  // refs/api_overview.md:43-50. The first failing field is named.
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0]);
    return reject(errorBody(403, { message: `Invalid request field(s): '${field}'.` }));
  }
  const draft = parsed.data;
  checkSize(draft);

  const streamId = draft.MessageStream ?? "outbound";
  const stream = findStream(runtime.store.state, submission.auth, streamId);
  if (stream === undefined) return reject(errorBody(1235, { params: { stream: streamId } }));
  if (stream.MessageStreamType === "Inbound") return reject(errorBody(1236));
  if (stream.ArchivedAt !== null) {
    throw new Unsupported(`send to archived stream '${streamId}' is not captured (docs/04 Q15)`);
  }

  if (draft.From === undefined) return invalidAddress("From", "");
  const [from, ...moreFrom] = parseAddressList(draft.From) ?? [];
  if (from === undefined || moreFrom.length > 0) return invalidAddress("From", draft.From);
  const lists: Record<"To" | "Cc" | "Bcc" | "ReplyTo", Address[]> = {
    To: [],
    Cc: [],
    Bcc: [],
    ReplyTo: [],
  };
  for (const field of ["To", "Cc", "Bcc", "ReplyTo"] as const) {
    const addresses = parseAddressList(draft[field] ?? "");
    if (addresses === undefined) return invalidAddress(field, draft[field] ?? "");
    lists[field] = addresses;
  }
  const recipients = [...lists.To, ...lists.Cc, ...lists.Bcc];
  if (recipients.length === 0) return invalid("Zero recipients specified");
  if (recipients.length > MAX_RECIPIENTS) {
    return invalid(`Exceeded the maximum of ${MAX_RECIPIENTS} recipients per message.`);
  }
  if (draft.HtmlBody === undefined && draft.TextBody === undefined) {
    return invalid("Provide either email TextBody or HtmlBody or both.");
  }
  const limitError = checkLimits(draft);
  if (limitError !== undefined) return invalid(limitError);
  for (const attachment of draft.Attachments ?? []) {
    const extension = /\.([^.]*)$/.exec(attachment.Name)?.[1]?.toLowerCase();
    if (extension !== undefined && FORBIDDEN_EXTENSIONS.has(extension)) {
      return reject(errorBody(411));
    }
  }
  return {
    outcome: "valid",
    outbound: {
      submission,
      draft: { ...draft, From: draft.From, To: draft.To ?? "" },
      streamId,
      from,
      lists,
      recipients,
    },
  };
}

/**
 * Account approval → suppression check → store → emit `sent` (docs/11 §2). The test token stops
 * before them: it validates data only, and account state and suppressions are INFERRED not to
 * apply to it (docs/02 Q18).
 */
export async function acceptOutbound(
  runtime: Runtime,
  outbound: ValidOutbound,
): Promise<SubmitResult> {
  const { submission, draft, streamId, from, lists, recipients } = outbound;
  const { auth } = submission;
  const now = runtime.clock.now();
  if (auth.kind === "test") {
    return { outcome: "validated", messageId: newMessageId(), submittedAt: now };
  }
  const { account } = runtime.store.state;
  if (account.approval === "unapproved") return reject(errorBody(413));
  const fromDomain = domainOf(from);
  if (account.approval === "pending" && recipients.some((r) => domainOf(r) !== fromDomain)) {
    return reject(errorBody(412));
  }

  const inactive = inactiveRecipients(runtime, auth.server.ID, streamId, recipients);
  if (inactive.length === recipients.length) {
    return reject(inactiveRecipientsError(uniqueEmails(inactive)));
  }

  const message: OutboundMessage = {
    MessageID: newMessageId(),
    ServerID: auth.server.ID,
    MessageStream: streamId,
    From: draft.From,
    To: lists.To,
    Cc: lists.Cc,
    Bcc: lists.Bcc,
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
      // `""` is "not inline", like null and absent (docs/03 §1.7).
      ContentID: a.ContentID || null,
      ContentLength: a.Content.length,
    })),
    Metadata: draft.Metadata ?? {},
    // A server with open tracking on forces it on (docs/03 §5.3).
    TrackOpens: auth.server.TrackOpens || (draft.TrackOpens ?? false),
    // A message value overrides the server value (docs/03 §5.2).
    TrackLinks: draft.TrackLinks ?? auth.server.TrackLinks,
    Status: "Sent",
    Sandboxed: auth.server.DeliveryType === "Sandbox",
    ReceivedAt: now,
    MessageEvents: [],
    channel: submission.channel,
    request: submission.request,
    // REST sends generate no MIME source yet.
    rawSource: submission.rawSource ?? "",
    bulkRequestId: submission.bulkRequestId,
    templateId: submission.templateId,
  };
  runtime.store.state.outbound.set(message.MessageID, message);
  await runtime.events.emit("sent", { message });
  return inactive.length === 0
    ? { outcome: "accepted", message }
    : {
        outcome: "partiallySuppressed",
        message,
        error: inactiveRecipientsError(uniqueEmails(inactive)),
      };
}

/** `validateOutbound`, then `acceptOutbound` for a valid draft. */
export async function submitOutbound(
  runtime: Runtime,
  submission: Submission,
): Promise<SubmitResult> {
  const validation = validateOutbound(runtime, submission);
  return validation.outcome === "valid" ? acceptOutbound(runtime, validation.outbound) : validation;
}

/**
 * Body parts over 5 MB or a message over 10 MB, measured after base64, is HTTP 413 (docs/07 §3).
 * The 413 body is not captured (docs/02 Q10), so postmock answers 501.
 */
function checkSize(draft: Draft): void {
  const bodies = [draft.HtmlBody, draft.TextBody].map((b) => Buffer.byteLength(b ?? ""));
  const attachments = (draft.Attachments ?? []).reduce(
    (sum, a) => sum + Math.ceil(a.Content.length / 3) * 4,
    0,
  );
  const total = bodies.reduce((a, b) => a + b, 0) + attachments;
  if (bodies.some((b) => b > MAX_BODY_BYTES) || total > MAX_MESSAGE_BYTES) {
    throw new Unsupported("HTTP 413 for an oversized message: body not captured (docs/02 Q10)");
  }
}

/** The first limit the draft breaks, as a 300 message (texts INFERRED, docs/03 Q4). */
function checkLimits(draft: Draft): string | undefined {
  if ((draft.From ?? "").length > MAX_FROM) {
    return `The 'From' field exceeds the maximum length of ${MAX_FROM} characters.`;
  }
  if ((draft.Subject ?? "").length > MAX_SUBJECT) {
    return `The 'Subject' field exceeds the maximum length of ${MAX_SUBJECT} characters.`;
  }
  if ((draft.Tag ?? "").length > MAX_TAG) {
    return `The 'Tag' field exceeds the maximum length of ${MAX_TAG} characters.`;
  }
  const metadata = Object.entries(draft.Metadata ?? {});
  if (metadata.length > MAX_METADATA_FIELDS) {
    return `Metadata may contain at most ${MAX_METADATA_FIELDS} fields.`;
  }
  const seen = new Set<string>();
  for (const [key, value] of metadata) {
    if (key.length > MAX_METADATA_KEY) {
      return `Metadata field name '${key}' exceeds the maximum length of ${MAX_METADATA_KEY} characters.`;
    }
    if (value.length > MAX_METADATA_VALUE) {
      return `Metadata field '${key}' value exceeds the maximum length of ${MAX_METADATA_VALUE} characters.`;
    }
    if (seen.has(key.toLowerCase())) return `Metadata field '${key}' appears more than once.`;
    seen.add(key.toLowerCase());
  }
  return undefined;
}

const domainOf = (address: Address): string =>
  (address.Email.split("@").at(-1) as string).toLowerCase();

/** Recipients on the send stream's suppression list; each stream has its own list (docs/04 §3.3). */
const inactiveRecipients = (
  runtime: Runtime,
  serverId: number,
  streamId: string,
  recipients: Address[],
): Address[] =>
  recipients.filter((r) =>
    runtime.store.state.suppressions.has(suppressionKey(serverId, streamId, r.Email)),
  );

/** Each address once, in first-seen spelling; addresses compare without case. */
function uniqueEmails(addresses: Address[]): string[] {
  const byLower = new Map<string, string>();
  for (const { Email } of addresses) {
    if (!byLower.has(Email.toLowerCase())) byLower.set(Email.toLowerCase(), Email);
  }
  return [...byLower.values()];
}
