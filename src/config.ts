import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { PostmockConfig } from "./server.ts";

/** Every setting is one of these env keys. Plugins read their own keys when they start. */
export const ENV_KEYS = [
  "POSTMOCK_HOST",
  "POSTMOCK_API_PORT",
  "POSTMOCK_CONTROL_PORT",
  "POSTMOCK_SEED",
  "POSTMOCK_CLOCK",
  "POSTMOCK_HTTPS_PORT",
  "POSTMOCK_HTTPS_TLS_KEY",
  "POSTMOCK_HTTPS_TLS_CERT",
  "POSTMOCK_SMTP_PORTS",
  "POSTMOCK_SMTP_TLS_KEY",
  "POSTMOCK_SMTP_TLS_CERT",
  "POSTMOCK_WEBHOOKS_ALLOW_HOSTS",
] as const;

export const flagOf = (key: string) =>
  key.slice("POSTMOCK_".length).toLowerCase().replaceAll("_", "-");

export const USAGE = [
  "usage: postmock [--<flag> <value>]...",
  "Each flag sets an env key; a flag wins over the env:",
  ...ENV_KEYS.map((key) => `  --${flagOf(key).padEnd(22)} ${key}`),
].join("\n");

/**
 * Writes each flag in `argv` into `env` under its key, so plugins that read `process.env` see it.
 * Returns `help` for `--help`. An unknown flag, a positional argument, or an empty value throws.
 */
export function applyFlags(argv: string[], env: NodeJS.ProcessEnv): "help" | "run" {
  const { values }: { values: Record<string, string | boolean | undefined> } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean" },
      ...Object.fromEntries(ENV_KEYS.map((key) => [flagOf(key), { type: "string" as const }])),
    },
  });
  if (values.help) return "help";
  for (const key of ENV_KEYS) {
    const value = values[flagOf(key)];
    if (typeof value === "string") env[key] = value;
  }
  for (const key of ENV_KEYS) {
    if (env[key] === "") throw new Error(`${key} is empty; unset it or give a value`);
  }
  return "run";
}

/** A decimal TCP port; `0` picks a free port. */
export const portSchema = z
  .string()
  .regex(/^\d+$/, "a decimal port")
  .transform(Number)
  .pipe(z.int().max(65535));

/** The content of the PEM file that env key `key` names. */
export function readPem(key: string, path: string): string {
  if (!existsSync(path)) throw new Error(`${key}: no file at ${path}`);
  return readFileSync(path, "utf8");
}

const envSchema = z.object({
  POSTMOCK_HOST: z.string().min(1).default("127.0.0.1"),
  POSTMOCK_API_PORT: portSchema.default(8080),
  POSTMOCK_CONTROL_PORT: portSchema.default(8025),
  POSTMOCK_SEED: z.string().min(1).default("empty"),
  POSTMOCK_CLOCK: z.enum(["real", "manual"]).default("real"),
  POSTMOCK_HTTPS_PORT: portSchema.optional(),
  POSTMOCK_HTTPS_TLS_KEY: z.string().min(1).optional(),
  POSTMOCK_HTTPS_TLS_CERT: z.string().min(1).optional(),
});

/** The core listeners' config from env. A bad value throws. */
export function configFromEnv(env: NodeJS.ProcessEnv): PostmockConfig {
  const e = envSchema.parse(env);
  const config: PostmockConfig = {
    host: e.POSTMOCK_HOST,
    apiPort: e.POSTMOCK_API_PORT,
    controlPort: e.POSTMOCK_CONTROL_PORT,
    seed: e.POSTMOCK_SEED,
    clock: e.POSTMOCK_CLOCK,
  };
  const https = [e.POSTMOCK_HTTPS_PORT, e.POSTMOCK_HTTPS_TLS_KEY, e.POSTMOCK_HTTPS_TLS_CERT];
  if (https.every((v) => v === undefined)) return config;
  if (
    e.POSTMOCK_HTTPS_PORT === undefined ||
    e.POSTMOCK_HTTPS_TLS_KEY === undefined ||
    e.POSTMOCK_HTTPS_TLS_CERT === undefined
  ) {
    throw new Error(
      "set POSTMOCK_HTTPS_PORT, POSTMOCK_HTTPS_TLS_KEY and POSTMOCK_HTTPS_TLS_CERT, or none",
    );
  }
  return {
    ...config,
    https: {
      port: e.POSTMOCK_HTTPS_PORT,
      key: readPem("POSTMOCK_HTTPS_TLS_KEY", e.POSTMOCK_HTTPS_TLS_KEY),
      cert: readPem("POSTMOCK_HTTPS_TLS_CERT", e.POSTMOCK_HTTPS_TLS_CERT),
    },
  };
}
