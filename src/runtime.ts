import { EventBus } from "./events.ts";
import { PLUGINS, type Plugin } from "./plugins.ts";
import { Clock } from "./state/clock.ts";
import { Store } from "./state/store.ts";

/** Everything a request handler, the pipeline, a seed, a plugin or a listener shares. */
export interface Runtime {
  store: Store;
  events: EventBus;
  clock: Clock;
}

/** A runtime with every plugin installed. Tests pass a `Clock` with a frozen real time. */
export function createRuntime(plugins: readonly Plugin[] = PLUGINS, clock = new Clock()): Runtime {
  const runtime: Runtime = { store: new Store(), events: new EventBus(), clock };
  for (const plugin of plugins) plugin.install?.(runtime);
  return runtime;
}
