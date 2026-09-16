import { z } from "zod";
import { apiError, type ErrorFamily } from "../../errors.ts";
import { formatTimestamp } from "../../time.ts";
import { ControlError, controlInput, defineControl } from "../registry.ts";
import { seedAtomically } from "../seeding.ts";

// docs/09 §5: reset, seed, clock, faults, messages.

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
    return { now: formatTimestamp(ctx.clock.now(), "utc") };
  },
});

const faultSchema = z.object({
  match: z.object({ method: z.string(), path: z.string().startsWith("/") }),
  times: z.int().positive().default(1),
  reply: z.union([
    z.object({
      errorCode: z.int(),
      status: z.int().optional(),
      family: z.string().optional(),
      message: z.string().optional(),
    }),
    z.literal("timeout"),
    z.literal("reset"),
  ]),
});

defineControl({
  method: "POST",
  path: "/control/faults",
  handler: (ctx) => {
    const { match, times, reply } = controlInput(faultSchema, ctx.body);
    ctx.store.state.faults.push({
      method: match.method,
      path: match.path,
      remaining: times,
      reply: typeof reply === "string" ? reply : faultError(reply),
    });
    return { faults: ctx.store.state.faults.length };
  },
});

/** Only a status and ErrorCode pair from docs/02 §4.4 can be faulted (CONTROL-API.md principle). */
function faultError(reply: Exclude<z.output<typeof faultSchema>["reply"], string>) {
  try {
    const { status, body } = apiError(reply.errorCode, {
      ...(reply.status !== undefined && { status: reply.status }),
      ...(reply.family !== undefined && { family: reply.family as ErrorFamily }),
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
