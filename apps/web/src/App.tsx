import { AppStoreProvider, useStore } from "./store/appStore";
import { AppShell } from "./components/AppShell";
import { ScenarioBuilder } from "./components/builder/ScenarioBuilder";
import { ExecutionReplay } from "./components/replay/ExecutionReplay";
import { AdminGate } from "./components/AdminGate";

/**
 * Cyflow — Make-style automation product. A glass SaaS shell (sidebar,
 * dashboard, scenarios, connections, executions, data stores), the full-screen
 * scenario builder, and the execution replay screen.
 *
 * In API mode the app is gated until it can talk to the (possibly
 * admin-protected) API; local demo mode renders immediately.
 */
function Router() {
  const { view, apiStatus } = useStore();
  if (apiStatus !== "connected" && apiStatus !== "local") return <AdminGate />;
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
