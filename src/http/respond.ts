import type { ApiError } from "../errors.ts";

/**
 * Behavior postmock does not know yet (an uncaptured response, an unbuilt route).
 * Answers 501 with a plain-text reason, so a test fails loudly instead of learning a guess
 * (AGENTS.md rule 5).
 */
export class Unsupported extends Error {}

// docs/02 §4.1 example: `Content-Type: application/json`; charset pending capture Q4.
const JSON_TYPE = "application/json";

/** Serializes JSON and refuses a raw Date: each surface formats its own dates (docs/02 §7.1). */
export function toJson(body: unknown): string {
  return JSON.stringify(body, function (this: Record<string, unknown>, key, value) {
    if (this[key] instanceof Date) throw new Error(`unformatted Date at key '${key}'`);
    return value;
  });
}

/** Every success is HTTP 200 with a JSON body (docs/08 E1, E2). */
export const jsonResponse = (body: unknown): Response =>
  new Response(toJson(body), { status: 200, headers: { "Content-Type": JSON_TYPE } });

/** `{ErrorCode, Message}` with `X-PM-ApiErrorCode` (docs/02 §4.1; docs/08 E3). */
export const errorResponse = (error: ApiError): Response =>
  new Response(toJson(error.body), {
    status: error.status,
    headers: { "Content-Type": JSON_TYPE, "X-PM-ApiErrorCode": String(error.body.ErrorCode) },
  });

export const textResponse = (status: number, text: string): Response =>
  new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * A list page with its wrapper key and `TotalCount`, both present when empty. `TotalCount` counts
 * every match, not the page (docs/08 E9).
 */
export function paged<T>(
  key: string,
  items: readonly T[],
  count: number,
  offset: number,
): Record<string, unknown> {
  return { TotalCount: items.length, [key]: items.slice(offset, offset + count) };
}
