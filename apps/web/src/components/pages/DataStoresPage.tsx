import { EmptyState } from "../ui";
import { DataStoreIcon } from "../icons";

export function DataStoresPage() {
  return (
    <>
      <div className="page__head">
        <div className="page__title">
          <h1>Data stores</h1>
          <p>Built-in key-value storage your scenarios can read and write.</p>
        </div>
      </div>

      <div className="cards" style={{ marginBottom: 18 }}>
        <div className="scard glass" style={{ cursor: "default" }}>
          <div className="scard__top">
            <div className="scard__mini">
              <DataStoreIcon sw={1.8} />
            </div>
            <div className="scard__title" style={{ flex: 1 }}>
              Default store
            </div>
          </div>
          <div className="scard__meta">
            <span>
              Records <b>0</b>
            </span>
            <span>
              Type <b>key-value</b>
            </span>
          </div>
        </div>
      </div>

      <div className="glass">
        <EmptyState
          icon={<DataStoreIcon />}
          title="No records yet"
          message="Use Data store modules (get / set / increment / list) in a scenario to read and write persistent records here."
        />
      </div>
    </>
  );
}
