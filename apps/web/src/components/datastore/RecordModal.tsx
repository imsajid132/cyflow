import { useState } from "react";
import { useStore } from "../../store/appStore";
import { Modal, Button } from "../ui";
import type { DataRecord } from "../../store/types";

interface Props {
  storeId: string;
  mode: "create" | "edit";
  existing?: DataRecord;
  onClose: () => void;
}

export function RecordModal({ storeId, mode, existing, onClose }: Props) {
  const store = useStore();
  const [key, setKey] = useState(existing?.key ?? "");
  const [text, setText] = useState(() =>
    existing ? JSON.stringify(existing.value, null, 2) : "",
  );
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    if (!key.trim()) {
      setError("Give the record a key.");
      return;
    }
    let value: unknown;
    try {
      value = text.trim() ? JSON.parse(text) : null;
    } catch {
      setError("Value must be valid JSON (use quotes for strings, e.g. \"hello\").");
      return;
    }
    store.upsertRecord(storeId, key.trim(), value);
    onClose();
  };

  return (
    <Modal
      title={mode === "edit" ? "Edit record" : "Add record"}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>{mode === "edit" ? "Save record" : "Add record"}</Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="rec-key">Key</label>
        <input
          id="rec-key"
          className="input mono"
          value={key}
          placeholder="e.g. lead:ada@lovelace.dev"
          disabled={mode === "edit"}
          onChange={(e) => setKey(e.target.value)}
        />
        {mode === "edit" ? <span className="hint">Keys are stable and can't be renamed — delete and re-add to change one.</span> : null}
      </div>
      <div className="field">
        <label htmlFor="rec-val">Value (JSON)</label>
        <textarea
          id="rec-val"
          className="input mono"
          rows={7}
          value={text}
          placeholder={'{\n  "score": 42\n}'}
          onChange={(e) => setText(e.target.value)}
        />
        <span className="hint">Any JSON value — object, array, number, boolean, or a quoted string.</span>
      </div>
      {error ? <div className="oauth-note">⚠ {error}</div> : null}
    </Modal>
  );
}
