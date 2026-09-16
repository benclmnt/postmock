import { z } from "zod";
import { apiError } from "../../errors.ts";
import { absent, intLike, parseBody } from "../../http/normalize.ts";
import { Unsupported } from "../../http/respond.ts";
import type { State } from "../../state/store.ts";
import { SERVER_COLORS, type Server } from "../../state/types.ts";
import { pathId } from "./paging.ts";

// Servers API (docs/06 §4.2; refs/api_servers-api.md). Messages of summary rows are INFERRED.

/** A doc enum value matched without case (INFERRED), answered in the doc spelling. */
const oneOf = <T extends string>(values: readonly T[]) =>
  z.string().transform((value, ctx) => {
    const found = values.find((v) => v.toLowerCase() === value.toLowerCase());
    if (found !== undefined) return found;
    ctx.issues.push({ code: "custom", message: `not one of ${values.join(", ")}`, input: value });
    return z.NEVER;
  });

const isHttpUrl = (value: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const hookUrl = absent(z.string().refine(isHttpUrl));
const flag = absent(z.boolean());

// refs/api_servers-api.md:121-137 (create body); edit takes the same fields but DeliveryType (:256-271).
const settingsSchema = z.object({
  Name: absent(z.string()),
  Color: absent(oneOf(SERVER_COLORS)),
  SmtpApiActivated: flag,
  RawEmailEnabled: flag,
  DeliveryType: absent(oneOf(["Live", "Sandbox"] as const)),
  InboundHookUrl: hookUrl,
  BounceHookUrl: hookUrl,
  OpenHookUrl: hookUrl,
  DeliveryHookUrl: hookUrl,
  ClickHookUrl: hookUrl,
  PostFirstOpenOnly: flag,
  InboundDomain: absent(z.string()),
  InboundSpamThreshold: absent(intLike.pipe(z.number().min(0).max(30))),
  TrackOpens: flag,
  TrackLinks: absent(oneOf(["None", "HtmlAndText", "HtmlOnly", "TextOnly"] as const)),
  IncludeBounceContentInHook: flag,
  EnableSmtpApiErrorHooks: flag,
});
export type ServerInput = z.output<typeof settingsSchema>;

const HOOK_FIELDS = new Set([
  "InboundHookUrl",
  "BounceHookUrl",
  "OpenHookUrl",
  "DeliveryHookUrl",
  "ClickHookUrl",
]);

/**
 * The settings of a create or edit body. A body that is no JSON object is
 * 609. A bad value gets its field's ErrorCode (refs/api_overview.md:101-108); a field of the wrong
 * JSON type has no documented code, so it answers 501.
 */
export function parseServerInput(state: State, body: unknown, self: Server | null): ServerInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw apiError(609);
  const parsed = parseBody(settingsSchema, body);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0]);
    if (field === "Color") throw apiError(607);
    if (field === "TrackLinks") throw apiError(612);
    if (field === "DeliveryType") throw apiError(613);
    if (field === "InboundSpamThreshold") throw apiError(611);
    if (HOOK_FIELDS.has(field)) {
      throw apiError(606, { message: `The '${field}' is not a valid URL.` });
    }
    throw new Unsupported(
      `server field '${field}' has the wrong type: Postmark's answer is not captured`,
    );
  }
  const input = parsed.data;
  const others = [...state.servers.values()].filter((s) => s.ID !== self?.ID);
  if (input.Name !== undefined) {
    const name = input.Name.toLowerCase();
    if (others.some((s) => s.Name.toLowerCase() === name)) throw apiError(603);
  }
  if (input.InboundDomain !== undefined) {
    const domain = input.InboundDomain.toLowerCase();
    if (domain.includes("postmarkapp.com")) {
      throw apiError(608, { message: "The inbound domain cannot contain postmarkapp.com." });
    }
    // The MX check (ErrorCode 610) needs DNS; postmock accepts every inbound domain.
    if (others.some((s) => s.InboundDomain.toLowerCase() === domain)) throw apiError(602);
  }
  return input;
}

/**
 * Applies an edit body to a server: `PUT /servers/{id}` (account token) and `PUT /server` (server
 * token) take the same fields. DeliveryType is fixed at create (refs/api_servers-api.md:38).
 */
export function editServer(state: State, server: Server, body: unknown): Server {
  const input = parseServerInput(state, body, server);
  if (input.DeliveryType !== undefined && input.DeliveryType !== server.DeliveryType) {
    throw new Unsupported("a DeliveryType change: Postmark's answer is not captured");
  }
  Object.assign(server, definedSettings(input));
  return server;
}

/** The settings a create or edit sets: absent fields keep their value (docs/08 R9). */
export const definedSettings = (input: ServerInput): Partial<Server> =>
  Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));

export function findServer(state: State, id: string): Server {
  const server = state.servers.get(pathId(id) ?? -1);
  // No ErrorCode in the servers table names a missing server (docs/02 §4.4).
  if (server === undefined)
    throw new Unsupported(`server ${id} not found: Postmark's answer is not captured`);
  return server;
}

type ServerOwned = { ServerID: number } | { serverId: number };
const ownerOf = (item: ServerOwned): number => ("ServerID" in item ? item.ServerID : item.serverId);

function dropOwned<K, V extends ServerOwned>(map: Map<K, V>, serverId: number): void {
  for (const [key, item] of map) if (ownerOf(item) === serverId) map.delete(key);
}

/** Removes a server and everything it owns. */
export function deleteServer(state: State, server: Server): void {
  state.servers.delete(server.ID);
  const id = server.ID;
  for (const map of [
    state.streams,
    state.outbound,
    state.inbound,
    state.bounces,
    state.suppressions,
    state.templates,
    state.bulkRequests,
    state.webhooks,
    state.inboundRules,
    state.smtpTokens,
  ] as Map<unknown, ServerOwned>[]) {
    dropOwned(map, id);
  }
  state.opens = state.opens.filter((o) => o.ServerID !== id);
  state.clicks = state.clicks.filter((c) => c.ServerID !== id);
  state.webhookAttempts = state.webhookAttempts.filter((a) => a.serverId !== id);
}
