import { useRef } from "react";

/**
 * An inline mapping token (e.g. {{1.body.email}}) — lime text on ink, in
 * JetBrains Mono. Clicking a real output field would insert one of these; here
 * it gives a small tactile pulse as feedback.
 */
export function MappingToken({ children }: { children: string }) {
  const ref = useRef<HTMLButtonElement>(null);

  const pulse = () => {
    ref.current?.animate?.(
      [{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }],
      { duration: 220 },
    );
  };

  return (
    <button ref={ref} type="button" className="token" title="Insert mapping" onClick={pulse}>
      {children}
    </button>
  );
}
