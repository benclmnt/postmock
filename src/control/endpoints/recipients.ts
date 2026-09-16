import { z } from "zod";
import { Unsupported } from "../../http/respond.ts";
import { recipientsOf, recordBounce, recordUnsubscribe } from "../../recipients/transitions.ts";
import { streamKey } from "../../state/store.ts";
import { findSuppression } from "../../state/suppressions.ts";
import type { BounceType, OutboundMessage } from "../../state/types.ts";
import { type ControlContext, ControlError, controlInput, defineControl } from "../registry.ts";

// What a recipient or its mail server does to a delivered message (docs/04 §3.2 T1–T5).

/** Bounce types a receiving mail server reports, with a known effect on the address (docs/04 §1.4). */
const SERVER_BOUNCE_TYPES = [
  "HardBounce",
  "Transient",
  "Subscribe",
  "AutoResponder",
  "AddressChange",
  "DnsError",
  "SpamNotification",
  "OpenRelayTest",
  "Unknown",
  "SoftBounce",
  "VirusNotification",
  "ChallengeVerification",
] as const satisfies readonly BounceType[];

const target = z.object({ messageId: z.string(), recipient: z.string() });

/** A delivered message and one of its recipients, with its case as sent. */
function delivered(ctx: ControlContext, input: z.output<typeof target>) {
  const message = ctx.store.state.outbound.get(input.messageId);
  if (message === undefined) throw new ControlError(`no outbound message ${input.messageId}`);
  // A sandbox server delivers nothing, so nothing can bounce (docs/07 §2).
  if (message.Sandboxed)
    throw new ControlError(`message ${message.MessageID} was not delivered (sandbox)`);
  const email = recipientsOf(message).find(
    (r) => r.toLowerCase() === input.recipient.toLowerCase(),
  );
  if (email === undefined) {
    throw new ControlError(`${input.recipient} is not a recipient of ${message.MessageID}`);
  }
  const stream = ctx.store.state.streams.get(streamKey(message.ServerID, message.MessageStream));
  // A purged stream, or a new stream with the same ID, never carried this message.
  if (stream === undefined || stream.CreatedAt.getTime() > message.ReceivedAt.getTime()) {
    throw new ControlError(`stream ${message.MessageStream} of ${message.MessageID} is gone`);
  }
  if (message.Status === "Queued") {
    throw new ControlError(`message ${message.MessageID} is queued, not delivered`);
  }
  // A send skips an address suppressed at send time (docs/04 §3.3).
  const row = findSuppression(ctx.store.state, message.ServerID, message.MessageStream, email);
  if (row !== undefined && row.CreatedAt.getTime() <= message.ReceivedAt.getTime()) {
    throw new ControlError(`${email} was suppressed when ${message.MessageID} was sent`);
  }
  return { message, email, stream };
}

/**
 * One message ends once per recipient: after a bounce or complaint other than a `Transient` delay,
 * no further bounce or complaint comes (INFERRED).
 */
function refuseAfterFinal(ctx: ControlContext, message: OutboundMessage, email: string) {
  for (const bounce of ctx.store.state.bounces.values()) {
    if (
      bounce.MessageID === message.MessageID &&
      bounce.Email === email &&
      bounce.Type !== "Transient"
    ) {
      throw new ControlError(`${message.MessageID} already has a ${bounce.Type} for ${email}`);
    }
  }
}

/** Behavior postmock does not know is a bad control request, not a crash. */
async function known<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Unsupported) throw new ControlError(error.message);
    throw error;
  }
}

/** A minimal DSN as the bounce dump (INFERRED shape). */
const dsn = (message: OutboundMessage, email: string, details: string) =>
  [
    "Return-Path: <>",
    "From: MAILER-DAEMON@postmock.invalid",
    `To: ${message.From}`,
    "Subject: Undelivered Mail Returned to Sender",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `Delivery to ${email} failed.`,
    details,
    "",
  ].join("\r\n");

defineControl({
  method: "POST",
  path: "/control/bounces",
  handler: async (ctx) => {
    const input = controlInput(
      target.extend({
        type: z.enum(SERVER_BOUNCE_TYPES),
        details: z.string().default("smtp;550 5.1.1 The email account does not exist."),
        dump: z.string().optional(),
      }),
      ctx.body,
    );
    const { message, email } = delivered(ctx, input);
    refuseAfterFinal(ctx, message, email);
    const bounce = await known(() =>
      recordBounce(ctx, {
        message,
        email,
        type: input.type,
        details: input.details,
        content: input.dump ?? dsn(message, email, input.details),
      }),
    );
    return { ID: bounce.ID };
  },
});

defineControl({
  method: "POST",
  path: "/control/events/spam-complaint",
  handler: async (ctx) => {
    const input = controlInput(target.extend({ dump: z.string().optional() }), ctx.body);
    const { message, email } = delivered(ctx, input);
    refuseAfterFinal(ctx, message, email);
    const bounce = await known(() =>
      recordBounce(ctx, {
        message,
        email,
        type: "SpamComplaint",
        details: "",
        content:
          input.dump ??
          `Content-Type: message/feedback-report\r\n\r\nFeedback-Type: abuse\r\nOriginal-Rcpt-To: ${email}\r\n`,
      }),
    );
    return { ID: bounce.ID };
  },
});

defineControl({
  method: "POST",
  path: "/control/events/unsubscribe",
  handler: async (ctx) => {
    const { message, email, stream } = delivered(ctx, controlInput(target, ctx.body));
    // Postmark adds its unsubscribe link only on such a stream (docs/04 §3.2 T5).
    if (
      stream.MessageStreamType !== "Broadcasts" ||
      stream.SubscriptionManagementConfiguration.UnsubscribeHandlingType !== "Postmark"
    ) {
      throw new ControlError(
        `stream ${message.MessageStream} has no Postmark unsubscribe handling`,
      );
    }
    return { suppressed: await known(() => recordUnsubscribe(ctx, message, email)) };
  },
});
