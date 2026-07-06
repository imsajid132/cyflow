import type { FlowModule } from "../data/modules";
import { ModuleIcon } from "./ModuleIcon";
import { StatusChip } from "./StatusChip";
import { MappingToken } from "./MappingToken";
import { Button } from "./Button";

/**
 * Right-hand config panel. The header reflects the selected module; the body is
 * the schema-style form for the Telegram "Send a message" action (the demo
 * module), including a mapping token pulled from module 1's output.
 */
export function ConfigPanel({ module }: { module: FlowModule }) {
  return (
    <aside className="panel glass" aria-label="Module configuration">
      <div className="panel__head">
        <div className="panel__icon">
          <ModuleIcon id={module.id} sw={1.8} />
        </div>
        <div>
          <h2>{module.label}</h2>
          <span>{module.panelSub}</span>
        </div>
      </div>

      <div className="panel__status">
        <StatusChip kind="success">Webhook · success</StatusChip>
        <StatusChip kind="running">HTTP · running</StatusChip>
      </div>

      <div className="panel__body">
        <div className="field">
          <label htmlFor="conn">Connection</label>
          <select className="input" id="conn" defaultValue="cyflow">
            <option value="cyflow">Cyflow Bot · @cyflow_alerts</option>
            <option value="new">Add a new connection…</option>
          </select>
          <span className="hint">
            Bring your own bot — credentials stay in your encrypted vault.
          </span>
        </div>

        <div className="field">
          <label htmlFor="chat">Chat ID</label>
          <input className="input" id="chat" defaultValue="-100234598812" />
        </div>

        <div className="field">
          <label>Message text</label>
          <div className="mapfield">
            <span className="lead">New lead:</span>
            <MappingToken>{"{{1.body.email}}"}</MappingToken>
          </div>
          <span className="hint">
            Click a field from an earlier module to insert its mapping token.
          </span>
        </div>

        <div className="field">
          <label htmlFor="mode">Parse mode</label>
          <select className="input" id="mode" defaultValue="Markdown">
            <option>Markdown</option>
            <option>HTML</option>
            <option>Plain text</option>
          </select>
        </div>

        <div className="field">
          <label>Incoming bundle · module 1</label>
          <div className="kv">
            <div>
              <span className="k">body.email:</span> ada@lovelace.dev
            </div>
            <div>
              <span className="k">body.name:</span> Ada Lovelace
            </div>
            <div>
              <span className="k">headers.source:</span> landing-page
            </div>
          </div>
        </div>
      </div>

      <div className="panel__foot">
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Save module</Button>
      </div>
    </aside>
  );
}
