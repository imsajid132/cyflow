import { Modal } from "../ui";
import { formatDuration } from "../../lib/format";

export interface PerfRow {
  label: string;
  number: number;
  ms: number;
}

/** True for modules materially slower than the median (the run's hot spots). */
export function slowSet(rows: PerfRow[]): Set<number> {
  const times = rows.map((r) => r.ms).filter((m) => m > 0).sort((a, b) => a - b);
  if (times.length === 0) return new Set();
  const median = times[Math.floor(times.length / 2)];
  const slow = new Set<number>();
  rows.forEach((r) => {
    if (r.ms > 20 && r.ms >= Math.max(median * 1.75, 40)) slow.add(r.number);
  });
  return slow;
}

export function PerformanceModal({ rows, totalMs, onClose }: { rows: PerfRow[]; totalMs: number; onClose: () => void }) {
  const max = Math.max(1, ...rows.map((r) => r.ms));
  const slow = slowSet(rows);

  return (
    <Modal title="Performance" onClose={onClose} width={520}>
      <div className="trow" style={{ gridTemplateColumns: "1fr auto", border: "none", padding: "0 0 12px" }}>
        <b>Total duration</b>
        <span className="mono">{formatDuration(totalMs)}</span>
      </div>
      <div className="perf">
        {rows.map((r) => (
          <div className={`perfrow${slow.has(r.number) ? " is-slow" : ""}`} key={r.number}>
            <span className="perfrow__name">
              <span className="mapping__num">{r.number}</span>
              {r.label}
              {slow.has(r.number) ? <span className="chip">slow</span> : null}
            </span>
            <div className="perfrow__bar">
              <div className="perfrow__fill" style={{ width: `${Math.max(3, (r.ms / max) * 100)}%` }} />
            </div>
            <span className="perfrow__ms mono">{formatDuration(r.ms)}</span>
          </div>
        ))}
        {rows.length === 0 ? <span className="muted">No timing data for this run.</span> : null}
      </div>
    </Modal>
  );
}
