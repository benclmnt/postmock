interface Task {
  due: number;
  run: () => void;
  timer: NodeJS.Timeout;
}

/**
 * Real time plus an offset that `advance()` grows (docs/09 §5 `clock/advance`).
 * A scheduled task runs once: when real time reaches it, or when `advance()` passes it.
 */
export class Clock {
  private offsetMs = 0;
  private tasks = new Set<Task>();

  private readonly realNow: () => number;

  constructor(realNow: () => number = Date.now) {
    this.realNow = realNow;
  }

  now(): Date {
    return new Date(this.realNow() + this.offsetMs);
  }

  schedule(delayMs: number, run: () => void): void {
    const task: Task = {
      due: this.now().getTime() + delayMs,
      run,
      timer: setTimeout(() => this.fire(task), delayMs).unref(),
    };
    this.tasks.add(task);
  }

  /** Moves time forward and runs every task now due, in due order. */
  advance(ms: number): void {
    if (!Number.isInteger(ms) || ms < 0) throw new Error(`clock.advance needs ms >= 0, got ${ms}`);
    this.offsetMs += ms;
    const now = this.now().getTime();
    const due = [...this.tasks].filter((t) => t.due <= now).sort((a, b) => a.due - b.due);
    for (const task of due) this.fire(task);
  }

  /** Drops pending tasks and the offset. */
  reset(): void {
    for (const task of this.tasks) clearTimeout(task.timer);
    this.tasks.clear();
    this.offsetMs = 0;
  }

  private fire(task: Task): void {
    if (!this.tasks.delete(task)) return;
    clearTimeout(task.timer);
    task.run();
  }
}
