import type { ReactNode } from "react";
import { XIcon } from "./icons";
import { Button } from "./Button";

/* ---- status pill (light list style) ---- */
export function StatusPill({ status }: { status: string }) {
  const s = status.toUpperCase();
  const map: Record<string, { cls: string; label: string }> = {
    ACTIVE: { cls: "pill--active", label: "Active" },
    PAUSED: { cls: "pill--paused", label: "Paused" },
    DRAFT: { cls: "pill--draft", label: "Draft" },
    SUCCESS: { cls: "pill--success", label: "Success" },
    FAILED: { cls: "pill--failed", label: "Failed" },
    RUNNING: { cls: "pill--active", label: "Running" },
  };
  const it = map[s] ?? { cls: "", label: status };
  return (
    <span className={`pill ${it.cls}`}>
      <span className="dot" />
      {it.label}
    </span>
  );
}

/* ---- toggle switch ---- */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle${on ? " is-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="toggle__dot" />
    </button>
  );
}

/* ---- empty state ---- */
export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}

/* ---- glass modal ---- */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="modal"
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export { Button };
