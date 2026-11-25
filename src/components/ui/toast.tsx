import { useEffect } from "react";
import { create } from "zustand";
import { CheckCircle, WarningCircle, X } from "./icons";
import { cn, uid } from "@/lib/utils";

interface Toast {
  id: string;
  kind: "success" | "error" | "info";
  title: string;
  detail?: string;
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));

export function toast(title: string, opts: { kind?: Toast["kind"]; detail?: string } = {}) {
  const t: Toast = { id: uid(), kind: opts.kind ?? "success", title, detail: opts.detail };
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
  return t.id;
}
toast.error = (title: string, detail?: string) => toast(title, { kind: "error", detail });

function dismiss(id: string) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

function ToastItem({ t }: { t: Toast }) {
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), t.kind === "error" ? 7000 : 2600);
    return () => clearTimeout(timer);
  }, [t]);
  return (
    <div className="pointer-events-auto flex w-80 items-start gap-2.5 rounded-xl bg-elevated px-3 py-2.5 shadow-pop animate-pop-in">
      {t.kind === "error" ? (
        <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-danger" />
      ) : (
        <CheckCircle weight="fill" className={cn("mt-0.5 size-4 shrink-0", t.kind === "success" ? "text-ok" : "text-accent")} />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t.title}</div>
        {t.detail && <div className="selectable mt-0.5 line-clamp-4 break-words text-xs text-fg/55">{t.detail}</div>}
      </div>
      <button onClick={() => dismiss(t.id)} className="-mr-1 rounded-md p-0.5 text-fg/40 hover:text-fg">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}
