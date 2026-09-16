import type { Runtime } from "../runtime.ts";
import type { TestTokenContext } from "../state/servers.ts";
import type { Server } from "../state/types.ts";
import type { Query } from "./normalize.ts";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type Segment = { literal: string } | { param: string };

/**
 * Method + path patterns (`/templates/:idOrAlias`). Literal segments match without case and a
 * trailing slash is ignored (docs/08 R2). A literal beats a param at the same position, so
 * `PUT /templates/push` wins over `PUT /templates/:idOrAlias` (docs/08 §2.5).
 */
export class RouteTable<R extends { method: Method; path: string }> {
  private readonly entries: Array<{ route: R; segments: Segment[] }> = [];

  add(route: R): void {
    const segments = parsePattern(route.path);
    const shape = shapeOf(segments);
    const clash = this.entries.find(
      (e) => e.route.method === route.method && shapeOf(e.segments) === shape,
    );
    if (clash)
      throw new Error(`route ${route.method} ${route.path} clashes with ${clash.route.path}`);
    this.entries.push({ route, segments });
  }

  match(
    method: string,
    pathname: string,
  ): { route: R; params: Record<string, string> } | undefined {
    const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    let best: { route: R; params: Record<string, string>; rank: string } | undefined;
    for (const { route, segments } of this.entries) {
      if (route.method !== method.toUpperCase() || segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const ok = segments.every((segment, i) => {
        const part = parts[i] as string;
        if ("param" in segment) params[segment.param] = part;
        return "param" in segment || segment.literal === part.toLowerCase();
      });
      const rank = segments.map((s) => ("literal" in s ? "0" : "1")).join("");
      if (ok && (best === undefined || rank < best.rank)) best = { route, params, rank };
    }
    return best && { route: best.route, params: best.params };
  }
}

function parsePattern(path: string): Segment[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith(":") ? { param: s.slice(1) } : { literal: s.toLowerCase() }));
}

const shapeOf = (segments: Segment[]): string =>
  segments.map((s) => ("literal" in s ? s.literal : ":")).join("/");

/**
 * - `server`: a server token; `POSTMARK_API_TEST` answers 501 until its behavior there is known.
 * - `serverOrTest`: a server token or `POSTMARK_API_TEST` (docs/02 §3.3), which gets a
 *   `TestTokenContext`.
 * - `account`: an account token.
 */
export type AuthRequirement = "server" | "serverOrTest" | "account";

export type ServerAuth = { kind: "server"; server: Server };
export type AuthResult = {
  server: ServerAuth;
  serverOrTest: ServerAuth | TestTokenContext;
  account: { kind: "account" };
};

export interface RequestContext extends Runtime {
  method: Method;
  /** Raw path params, URL-decoded, case kept. */
  params: Record<string, string>;
  query: Query;
  /** Parsed JSON body; `undefined` when empty or the literal `null` (docs/08 R7). */
  body: unknown;
  headers: Headers;
}

export interface ApiRoute<A extends AuthRequirement = AuthRequirement> {
  method: Method;
  path: string;
  auth: A;
  /** Returns the JSON body of a 200 response (docs/08 E1). Throws `ApiError` for an error. */
  handler: (ctx: RequestContext & { auth: AuthResult[A] }) => unknown;
}

export const apiRoutes = new RouteTable<ApiRoute>();

/** Registers a Postmark API route. Each `src/api/<group>/routes.ts` calls it at import. */
export function defineRoute<A extends AuthRequirement>(route: ApiRoute<A>): void {
  apiRoutes.add(route as unknown as ApiRoute);
}
