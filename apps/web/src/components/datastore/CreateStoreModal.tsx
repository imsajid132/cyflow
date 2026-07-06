import { useState } from "react";
import { useStore } from "../../store/appStore";
import { Modal, Button } from "../ui";

export function CreateStoreModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const store = useStore();
  const [name, setName] = useState("");

  const create = () => {
    const id = store.createDataStore(name);
    onCreated(id);
  };

  return (
    <Modal
      title="Create data store"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create} disabled={!name.trim()}>Create data store</Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="ds-name">Name</label>
        <input
          id="ds-name"
          className="input"
          autoFocus
          value={name}
          placeholder="e.g. Customer cache"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => (e.key === "Enter" && name.trim() ? create() : undefined)}
        />
        <span className="hint">A key-value collection your scenarios can read and write.</span>
      </div>
    </Modal>
  );
}
