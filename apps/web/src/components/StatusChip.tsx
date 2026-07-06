import { CheckIcon } from "./icons";

type ChipKind = "success" | "running" | "failed";

/**
 * Dark-glass status pill. Success shows a lime tick, running shows a pulsing
 * lime dot, failed shows a danger dot.
 */
export function StatusChip({ kind, children }: { kind: ChipKind; children: React.ReactNode }) {
  return (
    <span className={`chip${kind === "failed" ? " is-danger" : ""}`}>
      {kind === "success" && (
        <span className="check" aria-hidden="true">
          <CheckIcon sw={3.2} width={12} height={12} />
        </span>
      )}
      {(kind === "running" || kind === "failed") && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
