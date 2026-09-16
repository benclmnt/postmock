import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import "../api/index.ts";
import { ApiError } from "../errors.ts";
import type { Runtime } from "../runtime.ts";
import { authenticate } from "./auth.ts";
import { applyFault } from "./faults.ts";
import { decodeJsonBody, Query } from "./normalize.ts";
import { errorResponse, jsonResponse, textResponse, Unsupported } from "./respond.ts";
import { apiRoutes, type Method } from "./routes.ts";

/** The Postmark REST API on any host and port, at the root path (docs/08 R1). */
export function createApiApp(runtime: Runtime): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.all("*", async (c) => {
    const request = c.req.raw;
    const url = new URL(request.url);
    const fault = await applyFault(runtime.store.state, request.method, url.pathname, c.env);
    if (fault) return fault;

    const matched = apiRoutes.match(request.method, url.pathname);
    // The body of an unknown route is not captured (docs/02 §9 Q9).
    if (!matched)
      return textResponse(404, `postmock: no route for ${request.method} ${url.pathname}`);
    const { route, params } = matched;
    try {
      const auth = authenticate(
        route.auth,
        request.headers,
        runtime.store.state,
        `${route.method} ${route.path}`,
        runtime.clock.now(),
      );
      const body = decodeJsonBody(await request.arrayBuffer());
      const result = await route.handler({
        ...runtime,
        method: route.method as Method,
        params,
        query: new Query(url.searchParams),
        body,
        headers: request.headers,
        auth,
      });
      return jsonResponse(result);
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error);
      if (error instanceof Unsupported) return textResponse(501, `postmock: ${error.message}`);
      throw error;
    }
  });
  // A bug in postmock: a loud 500 that no Postmark client mistakes for a Postmark envelope.
  app.onError((error) => {
    console.error(error);
    return textResponse(500, `postmock crashed: ${error.stack ?? error.message}`);
  });
  return app;
}
