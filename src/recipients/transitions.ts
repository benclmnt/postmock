import { apiError } from "../errors.ts";
import { Unsupported } from "../http/respond.ts";
import type { Runtime } from "../runtime.ts";
import { suppressionKey } from "../state/store.ts";
import { findSuppression } from "../state/suppressions.ts";
import type {
  Bounce,
  BounceType,
  OutboundMessage,
  Server,
  Suppression,
  SuppressionOrigin,
  SuppressionReason,
} from "../state/types.ts";

// The recipient state machine of docs/04 §3.2: bounces, suppressions and the events between them.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Bounces are kept 45 days (refs/api_bounce-api.md:4); their suppression rows stay (T14, INFERRED). */
export const BOUNCE_RETENTION_MS = 45 * DAY_MS;
/** No dump after 30 days (refs/api_bounce-api.md:141). */
export const DUMP_RETENTION_MS = 30 * DAY_MS;

// refs/api_bounce-api.md:397-418.
export const BOUNCE_DESCRIPTIONS: Record<BounceType, string> = {
  HardBounce:
    "The server was unable to deliver your message (ex: unknown user, mailbox not found).",
  Transient:
    "The server could not temporarily deliver your message (ex: Message is delayed due to network troubles).",
  Unsubscribe: "Unsubscribe or Remove request.",
  Subscribe: "Subscribe request from someone wanting to get added to the mailing list.",
  AutoResponder:
    '"Autoresponder" is an automatic email responder including nondescript NDRs and some "out of office" replies.',
  AddressChange: "The recipient has requested an address change.",
  DnsError: "A temporary DNS error.",
  SpamNotification:
    "The message was delivered, but was either blocked by the user, or classified as spam, bulk mail, or had rejected content.",
  OpenRelayTest:
    "The NDR is actually a test email message to see if the mail server is an open relay.",
  Unknown: "Unable to classify the NDR.",
  SoftBounce:
    "Unable to temporarily deliver message (i.e. mailbox full, account disabled, exceeds quota, out of disk space).",
  VirusNotification:
    "The bounce is actually a virus notification warning about a virus/code infected message.",
  ChallengeVerification:
    "The bounce is a challenge asking for verification you actually sent the email. Typcial challenges are made by Spam Arrest, or MailFrontier Matador.",
  BadEmailAddress: "The address is not a valid email address.",
  SpamComplaint: "The subscriber explicitly marked this message as spam.",
  ManuallyDeactivated: "The email was manually deactivated.",
  Unconfirmed:
    "The subscriber has not clicked on the confirmation link upon registration or import.",
  Blocked: "Blocked from this ISP due to content or blacklisting.",
  SMTPApiError: "An error occurred while accepting an email through the SMTP API.",
  InboundError: "Unable to deliver inbound message to destination inbound hook.",
  DMARCPolicy: "Email rejected due DMARC Policy.",
  TemplateRenderingFailed: "An error occurred while attempting to render your template.",
};

/**
 * Bounce types whose effect on the address is known (docs/04 §1.4): `true` deactivates.
 * HardBounce and SpamComplaint are DOC; `false` rows are INFERRED (Q13). SoftBounce "sometimes"
 * deactivates (DOC); postmock never does (Q13). Types absent here have an unknown effect.
 */
const DEACTIVATES: Partial<Record<BounceType, boolean>> = {
  HardBounce: true,
  SpamComplaint: true,
  Transient: false,
  Subscribe: false,
  AutoResponder: false,
  AddressChange: false,
  DnsError: false,
  SpamNotification: false,
  OpenRelayTest: false,
  Unknown: false,
  SoftBounce: false,
  VirusNotification: false,
  ChallengeVerification: false,
};

export const recipientsOf = (message: OutboundMessage): string[] =>
  [...message.To, ...message.Cc, ...message.Bcc].map((a) => a.Email);

/** A bounce is readable until retention ends (T14). */
export const bounceVisible = (bounce: Bounce, now: Date): boolean =>
  now.getTime() - bounce.BouncedAt.getTime() < BOUNCE_RETENTION_MS;

export const dumpAvailable = (bounce: Bounce, now: Date): boolean =>
  bounce.Content !== "" && now.getTime() - bounce.BouncedAt.getTime() < DUMP_RETENTION_MS;

/** A bounce of this server within retention, or 422 / 1001. */
export function findBounce(runtime: Runtime, server: Server, id: number): Bounce {
  const bounce = runtime.store.state.bounces.get(id);
  if (
    bounce === undefined ||
    bounce.ServerID !== server.ID ||
    !bounceVisible(bounce, runtime.clock.now())
  ) {
    // Message text INFERRED from the summary row (refs/api_overview.md:117).
    throw apiError(1001, { message: "The bounce was not found." });
  }
  return bounce;
}

export interface BounceReport {
  message: OutboundMessage;
  /** One recipient of the message. */
  email: string;
  type: BounceType;
  details: string;
  /** Raw dump; "" when none. */
  content: string;
}

/**
 * The recipient server (or the recipient, for SpamComplaint) reports a bounce: T1, T3, T4.
 * A deactivating type marks the bounce inactive and adds a Recipient row on the message stream
 * unless one exists. Emits the bounce event, then `subscriptionChange` for a new row (Q12 order).
 */
export const recordBounce = (runtime: Runtime, report: BounceReport): Promise<Bounce> =>
  recordBounceAt(runtime, report, {
    id: runtime.store.nextId("bounce"),
    at: runtime.clock.now(),
  });

/** `recordBounce` with a bounce ID the caller claimed and a time: a seed records past bounces (docs/11 §5). */
export async function recordBounceAt(
  runtime: Runtime,
  report: BounceReport,
  { id, at }: { id: number; at: Date },
): Promise<Bounce> {
  const { store, events } = runtime;
  const { message, email, type } = report;
  const deactivates = DEACTIVATES[type];
  if (deactivates === undefined) {
    throw new Unsupported(
      `bounce type ${type}: effect on the address is not captured (docs/04 Q13)`,
    );
  }
  const reason: SuppressionReason = type === "SpamComplaint" ? "SpamComplaint" : "HardBounce";
  const existing = findSuppression(store.state, message.ServerID, message.MessageStream, email);
  if (deactivates && existing !== undefined && existing.SuppressionReason !== reason) {
    throw new Unsupported(
      `${type} for ${email}, suppressed as ${existing.SuppressionReason}/${existing.Origin}: effect not captured`,
    );
  }
  const bounce: Bounce = {
    ID: id,
    ServerID: message.ServerID,
    MessageStream: message.MessageStream,
    MessageID: message.MessageID,
    Type: type,
    Tag: message.Tag,
    Description: BOUNCE_DESCRIPTIONS[type],
    Details: report.details,
    Email: email,
    From: message.From,
    Subject: message.Subject ?? "",
    BouncedAt: at,
    Inactive: deactivates,
    // A spam complaint cannot be reactivated (refs/webhooks_spam-complaint-webhook.md:6,58).
    CanActivate: type !== "SpamComplaint",
    Content: report.content,
    Metadata: message.Metadata,
  };
  store.state.bounces.set(bounce.ID, bounce);
  const event = type === "SpamComplaint" ? "spamComplaint" : "bounced";
  await events.emit(event, { bounce });
  if (deactivates && existing === undefined) {
    await addSuppression(runtime, {
      serverId: message.ServerID,
      stream: message.MessageStream,
      email,
      reason,
      origin: "Recipient",
      message,
      at,
    });
  }
  return bounce;
}

/**
 * The recipient unsubscribes through Postmark's link on a Broadcasts stream with
 * `UnsubscribeHandlingType: Postmark` (T5). Returns false when the address is already unsubscribed;
 * an unsubscribe over another row is not captured.
 */
export async function recordUnsubscribe(
  runtime: Runtime,
  message: OutboundMessage,
  email: string,
): Promise<boolean> {
  const existing = findSuppression(
    runtime.store.state,
    message.ServerID,
    message.MessageStream,
    email,
  );
  if (existing !== undefined) {
    if (existing.SuppressionReason === "ManualSuppression" && existing.Origin === "Recipient") {
      return false;
    }
    throw new Unsupported(
      `unsubscribe over a ${existing.SuppressionReason}/${existing.Origin} row is not captured`,
    );
  }
  await addSuppression(runtime, {
    serverId: message.ServerID,
    stream: message.MessageStream,
    email,
    reason: "ManualSuppression",
    origin: "Recipient",
    message,
    at: runtime.clock.now(),
  });
  return true;
}

async function addSuppression(
  runtime: Runtime,
  row: {
    serverId: number;
    stream: string;
    email: string;
    reason: SuppressionReason;
    origin: SuppressionOrigin;
    message: OutboundMessage | null;
    at: Date;
  },
): Promise<void> {
  const now = row.at;
  const suppression: Suppression = {
    ServerID: row.serverId,
    MessageStream: row.stream,
    EmailAddress: row.email,
    SuppressionReason: row.reason,
    Origin: row.origin,
    CreatedAt: now,
  };
  runtime.store.state.suppressions.set(
    suppressionKey(row.serverId, row.stream, row.email),
    suppression,
  );
  // refs/webhooks_subscription-change-webhook.md:35-38: MessageID null for a manual suppression.
  await runtime.events.emit("subscriptionChange", {
    change: {
      MessageID: row.message?.MessageID ?? null,
      ServerID: row.serverId,
      MessageStream: row.stream,
      ChangedAt: now,
      Recipient: row.email,
      Origin: row.origin,
      SuppressSending: true,
      SuppressionReason: row.reason,
      Tag: row.message?.Tag ?? null,
      Metadata: row.message?.Metadata ?? {},
    },
  });
}

/**
 * Removes a row the customer may lift and reactivates its bounces (T7, T8, T11). The
 * `subscriptionChange` event has the null fields of a reactivation (docs/05 §2.6).
 */
async function reactivate(runtime: Runtime, row: Suppression): Promise<void> {
  const { store, clock } = runtime;
  store.state.suppressions.delete(
    suppressionKey(row.ServerID, row.MessageStream, row.EmailAddress),
  );
  const email = row.EmailAddress.toLowerCase();
  // The bounces that caused the row turn active (docs/04 §3.2 T7, flag change INFERRED).
  for (const bounce of store.state.bounces.values()) {
    if (
      bounce.ServerID === row.ServerID &&
      bounce.MessageStream === row.MessageStream &&
      bounce.Email.toLowerCase() === email &&
      bounce.Inactive
    ) {
      bounce.Inactive = false;
    }
  }
  await runtime.events.emit("subscriptionChange", {
    change: {
      MessageID: null,
      ServerID: row.ServerID,
      MessageStream: row.MessageStream,
      ChangedAt: clock.now(),
      Recipient: row.EmailAddress,
      Origin: "Customer",
      SuppressSending: false,
      SuppressionReason: null,
      Tag: null,
      Metadata: {},
    },
  });
}

/** `PUT /bounces/{id}/activate` (T11, T12). */
export async function activateBounce(runtime: Runtime, bounce: Bounce): Promise<void> {
  if (!bounce.CanActivate) throw apiError(1003);
  if (!bounce.Inactive) {
    throw new Unsupported("activate on an active bounce is not captured (docs/04 Q9)");
  }
  const row = findSuppression(
    runtime.store.state,
    bounce.ServerID,
    bounce.MessageStream,
    bounce.Email,
  );
  // Every path that removes a row also turns its bounces active.
  if (row === undefined) throw new Error(`inactive bounce ${bounce.ID} has no suppression row`);
  if (row.SuppressionReason !== "HardBounce") {
    throw new Unsupported(
      `activate with a ${row.SuppressionReason}/${row.Origin} row is not captured`,
    );
  }
  await reactivate(runtime, row);
}

// refs/api_suppressions-api.md:158-165.
const AUTHORITY = "You do not have the required authority to change this suppression.";
const INVALID_ADDRESS = "An invalid email address was provided.";

export interface SuppressionStatus {
  EmailAddress: string;
  Status: "Suppressed" | "Deleted" | "Failed";
  Message: string | null;
}

/**
 * Address syntax for the Suppressions API: one `@`, no spaces, a dot in the domain. The exact rule
 * is INFERRED; `not-a-correct-email-address` fails (sdk/postmark-dotnet/src/Postmark.Tests/ClientSuppressionTests.cs:40).
 */
export const isEmailAddress = (value: string): boolean =>
  /^[^@\s<>()",;:]+@[^@\s<>()",;:]+\.[^@\s<>()",;:]+$/.test(value);

/** `POST .../suppressions`, one item (T6). */
export async function suppressByCustomer(
  runtime: Runtime,
  serverId: number,
  stream: string,
  email: string,
): Promise<SuppressionStatus> {
  if (!isEmailAddress(email))
    return { EmailAddress: email, Status: "Failed", Message: INVALID_ADDRESS };
  const existing = findSuppression(runtime.store.state, serverId, stream, email);
  if (existing === undefined) {
    await addSuppression(runtime, {
      serverId,
      stream,
      email,
      reason: "ManualSuppression",
      origin: "Customer",
      message: null,
      at: runtime.clock.now(),
    });
  } else if (existing.SuppressionReason === "SpamComplaint") {
    return { EmailAddress: email, Status: "Failed", Message: AUTHORITY };
  } else if (existing.SuppressionReason !== "ManualSuppression" || existing.Origin !== "Customer") {
    throw new Unsupported(
      `suppress ${email} over a ${existing.SuppressionReason}/${existing.Origin} row is not captured`,
    );
  }
  return { EmailAddress: email, Status: "Suppressed", Message: null };
}

/** `POST .../suppressions/delete`, one item (T7–T10). */
export async function deleteSuppression(
  runtime: Runtime,
  serverId: number,
  stream: string,
  email: string,
): Promise<SuppressionStatus> {
  // Failed for bad syntax on delete is INFERRED from create (docs/04 §2.4).
  if (!isEmailAddress(email))
    return { EmailAddress: email, Status: "Failed", Message: INVALID_ADDRESS };
  const row = findSuppression(runtime.store.state, serverId, stream, email);
  if (row === undefined) return { EmailAddress: email, Status: "Deleted", Message: null };
  if (row.SuppressionReason === "SpamComplaint") {
    return { EmailAddress: email, Status: "Failed", Message: AUTHORITY };
  }
  const liftable =
    (row.SuppressionReason === "HardBounce" && row.Origin === "Recipient") ||
    (row.SuppressionReason === "ManualSuppression" && row.Origin === "Customer");
  if (!liftable) {
    throw new Unsupported(
      `delete of a ${row.SuppressionReason}/${row.Origin} row is not captured (docs/04 Q4)`,
    );
  }
  await reactivate(runtime, row);
  return { EmailAddress: email, Status: "Deleted", Message: null };
}
