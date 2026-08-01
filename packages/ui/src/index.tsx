import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; variant?: "primary" | "ghost" };
export function Button({ icon, children, variant = "primary", className = "", ...props }: ButtonProps) {
  return <button className={`ch-button ch-button--${variant} ${className}`} {...props}>{icon}{children}</button>;
}
