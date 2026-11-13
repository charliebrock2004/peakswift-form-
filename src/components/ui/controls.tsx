import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared input surface: 48px tall, 16px text (no iOS zoom), accent focus ring. */
export const fieldClass =
  "w-full rounded-md border border-line-strong bg-card px-3.5 text-base text-ink shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/70 hover:border-ink/30 focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent/15 disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/15";

export function FieldLabel({ label, mandatory, htmlFor }: { label: string; mandatory?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
      {label}
      {mandatory ? (
        <>
          <span className="ml-0.5 text-accent" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </label>
  );
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-danger animate-fade-in">
      <svg viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.5v4M8 10.75v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

type FieldExtras = {
  label: string;
  hint?: string;
  error?: string;
  /** Shows a required marker without triggering native browser validation. */
  mandatory?: boolean;
};

function useFieldIds(explicit?: string) {
  const auto = useId();
  const id = explicit ?? auto;
  return { id, hintId: `${id}-hint`, errorId: `${id}-error` };
}

function describedBy(hint: string | undefined, error: string | undefined, ids: { hintId: string; errorId: string }) {
  return [hint ? ids.hintId : "", error ? ids.errorId : ""].filter(Boolean).join(" ") || undefined;
}

export function TextField({
  label,
  hint,
  error,
  className,
  mandatory,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & FieldExtras) {
  const ids = useFieldIds(props.id ?? (props.name ? `f-${props.name}` : undefined));
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel label={label} mandatory={mandatory} htmlFor={ids.id} />
      {hint ? (
        <p id={ids.hintId} className="-mt-0.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <input
        {...props}
        id={ids.id}
        className={cn(fieldClass, "h-12")}
        aria-required={mandatory || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint, error, ids)}
      />
      <FieldError id={ids.errorId}>{error}</FieldError>
    </div>
  );
}

export function AreaField({
  label,
  hint,
  error,
  className,
  compact = false,
  mandatory,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & FieldExtras & { compact?: boolean }) {
  const ids = useFieldIds(props.id ?? (props.name ? `f-${props.name}` : undefined));
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel label={label} mandatory={mandatory} htmlFor={ids.id} />
      {hint ? (
        <p id={ids.hintId} className="-mt-0.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <textarea
        {...props}
        id={ids.id}
        className={cn(fieldClass, compact ? "min-h-28" : "min-h-36", "resize-y py-3 leading-relaxed")}
        aria-required={mandatory || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint, error, ids)}
      />
      <FieldError id={ids.errorId}>{error}</FieldError>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 animate-spin", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  type = "button",
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "dark";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[transform,background-color,border-color,box-shadow,color] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-11 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-[15px]",
        variant === "primary" && "bg-accent text-accent-fg shadow-xs hover:bg-accent-hover",
        variant === "dark" && "bg-ink text-white shadow-xs hover:bg-ink-soft",
        variant === "secondary" && "border border-line-strong bg-card text-ink shadow-xs hover:border-ink/30 hover:bg-paper",
        variant === "ghost" && "text-ink-soft hover:bg-paper-deep hover:text-ink",
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function ChoiceGroup({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      <legend className="mb-1 text-sm font-medium text-ink">
        {label}
        {hint ? <span className="mt-0.5 block text-sm font-normal text-muted">{hint}</span> : null}
      </legend>
      {children}
    </fieldset>
  );
}

/** Small uppercase-free section label used to group related fields within a step. */
export function FieldGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line pt-7 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
