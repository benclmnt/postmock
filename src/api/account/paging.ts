import { z } from "zod";
import { apiError } from "../../errors.ts";
import { type Query, queryInt } from "../../http/normalize.ts";
import { paged } from "../../http/respond.ts";

// `count` (at most 500) and `offset` are required on the servers, domains and senders lists
// (refs/api_servers-api.md:383-384; refs/api_domains-api.md:34-35; refs/api_signatures-api.md:34-35;
// the 500 cap for servers: ErrorCode 600, docs/02 §4.4).
const pageQuery = z.object({
  count: queryInt.pipe(z.number().int().min(0).max(500)),
  offset: queryInt.pipe(z.number().int().min(0)),
});

/**
 * One page of an account list. Servers answer ErrorCode 600, domains and senders 500.
 * The messages are INFERRED: both rows are summaries (docs/02 §4.4).
 */
export function accountPage<T>(
  query: Query,
  key: string,
  items: readonly T[],
  code: 500 | 600,
): Record<string, unknown> {
  const page = query.pick(pageQuery);
  if (!page.success) {
    const field = String(page.error.issues[0]?.path[0]);
    throw apiError(code, {
      message:
        field === "count"
          ? "Parameter 'count' must be an integer between 0 and 500."
          : "Parameter 'offset' must be an integer of 0 or more.",
    });
  }
  const { count, offset } = page.data;
  // "Postmark API returns 0 as total if you request 0 documents" (sdk/postmark-gem/lib/postmark/client.rb:77).
  if (count === 0) return { TotalCount: 0, [key]: [] };
  return paged(key, items, count, offset);
}

/** A numeric path ID; anything else matches no entity. */
export const pathId = (value: string): number | undefined =>
  /^\d+$/.test(value) ? Number(value) : undefined;

/** Entities in ID order (INFERRED). */
export const byId = <T extends { ID: number }>(items: Iterable<T>): T[] =>
  [...items].sort((a, b) => a.ID - b.ID);
