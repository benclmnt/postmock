import type { HttpBindings } from "@hono/node-server";
import { ApiError } from "../errors.ts";
import type { Runtime } from "../runtime.ts";
import type { Fault, RequestRule } from "../state/types.ts";
import { errorResponse } from "./respond.ts";
import { type Method, RouteTable } from "./routes.ts";

/**
 * Holds the request for the first matching latency rule, then applies the first matching fault
 * (docs/09 §5 `POST /control/latency`, `POST /control/faults`). Each match uses one of the rule's
 * `times`. `timeout` holds the request open until the client gives up; `reset` destroys the socket.
 */
export async function applyFault(
  { store, clock }: Runtime,
  method: string,
  pathname: string,
  env: HttpBindings,
): Promise<Response | undefined> {
  const latency = take(store.state.latencies, method, pathname);
  if (latency) await clock.hold(latency.ms);
  const fault = take(store.state.faults, method, pathname);
  return fault && reply(fault, env);
}

function take<R extends RequestRule>(rules: R[], method: string, pathname: string): R | undefined {
  const rule = rules.find((r) => {
    if (r.remaining <= 0) return false;
    const table = new RouteTable<{ method: Method; path: string }>();
    table.add({ method: r.method.toUpperCase() as Method, path: r.path });
    return table.match(method, pathname) !== undefined;
  });
  if (rule) rule.remaining -= 1;
  return rule;
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
