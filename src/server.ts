import type { AddressInfo } from "node:net";
import { type ServerType, serve } from "@hono/node-server";
import { createControlApp } from "./control/app.ts";
import { applySeed } from "./control/seed.ts";
import { createApiApp } from "./http/app.ts";
import { PLUGINS, type Plugin, type StartedListener } from "./plugins.ts";
import { createRuntime, type Runtime } from "./runtime.ts";

export interface PostmockConfig {
  host: string;
  /** Plain-http REST port; 0 picks a free port. */
  apiPort: number;
  controlPort: number;
  seed: string;
  /** Defaults to every plugin in `src/plugins/`. */
  plugins?: readonly Plugin[];
}

export interface RunningPostmock {
  runtime: Runtime;
  /** URL per listener: `api`, `control`, and one per plugin listener. */
  listeners: Record<string, string>;
  close(): Promise<void>;
}

function listen(
  name: string,
  fetch: Parameters<typeof serve>[0]["fetch"],
  host: string,
  port: number,
): Promise<StartedListener> {
  return new Promise((resolve) => {
    const server: ServerType = serve({ fetch, hostname: host, port }, (info: AddressInfo) =>
      resolve({
        name,
        url: `http://${host}:${info.port}`,
        close: () => new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done()))),
      }),
    );
  });
}

/** Seeds the state, then starts the REST, control and plugin listeners. */
export async function startPostmock(config: PostmockConfig): Promise<RunningPostmock> {
  const runtime = createRuntime(config.plugins ?? PLUGINS);
  await applySeed(runtime, config.seed);
  const started = [
    await listen("api", createApiApp(runtime).fetch, config.host, config.apiPort),
    await listen(
      "control",
      createControlApp(runtime, config.seed).fetch,
      config.host,
      config.controlPort,
    ),
  ];
  for (const plugin of config.plugins ?? PLUGINS) {
    if (plugin.start) started.push(await plugin.start(runtime, config.host));
  }
  const names = started.map((l) => l.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate !== undefined) throw new Error(`two listeners named ${duplicate}`);
  return {
    runtime,
    listeners: Object.fromEntries(started.map((l) => [l.name, l.url])),
    close: async () => {
      await Promise.all(started.map((l) => l.close()));
      runtime.clock.reset();
    },
  };
}
