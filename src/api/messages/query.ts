import { apiError } from "../../errors.ts";
import { parseQueryDate, type Query } from "../../http/normalize.ts";
import { formatEasternDate } from "../../time.ts";

// Paging and filters shared by the Messages API reads (docs/06 §1.1, §1.7).
// ErrorCode 700 is DOC (refs/api_overview.md:112); its message texts are INFERRED.

/** Messages, opens and clicks leave the API after the default retention (docs/06 §1.1). */
export const RETENTION_MS = 45 * 24 * 60 * 60 * 1000;

export const retained = (at: Date, now: Date): boolean =>
  now.getTime() - at.getTime() <= RETENTION_MS;

const invalid = (message: string) => apiError(700, { message });

const integer = (query: Query, name: string): number | undefined => {
  const raw = query.get(name);
  if (raw === undefined) return undefined;
  return /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
};

/**
 * `count` 1–500 and `offset` ≥ 0 are required; `count + offset` ≤ 10 000
 * (refs/api_messages-api.md:34-35, :630-631). The clicks and single-message pages do not state the
 * 10 000 cap; the mock applies it there too (INFERRED, docs/06 §5.4). A page past the cap is
 * rejected, never clamped.
 */
export function paging(query: Query): { count: number; offset: number } {
  const count = integer(query, "count");
  const offset = integer(query, "offset");
  if (count === undefined || !(count >= 1 && count <= 500)) {
    throw invalid("The 'count' parameter must be an integer between 1 and 500.");
  }
  if (offset === undefined || !(offset >= 0)) {
    throw invalid("The 'offset' parameter must be an integer of 0 or more.");
  }
  if (count + offset > 10000) throw invalid("Count + Offset cannot exceed 10,000 messages.");
  return { count, offset };
}

/** `fromdate`/`todate`, inclusive, Eastern time; a date-only `todate` covers its whole day. */
export function dateRange(query: Query): (at: Date) => boolean {
  const bound = (name: "fromdate" | "todate") => {
    const raw = query.get(name);
    if (raw === undefined) return undefined;
    const parsed = parseQueryDate(raw);
    if (parsed === undefined) throw invalid(`The '${name}' parameter is not a valid date.`);
    return parsed;
  };
  const from = bound("fromdate");
  const to = bound("todate");
  return (at) =>
    (from === undefined || at.getTime() >= from.instant.getTime()) &&
    (to === undefined ||
      (to.dateOnly
        ? formatEasternDate(at) <= formatEasternDate(to.instant)
        : at.getTime() <= to.instant.getTime()));
}

/** A `status` value from `allowed`, matched without case. */
export function status<S extends string>(query: Query, allowed: Record<string, readonly S[]>) {
  const raw = query.get("status");
  if (raw === undefined) return undefined;
  const statuses = allowed[raw.toLowerCase()];
  if (statuses === undefined) throw invalid(`The 'status' parameter '${raw}' is not valid.`);
  return statuses;
}

export const sameText = (a: string | null | undefined, b: string): boolean =>
  a != null && a.toLowerCase() === b.toLowerCase();
