/**
 * Cyflow icon set — black line icons drawn 1:1 from the approved prototype.
 * Each icon is a 24×24 stroke glyph; `sw` controls stroke width so the same
 * glyph can sit in the rail (1.9), a bubble (1.7), or the panel head (1.8).
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { sw?: number };

function Glyph({ sw = 1.8, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function WebhookIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M9 6.5a3 3 0 1 1 4.9 2.32L11 14" />
      <path d="M6.5 15a3 3 0 1 0 3 3h5.2" />
      <path d="M15.5 9a3 3 0 1 1-1.6 5.5L11 10" />
    </Glyph>
  );
}

export function HttpIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3Z" />
    </Glyph>
  );
}

export function TelegramIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M21 4 3 11l6 2.2L11 20l3-4.6L21 4Z" />
      <path d="M9 13.2 21 4" />
    </Glyph>
  );
}

export function RouterIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="5" cy="12" r="2.4" />
      <circle cx="19" cy="6" r="2.4" />
      <circle cx="19" cy="18" r="2.4" />
      <path d="M7.4 11 16.6 6.7" />
      <path d="M7.4 13l9.2 4.3" />
    </Glyph>
  );
}

export function IteratorIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M4 7h11l-2.5-2.5M4 7l2.5 2.5" />
      <path d="M20 17H9l2.5 2.5M20 17l-2.5-2.5" />
    </Glyph>
  );
}

export function DelayIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2" />
      <path d="M9 2h6" />
    </Glyph>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Glyph sw={2.1} {...p}>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  );
}

export function ResetIcon(p: IconProps) {
  return (
    <Glyph sw={2} {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
    </Glyph>
  );
}

/** Solid play triangle (fill, not stroke). */
export function PlayIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" {...p}>
      <path d="M7 5v14l12-7z" />
    </svg>
  );
}

/** Check mark — used in success badges (sw 3) and chips (sw 3.2). */
export function CheckIcon({ sw = 3, ...rest }: IconProps) {
  return (
    <Glyph sw={sw} {...rest}>
      <path d="M5 13l4 4L19 7" />
    </Glyph>
  );
}
