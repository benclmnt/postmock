import type { HttpBindings } from "@hono/node-server";
import { ApiError, errorBody } from "../errors.ts";
import type { State } from "../state/store.ts";
import type { Fault } from "../state/types.ts";
import { errorResponse } from "./respond.ts";
import { type Method, RouteTable } from "./routes.ts";

/**
 * Applies the first fault that matches the request and uses one of its `times`
 * (docs/09 §5 `POST /control/faults`). `timeout` holds the request open until the client gives up;
 * `reset` destroys the socket.
 */
export async function applyFault(
  state: State,
  method: string,
  pathname: string,
  env: HttpBindings,
): Promise<Response | undefined> {
  const fault = state.faults.find((f) => {
    if (f.remaining <= 0) return false;
    const table = new RouteTable<{ method: Method; path: string }>();
    table.add({ method: f.method.toUpperCase() as Method, path: f.path });
    return table.match(method, pathname) !== undefined;
  });
  if (!fault) return undefined;
  fault.remaining -= 1;
  return reply(fault, env);
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
  return errorResponse(new ApiError(reply.status, errorBody(reply.errorCode)));
}
