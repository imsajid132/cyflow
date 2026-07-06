import { useStore } from "../../store/appStore";
import { Modal, StatusPill } from "../ui";
import { EmptyState } from "../ui";
import { ExecutionsIcon } from "../icons";
import { timeAgo } from "../../lib/format";

export function HistoryModal({ scenarioId, onClose }: { scenarioId: string; onClose: () => void }) {
  const store = useStore();
  const runs = store.executions.filter((e) => e.scenarioId === scenarioId);

  return (
    <Modal title="Execution history" onClose={onClose} width={560}>
      {runs.length === 0 ? (
        <EmptyState icon={<ExecutionsIcon />} title="No runs yet" message="Run this scenario to see its history." />
      ) : (
        <div>
          {runs.map((e, i) => (
            <div className="trow" style={{ gridTemplateColumns: "auto 1fr auto auto", border: i === runs.length - 1 ? "none" : undefined }} key={i}>
              <StatusPill status={e.execution.status} />
              <span className="muted">{timeAgo(e.ranAt)}</span>
              <span className="muted mono">{e.execution.steps.length || "—"} steps</span>
              <span className="mono">{e.execution.operations} ops</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
