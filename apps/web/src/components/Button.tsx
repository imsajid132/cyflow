import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  icon?: ReactNode;
  /** When set, the label collapses on narrow canvases (matches prototype). */
  collapsible?: boolean;
  children: ReactNode;
}

/** Ink primary pill or frosted-glass secondary pill. */
export function Button({
  variant = "ghost",
  icon,
  collapsible = false,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={`btn btn--${variant}`} {...rest}>
      {icon}
      {collapsible ? <span>{children}</span> : children}
    </button>
  );
}
