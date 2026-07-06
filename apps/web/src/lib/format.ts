import type { StoredExecution } from "@cyflow/shared";
import type { Schedule } from "../store/types";

/** Wall-clock duration of an execution in ms (0 if not finished). */
export function durationOf(execution: StoredExecution): number {
  if (!execution.finishedAt) return 0;
  return Math.max(0, +new Date(execution.finishedAt) - +new Date(execution.startedAt));
}

/** Human duration: "820ms" / "1.24s" / "1m 3s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

/** Local clock time, e.g. "14:03:52". */
export function clockTime(value?: string | Date | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function timeAgo(iso?: string): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function nextRunLabel(schedule: Schedule, lastRunAt?: string): string {
  const now = Date.now();
  if (schedule.type === "manual") return "On demand";
  if (schedule.type === "cron") return schedule.expression;
  let next: number;
  if (schedule.type === "interval") {
    next = (lastRunAt ? new Date(lastRunAt).getTime() : now) + schedule.minutes * 60000;
  } else if (schedule.type === "hourly") {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    next = d.getTime();
  } else {
    const [h, m] = schedule.time.split(":").map(Number);
    const d = new Date();
    d.setHours(h || 0, m || 0, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    next = d.getTime();
  }
  const diff = next - now;
  if (diff <= 0) return "due now";
  const min = Math.round(diff / 60000);
  if (min < 60) return `in ${min}m`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}

export function scheduleLabel(schedule: Schedule): string {
  switch (schedule.type) {
    case "manual":
      return "Manual";
    case "interval":
      return `Every ${schedule.minutes} min`;
    case "hourly":
      return "Hourly";
    case "daily":
      return `Daily at ${schedule.time}`;
    case "cron":
      return `Cron · ${schedule.expression}`;
  }
}
