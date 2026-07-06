/**
 * Interval schedule runner (Milestone 1). A poll-based scheduler: every tick it
 * loads the active scenarios, computes which are due (their "every X minutes"
 * interval has elapsed since the last run), and enqueues them. Kept simple and
 * deterministic — the "due" logic is a pure function so it's easy to test.
 */

export interface SchedulerScenario {
  id: string;
  /** The scenario's schedule JSON (only `{ type: "interval", minutes }` runs). */
  schedule: unknown;
  /** Last time this scenario ran, or null if it never has. */
  lastRunAt: Date | null;
}

/** Which active interval scenarios are due to run at `now`. Pure. */
export function dueScenarioIds(scenarios: SchedulerScenario[], now: Date): string[] {
  const due: string[] = [];
  for (const s of scenarios) {
    const sched = s.schedule as { type?: string; minutes?: number } | null;
    if (!sched || sched.type !== "interval" || !sched.minutes || sched.minutes <= 0) continue;
    if (!s.lastRunAt) {
      due.push(s.id);
      continue;
    }
    if (now.getTime() - s.lastRunAt.getTime() >= sched.minutes * 60_000) due.push(s.id);
  }
  return due;
}

export interface SchedulerOptions {
  /** Load the currently active scenarios with their last-run time. */
  load: () => Promise<SchedulerScenario[]>;
  /** Enqueue a run for a scenario id. */
  enqueue: (scenarioId: string) => Promise<void> | void;
  /** Poll interval in ms (default 60s). */
  tickMs?: number;
  /** Clock injection for tests. */
  now?: () => Date;
}

export interface Scheduler {
  tick: () => Promise<string[]>;
  start: () => void;
  stop: () => void;
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  const tickMs = options.tickMs ?? 60_000;
  const now = options.now ?? (() => new Date());
  // Remember when we last enqueued each scenario, so we don't double-fire before
  // the run's execution lands in the DB and updates lastRunAt.
  const enqueuedAt = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<string[]> => {
    const scenarios = await options.load();
    const t = now();
    const withDebounce: SchedulerScenario[] = scenarios.map((s) => {
      const eq = enqueuedAt.get(s.id) ?? 0;
      const last = Math.max(s.lastRunAt?.getTime() ?? 0, eq);
      return { ...s, lastRunAt: last ? new Date(last) : null };
    });
    const due = dueScenarioIds(withDebounce, t);
    for (const id of due) {
      enqueuedAt.set(id, t.getTime());
      await options.enqueue(id);
    }
    return due;
  };

  return {
    tick,
    start: () => {
      if (timer) return;
      timer = setInterval(() => {
        void tick().catch((e) => console.error("[scheduler] tick failed:", e));
      }, tickMs);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
