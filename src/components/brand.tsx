import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/** PeakSwift peak mark. Matches /favicon.svg. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--color-ink)" />
      <path d="M7.5 23.5 16 7.5 24.5 23.5Z" fill="#fff" />
      <path d="M12.15 23.5 16 16.35 19.85 23.5Z" fill="var(--color-ink)" />
    </svg>
  );
}

export function Wordmark({ to = "/", product, className }: { to?: "/" | "/studio"; product?: string; className?: string }) {
  return (
    <Link to={to} className={cn("inline-flex items-center gap-2.5 rounded-sm text-ink no-underline", className)}>
      <Mark className="size-7" />
      <span className="text-[15px] font-semibold tracking-tight">
        PeakSwift
        {product ? <span className="ml-1.5 font-normal text-muted">{product}</span> : null}
      </span>
    </Link>
  );
}
