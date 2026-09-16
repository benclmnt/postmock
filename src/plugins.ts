import { importAll } from "./discover.ts";
import type { Runtime } from "./runtime.ts";

export interface StartedListener {
  /** Key in `RunningPostmock.listeners` and the startup line, e.g. `smtp`. */
  name: string;
  url: string;
  close(): Promise<void>;
}

/**
 * A feature that needs more than routes: event listeners (webhooks, stats) or its own listener
 * (SMTP, TLS). One file per plugin in `src/plugins/`, default export. A plugin reads its own env
 * keys in `start`, parsed there with zod (docs/11 §5).
 */
export interface Plugin {
  /** Runs once per runtime, before any seed. */
  install?(runtime: Runtime): void;
  /** Starts a listener after the seed is applied. */
  start?(runtime: Runtime, host: string): Promise<StartedListener>;
}

/** Every plugin in `src/plugins/`, in filename order. */
export const PLUGINS: Plugin[] = (await importAll(new URL("./plugins/", import.meta.url))).map(
  (found) => {
    const plugin = (found.module as { default?: unknown }).default;
    if (typeof plugin !== "object" || plugin === null) {
      throw new Error(`${found.url.pathname} has no default export plugin object`);
    }
    return plugin as Plugin;
  },
);
