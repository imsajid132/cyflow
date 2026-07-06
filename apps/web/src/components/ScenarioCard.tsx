import type { Scenario } from "../store/types";
import { deriveModules } from "../scenario/model";
import { ModuleIcon } from "./ModuleIcon";
import { StatusPill } from "./ui";
import { scheduleLabel, timeAgo } from "../lib/format";

export function ScenarioCard({ scenario, onOpen }: { scenario: Scenario; onOpen: () => void }) {
  const modules = deriveModules(scenario.blueprint).slice(0, 5);

  return (
    <div className="scard glass" role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" ? onOpen() : undefined)}>
      <div className="scard__top">
        <div className="scard__chain">
          {modules.length === 0 ? (
            <div className="scard__mini" aria-hidden />
          ) : (
            modules.map((m) => (
              <div className="scard__mini" key={m.node.id}>
                <ModuleIcon app={m.node.app} operation={m.node.operation} sw={1.8} />
              </div>
            ))
          )}
        </div>
      </div>
      <div className="scard__title">{scenario.name}</div>
      <div className="scard__meta">
        <span>
          Schedule <b>{scheduleLabel(scenario.schedule)}</b>
        </span>
        <span>
          Last run <b>{timeAgo(scenario.lastRunAt)}</b>
        </span>
        <span>
          Ops <b>{scenario.operations ?? 0}</b>
        </span>
      </div>
      <div className="scard__foot">
        <StatusPill status={scenario.status} />
        {scenario.lastStatus ? <StatusPill status={scenario.lastStatus} /> : null}
      </div>
    </div>
  );
}
