import type { HttpBindings } from "@hono/node-server";
import { ApiError } from "../errors.ts";
import { parseAddressList } from "../pipeline/addresses.ts";
import type { Runtime } from "../runtime.ts";
import type { Fault, RequestRule } from "../state/types.ts";
import { errorResponse } from "./respond.ts";
import { type Method, RouteTable } from "./routes.ts";

/** What a rule can match on: the route, and the send body for a recipient domain. */
export interface RuleRequest {
  method: string;
  pathname: string;
  body: ArrayBuffer;
}

/**
 * Holds the request for the first matching latency rule, then applies the first matching fault
 * (docs/09 §5 `POST /control/latency`, `POST /control/faults`). Each match uses one of the rule's
 * `times`. `timeout` holds the request open until the client gives up; `reset` destroys the socket.
 */
export async function applyFault(
  { store, clock }: Runtime,
  request: RuleRequest,
  env: HttpBindings,
): Promise<Response | undefined> {
  const latency = take(store.state.latencies, request);
  if (latency) await clock.hold(latency.ms);
  const fault = take(store.state.faults, request);
  return fault && reply(fault, env);
}

function take<R extends RequestRule>(rules: R[], request: RuleRequest): R | undefined {
  let domains: Set<string> | undefined;
  const rule = rules.find((r) => {
    if (r.remaining <= 0) return false;
    const table = new RouteTable<{ method: Method; path: string }>();
    table.add({ method: r.method.toUpperCase() as Method, path: r.path });
    if (table.match(request.method, request.pathname) === undefined) return false;
    if (r.recipientDomain === undefined) return true;
    domains ??= recipientDomains(request.body);
    return domains.has(r.recipientDomain);
  });
  if (rule) rule.remaining -= 1;
  return rule;
}

/**
 * The lower-case domains of every To, Cc and Bcc address in a send body: one message, a batch
 * array, or a `Messages` list. Keys match without case (docs/08 R8). A body that is not JSON has
 * none; its route answers the Postmark error.
 */
function recipientDomains(bytes: ArrayBuffer): Set<string> {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return new Set();
  }
  const list = field(body, "Messages");
  const messages = Array.isArray(body) ? body : Array.isArray(list) ? list : [body];
  const domains = new Set<string>();
  for (const message of messages) {
    for (const name of ["To", "Cc", "Bcc"]) {
      const raw = field(message, name);
      if (typeof raw !== "string") continue;
      for (const { Email } of parseAddressList(raw) ?? []) {
        domains.add(Email.slice(Email.lastIndexOf("@") + 1).toLowerCase());
      }
    }
  }
  return domains;
}

function field(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const key = Object.keys(value).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : (value as Record<string, unknown>)[key];
}

async function reply(fault: Fault, env: HttpBindings): Promise<Response> {
  const { reply } = fault;
  if (reply === "reset") {
    env.incoming.socket.destroy();
    return new Response(null, { status: 499 });
  }
  if (reply === "timeout") {
    await new Promise((resolve) => env.incoming.socket.once("close", resolve));
    return new Response(null, { status: 499 });
  }
  return errorResponse(new ApiError(reply.status, reply.body));
}
