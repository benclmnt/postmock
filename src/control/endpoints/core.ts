import { z } from "zod";
import { apiError, ERROR_FAMILIES, isSummaryRow } from "../../errors.ts";
import type { Clock } from "../../state/clock.ts";
import type { RequestRule } from "../../state/types.ts";
import { formatTimestamp } from "../../time.ts";
import { ControlError, controlInput, defineControl } from "../registry.ts";
import { seedAtomically } from "../seeding.ts";

// docs/09 §5: reset, seed, clock, latency, faults, messages.

defineControl({
  method: "POST",
  path: "/control/reset",
  handler: async (ctx) => {
    const { seed = ctx.startupSeed } = controlInput(
      z.object({ seed: z.string().optional() }),
      ctx.body,
    );
    await seedAtomically(ctx, seed, { reset: true });
    return { seed };
  },
});

defineControl({
  method: "POST",
  path: "/control/seed",
  handler: async (ctx) => {
    const { name } = controlInput(z.object({ name: z.string() }), ctx.body);
    await seedAtomically(ctx, name, { reset: false });
    return { seed: name };
  },
});

defineControl({
  method: "POST",
  path: "/control/clock/advance",
  handler: async (ctx) => {
    const { ms } = controlInput(z.object({ ms: z.int().nonnegative() }), ctx.body);
    await ctx.clock.advance(ms);
    return clockState(ctx.clock);
  },
});

defineControl({
  method: "GET",
  path: "/control/clock",
  handler: (ctx) => clockState(ctx.clock),
});

function clockState(clock: Clock) {
  return { now: formatTimestamp(clock.now(), "utc"), pending: clock.pending };
}

const requestMatch = z.object({
  method: z.string(),
  path: z.string().startsWith("/"),
  recipientDomain: z
    .string()
    .regex(/^[^@\s]+$/)
    .transform((d) => d.toLowerCase())
    .optional(),
});

function requestRule(match: z.output<typeof requestMatch>, times: number): RequestRule {
  return {
    method: match.method,
    path: match.path,
    recipientDomain: match.recipientDomain,
    remaining: times,
  };
}

defineControl({
  method: "POST",
  path: "/control/latency",
  handler: (ctx) => {
    const { match, times, ms } = controlInput(
      z.object({
        match: requestMatch,
        times: z.int().positive().default(1),
        ms: z.int().positive(),
      }),
      ctx.body,
    );
    ctx.store.state.latencies.push({
      ...requestRule(match, times),
      ms,
    });
    return { latencies: ctx.store.state.latencies.length };
  },
});

const errorReply = z.object({
  errorCode: z.int(),
  status: z.int().optional(),
  family: z.enum(ERROR_FAMILIES).optional(),
  message: z.string().optional(),
});

const faultSchema = z.object({
  match: requestMatch,
  times: z.int().positive().default(1),
  reply: z.unknown(),
});

defineControl({
  method: "POST",
  path: "/control/faults",
  handler: (ctx) => {
    const { match, times, reply } = controlInput(faultSchema, ctx.body);
    ctx.store.state.faults.push({
      ...requestRule(match, times),
      reply:
        reply === "timeout" || reply === "reset"
          ? reply
          : faultError(controlInput(errorReply, reply)),
    });
    return { faults: ctx.store.state.faults.length };
  },
});

/** Only a status and ErrorCode pair from docs/02 §4.4 can be faulted (CONTROL-API.md principle). */
function faultError(reply: z.output<typeof errorReply>) {
  try {
    // A message row's text is the wire text; only a summary row takes a caller message.
    if (reply.message !== undefined && !isSummaryRow(reply.errorCode, reply.family)) {
      throw new Error(`ErrorCode ${reply.errorCode}: message only for a summary row`);
    }
    const { status, body } = apiError(reply.errorCode, {
      ...(reply.status !== undefined && { status: reply.status }),
      ...(reply.family !== undefined && { family: reply.family }),
      ...(reply.message !== undefined && { message: reply.message }),
    });
    return { status, body };
  } catch (error) {
    throw new ControlError((error as Error).message);
  }
}

defineControl({
  method: "GET",
  path: "/control/messages",
  handler: ({ store, query }) => {
    const to = query.get("to")?.toLowerCase();
    const tag = query.get("tag");
    const channel = query.get("channel");
    if (channel !== null && channel !== "rest" && channel !== "smtp") {
      throw new ControlError(`channel must be rest or smtp, got '${channel}'`);
    }
    const messages = [...store.state.outbound.values()].filter(
      (m) =>
        (to === undefined ||
          [...m.To, ...m.Cc, ...m.Bcc].some((a) => a.Email.toLowerCase() === to)) &&
        (tag === null || m.Tag === tag) &&
        (channel === null || m.channel === channel),
    );
    return {
      Messages: messages.map((m) => ({
        MessageID: m.MessageID,
        ServerID: m.ServerID,
        MessageStream: m.MessageStream,
        Channel: m.channel,
        SubmittedAt: formatTimestamp(m.ReceivedAt),
        Request: m.request,
      })),
    };
  },
});
