import { createApiApp } from "../http/app.ts";
import type { Runtime } from "../runtime.ts";

/** A server-token client for route tests. */
export function apiClient(runtime: Runtime, token: string) {
  const app = createApiApp(runtime);
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`http://api.postmarkapp.com${path}`, {
      method,
      headers: { "X-Postmark-Server-Token": token },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return {
      status: res.status,
      json: (res.headers.get("Content-Type") === "application/json"
        ? JSON.parse(text)
        : { text }) as Record<string, unknown>,
    };
  };
}
