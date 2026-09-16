import { EventBus } from "./events.ts";
import { Clock } from "./state/clock.ts";
import { Store } from "./state/store.ts";

/** Everything a request handler, the pipeline, a seed or a listener shares. */
export interface Runtime {
  store: Store;
  events: EventBus;
  clock: Clock;
}

export const createRuntime = (clock = new Clock()): Runtime => ({
  store: new Store(),
  events: new EventBus(),
  clock,
});
