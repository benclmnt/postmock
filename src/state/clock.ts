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
 * Advances and real-timer tasks run one at a time, in the order they start.
 */
export class Clock {
  private offsetMs = 0;
  private seq = 0;
  private advancing = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly tasks = new Set<Task>();
  private readonly realNow: () => number;

  constructor(realNow: () => number = Date.now) {
    this.realNow = realNow;
  }

  now(): Date {
    return new Date(this.realNow() + this.offsetMs);
  }

  schedule(delayMs: number, run: Run): void {
    if (!Number.isInteger(delayMs) || delayMs < 0) {
      throw new Error(`schedule needs delayMs >= 0, got ${delayMs}`);
    }
    this.add({ due: this.now().getTime() + delayMs, seq: this.seq++, run, timer: undefined });
  }

  /**
   * Moves time forward by `ms`, after any advance already running. Runs each task due by the end in
   * due order, with `now()` set to its due time, and awaits it. A task scheduled during the advance
   * runs too when it falls due by the end.
   */
  advance(ms: number): Promise<void> {
    if (!Number.isInteger(ms) || ms < 0) {
      return Promise.reject(new Error(`clock.advance needs ms >= 0, got ${ms}`));
    }
    return this.enqueue(async () => {
      this.advancing = true;
      try {
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
      } finally {
        this.advancing = false;
      }
    });
  }

  /** Resolves when every advance and real-timer task started so far has finished. */
  idle(): Promise<void> {
    return this.queue;
  }

  /** Drops pending tasks and the offset. Throws during an advance, which would undo it. */
  reset(): void {
    if (this.advancing) throw new Error("clock.reset during an advance");
    for (const task of this.tasks) clearTimeout(task.timer);
    this.tasks.clear();
    this.offsetMs = 0;
  }

  /** Captures offset and pending tasks; the returned function puts them back. */
  checkpoint(): () => void {
    const offsetMs = this.offsetMs;
    const tasks = [...this.tasks].map(({ due, seq, run }) => ({ due, seq, run }));
    return () => {
      this.reset();
      this.offsetMs = offsetMs;
      for (const task of tasks) this.add({ ...task, timer: undefined });
    };
  }

  private add(task: Task): void {
    const delay = task.due - this.now().getTime();
    if (delay <= MAX_TIMER_MS) {
      // A task that throws on a real timer is a postmock bug: rethrow so the process crashes.
      task.timer = setTimeout(
        () => {
          this.enqueue(() => this.take(task)).catch((error: unknown) =>
            queueMicrotask(() => {
              throw error;
            }),
          );
        },
        Math.max(0, delay),
      ).unref();
    }
    this.tasks.add(task);
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.queue.then(work);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  /** Time never moves back. */
  private moveTo(instant: number): void {
    this.offsetMs = Math.max(this.now().getTime(), instant) - this.realNow();
  }

  private async take(task: Task): Promise<void> {
    if (!this.tasks.delete(task)) return;
    clearTimeout(task.timer);
    await task.run();
  }
}
