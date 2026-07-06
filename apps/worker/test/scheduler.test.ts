import { describe, it, expect } from "vitest";
import { dueScenarioIds, createScheduler, type SchedulerScenario } from "../src/scheduler";

describe("interval scheduler", () => {
  it("marks interval scenarios due only when the interval has elapsed", () => {
    const now = new Date("2026-07-07T12:00:00Z");
    const scenarios: SchedulerScenario[] = [
      { id: "a", schedule: { type: "interval", minutes: 15 }, lastRunAt: new Date("2026-07-07T11:44:00Z") }, // 16m -> due
      { id: "b", schedule: { type: "interval", minutes: 15 }, lastRunAt: new Date("2026-07-07T11:50:00Z") }, // 10m -> no
      { id: "c", schedule: { type: "interval", minutes: 5 }, lastRunAt: null }, // never -> due
      { id: "d", schedule: { type: "manual" }, lastRunAt: null }, // manual -> never
      { id: "e", schedule: { type: "daily", time: "09:00" }, lastRunAt: null }, // unsupported -> never
    ];
    expect(dueScenarioIds(scenarios, now)).toEqual(["a", "c"]);
  });

  it("enqueues due scenarios and debounces until the next interval", async () => {
    const enqueued: string[] = [];
    let t = new Date("2026-07-07T12:00:00Z");
    const scheduler = createScheduler({
      load: async () => [{ id: "a", schedule: { type: "interval", minutes: 10 }, lastRunAt: null }],
      enqueue: (id) => { enqueued.push(id); },
      now: () => t,
    });

    await scheduler.tick(); // never run -> due
    expect(enqueued).toEqual(["a"]);

    t = new Date("2026-07-07T12:05:00Z"); // 5m later, within interval + debounced
    await scheduler.tick();
    expect(enqueued).toEqual(["a"]);

    t = new Date("2026-07-07T12:11:00Z"); // 11m after enqueue -> due again
    await scheduler.tick();
    expect(enqueued).toEqual(["a", "a"]);

    scheduler.stop();
  });
});
