type Run = () => void | Promise<void>;

interface Task {
  due: number;
  seq: number;
  run: Run;
  timer: NodeJS.Timeout | undefined;
}

// setTimeout fires at once for a delay above 2^31-1 ms; such a task waits for `advance()` only.
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Real time plus an offset that `advance()` grows (docs/09 §5 `clock/advance`).
 * A scheduled task runs once: when real time reaches it, or when `advance()` passes it.
 */
export class Clock {
  private offsetMs = 0;
  private seq = 0;
  private readonly tasks = new Set<Task>();
  private readonly realNow: () => number;

  constructor(realNow: () => number = Date.now) {
    this.realNow = realNow;
  }

  now(): Date {
    return new Date(this.realNow() + this.offsetMs);
  }

  schedule(delayMs: number, run: Run): void {
    if (!Number.isInteger(delayMs) || delayMs < 0)
      throw new Error(`schedule needs delayMs >= 0, got ${delayMs}`);
    const task: Task = {
      due: this.now().getTime() + delayMs,
      seq: this.seq++,
      run,
      timer: undefined,
    };
    if (delayMs <= MAX_TIMER_MS) {
      // A task that throws on a real timer is a postmock bug: rethrow so the process crashes.
      task.timer = setTimeout(() => {
        this.take(task)?.catch((error: unknown) =>
          queueMicrotask(() => {
            throw error;
          }),
        );
      }, delayMs).unref();
    }
    this.tasks.add(task);
  }

  /**
   * Moves time forward by `ms`. Runs each task due by then in due order, with `now()` set to its due
   * time, and awaits it. A task scheduled during the advance runs too when it falls due by the end.
   */
  async advance(ms: number): Promise<void> {
    if (!Number.isInteger(ms) || ms < 0) throw new Error(`clock.advance needs ms >= 0, got ${ms}`);
    const target = this.now().getTime() + ms;
    for (;;) {
      const next = [...this.tasks]
        .filter((t) => t.due <= target)
        .sort((a, b) => a.due - b.due || a.seq - b.seq)[0];
      if (next === undefined) break;
      this.moveTo(next.due);
      await this.take(next);
    }
    this.moveTo(target);
  }

  /** Drops pending tasks and the offset. */
  reset(): void {
    for (const task of this.tasks) clearTimeout(task.timer);
    this.tasks.clear();
    this.offsetMs = 0;
  }

  /** Time never moves back. */
  private moveTo(instant: number): void {
    this.offsetMs = Math.max(this.now().getTime(), instant) - this.realNow();
  }

  private take(task: Task): Promise<void> | undefined {
    if (!this.tasks.delete(task)) return undefined;
    clearTimeout(task.timer);
    return Promise.resolve().then(task.run);
  }
}
