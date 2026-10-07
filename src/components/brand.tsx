import { Link } from "@tanstack/react-router";

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M8 22.5 16 9.5l8 13"
        fill="none"
        stroke="var(--color-paper)"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark({ to = "/" }: { to?: "/" | "/studio" }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2.5 text-ink no-underline">
      <Mark className="size-8" />
      <span className="text-base font-medium tracking-tight">PeakSwift</span>
    </Link>
  );
}
