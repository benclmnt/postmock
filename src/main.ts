#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { startPostmock } from "./server.ts";

// Every setting is an env key. A flag sets its key: `--api-port 9000` is POSTMOCK_API_PORT=9000.
// Plugins read their own keys when they start, so a flag reaches them too.
const KEYS = [
  "POSTMOCK_HOST",
  "POSTMOCK_API_PORT",
  "POSTMOCK_CONTROL_PORT",
  "POSTMOCK_SEED",
  "POSTMOCK_HTTPS_PORT",
  "POSTMOCK_HTTPS_TLS_KEY",
  "POSTMOCK_HTTPS_TLS_CERT",
  "POSTMOCK_SMTP_PORTS",
  "POSTMOCK_SMTP_TLS_KEY",
  "POSTMOCK_SMTP_TLS_CERT",
  "POSTMOCK_WEBHOOKS_ALLOW_HOSTS",
] as const;
const flagOf = (key: string) => key.slice("POSTMOCK_".length).toLowerCase().replaceAll("_", "-");

const { values }: { values: Record<string, string | boolean | undefined> } = parseArgs({
  options: {
    help: { type: "boolean" },
    ...Object.fromEntries(KEYS.map((key) => [flagOf(key), { type: "string" as const }])),
  },
});
if (values.help) {
  console.log(
    [
      "usage: postmock [--<flag> <value>]...",
      "Each flag sets an env key:",
      ...KEYS.map((key) => `  --${flagOf(key).padEnd(22)} ${key}`),
    ].join("\n"),
  );
  process.exit(0);
}
for (const key of KEYS) {
  const value = values[flagOf(key)];
  if (typeof value === "string") process.env[key] = value;
}

const port = z.coerce.number().int().min(0).max(65535);

// A bad value stops startup.
const env = z
  .object({
    POSTMOCK_HOST: z.string().default("127.0.0.1"),
    POSTMOCK_API_PORT: port.default(8080),
    POSTMOCK_CONTROL_PORT: port.default(8025),
    POSTMOCK_SEED: z.string().default("empty"),
    POSTMOCK_HTTPS_PORT: port.optional(),
    POSTMOCK_HTTPS_TLS_KEY: z.string().optional(),
    POSTMOCK_HTTPS_TLS_CERT: z.string().optional(),
  })
  .transform((e, ctx) => {
    const {
      POSTMOCK_HTTPS_PORT: httpsPort,
      POSTMOCK_HTTPS_TLS_KEY: key,
      POSTMOCK_HTTPS_TLS_CERT: cert,
    } = e;
    if (httpsPort === undefined && key === undefined && cert === undefined)
      return { ...e, https: undefined };
    if (httpsPort === undefined || key === undefined || cert === undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "set POSTMOCK_HTTPS_PORT, POSTMOCK_HTTPS_TLS_KEY and POSTMOCK_HTTPS_TLS_CERT, or none",
      });
      return z.NEVER;
    }
    return {
      ...e,
      https: { port: httpsPort, key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") },
    };
  })
  .parse(process.env);

const running = await startPostmock({
  host: env.POSTMOCK_HOST,
  apiPort: env.POSTMOCK_API_PORT,
  controlPort: env.POSTMOCK_CONTROL_PORT,
  ...(env.https === undefined ? {} : { https: env.https }),
  seed: env.POSTMOCK_SEED,
});
const urls = Object.entries(running.listeners).map(([name, url]) => `${name}=${url}`);
console.log(`postmock ${urls.join(" ")} seed=${env.POSTMOCK_SEED}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void running.close().then(() => process.exit(0)));
}
