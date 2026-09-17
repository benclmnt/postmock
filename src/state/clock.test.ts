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

  it("serializes concurrent advances; each computes its target when it starts", async () => {
    const clock = new Clock(() => 0);
    const ran: number[] = [];
    for (const due of [50, 150]) {
      clock.schedule(due, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        ran.push(clock.now().getTime());
      });
    }
    await Promise.all([clock.advance(100), clock.advance(100)]);
    expect(ran).toEqual([50, 150]);
    expect(clock.now().getTime()).toBe(200);
  });

  it("runs a real-timer task after a running advance, not inside it", async () => {
    vi.useFakeTimers();
    const clock = new Clock();
    const order: string[] = [];
    clock.schedule(10, async () => {
      order.push("A start");
      await new Promise((resolve) => setTimeout(resolve, 100));
      order.push("A end");
    });
    clock.schedule(50, () => {
      order.push("B");
    });
    const advancing = clock.advance(10);
    await vi.advanceTimersByTimeAsync(100);
    await advancing;
    await clock.idle();
    expect(order).toEqual(["A start", "A end", "B"]);
  });

  it("refuses reset during an advance", async () => {
    const clock = new Clock(() => 0);
    let resetError: unknown;
    clock.schedule(1, () => {
      try {
        clock.reset();
      } catch (error) {
        resetError = error;
      }
    });
    await clock.advance(1);
    expect(String(resetError)).toContain("during an advance");
  });

  it("restores offset and pending tasks from a checkpoint", async () => {
    const clock = new Clock(() => 0);
    await clock.advance(1_000);
    const run = vi.fn();
    clock.schedule(500, run);
    const restore = clock.checkpoint();
    clock.reset();
    restore();
    expect(clock.now().getTime()).toBe(1_000);
    await clock.advance(500);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stands still while paused; only advance moves it and runs tasks", async () => {
    vi.useFakeTimers();
    let real = 0;
    const clock = new Clock(() => real);
    const run = vi.fn();
    clock.schedule(100, run);
    clock.pause();
    real = 10_000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(clock.now().getTime()).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(clock.pending).toBe(1);
    await clock.advance(100);
    expect(run).toHaveBeenCalledTimes(1);
    expect(clock.now().getTime()).toBe(100);
    expect(clock.pending).toBe(0);
  });

  it("resumes from the paused instant and arms real timers again", async () => {
    vi.useFakeTimers();
    let real = 0;
    const clock = new Clock(() => real);
    const run = vi.fn();
    clock.schedule(100, run);
    clock.pause();
    real = 5_000;
    clock.resume();
    expect(clock.now().getTime()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    await clock.idle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reset ends a pause; a checkpoint keeps it", async () => {
    const clock = new Clock(() => 0);
    clock.pause();
    const restore = clock.checkpoint();
    clock.reset();
    expect(clock.paused).toBe(false);
    restore();
    expect(clock.paused).toBe(true);
  });
});
