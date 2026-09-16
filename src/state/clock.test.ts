import { afterEach, describe, expect, it, vi } from "vitest";
import { Clock } from "./clock.ts";

afterEach(() => vi.useRealTimers());

describe("Clock", () => {
  it("adds advance() to real time", async () => {
    const clock = new Clock(() => 1_000);
    await clock.advance(500);
    expect(clock.now().getTime()).toBe(1_500);
  });

  it("runs due tasks on advance, in due order, once, with now() at each due time", async () => {
    const clock = new Clock(() => 0);
    const ran: Array<[string, number]> = [];
    const at = (name: string) => () => {
      ran.push([name, clock.now().getTime()]);
    };
    clock.schedule(300, at("b"));
    clock.schedule(100, at("a"));
    clock.schedule(10_000, at("later"));
    await clock.advance(300);
    await clock.advance(0);
    expect(ran).toEqual([
      ["a", 100],
      ["b", 300],
    ]);
    expect(clock.now().getTime()).toBe(300);
  });

  it("awaits async tasks and runs tasks they schedule within the advance (webhook retries)", async () => {
    const clock = new Clock(() => 0);
    const attempts: number[] = [];
    const attempt = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      attempts.push(clock.now().getTime());
      if (attempts.length < 3) clock.schedule(60_000 * attempts.length, attempt);
    };
    clock.schedule(60_000, attempt);
    await clock.advance(60_000 + 60_000 + 120_000);
    expect(attempts).toEqual([60_000, 120_000, 240_000]);
  });

  it("propagates a task error to the advance caller", async () => {
    const clock = new Clock(() => 0);
    clock.schedule(1, async () => {
      throw new Error("boom");
    });
    await expect(clock.advance(1)).rejects.toThrow("boom");
  });

  it("runs a task when real time reaches it", async () => {
    vi.useFakeTimers();
    const clock = new Clock();
    const run = vi.fn();
    clock.schedule(60_000, run);
    await vi.advanceTimersByTimeAsync(60_000);
    await clock.advance(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("arms no real timer past the setTimeout limit", async () => {
    vi.useFakeTimers();
    const clock = new Clock();
    const run = vi.fn();
    clock.schedule(2 ** 31, run);
    await vi.advanceTimersByTimeAsync(5);
    expect(run).not.toHaveBeenCalled();
    await clock.advance(2 ** 31);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reset drops tasks and the offset", async () => {
    const clock = new Clock(() => 0);
    const run = vi.fn();
    clock.schedule(1, run);
    clock.reset();
    await clock.advance(10);
    expect(run).not.toHaveBeenCalled();
    expect(clock.now().getTime()).toBe(10);
  });

  it("rejects a negative or fractional advance", async () => {
    await expect(new Clock().advance(-1)).rejects.toThrow();
    await expect(new Clock().advance(1.5)).rejects.toThrow();
  });
});
