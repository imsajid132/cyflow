import type { Schedule } from "../store/types";

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
