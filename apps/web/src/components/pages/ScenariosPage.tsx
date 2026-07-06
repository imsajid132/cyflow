import { useStore } from "../../store/appStore";
import { ScenarioCard } from "../ScenarioCard";
import { Button, EmptyState } from "../ui";
import { ScenariosIcon, PlusIcon } from "../icons";

export function ScenariosPage() {
  const store = useStore();
  const q = store.search.trim().toLowerCase();
  const scenarios = q
    ? store.scenarios.filter((s) => s.name.toLowerCase().includes(q))
    : store.scenarios;

  return (
    <>
      <div className="page__head">
        <div className="page__title">
          <h1>Scenarios</h1>
          <p>Build and manage your automations.</p>
        </div>
        <Button variant="primary" icon={<PlusIcon width={16} height={16} />} onClick={store.createScenario}>
          Create scenario
        </Button>
      </div>

      {scenarios.length === 0 ? (
        <div className="glass">
          <EmptyState
            icon={<ScenariosIcon />}
            title={q ? "No scenarios match your search" : "No scenarios yet"}
            message={
              q
                ? "Try a different search term."
                : "Scenarios chain modules together to move and transform data. Build your first one to get started."
            }
            action={
              q ? undefined : (
                <Button variant="primary" icon={<PlusIcon width={16} height={16} />} onClick={store.createScenario}>
                  Build your first scenario
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="cards">
          {scenarios.map((s) => (
            <ScenarioCard key={s.id} scenario={s} onOpen={() => store.navigate("builder", s.id)} />
          ))}
        </div>
      )}
    </>
  );
}
