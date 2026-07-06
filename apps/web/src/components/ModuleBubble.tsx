import type { KeyboardEvent } from "react";
import type { UiModule } from "../scenario/model";
import type { NodeStatus } from "../hooks/useRunOnce";
import { ModuleIcon } from "./ModuleIcon";
import { CheckIcon } from "./icons";

interface ModuleBubbleProps {
  module: UiModule;
  status: NodeStatus;
  selected: boolean;
  onSelect: () => void;
  /** Callback ref to the .bubble element (optional). */
  bubbleRef?: (el: HTMLDivElement | null) => void;
}

/**
 * The signature element: a circular frosted-glass orb with a black app icon,
 * a black title beneath, and run-state rings (selected / running glow /
 * success / error). Keyboard-operable as a button.
 */
export function ModuleBubble({ module, status, selected, onSelect, bubbleRef }: ModuleBubbleProps) {
  const classes = [
    "node",
    selected ? "is-selected" : "",
    status === "running" ? "is-running" : "",
    status === "success" ? "is-success" : "",
    status === "error" ? "is-error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      className={classes}
      role="button"
      tabIndex={0}
      aria-label={`${module.label} module`}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <div className="bubble" ref={bubbleRef} tabIndex={-1}>
        <ModuleIcon app={module.node.app} operation={module.node.operation} sw={1.7} />
        <div className="node__badge" aria-hidden="true">
          <CheckIcon sw={3} width={13} height={13} />
        </div>
      </div>
      <div className="node__label">{module.label}</div>
      <div className="node__sub">{module.sub}</div>
    </div>
  );
}
