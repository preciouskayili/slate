import { Tooltip as T } from "@base-ui/react/tooltip";

export const TooltipProvider = T.Provider;

export function Tooltip({ label, shortcut, side = "bottom", children }: { label: React.ReactNode; shortcut?: string; side?: "top" | "bottom" | "left" | "right"; children: React.ReactElement }) {
  return (
    <T.Root>
      <T.Trigger render={children} />
      <T.Portal>
        <T.Positioner side={side} sideOffset={6} className="z-[60]">
          <T.Popup className="flex items-center gap-2 rounded-lg bg-elevated px-2 py-1 text-xs text-fg shadow-pop animate-fade-in">
            {label}
            {shortcut && <span className="text-fg/40">{shortcut}</span>}
          </T.Popup>
        </T.Positioner>
      </T.Portal>
    </T.Root>
  );
}
