import { afterEach, describe, expect, it, vi } from "vitest";
import { Clock } from "./clock.ts";

afterEach(() => vi.useRealTimers());

describe("Clock", () => {
  it("adds advance() to real time", () => {
    const clock = new Clock(() => 1_000);
    clock.advance(500);
    expect(clock.now().getTime()).toBe(1_500);
  });

  it("runs due tasks on advance, in due order, once", () => {
    const clock = new Clock(() => 0);
    const ran: string[] = [];
    clock.schedule(300, () => ran.push("b"));
    clock.schedule(100, () => ran.push("a"));
    clock.schedule(10_000, () => ran.push("later"));
    clock.advance(300);
    clock.advance(0);
    expect(ran).toEqual(["a", "b"]);
  });

  it("runs a task when real time reaches it", () => {
    vi.useFakeTimers();
    const clock = new Clock();
    const run = vi.fn();
    clock.schedule(60_000, run);
    vi.advanceTimersByTime(60_000);
    clock.advance(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reset drops tasks and the offset", () => {
    const clock = new Clock(() => 0);
    const run = vi.fn();
    clock.schedule(1, run);
    clock.advance(0);
    clock.reset();
    clock.advance(10);
    expect(run).not.toHaveBeenCalled();
    expect(clock.now().getTime()).toBe(10);
  });

  it("rejects a negative or fractional advance", () => {
    expect(() => new Clock().advance(-1)).toThrow();
    expect(() => new Clock().advance(1.5)).toThrow();
  });
});
