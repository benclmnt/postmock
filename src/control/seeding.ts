import type { Runtime } from "../runtime.ts";
import { ControlError } from "./registry.ts";
import { applySeed, seedNames } from "./seed.ts";

/**
 * Applies a seed, after a full reset when `reset` is set, or changes nothing: a failing seed
 * restores the state, the clock offset and the pending clock tasks, and answers 400.
 * The clock resets before the seed, so seeded dates and seed-scheduled tasks use the fresh clock.
 */
export async function seedAtomically(
  runtime: Runtime,
  name: string,
  { reset }: { reset: boolean },
  apply: typeof applySeed = applySeed,
): Promise<void> {
  if (!seedNames().includes(name)) {
    throw new ControlError(`unknown seed '${name}'; seeds: ${seedNames().join(", ")}`);
  }
  await runtime.clock.idle();
  const state = structuredClone(runtime.store.state);
  const restoreClock = runtime.clock.checkpoint();
  try {
    if (reset) {
      runtime.store.reset();
      runtime.clock.reset();
    }
    await apply(runtime, name);
  } catch (error) {
    runtime.store.state = state;
    restoreClock();
    throw new ControlError(`seed '${name}' failed: ${(error as Error).message}`);
  }
}
