import { AppStoreProvider, useStore } from "./store/appStore";
import { AppShell } from "./components/AppShell";
import { ScenarioBuilder } from "./components/builder/ScenarioBuilder";

/**
 * Cyflow — Make-style automation product. A glass SaaS shell (sidebar,
 * dashboard, scenarios, connections, executions, data stores) plus the
 * full-screen scenario builder that runs the real engine for "Run once".
 */
function Router() {
  const { view } = useStore();
  return view === "builder" ? <ScenarioBuilder /> : <AppShell />;
}

export default function App() {
  return (
    <AppStoreProvider>
      <Router />
    </AppStoreProvider>
  );
}
