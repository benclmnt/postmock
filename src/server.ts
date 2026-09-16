import type { AddressInfo } from "node:net";
import { type ServerType, serve } from "@hono/node-server";
import { createControlApp } from "./control/app.ts";
import { applySeed } from "./control/seed.ts";
import { createApiApp } from "./http/app.ts";
import { createRuntime, type Runtime } from "./runtime.ts";

export interface PostmockConfig {
  host: string;
  /** Plain-http REST port; 0 picks a free port. */
  apiPort: number;
  controlPort: number;
  seed: string;
}

export interface RunningPostmock {
  runtime: Runtime;
  apiUrl: string;
  controlUrl: string;
  close(): Promise<void>;
}

function listen(fetch: Parameters<typeof serve>[0]["fetch"], host: string, port: number) {
  return new Promise<{ server: ServerType; url: string }>((resolve) => {
    const server = serve({ fetch, hostname: host, port }, (info: AddressInfo) =>
      resolve({ server, url: `http://${host}:${info.port}` }),
    );
  });
}

/** Seeds the state and starts the REST and control listeners. SMTP and TLS come later (docs/11). */
export async function startPostmock(config: PostmockConfig): Promise<RunningPostmock> {
  const runtime = createRuntime();
  await applySeed(runtime, config.seed);
  const api = await listen(createApiApp(runtime).fetch, config.host, config.apiPort);
  const control = await listen(
    createControlApp(runtime, config.seed).fetch,
    config.host,
    config.controlPort,
  );
  return {
    runtime,
    apiUrl: api.url,
    controlUrl: control.url,
    close: async () => {
      runtime.clock.reset();
      await Promise.all(
        [api.server, control.server].map(
          (s) =>
            new Promise<void>((resolve, reject) => s.close((e) => (e ? reject(e) : resolve()))),
        ),
      );
    },
  };
}
