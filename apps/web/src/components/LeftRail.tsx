import { Fragment, useState, type ReactNode } from "react";
import {
  WebhookIcon,
  HttpIcon,
  TelegramIcon,
  RouterIcon,
  IteratorIcon,
  DelayIcon,
  PlusIcon,
} from "./icons";

interface Tool {
  key: string;
  label: string;
  icon: ReactNode;
  /** Renders a lime divider above this tool. */
  divider?: boolean;
}

const TOOLS: Tool[] = [
  { key: "webhook", label: "Webhooks", icon: <WebhookIcon sw={1.9} /> },
  { key: "http", label: "HTTP", icon: <HttpIcon sw={1.9} /> },
  { key: "telegram", label: "Telegram", icon: <TelegramIcon sw={1.9} /> },
  { key: "router", label: "Router", icon: <RouterIcon sw={1.9} />, divider: true },
  { key: "iterator", label: "Iterator", icon: <IteratorIcon sw={1.9} /> },
  { key: "delay", label: "Delay", icon: <DelayIcon sw={1.9} /> },
];

/** Tall frosted-glass app rail with black icons. */
export function LeftRail() {
  const [active, setActive] = useState("webhook");

  return (
    <aside className="rail glass" aria-label="Apps">
      <div className="rail__brand" title="Cyflow">
        C
      </div>

      {TOOLS.map((tool) => (
        <Fragment key={tool.key}>
          {tool.divider && <div className="rail__divider" />}
          <button
            className={`tool${active === tool.key ? " is-active" : ""}`}
            aria-label={tool.label}
            aria-pressed={active === tool.key}
            title={tool.label}
            onClick={() => setActive(tool.key)}
          >
            {tool.icon}
          </button>
        </Fragment>
      ))}

      <div className="rail__spacer" />
      <button className="tool" aria-label="Add module" title="Add module">
        <PlusIcon />
      </button>
    </aside>
  );
}
