import { Unsupported } from "../http/respond.ts";
import { TEST_TOKEN } from "../state/servers.ts";
import type { State } from "../state/store.ts";
import type { Server } from "../state/types.ts";
import { SmtpReply } from "./reply.ts";

/**
 * Who an SMTP session authenticated as. Kept as the credential, not the server object, so a
 * revoked token or a `POST /control/reset` takes effect on an open pooled connection.
 */
export type SmtpIdentity =
  | { kind: "serverToken"; token: string }
  | { kind: "smtpToken"; accessKey: string };

/** The server a message goes to, and the stream an SMTP token pins. */
export interface SmtpSender {
  server: Server;
  /** Set for an SMTP token (one token per stream, docs/07 §1.2); null for a server token. */
  tokenStream: string | null;
}

/** What `smtp-server` hands to `onAuth`: PLAIN and LOGIN carry a password, CRAM-MD5 a verifier. */
export type AuthAttempt =
  | { username: string; password: string }
  | { username: string; validatePassword(password: string): boolean };

// Reply code and text for bad credentials are not captured (docs/07 §1.4, Q3): INFERRED 535.
const invalid = () => new SmtpReply(535, "Authentication credentials invalid");

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function passwordMatches(attempt: AuthAttempt, expected: string, ignoreCase: boolean): boolean {
  if ("validatePassword" in attempt) return attempt.validatePassword(expected);
  return ignoreCase ? same(attempt.password, expected) : attempt.password === expected;
}

/**
 * docs/07 §1.2: a server API token is both username and password; an SMTP token is Access Key and
 * Secret Key. An account token, an unknown or revoked token, and a server with
 * `SmtpApiActivated: false` fail AUTH. DIGEST-MD5 never reaches here: it is not offered (504).
 */
export function authenticate(state: State, attempt: AuthAttempt): SmtpIdentity {
  const { username } = attempt;
  // docs/07 §2.2 Q4: whether POSTMARK_API_TEST works over SMTP is not captured.
  if (same(username, TEST_TOKEN)) {
    throw new Unsupported(`${TEST_TOKEN} over SMTP is not captured (docs/07 Q4)`);
  }
  const smtpToken = state.smtpTokens.get(username);
  if (smtpToken !== undefined) {
    if (!passwordMatches(attempt, smtpToken.secretKey, false)) throw invalid();
    const identity: SmtpIdentity = { kind: "smtpToken", accessKey: username };
    resolveSender(state, identity);
    return identity;
  }
  const held = serverByToken(state, username);
  // Server tokens compare without case, as on REST (docs/02 §3.1). CRAM-MD5 hashes the stored
  // spelling, so a client there must send the token as stored.
  if (held === undefined || !passwordMatches(attempt, held.token, true)) throw invalid();
  const identity: SmtpIdentity = { kind: "serverToken", token: held.token };
  resolveSender(state, identity);
  return identity;
}

function serverByToken(state: State, token: string): { server: Server; token: string } | undefined {
  for (const server of state.servers.values()) {
    const stored = server.ApiTokens.find((t) => same(t, token));
    if (stored !== undefined) return { server, token: stored };
  }
  return undefined;
}

/** The current sender for an identity; throws 535 once the token or its SMTP access is gone. */
export function resolveSender(state: State, identity: SmtpIdentity): SmtpSender {
  let sender: SmtpSender | undefined;
  if (identity.kind === "serverToken") {
    const held = serverByToken(state, identity.token);
    if (held !== undefined) sender = { server: held.server, tokenStream: null };
  } else {
    const token = state.smtpTokens.get(identity.accessKey);
    const server = token && state.servers.get(token.serverId);
    if (token !== undefined && server !== undefined) {
      sender = { server, tokenStream: token.messageStream };
    }
  }
  if (sender === undefined || !sender.server.SmtpApiActivated) throw invalid();
  return sender;
}
