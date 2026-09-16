import { z } from "zod";
import { errorBody } from "../../errors.ts";
import { formatTimestamp } from "../../time.ts";
import { type ControlContext, ControlError, controlInput, defineControl } from "../registry.ts";
import { applySeed, seedNames } from "../seed.ts";

// docs/09 §5: reset, seed, clock, faults, messages.

defineControl({
  method: "POST",
  path: "/control/reset",
  handler: async (ctx) => {
    const { seed = ctx.startupSeed } = controlInput(
      z.object({ seed: z.string().optional() }),
      ctx.body,
    );
    await seedAtomically(ctx, seed, () => ctx.store.reset());
    ctx.clock.reset();
    return { seed };
  },
});

defineControl({
  method: "POST",
  path: "/control/seed",
  handler: async (ctx) => {
    const { name } = controlInput(z.object({ name: z.string() }), ctx.body);
    await seedAtomically(ctx, name, () => {});
    return { seed: name };
  },
});

/** Runs `prepare` and the seed, or neither: a failing seed restores the state and answers 400. */
async function seedAtomically(
  ctx: ControlContext,
  name: string,
  prepare: () => void,
): Promise<void> {
  if (!seedNames().includes(name)) {
    throw new ControlError(`unknown seed '${name}'; seeds: ${seedNames().join(", ")}`);
  }
  const before = structuredClone(ctx.store.state);
  try {
    prepare();
    await applySeed(ctx, name);
  } catch (error) {
    ctx.store.state = before;
    throw new ControlError(`seed '${name}' failed: ${(error as Error).message}`);
  }
}

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
    z.object({ status: z.int().min(400).max(599), errorCode: z.int() }),
    z.literal("timeout"),
    z.literal("reset"),
  ]),
});

defineControl({
  method: "POST",
  path: "/control/faults",
  handler: (ctx) => {
    const { match, times, reply } = controlInput(faultSchema, ctx.body);
    if (typeof reply === "object") {
      try {
        errorBody(reply.errorCode);
      } catch (error) {
        throw new ControlError((error as Error).message);
      }
    }
    ctx.store.state.faults.push({
      method: match.method,
      path: match.path,
      remaining: times,
      reply,
    });
    return { faults: ctx.store.state.faults.length };
  },
});

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
