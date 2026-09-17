import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPostmock } from "../server.ts";
import { startSmtp } from "./listener.ts";

/** postmock with the conformance seed and an SMTP listener on a free port. */
export async function startWithSmtp(tls: { key: string; cert: string } | null = null) {
  const postmock = await startPostmock({
    host: "127.0.0.1",
    apiPort: 0,
    controlPort: 0,
    seed: "conformance",
    clock: "real",
    plugins: [],
  });
  const smtp = await startSmtp(postmock.runtime, { host: "127.0.0.1", ports: [0], tls });
  const control = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${postmock.listeners.control}${path}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return {
    runtime: postmock.runtime,
    port: Number(new URL(smtp.url).port),
    control,
    close: async () => {
      await smtp.close();
      await postmock.close();
    },
  };
}

/** A key and a cert for both Postmark SMTP host names, from the system openssl. */
export function testCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "postmock-smtp-"));
  execFileSync(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1"],
      ...["-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")],
      ...["-subj", "/CN=smtp.postmarkapp.com"],
      ...["-addext", "subjectAltName=DNS:smtp.postmarkapp.com,DNS:smtp-broadcasts.postmarkapp.com"],
    ],
    { stdio: "ignore" },
  );
  return {
    key: readFileSync(join(dir, "key.pem"), "utf8"),
    cert: readFileSync(join(dir, "cert.pem"), "utf8"),
  };
}

/** A line-level SMTP client for what nodemailer never sends (RSET, DIGEST-MD5, raw bytes). */
export async function rawSmtp(port: number) {
  const socket: Socket = connect(port, "127.0.0.1");
  socket.setEncoding("utf8");
  const replies: string[] = [];
  const waiters: Array<(reply: string) => void> = [];
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const match = /^(?:\d{3}-[^\r\n]*\r\n)*\d{3}(?: [^\r\n]*)?\r\n/.exec(buffer);
      if (match === null) break;
      buffer = buffer.slice(match[0].length);
      const reply = match[0].trimEnd();
      const waiter = waiters.shift();
      if (waiter === undefined) replies.push(reply);
      else waiter(reply);
    }
  });
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  const next = () =>
    new Promise<string>((resolve) => {
      const reply = replies.shift();
      if (reply === undefined) waiters.push(resolve);
      else resolve(reply);
    });
  const greeting = await next();
  return {
    greeting,
    closed,
    command: (line: string) => {
      socket.write(`${line}\r\n`);
      return next();
    },
    /** Sends DATA content and the terminating dot. */
    data: (content: string) => {
      socket.write(`${content.replace(/^\./gm, "..")}\r\n.\r\n`);
      return next();
    },
    close: () => socket.destroy(),
  };
}

export const plain = (user: string, pass: string) =>
  Buffer.from(`\0${user}\0${pass}`).toString("base64");
