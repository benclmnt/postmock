import { apiError } from "../errors.ts";
import { TEST_TOKEN, testTokenContext } from "../state/servers.ts";
import type { State } from "../state/store.ts";
import { Unsupported } from "./respond.ts";
import type { AuthRequirement, AuthResult } from "./routes.ts";

// "The header name and value are case insensitive." refs/api_overview.md:21 (docs/02 §3.1).
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Checks the token header the route needs. A missing, unknown or wrong-type token is HTTP 401,
 * ErrorCode 10 (docs/02 §3.4). The other token header is ignored.
 */
export function authenticate<A extends AuthRequirement>(
  requirement: A,
  headers: Headers,
  state: State,
  routeName: string,
  now: Date,
): AuthResult[A] {
  if (requirement === "account") {
    const token = headers.get("X-Postmark-Account-Token");
    if (token !== null && state.account.tokens.some((t) => same(t, token))) {
      return { kind: "account" } as AuthResult[A];
    }
    throw apiError(10);
  }
  const token = headers.get("X-Postmark-Server-Token");
  if (token === null) throw apiError(10);
  if (same(token, TEST_TOKEN)) {
    if (requirement === "serverOrTest") return testTokenContext(now) as AuthResult[A];
    throw new Unsupported(`${TEST_TOKEN} on ${routeName}: behavior not captured (docs/02 §9 Q8)`);
  }
  for (const server of state.servers.values()) {
    if (server.ApiTokens.some((t) => same(t, token))) {
      return { kind: "server", server } as AuthResult[A];
    }
  }
  throw apiError(10);
}
