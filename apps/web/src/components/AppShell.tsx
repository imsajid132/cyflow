import { useStore } from "../store/appStore";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { DashboardPage } from "./pages/DashboardPage";
import { ScenariosPage } from "./pages/ScenariosPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { ExecutionsPage } from "./pages/ExecutionsPage";
import { DataStoresPage } from "./pages/DataStoresPage";
import { SettingsPage } from "./pages/SettingsPage";

export function AppShell() {
  const { view } = useStore();

  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <TopBar />
        <div className="page">
          {view === "dashboard" && <DashboardPage />}
          {view === "scenarios" && <ScenariosPage />}
          {view === "templates" && <TemplatesPage />}
          {view === "connections" && <ConnectionsPage />}
          {view === "executions" && <ExecutionsPage />}
          {view === "datastores" && <DataStoresPage />}
          {view === "settings" && <SettingsPage />}
        </div>
      </div>
    </div>
  );
}
