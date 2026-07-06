import { AppStoreProvider, useStore } from "./store/appStore";
import { AppShell } from "./components/AppShell";
import { ScenarioBuilder } from "./components/builder/ScenarioBuilder";
import { ExecutionReplay } from "./components/replay/ExecutionReplay";

/**
 * Cyflow — Make-style automation product. A glass SaaS shell (sidebar,
 * dashboard, scenarios, connections, executions, data stores), the full-screen
 * scenario builder, and the execution replay screen.
 */
function Router() {
  const { view } = useStore();
  if (view === "builder") return <ScenarioBuilder />;
  if (view === "replay") return <ExecutionReplay />;
  return <AppShell />;
}

export default function App() {
  return (
    <AppStoreProvider>
      <Router />
    </AppStoreProvider>
  );
}
