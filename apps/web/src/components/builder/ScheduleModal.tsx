import { useState } from "react";
import type { Schedule } from "../../store/types";
import { Modal, Toggle, Button } from "../ui";
import { PlayIcon } from "../icons";

const OPTIONS: { type: Schedule["type"]; label: string; hint: string }[] = [
  { type: "manual", label: "Manual", hint: "Run only when triggered by hand" },
  { type: "interval", label: "Every X minutes", hint: "Repeat on a fixed interval" },
  { type: "hourly", label: "Hourly", hint: "At the start of every hour" },
  { type: "daily", label: "Daily", hint: "Once a day at a set time" },
  { type: "cron", label: "Custom (cron)", hint: "Advanced cron expression" },
];

export function ScheduleModal({
  schedule,
  active,
  onSave,
  onRunOnce,
  onClose,
}: {
  schedule: Schedule;
  active: boolean;
  onSave: (schedule: Schedule, active: boolean) => void;
  onRunOnce: () => void;
  onClose: () => void;
}) {
  const [sched, setSched] = useState<Schedule>(schedule);
  const [on, setOn] = useState(active);

  const pick = (type: Schedule["type"]) => {
    if (type === "interval") setSched({ type, minutes: sched.type === "interval" ? sched.minutes : 15 });
    else if (type === "daily") setSched({ type, time: sched.type === "daily" ? sched.time : "09:00" });
    else if (type === "cron") setSched({ type, expression: sched.type === "cron" ? sched.expression : "*/15 * * * *" });
    else setSched({ type });
  };

  return (
    <Modal
      title="Scheduling"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(sched, on)}>
            Save schedule
          </Button>
        </>
      }
    >
      <div className="trow" style={{ gridTemplateColumns: "1fr auto", border: "none", padding: "0 0 14px" }}>
        <div>
          <b>Scenario status</b>
          <div className="muted">{on ? "Active — runs on schedule" : "Off — runs only manually"}</div>
        </div>
        <Toggle on={on} onChange={setOn} label="Active" />
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Run manually</label>
        <Button variant="ghost" icon={<PlayIcon width={14} height={14} />} onClick={onRunOnce}>
          Run once now
        </Button>
      </div>

      <div className="field">
        <label>Schedule</label>
        {OPTIONS.map((o) => (
          <div
            key={o.type}
            className={`schedopt${sched.type === o.type ? " is-active" : ""}`}
            onClick={() => pick(o.type)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" ? pick(o.type) : undefined)}
          >
            <span className="schedopt__radio" />
            <div style={{ flex: 1 }}>
              <b>{o.label}</b>
              <small>{o.hint}</small>
            </div>
            {sched.type === "interval" && o.type === "interval" ? (
              <input
                className="input"
                type="number"
                min={1}
                value={sched.minutes}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setSched({ type: "interval", minutes: Number(e.target.value) || 1 })}
              />
            ) : null}
            {sched.type === "daily" && o.type === "daily" ? (
              <input
                className="input"
                type="time"
                value={sched.time}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setSched({ type: "daily", time: e.target.value })}
              />
            ) : null}
            {sched.type === "cron" && o.type === "cron" ? (
              <input
                className="input mono"
                style={{ width: 140 }}
                value={sched.expression}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setSched({ type: "cron", expression: e.target.value })}
              />
            ) : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}
