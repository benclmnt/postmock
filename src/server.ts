import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { type ServerType, serve } from "@hono/node-server";
import { createControlApp } from "./control/app.ts";
import { applySeed } from "./control/seed.ts";
import { createApiApp } from "./http/app.ts";
import { PLUGINS, type Plugin, type StartedListener } from "./plugins.ts";
import { createRuntime, type Runtime } from "./runtime.ts";
import { Clock, type ClockMode } from "./state/clock.ts";

export interface PostmockConfig {
  host: string;
  /** Plain-http REST port; 0 picks a free port. */
  apiPort: number;
  controlPort: number;
  /** REST over TLS for DNS routing (docs/01 §3.3 option B): PEM key and cert for the Postmark host names. */
  https?: { port: number; key: string; cert: string };
  seed: string;
  /** `manual`: time moves only on `POST /control/clock/advance`. */
  clock: ClockMode;
  /** Defaults to every plugin in `src/plugins/`. */
  plugins?: readonly Plugin[];
}

export interface RunningPostmock {
  runtime: Runtime;
  /** URL per listener: `api`, `control`, `https` when configured, and one per plugin listener. */
  listeners: Record<string, string>;
  close(): Promise<void>;
}

function listen(
  name: string,
  fetch: Parameters<typeof serve>[0]["fetch"],
  host: string,
  port: number,
  tls?: { key: string; cert: string },
): Promise<StartedListener> {
  return new Promise((resolve) => {
    const onListen = (info: AddressInfo) =>
      resolve({
        name,
        url: `${tls ? "https" : "http"}://${host}:${info.port}`,
        close: () => new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done()))),
      });
    const server: ServerType = tls
      ? serve(
          { fetch, hostname: host, port, createServer: createHttpsServer, serverOptions: tls },
          onListen,
        )
      : serve({ fetch, hostname: host, port }, onListen);
  });
}

/** Seeds the state, then starts the REST, control and plugin listeners. */
export async function startPostmock(config: PostmockConfig): Promise<RunningPostmock> {
  const runtime = createRuntime(config.plugins ?? PLUGINS, new Clock(Date.now, config.clock));
  await applySeed(runtime, config.seed);
  const api = createApiApp(runtime);
  const started = [await listen("api", api.fetch, config.host, config.apiPort)];
  if (config.https) {
    const { port, key, cert } = config.https;
    started.push(await listen("https", api.fetch, config.host, port, { key, cert }));
  }
  for (const plugin of config.plugins ?? PLUGINS) {
    if (plugin.start) started.push(await plugin.start(runtime, config.host));
  }
  // Control binds last: once it answers, every listener is up (the Compose health check).
  started.push(
    await listen(
      "control",
      createControlApp(runtime, config.seed).fetch,
      config.host,
      config.controlPort,
    ),
  );
  const names = started.map((l) => l.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate !== undefined) throw new Error(`two listeners named ${duplicate}`);
  return {
    runtime,
    listeners: Object.fromEntries(started.map((l) => [l.name, l.url])),
    close: async () => {
      // Reset first: a listener closes only after its held requests answer.
      await runtime.clock.idle();
      runtime.clock.reset();
      await Promise.all(started.map((l) => l.close()));
    },
  };
}
