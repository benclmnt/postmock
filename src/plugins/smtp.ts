import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Plugin } from "../plugins.ts";
import { startSmtp } from "../smtp/listener.ts";

/**
 * `POSTMOCK_SMTP_PORTS`: comma-separated; every port serves the same endpoint. The default `0` picks
 * a free port, so parallel test runs never collide. Postmark listens on 25, 587 and 2525
 * (docs/07 §1.2): set `2525` and map the other two to it.
 * `POSTMOCK_SMTP_TLS_KEY`, `POSTMOCK_SMTP_TLS_CERT`: PEM files; both set offers STARTTLS.
 */
export const smtpEnv = z
  .object({
    POSTMOCK_SMTP_PORTS: z
      .string()
      .regex(/^\d+(,\d+)*$/, "a comma-separated port list")
      .default("0")
      .transform((v) => v.split(",").map(Number))
      .pipe(z.array(z.int().max(65535))),
    POSTMOCK_SMTP_TLS_KEY: z.string().optional(),
    POSTMOCK_SMTP_TLS_CERT: z.string().optional(),
  })
  .refine(
    (env) =>
      (env.POSTMOCK_SMTP_TLS_KEY === undefined) === (env.POSTMOCK_SMTP_TLS_CERT === undefined),
    {
      message: "set both POSTMOCK_SMTP_TLS_KEY and POSTMOCK_SMTP_TLS_CERT, or neither",
    },
  )
  .refine((env) => env.POSTMOCK_SMTP_PORTS.length === 1 || !env.POSTMOCK_SMTP_PORTS.includes(0), {
    message: "POSTMOCK_SMTP_PORTS: port 0 is only allowed alone; its port is in the startup URL",
  });

const smtp: Plugin = {
  start: (runtime, host) => {
    const env = smtpEnv.parse(process.env);
    return startSmtp(runtime, {
      host,
      ports: env.POSTMOCK_SMTP_PORTS,
      tls:
        env.POSTMOCK_SMTP_TLS_KEY === undefined || env.POSTMOCK_SMTP_TLS_CERT === undefined
          ? null
          : {
              key: readFileSync(env.POSTMOCK_SMTP_TLS_KEY, "utf8"),
              cert: readFileSync(env.POSTMOCK_SMTP_TLS_CERT, "utf8"),
            },
    });
  },
};
export default smtp;
