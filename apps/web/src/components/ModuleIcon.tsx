import type { ModuleId } from "../data/modules";
import { WebhookIcon, HttpIcon, TelegramIcon } from "./icons";

/** Maps a module id to its app icon, forwarding stroke width + props. */
export function ModuleIcon({ id, sw }: { id: ModuleId; sw?: number }) {
  switch (id) {
    case "webhook":
      return <WebhookIcon sw={sw} />;
    case "http":
      return <HttpIcon sw={sw} />;
    case "telegram":
      return <TelegramIcon sw={sw} />;
  }
}
