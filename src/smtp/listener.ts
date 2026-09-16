import type { AddressInfo } from "node:net";
import { SMTPServer, type SMTPServerDataStream, type SMTPServerSession } from "smtp-server";
import { Unsupported } from "../http/respond.ts";
import type { StartedListener } from "../plugins.ts";
import type { Runtime } from "../runtime.ts";
import { authenticate, resolveSender, type SmtpIdentity } from "./auth.ts";
import { receive } from "./receive.ts";
import { SmtpReply, takeFault, UNSUPPORTED_CODE } from "./reply.ts";

/** 10 MB total, measured after base64 (docs/07 §3). Advertised as EHLO `SIZE`; same on SMTP is INFERRED. */
export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;

// setTimeout's ceiling. Postmark's idle timeout is not captured (docs/07 Q11), so postmock never
// closes an idle connection; smtp-server reads 0 as its 60 s default.
const NEVER_MS = 2 ** 31 - 1;

export interface SmtpOptions {
  host: string;
  /** Every port serves the same listener; `0` picks a free port. */
  ports: number[];
  /** PEM key and cert. With them the listener offers STARTTLS; it never requires it (docs/07 §1.2). */
  tls: { key: string; cert: string } | null;
}

/** An `smtp-server` callback error: an `SmtpReply`, a 502 for `Unsupported`, else a crash (554). */
function toReply(error: unknown): SmtpReply {
  if (error instanceof SmtpReply) return error;
  if (error instanceof Unsupported)
    return new SmtpReply(UNSUPPORTED_CODE, `postmock: ${error.message}`);
  console.error(error);
  return new SmtpReply(554, `postmock crashed: ${(error as Error).message}`);
}

const settle = <T>(
  work: () => T | Promise<T>,
  callback: (err: Error | null, value?: T) => void,
) => {
  Promise.resolve()
    .then(work)
    .then(
      (value) => callback(null, value),
      (error: unknown) => callback(toReply(error)),
    );
};

function createServer(runtime: Runtime, options: SmtpOptions): SMTPServer {
  const identities = new WeakMap<SMTPServerSession, SmtpIdentity>();
  const identity = (session: SMTPServerSession): SmtpIdentity => {
    const found = identities.get(session);
    if (found === undefined) throw new Error("smtp-server let an unauthenticated session through");
    return found;
  };
  const server = new SMTPServer({
    // Greeting name and EHLO order are not captured (docs/07 Q2).
    name: "postmock",
    banner: "postmock",
    // docs/07 Mock must: AUTH PLAIN LOGIN CRAM-MD5, before or after STARTTLS; DIGEST-MD5 gets 504.
    authMethods: ["PLAIN", "LOGIN", "CRAM-MD5"],
    allowInsecureAuth: true,
    authOptional: false,
    size: MAX_MESSAGE_BYTES,
    disableReverseLookup: true,
    socketTimeout: NEVER_MS,
    closeTimeout: 1,
    // Without 8BITMIME a client encodes 8-bit bodies, so the stored source keeps every byte as
    // UTF-8 text. Postmark's EHLO list is not captured (docs/07 Q2).
    hide8BITMIME: true,
    ...(options.tls === null ? { hideSTARTTLS: true } : options.tls),
    onConnect: (_session, callback) => settle(() => takeFault(runtime.store, "connect"), callback),
    onAuth: (auth, session, callback) =>
      settle(() => {
        // @types/smtp-server omits CRAM-MD5, which passes `validatePassword` instead of a password.
        const cram = auth as { validatePassword?: (password: string) => boolean };
        const username = auth.username ?? "";
        const attempt =
          cram.validatePassword === undefined
            ? { username, password: auth.password ?? "" }
            : { username, validatePassword: cram.validatePassword };
        identities.set(session, authenticate(runtime.store.state, attempt));
        return { user: attempt.username };
      }, callback),
    onMailFrom: (_address, session, callback) =>
      settle(() => {
        resolveSender(runtime.store.state, identity(session));
        takeFault(runtime.store, "mail");
      }, callback),
    // docs/07 §1.4: every recipient is accepted; problems become SMTPApiError bounces after DATA.
    onRcptTo: (_address, _session, callback) =>
      settle(() => takeFault(runtime.store, "rcpt"), callback),
    onData: (stream: SMTPServerDataStream, session, callback) =>
      settle(async () => {
        const raw = await collect(stream);
        // Oversize at DATA: SMTP 552 is INFERRED (docs/07 Q3).
        if (stream.sizeExceeded) {
          throw new SmtpReply(
            552,
            `Message exceeds fixed maximum message size ${MAX_MESSAGE_BYTES}`,
          );
        }
        const sender = resolveSender(runtime.store.state, identity(session));
        takeFault(runtime.store, "data");
        const rcptTo = session.envelope.rcptTo.map((r) => r.address);
        const messageId = await receive(runtime, sender, raw, rcptTo);
        // The 250 text is not captured (docs/07 Q1); naming the MessageID is INFERRED.
        return `Ok: queued as ${messageId}`;
      }, callback),
  });
  // A client that drops the socket mid-transaction is normal pool behavior (docs/07 §1.6).
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "ECONNRESET" && error.code !== "EPIPE") console.error(error);
  });
  return server;
}

const collect = async (stream: SMTPServerDataStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

function listen(server: SMTPServer, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.server.once("error", reject);
    server.listen(port, host, () => {
      server.server.off("error", reject);
      resolve((server.server.address() as AddressInfo).port);
    });
  });
}

/** Starts the Postmark SMTP endpoint (docs/07 §1). The URL names the first port. */
export async function startSmtp(runtime: Runtime, options: SmtpOptions): Promise<StartedListener> {
  const servers: SMTPServer[] = [];
  const ports: number[] = [];
  const close = async () => {
    await Promise.all(servers.map((s) => new Promise<void>((done) => s.close(() => done()))));
  };
  try {
    for (const port of options.ports) {
      const server = createServer(runtime, options);
      servers.push(server);
      ports.push(await listen(server, options.host, port));
    }
  } catch (error) {
    await close();
    throw error;
  }
  return { name: "smtp", url: `smtp://${options.host}:${ports[0]}`, close };
}
