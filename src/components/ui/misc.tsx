import { forwardRef } from "react";
import { CaretDown, CircleNotch } from "./icons";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} spellCheck={false} autoComplete="off" className={cn("field", className)} {...props} />
));
Input.displayName = "Input";

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select className="field appearance-none pr-7" {...props}>
        {children}
      </select>
      <CaretDown className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-fg/40" />
    </div>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("kbd", className)}>{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) {
  return <CircleNotch className={cn("size-4 animate-spin text-fg/50", className)} />;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-fg/15")}
    >
      <span className={cn("absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-[left]", checked ? "left-[14px]" : "left-[2px]")} />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex h-7 items-center rounded-lg bg-surface-hover p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-6 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
            value === o.value ? "bg-canvas text-fg shadow-sm dark:bg-surface-strong" : "text-fg/55 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {icon && <div className="mb-1 text-fg/25">{icon}</div>}
      <div className="text-sm font-medium text-fg/70">{title}</div>
      {children && <div className="max-w-sm text-xs text-fg/45">{children}</div>}
    </div>
  );
}
