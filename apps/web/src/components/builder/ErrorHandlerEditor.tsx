import { useState } from "react";
import type { ErrorHandler, ErrorHandlerType } from "@cyflow/shared";

const TYPES: { value: "" | ErrorHandlerType; label: string; hint: string }[] = [
  { value: "", label: "None — fail the run", hint: "The error stops the scenario (default)." },
  { value: "resume", label: "Resume with fallback", hint: "Substitute fallback output and continue." },
  { value: "ignore", label: "Ignore", hint: "Drop the failing bundle and continue." },
  { value: "break", label: "Break", hint: "Stop this route but keep others." },
  { value: "commit", label: "Commit (placeholder)", hint: "Commit work done so far." },
  { value: "rollback", label: "Rollback (placeholder)", hint: "Undo work done so far." },
];

/** Edit a module's error handler — saved into ModuleNode.errorHandler. */
export function ErrorHandlerEditor({
  value,
  onChange,
}: {
  value: ErrorHandler | null;
  onChange: (handler: ErrorHandler | null) => void;
}) {
  const type = value?.type ?? "";
  const [text, setText] = useState(() =>
    value?.type === "resume" && value.fallback !== undefined ? JSON.stringify(value.fallback, null, 2) : "",
  );
  const [error, setError] = useState<string | null>(null);

  const parseFallback = (raw: string): unknown => (raw.trim() ? JSON.parse(raw) : {});

  const setType = (t: string) => {
    if (!t) {
      onChange(null);
      return;
    }
    if (t === "resume") {
      try {
        const fallback = parseFallback(text);
        setError(null);
        onChange({ type: "resume", fallback: fallback as ErrorHandler["fallback"] });
      } catch {
        onChange({ type: "resume", fallback: {} });
      }
      return;
    }
    onChange({ type: t as ErrorHandlerType });
  };

  const onFallback = (raw: string) => {
    setText(raw);
    try {
      const fallback = parseFallback(raw);
      setError(null);
      onChange({ type: "resume", fallback: fallback as ErrorHandler["fallback"] });
    } catch {
      setError("Invalid JSON — not saved");
    }
  };

  const hint = TYPES.find((t) => t.value === type)?.hint;

  return (
    <div className="field">
      <label>Error handling</label>
      <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
        {TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
      {hint ? <span className="hint">{hint}</span> : null}
      {type === "resume" ? (
        <>
          <textarea
            className="input mono"
            rows={3}
            placeholder='{ "ok": true }'
            value={text}
            onChange={(e) => onFallback(e.target.value)}
            aria-label="Fallback output JSON"
          />
          {error ? <span className="hint" style={{ color: "var(--danger)" }}>{error}</span> : null}
        </>
      ) : null}
    </div>
  );
}
