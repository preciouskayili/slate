import { Dialog as D } from "@base-ui/react/dialog";
import { X } from "./icons";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogClose = D.Close;

export function DialogContent({ className, children, showClose = true, ...props }: D.Popup.Props & { showClose?: boolean }) {
  return (
    <D.Portal>
      <D.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] animate-fade-in dark:bg-black/60" />
      <D.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <D.Popup
          className={cn("relative flex max-h-full w-full max-w-lg flex-col rounded-2xl bg-elevated text-fg shadow-dialog outline-none animate-pop-in", className)}
          {...props}
        >
          {children}
          {showClose && (
            <D.Close className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-lg text-fg/50 hover:bg-surface-hover hover:text-fg">
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </D.Close>
          )}
        </D.Popup>
      </D.Viewport>
    </D.Portal>
  );
}

export function DialogTitle({ className, ...props }: D.Title.Props) {
  return <D.Title className={cn("text-[15px] font-semibold tracking-[-0.01em]", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: D.Description.Props) {
  return <D.Description className={cn("mt-1 text-sm text-fg/55", className)} {...props} />;
}
