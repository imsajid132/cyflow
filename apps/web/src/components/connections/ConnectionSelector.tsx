import type { Connection } from "../../store/types";

/**
 * Reusable connection dropdown for the module config panel. Lists the app's
 * connections + an inline "Add a new connection…" that opens the create modal
 * without leaving the builder (Make.com style).
 */
export function ConnectionSelector({
  appKey,
  connections,
  value,
  onSelect,
  onAddNew,
}: {
  appKey: string;
  connections: Connection[];
  value: string | null;
  onSelect: (connectionId: string | null) => void;
  onAddNew: () => void;
}) {
  const appConnections = connections.filter((c) => c.appKey === appKey);
  return (
    <div className="field">
      <label htmlFor="conn">Connection</label>
      <select
        className="input"
        id="conn"
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === "__new") onAddNew();
          else onSelect(e.target.value || null);
        }}
      >
        <option value="">Select a connection…</option>
        {appConnections.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
        <option value="__new">+ Add a new connection…</option>
      </select>
      <span className="hint">Credentials stay encrypted in your vault.</span>
    </div>
  );
}
