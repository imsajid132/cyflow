import { useStore } from "../store/appStore";
import { Button } from "./Button";
import { PlusIcon, SearchIcon } from "./icons";

export function TopBar() {
  const store = useStore();
  return (
    <header className="topbar glass">
      <div className="topbar__ws">
        <span className="dot" />
        {store.workspace}
      </div>
      <div className="topbar__search">
        <SearchIcon />
        <input
          className="input"
          placeholder="Search scenarios, connections, apps…"
          value={store.search}
          onChange={(e) => store.setSearch(e.target.value)}
        />
      </div>
      <div className="topbar__actions">
        <Button variant="primary" icon={<PlusIcon width={16} height={16} />} onClick={store.createScenario}>
          Create scenario
        </Button>
      </div>
    </header>
  );
}
