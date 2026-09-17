import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type ErrorBody, errorBody } from "../errors.ts";
import { absent, base64, canonicalizeKeys, objectOrEmptyArray } from "../http/normalize.ts";
import { Unsupported } from "../http/respond.ts";
import type { ServerAuth } from "../http/routes.ts";
import { composeMime } from "../mime/compose.ts";
import { testBounces } from "../recipients/test-bounces.ts";
import type { Runtime } from "../runtime.ts";
import { newMessageId } from "../state/ids.ts";
import { findStream, type TestTokenContext } from "../state/servers.ts";
import { suppressedAddresses } from "../state/suppressions.ts";
import type { Address, OutboundMessage } from "../state/types.ts";
import { parseAddressList } from "./addresses.ts";
import { inactiveRecipientsError } from "./inactive.ts";

/**
 * One message exactly as its channel received it: `/email` and batch JSON values (T1), templates
 * and bulk after render (T3), SMTP header text and MIME parts (T6). `validateOutbound` owns every
 * Postmark data check (types, address syntax, required fields, limits, enums), so each ErrorCode has one
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
    // php sends an empty metadata array as `[]` (sdk/postmark-php/src/Postmark/PostmarkClient.php:97,113).
    Metadata: nullable(objectOrEmptyArray(z.record(z.string(), z.string()))),
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

/**
 * A REST submission gets its MIME source from the pipeline, written from the draft. An SMTP
 * submission carries `rawSource`: the delivered copy the dump endpoint serves.
 */
export type Submission = {
  /** A test context is `POSTMARK_API_TEST`: validate, never store or deliver (docs/02 §3.3). */
  auth: ServerAuth | TestTokenContext;
  draft: OutboundDraft;
  /** Request JSON (REST) or raw MIME (SMTP), kept for `GET /control/messages`. */
  request: unknown;
  bulkRequestId: string | null;
  templateId: number | null;
} & ({ channel: "rest" } | { channel: "smtp"; rawSource: string });

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

const reject = (field: string, error: ErrorBody) => ({
  outcome: "rejected" as const,
  field,
  error,
});
// ErrorCode 300 is documented for each case below (refs/api_overview.md:69). Only the address
// texts are documented (refs/api_bulk-email.md:221-227); the other texts are INFERRED (docs/03 Q4).
const invalid = (field: string, message: string) => reject(field, errorBody(300, { message }));
const invalidAddress = (field: string, raw: string) =>
  invalid(field, `Invalid '${field}' address: '${raw}'.`);

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
  /**
   * `field` keys the bulk `Errors` map (refs/api_bulk-email.md:213-231). Which field Postmark
   * names is documented for addresses only; the others are INFERRED.
   */
  | { outcome: "rejected"; field: string; error: ErrorBody };

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
    return reject(field, errorBody(403, { message: `Invalid request field(s): '${field}'.` }));
  }
  const draft = parsed.data;
  checkSize(draft);

  const streamId = draft.MessageStream ?? "outbound";
  const stream = findStream(runtime.store.state, submission.auth, streamId);
  if (stream === undefined) {
    return reject("MessageStream", errorBody(1235, { params: { stream: streamId } }));
  }
  if (stream.MessageStreamType === "Inbound") return reject("MessageStream", errorBody(1236));
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
  // `To` is required (docs/03 §1.2); the empty-`To` text is INFERRED (docs/03 Q4).
  if (draft.To === undefined || lists.To.length === 0) return invalidAddress("To", draft.To ?? "");
  const recipients = [...lists.To, ...lists.Cc, ...lists.Bcc];
  if (recipients.length > MAX_RECIPIENTS) {
    return invalid("To", `Exceeded the maximum of ${MAX_RECIPIENTS} recipients per message.`);
  }
  if (draft.HtmlBody === undefined && draft.TextBody === undefined) {
    return invalid("TextBody", "Provide either email TextBody or HtmlBody or both.");
  }
  const limitError = checkLimits(draft);
  if (limitError !== undefined) return invalid(limitError.field, limitError.message);
  for (const attachment of draft.Attachments ?? []) {
    const extension = /\.([^.]*)$/.exec(attachment.Name)?.[1]?.toLowerCase();
    if (extension !== undefined && FORBIDDEN_EXTENSIONS.has(extension)) {
      return reject("Attachments", errorBody(411));
    }
  }
  // A fake bounce type with an uncaptured effect answers 501 before anything is stored.
  if (submission.auth.kind !== "test") testBounces(draft.Headers ?? [], recipients);
  return {
    outcome: "valid",
    outbound: {
      submission,
      draft: { ...draft, From: draft.From, To: draft.To },
      streamId,
      from,
      lists,
      recipients,
    },
  };
}

/**
 * Account approval → suppression check → store (docs/11 §2), with no event. The test token stops
 * before them: it validates data only, and account state and suppressions are INFERRED not to
 * apply to it (docs/02 Q18).
 */
function storeOutbound(runtime: Runtime, outbound: ValidOutbound): SubmitResult {
  const { submission, draft, streamId, from, lists, recipients } = outbound;
  const { auth } = submission;
  const now = runtime.clock.now();
  if (auth.kind === "test") {
    return { outcome: "validated", messageId: newMessageId(), submittedAt: now };
  }
  const { account } = runtime.store.state;
  if (account.approval === "unapproved") return { outcome: "rejected", error: errorBody(413) };
  const fromDomain = domainOf(from);
  if (account.approval === "pending" && recipients.some((r) => domainOf(r) !== fromDomain)) {
    return { outcome: "rejected", error: errorBody(412) };
  }

  const inactive = inactiveRecipients(runtime, auth.server.ID, streamId, recipients);
  if (inactive.length === recipients.length) {
    return { outcome: "rejected", error: inactiveRecipientsError(uniqueEmails(inactive)) };
  }

  const messageId = newMessageId();
  const message: OutboundMessage = {
    MessageID: messageId,
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
    // A server with open tracking on forces it on (docs/03 §5.3); a message without an HTML body
    // is never tracked (docs/07 §3).
    TrackOpens:
      draft.HtmlBody !== undefined && (auth.server.TrackOpens || (draft.TrackOpens ?? false)),
    // A message value overrides the server value (docs/03 §5.2).
    TrackLinks: draft.TrackLinks ?? auth.server.TrackLinks,
    Status: "Sent",
    Sandboxed: auth.server.DeliveryType === "Sandbox",
    ReceivedAt: now,
    MessageEvents: [],
    channel: submission.channel,
    request: submission.request,
    rawSource:
      submission.channel === "smtp" ? submission.rawSource : restSource(outbound, messageId, now),
    bulkRequestId: submission.bulkRequestId,
    templateId: submission.templateId,
    suppressedRecipients: uniqueEmails(inactive),
  };
  runtime.store.state.outbound.set(message.MessageID, message);
  return inactive.length === 0
    ? { outcome: "accepted", message }
    : {
        outcome: "partiallySuppressed",
        message,
        error: inactiveRecipientsError(uniqueEmails(inactive)),
      };
}

/**
 * The MIME source of a REST send, served by the dump endpoint. The gem live test finds the subject
 * in it (sdk/postmark-gem/spec/integration/api_client_resources_spec.rb:36-40). Postmark adds
 * `X-PM-Tag` and `X-PM-Message-Id` (refs/api_messages-api.md:276). A `Message-ID` from `Headers`
 * is kept; otherwise it is `<uuid@mtasv.net>`, as on SMTP (src/smtp/mime.ts, INFERRED). The layout
 * is INFERRED.
 */
function restSource({ draft, from, lists }: ValidOutbound, messageId: string, now: Date): string {
  const address = (a: Address) => ({ email: a.Email, name: a.Name ?? undefined });
  const custom = (draft.Headers ?? []).map((h) => ({ name: h.Name, value: h.Value }));
  const hasMessageId = custom.some((h) => h.name.toLowerCase() === "message-id");
  return composeMime(
    {
      from: address(from),
      to: lists.To.map(address),
      cc: lists.Cc.map(address),
      replyTo: draft.ReplyTo,
      subject: draft.Subject ?? "",
      text: draft.TextBody,
      html: draft.HtmlBody,
      headers: [
        ...custom,
        ...(draft.Tag === undefined ? [] : [{ name: "X-PM-Tag", value: draft.Tag }]),
        { name: "X-PM-Message-Id", value: messageId },
        ...(hasMessageId ? [] : [{ name: "Message-ID", value: `<${randomUUID()}@mtasv.net>` }]),
      ],
      attachments: (draft.Attachments ?? []).map((a) => ({
        name: a.Name,
        content: a.Content.toString("base64"),
        contentType: a.ContentType,
        contentId: a.ContentID || undefined,
      })),
    },
    now,
  );
}

/**
 * Stores every accepted message, then emits `sent` for each, in order. A `sent` listener that
 * changes state (archives a stream, adds a suppression) cannot affect a later message of the
 * same request.
 */
export async function acceptOutbounds(
  runtime: Runtime,
  outbounds: readonly ValidOutbound[],
): Promise<SubmitResult[]> {
  const results = outbounds.map((outbound) => storeOutbound(runtime, outbound));
  for (const result of results) {
    if ("message" in result) await runtime.events.emit("sent", { message: result.message });
  }
  return results;
}

export async function acceptOutbound(
  runtime: Runtime,
  outbound: ValidOutbound,
): Promise<SubmitResult> {
  const [result] = await acceptOutbounds(runtime, [outbound]);
  return result as SubmitResult;
}

/** `validateOutbound`, then `acceptOutbound` for a valid draft. */
export async function submitOutbound(
  runtime: Runtime,
  submission: Submission,
): Promise<SubmitResult> {
  const validation = validateOutbound(runtime, submission);
  return validation.outcome === "valid"
    ? acceptOutbound(runtime, validation.outbound)
    : { outcome: "rejected", error: validation.error };
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
function checkLimits(draft: Draft): { field: string; message: string } | undefined {
  if ((draft.From ?? "").length > MAX_FROM) {
    return {
      field: "From",
      message: `The 'From' field exceeds the maximum length of ${MAX_FROM} characters.`,
    };
  }
  if ((draft.Subject ?? "").length > MAX_SUBJECT) {
    return {
      field: "Subject",
      message: `The 'Subject' field exceeds the maximum length of ${MAX_SUBJECT} characters.`,
    };
  }
  if ((draft.Tag ?? "").length > MAX_TAG) {
    return {
      field: "Tag",
      message: `The 'Tag' field exceeds the maximum length of ${MAX_TAG} characters.`,
    };
  }
  const metadata = Object.entries(draft.Metadata ?? {});
  if (metadata.length > MAX_METADATA_FIELDS) {
    return {
      field: "Metadata",
      message: `Metadata may contain at most ${MAX_METADATA_FIELDS} fields.`,
    };
  }
  const seen = new Set<string>();
  for (const [key, value] of metadata) {
    if (key.length > MAX_METADATA_KEY) {
      return {
        field: "Metadata",
        message: `Metadata field name '${key}' exceeds the maximum length of ${MAX_METADATA_KEY} characters.`,
      };
    }
    if (value.length > MAX_METADATA_VALUE) {
      return {
        field: "Metadata",
        message: `Metadata field '${key}' value exceeds the maximum length of ${MAX_METADATA_VALUE} characters.`,
      };
    }
    if (seen.has(key.toLowerCase()))
      return { field: "Metadata", message: `Metadata field '${key}' appears more than once.` };
    seen.add(key.toLowerCase());
  }
  return undefined;
}

const domainOf = (address: Address): string =>
  (address.Email.split("@").at(-1) as string).toLowerCase();

/** Recipients on the send stream's suppression list; each stream has its own list (docs/04 §3.3). */
function inactiveRecipients(
  runtime: Runtime,
  serverId: number,
  streamId: string,
  recipients: Address[],
): Address[] {
  const emails = recipients.map((r) => r.Email);
  const suppressed = new Set(suppressedAddresses(runtime.store.state, serverId, streamId, emails));
  return recipients.filter((r) => suppressed.has(r.Email));
}

/** Each address once, in first-seen spelling; addresses compare without case. */
function uniqueEmails(addresses: Address[]): string[] {
  const byLower = new Map<string, string>();
  for (const { Email } of addresses) {
    if (!byLower.has(Email.toLowerCase())) byLower.set(Email.toLowerCase(), Email);
  }
  return [...byLower.values()];
}
