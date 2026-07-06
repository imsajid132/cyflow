import {
  WebhookIcon,
  HttpIcon,
  TelegramIcon,
  IteratorIcon,
  AggregatorIcon,
  RouterIcon,
  DataStoreIcon,
  DelayIcon,
} from "./icons";

/** Maps a module's app/operation to its app icon. */
export function ModuleIcon({ app, operation, sw }: { app: string; operation: string; sw?: number }) {
  if (app === "webhook") return <WebhookIcon sw={sw} />;
  if (app === "http") return <HttpIcon sw={sw} />;
  if (app === "telegram") return <TelegramIcon sw={sw} />;
  if (app === "core") return <DelayIcon sw={sw} />;
  if (app === "datastore") return <DataStoreIcon sw={sw} />;
  if (app === "flow") {
    if (operation === "router") return <RouterIcon sw={sw} />;
    if (operation === "iterator") return <IteratorIcon sw={sw} />;
    return <AggregatorIcon sw={sw} />;
  }
  return <RouterIcon sw={sw} />;
}
