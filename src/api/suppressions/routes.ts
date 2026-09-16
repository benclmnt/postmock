import { z } from "zod";
import { apiError } from "../../errors.ts";
import { inclusiveUpperBound, parseBody, queryDate } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import { defineRoute, type RequestContext, type ServerAuth } from "../../http/routes.ts";
import {
  deleteSuppression,
  type SuppressionStatus,
  suppressByCustomer,
} from "../../recipients/transitions.ts";
import type { MessageStream } from "../../state/types.ts";
import { formatTimestamp } from "../../time.ts";
import { liveStream } from "../message-streams/streams.ts";

// Suppressions API: docs/04 §2.

type Ctx = RequestContext & { auth: ServerAuth };

/** The path stream, or 1226. Effects of archiving on its suppressions are not captured (Q15). */
function streamOf(ctx: Ctx): MessageStream {
  const stream = liveStream(
    ctx.store.state,
    ctx.auth.server.ID,
    ctx.params.stream as string,
    ctx.clock.now(),
  );
  if (stream.ArchivedAt !== null) {
    throw new Unsupported("suppressions of an archived stream: not captured (docs/04 Q15)");
  }
  return stream;
}

const REASONS = ["HardBounce", "SpamComplaint", "ManualSuppression"] as const;
const ORIGINS = ["Recipient", "Customer", "Admin"] as const;

const dumpQuery = z.object({
  SuppressionReason: z.string().optional(),
  Origin: z.string().optional(),
  fromdate: queryDate.optional(),
  todate: queryDate.optional(),
  EmailAddress: z.string().optional(),
});

defineRoute({
  method: "GET",
  path: "/message-streams/:stream/suppressions/dump",
  auth: "server",
  handler: (ctx) => {
    const stream = streamOf(ctx);
    const parsed = ctx.query.pick(dumpQuery);
    if (!parsed.success) throw new Unsupported("invalid suppression dump date: error not captured");
    const q = parsed.data;
    // Enum values match with case kept (INFERRED); count and offset are ignored (docs/04 §2.2).
    if (
      q.SuppressionReason !== undefined &&
      !(REASONS as readonly string[]).includes(q.SuppressionReason)
    ) {
      throw apiError(1404);
    }
    if (q.Origin !== undefined && !(ORIGINS as readonly string[]).includes(q.Origin)) {
      throw apiError(1405);
    }
    const from = q.fromdate?.instant.getTime();
    const to = q.todate && inclusiveUpperBound(q.todate).getTime();
    const rows = [...ctx.store.state.suppressions.values()].filter(
      (s) =>
        s.ServerID === stream.ServerID &&
        s.MessageStream === stream.ID &&
        (q.SuppressionReason === undefined || s.SuppressionReason === q.SuppressionReason) &&
        (q.Origin === undefined || s.Origin === q.Origin) &&
        (from === undefined || s.CreatedAt.getTime() >= from) &&
        (to === undefined || s.CreatedAt.getTime() < to) &&
        // Exact match without case (INFERRED, Q5).
        (q.EmailAddress === undefined ||
          s.EmailAddress.toLowerCase() === q.EmailAddress.toLowerCase()),
    );
    return {
      Suppressions: rows.map((s) => ({
        EmailAddress: s.EmailAddress,
        SuppressionReason: s.SuppressionReason,
        Origin: s.Origin,
        CreatedAt: formatTimestamp(s.CreatedAt),
      })),
    };
  },
});

const MAX_ITEMS = 50; // refs/api_suppressions-api.md:114
const changeBody = z.object({
  Suppressions: z.array(z.object({ EmailAddress: z.string() })),
});

type Change = (
  ctx: Ctx,
  serverId: number,
  stream: string,
  email: string,
) => Promise<SuppressionStatus>;

/** Applies one change per item, in request order (docs/04 §2.4). */
async function changeAll(ctx: Ctx, change: Change) {
  const stream = streamOf(ctx);
  const parsed = parseBody(changeBody, ctx.body);
  if (!parsed.success) throw apiError(1409);
  const items = parsed.data.Suppressions;
  if (items.length > MAX_ITEMS) throw apiError(1410);
  const Suppressions: SuppressionStatus[] = [];
  for (const { EmailAddress } of items) {
    Suppressions.push(await change(ctx, stream.ServerID, stream.ID, EmailAddress));
  }
  return { Suppressions };
}

defineRoute({
  method: "POST",
  path: "/message-streams/:stream/suppressions",
  auth: "server",
  handler: (ctx) => changeAll(ctx, suppressByCustomer),
});

defineRoute({
  method: "POST",
  path: "/message-streams/:stream/suppressions/delete",
  auth: "server",
  handler: (ctx) => changeAll(ctx, deleteSuppression),
});
