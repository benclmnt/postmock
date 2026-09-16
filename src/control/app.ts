import { Hono } from "hono";
import "./index.ts";
import { textResponse, toJson } from "../http/respond.ts";
import type { Runtime } from "../runtime.ts";
import { ControlError, controlRoutes } from "./registry.ts";

const json = (status: number, body: unknown) =>
  new Response(toJson(body), { status, headers: { "Content-Type": "application/json" } });

/** The test-facing control API on its own port (docs/09 §3, §5). */
export function createControlApp(runtime: Runtime, startupSeed: string): Hono {
  const app = new Hono();
  app.all("*", async (c) => {
    const url = new URL(c.req.url);
    const matched = controlRoutes.match(c.req.method, url.pathname);
    if (!matched) return json(404, { error: `no control route ${c.req.method} ${url.pathname}` });
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(await c.req.arrayBuffer()) || "null") ?? undefined;
    } catch {
      return json(400, { error: "body is not JSON" });
    }
    try {
      const result = await matched.route.handler({
        ...runtime,
        params: matched.params,
        query: url.searchParams,
        body,
        startupSeed,
      });
      return json(200, result);
    } catch (error) {
      if (error instanceof ControlError) return json(400, { error: error.message });
      throw error;
    }
  });
  app.onError((error) => {
    console.error(error);
    return textResponse(500, `postmock crashed: ${error.stack ?? error.message}`);
  });
  return app;
}
