import { ContextMenu as CM } from "@base-ui/react/context-menu";
import { Menu as M } from "@base-ui/react/menu";
import { CaretRight, Check } from "./icons";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;

const popup =
  "min-w-44 max-h-[min(var(--available-height),520px)] overflow-y-auto rounded-xl bg-elevated p-1 text-sm text-fg shadow-pop outline-none animate-pop-in origin-[var(--transform-origin)]";

export function MenuContent({
  className,
  align = "start",
  side = "bottom",
  sideOffset = 6,
  ...props
}: M.Popup.Props & Pick<M.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <M.Portal>
      <M.Positioner align={align} side={side} sideOffset={sideOffset} className="z-50 outline-none">
        <M.Popup className={cn(popup, className)} {...props} />
      </M.Positioner>
    </M.Portal>
  );
}

export function ContextMenuContent({ className, ...props }: M.Popup.Props) {
  return (
    <CM.Portal>
      <CM.Positioner className="z-50 outline-none">
        <CM.Popup className={cn(popup, className)} {...props} />
      </CM.Positioner>
    </CM.Portal>
  );
}

export function MenuItem({
  className,
  shortcut,
  icon,
  danger,
  children,
  ...props
}: M.Item.Props & { shortcut?: React.ReactNode; icon?: React.ReactNode; danger?: boolean }) {
  return (
    <M.Item
      className={cn(
        "flex h-7 cursor-default select-none items-center gap-2 rounded-lg px-2 outline-none data-[highlighted]:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        danger && "text-danger data-[highlighted]:bg-danger/10",
        className,
      )}
      {...props}
    >
      {icon && <span className={cn("flex size-4 items-center justify-center text-fg/50", danger && "text-danger/80")}>{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="ml-4 flex items-center text-xs text-fg/35">{shortcut}</span>}
    </M.Item>
  );
}

export function MenuCheck({ checked, children, ...props }: M.CheckboxItem.Props & { children: React.ReactNode }) {
  return (
    <M.CheckboxItem
      checked={checked}
      className="flex h-7 cursor-default select-none items-center gap-2 rounded-lg px-2 outline-none data-[highlighted]:bg-surface-hover"
      {...props}
    >
      <span className="flex size-4 items-center justify-center text-accent">{checked && <Check weight="bold" className="size-3.5" />}</span>
      <span className="flex-1 truncate">{children}</span>
    </M.CheckboxItem>
  );
}

/** Plain section heading. (Base UI's GroupLabel throws outside a <Menu.Group>.) */
export function MenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="presentation" className={cn("select-none px-2 pb-1 pt-1.5 text-2xs font-medium text-fg/40", className)} {...props} />;
}

export const MenuGroup = M.Group;

export function MenuSeparator() {
  return <M.Separator className="mx-1 my-1 h-px bg-fg/[0.07]" />;
}

export function SubMenu({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <M.SubmenuRoot>
      <M.SubmenuTrigger className="flex h-7 cursor-default select-none items-center gap-2 rounded-lg px-2 outline-none data-[highlighted]:bg-surface-hover data-[popup-open]:bg-surface-hover">
        {icon && <span className="flex size-4 items-center justify-center text-fg/50">{icon}</span>}
        <span className="flex-1">{label}</span>
        <CaretRight className="size-3 text-fg/40" />
      </M.SubmenuTrigger>
      <M.Portal>
        <M.Positioner className="z-50 outline-none" sideOffset={4} alignOffset={-4}>
          <M.Popup className={popup}>{children}</M.Popup>
        </M.Positioner>
      </M.Portal>
    </M.SubmenuRoot>
  );
}
