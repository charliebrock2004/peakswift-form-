import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const fieldClass =
  "w-full rounded-sm border border-line bg-card px-3 text-base text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/80 focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/15 disabled:opacity-60";

export function TextField({
  label,
  hint,
  error,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const id = props.id ?? props.name;
  return (
    <label className={cn("flex flex-col gap-2", className)} htmlFor={id}>
      <span className="text-sm font-medium text-ink">{label}</span>
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
      <input id={id} className={cn(fieldClass, "h-12", error && "border-danger")} {...props} />
      {error ? <span className="text-sm text-danger">{error}</span> : null}
    </label>
  );
}

export function AreaField({
  label,
  hint,
  error,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const id = props.id ?? props.name;
  return (
    <label className={cn("flex flex-col gap-2", className)} htmlFor={id}>
      <span className="text-sm font-medium text-ink">{label}</span>
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
      <textarea id={id} className={cn(fieldClass, "min-h-36 resize-y py-3", error && "border-danger")} {...props} />
      {error ? <span className="text-sm text-danger">{error}</span> : null}
    </label>
  );
}

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-12 items-center justify-center gap-2 rounded-sm px-5 text-sm font-medium transition-[transform,background-color,opacity] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-accent-fg hover:bg-ink-soft",
        variant === "secondary" && "border border-line bg-card text-ink hover:bg-paper",
        variant === "ghost" && "text-ink hover:bg-paper-deep",
        className,
      )}
      {...props}
    />
  );
}

export function ChoiceGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium text-ink">{label}</legend>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      {children}
    </fieldset>
  );
}
