import { z } from "zod";
import { apiError } from "../../errors.ts";
import { inclusiveUpperBound, queryBool, queryDate, queryInt } from "../../http/normalize.ts";
import { paged } from "../../http/respond.ts";
import { defineRoute, type RequestContext, type ServerAuth } from "../../http/routes.ts";
import {
  activateBounce,
  bounceVisible,
  dumpAvailable,
  findBounce,
} from "../../recipients/transitions.ts";
import { BOUNCE_TYPES, type BounceType } from "../../state/types.ts";
import { bounceJson } from "./json.ts";

// Bounce API: docs/04 §1. Every 1000 and 1001 message text is INFERRED (summary rows,
// refs/api_overview.md:116-117).

const bounceType = z.string().refine((t): t is BounceType => Object.hasOwn(BOUNCE_TYPES, t));

const listQuery = z.object({
  count: queryInt.pipe(z.number().int().min(1).max(500)),
  offset: queryInt.pipe(z.number().int().min(0)),
  type: bounceType.optional(),
  inactive: queryBool.optional(),
  emailFilter: z.string().optional(),
  tag: z.string().optional(),
  messageID: z.string().optional(),
  fromdate: queryDate.optional(),
  todate: queryDate.optional(),
  messagestream: z.string().default("outbound"),
});

const QUERY_MESSAGES: Record<string, string> = {
  count: "Count must be an integer between 1 and 500.",
  offset: "Offset must be a non-negative integer.",
  type: "Illegal bounce type.",
  inactive: "Inactive must be true or false.",
  fromdate: "FromDate must be a date.",
  todate: "ToDate must be a date.",
};

defineRoute({
  method: "GET",
  path: "/bounces",
  auth: "server",
  handler: ({ store, clock, query, auth }) => {
    const parsed = query.pick(listQuery);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0]);
      throw apiError(1000, { message: QUERY_MESSAGES[field] ?? `Invalid ${field}.` });
    }
    const q = parsed.data;
    if (q.count + q.offset > 10000) {
      throw apiError(1000, { message: "Count plus offset cannot exceed 10,000." });
    }
    const now = clock.now();
    const from = q.fromdate?.instant.getTime();
    const to = q.todate && inclusiveUpperBound(q.todate).getTime();
    const matches = [...store.state.bounces.values()]
      .filter(
        (b) =>
          b.ServerID === auth.server.ID &&
          bounceVisible(b, now) &&
          b.MessageStream === q.messagestream &&
          (q.type === undefined || b.Type === q.type) &&
          (q.inactive === undefined || b.Inactive === q.inactive) &&
          // Substring match, case rule INFERRED (docs/04 §1.2, Q1).
          (q.emailFilter === undefined ||
            b.Email.toLowerCase().includes(q.emailFilter.toLowerCase())) &&
          (q.tag === undefined || b.Tag === q.tag) &&
          (q.messageID === undefined || b.MessageID.toLowerCase() === q.messageID.toLowerCase()) &&
          (from === undefined || b.BouncedAt.getTime() >= from) &&
          (to === undefined || b.BouncedAt.getTime() < to),
      )
      // Newest first (refs/api_bounce-api.md:151-196 example order).
      .sort((a, b) => b.BouncedAt.getTime() - a.BouncedAt.getTime() || b.ID - a.ID)
      .map((b) => ({ RecordType: "Bounce", ...bounceJson(b, now, "list") }));
    return paged("Bounces", matches, q.count, q.offset);
  },
});

/** The bounce ID from the path; a non-integer is an unknown bounce (INFERRED). */
function bounceOf(ctx: RequestContext & { auth: ServerAuth }) {
  const raw = ctx.params.bounceid as string;
  if (!/^\d+$/.test(raw)) throw apiError(1001, { message: "The bounce was not found." });
  return findBounce(ctx, ctx.auth.server, Number(raw));
}

defineRoute({
  method: "GET",
  path: "/bounces/:bounceid",
  auth: "server",
  handler: (ctx) => bounceJson(bounceOf(ctx), ctx.clock.now(), "single"),
});

defineRoute({
  method: "GET",
  path: "/bounces/:bounceid/dump",
  auth: "server",
  handler: (ctx) => {
    const bounce = bounceOf(ctx);
    if (bounce.Content === "") return { Body: "" };
    if (!dumpAvailable(bounce, ctx.clock.now())) {
      throw apiError(1001, { message: "The bounce dump is no longer available." });
    }
    return { Body: bounce.Content };
  },
});

// Accepts an empty body and `{}` (docs/04 §3.4); the body is not read.
defineRoute({
  method: "PUT",
  path: "/bounces/:bounceid/activate",
  auth: "server",
  handler: async (ctx) => {
    const bounce = bounceOf(ctx);
    await activateBounce(ctx, bounce);
    return { Message: "OK", Bounce: bounceJson(bounce, ctx.clock.now(), "single") };
  },
});

// postmark.js calls `/deliveryStats`; literals match without case (docs/04 §6).
defineRoute({
  method: "GET",
  path: "/deliverystats",
  auth: "server",
  handler: ({ store, clock, auth }) => {
    const now = clock.now();
    const bounces = [...store.state.bounces.values()].filter(
      (b) => b.ServerID === auth.server.ID && bounceVisible(b, now),
    );
    const types = (Object.keys(BOUNCE_TYPES) as BounceType[])
      .map((type) => ({
        Type: type,
        Name: BOUNCE_TYPES[type].Name,
        Count: bounces.filter((b) => b.Type === type).length,
      }))
      .filter((row) => row.Count > 0);
    return {
      // Inactive bounces, INFERRED from the example ratio (refs/api_bounce-api.md:41-47).
      InactiveMails: bounces.filter((b) => b.Inactive).length,
      Bounces: [{ Name: "All", Count: bounces.length }, ...types],
    };
  },
});
