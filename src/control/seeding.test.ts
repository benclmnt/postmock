import { describe, expect, it, vi } from "vitest";
import { createRuntime } from "../runtime.ts";
import { streamKey } from "../state/store.ts";
import { ControlError } from "./registry.ts";
import { seedAtomically } from "./seeding.ts";

const DAY = 86_400_000;

describe("seedAtomically", () => {
  it("reset clears the clock before the seed, so seeded dates use the fresh clock", async () => {
    const runtime = createRuntime();
    await runtime.clock.advance(DAY);
    await seedAtomically(runtime, "conformance", { reset: true });
    const createdAt = runtime.store.state.streams.get(streamKey(1, "outbound"))?.CreatedAt;
    expect(Math.abs((createdAt?.getTime() ?? 0) - Date.now())).toBeLessThan(DAY / 2);
  });

  it("a failing seed restores state, clock offset and pending tasks", async () => {
    const runtime = createRuntime();
    await seedAtomically(runtime, "conformance", { reset: true });
    await runtime.clock.advance(DAY);
    const task = vi.fn();
    runtime.clock.schedule(60_000, task);
    const failing = async () => {
      throw new Error("boom");
    };
    await expect(seedAtomically(runtime, "conformance", { reset: true }, failing)).rejects.toThrow(
      ControlError,
    );
    expect(runtime.store.state.servers.size).toBe(1);
    expect(runtime.clock.now().getTime() - Date.now()).toBeGreaterThan(DAY / 2);
    await runtime.clock.advance(60_000);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
