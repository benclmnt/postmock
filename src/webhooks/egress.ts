import { isIP } from "node:net";
import { z } from "zod";
import type { Runtime } from "../runtime.ts";

/**
 * Which hosts the emitter may reach. By default only loopback: SDK suites configure hooks at real
 * hosts (www.example.com, www.postmark.com), and a test run must not POST to the internet or to
 * Postmark (AGENTS.md rule 7). `POSTMOCK_WEBHOOKS_ALLOW_HOSTS` adds hostnames; `*` allows every host.
 */
export interface Egress {
  allowHosts: ReadonlySet<string>;
}

export const LOOPBACK_ONLY: Egress = { allowHosts: new Set() };

export const egressEnv = z
  .object({ POSTMOCK_WEBHOOKS_ALLOW_HOSTS: z.string().default("") })
  .transform(
    ({ POSTMOCK_WEBHOOKS_ALLOW_HOSTS: hosts }): Egress => ({
      allowHosts: new Set(
        hosts
          .split(",")
          .map((h) => h.trim().toLowerCase())
          .filter((h) => h !== ""),
      ),
    }),
  );

const egressByRuntime = new WeakMap<Runtime, Egress>();

export const setEgress = (runtime: Runtime, egress: Egress): void => {
  egressByRuntime.set(runtime, egress);
};

export const egressOf = (runtime: Runtime): Egress => egressByRuntime.get(runtime) ?? LOOPBACK_ONLY;

/** `localhost`, `127.0.0.0/8` and `::1` by their literal form; a name is never resolved. */
function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost") return true;
  if (isIP(host) === 4) return host.startsWith("127.");
  return isIP(host) === 6 && host === "::1";
}

export function allows(egress: Egress, url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return egress.allowHosts.has("*") || egress.allowHosts.has(host) || isLoopback(host);
}
