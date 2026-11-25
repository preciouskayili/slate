import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Connection } from "@shared/types";
import { isElectron } from "@/lib/platform";
import { actions, pendingCount, useApp, type Tab } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Plus, Pulse, SidebarSimple, X } from "./ui/icons";
import { FunctionIcon, KIND_COLOR, QueryIcon, TableIcon } from "./ui/object-icons";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuItem, MenuSeparator } from "./ui/menu";
import { Tooltip } from "./ui/tooltip";
import { promptText } from "./prompt-dialog";

export function tabTitle(tab: Tab) {
  switch (tab.kind) {
    case "table":
      return tab.table;
    case "query":
      return tab.title;
    case "routine":
      return `${tab.name}()`;
    case "activity":
      return "Activity";
  }
}

const ICONS = { table: TableIcon, query: QueryIcon, routine: FunctionIcon, activity: (p: { className?: string; style?: React.CSSProperties }) => <Pulse weight="duotone" {...p} /> };
const TAB_COLOR = { table: KIND_COLOR.table, query: KIND_COLOR.query, routine: KIND_COLOR.function, activity: "rgb(var(--ok))" };

export function TabBar({ connection }: { connection: Connection }) {
  const tabs = useApp(useShallow((s) => s.tabs.filter((t) => t.connectionId === connection.id)));
  const activeId = useApp((s) => s.activeTab[connection.id]);
  const collapsed = useApp((s) => s.sidebarCollapsed);
  const db = useApp((s) => s.databases[connection.id]) ?? connection.database;
  const [dragging, setDragging] = useState<string | null>(null);

  return (
    <div className={cn("chrome window-drag flex h-11 shrink-0 items-center gap-1 pr-2", collapsed ? (isElectron ? "pl-[78px]" : "pl-2") : "pl-2")}>
      {collapsed && (
        <Tooltip label="Show sidebar" shortcut="⌘\">
          <button onClick={() => useApp.setState({ sidebarCollapsed: false })} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-fg/50 hover:bg-surface-hover hover:text-fg">
            <SidebarSimple className="size-4" />
          </button>
        </Tooltip>
      )}
      <div className="thin-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:h-0">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            dragging={dragging === tab.id}
            onDragStart={() => setDragging(tab.id)}
            onDragEnd={() => setDragging(null)}
            onDropOn={() => {
              if (!dragging || dragging === tab.id) return;
              const all = useApp.getState().tabs;
              actions.moveTab(dragging, all.findIndex((t) => t.id === tab.id));
            }}
          />
        ))}
        <Tooltip label="New query" shortcut="⌘T">
          <button onClick={() => actions.openQuery(connection.id, db)} className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-fg/45 hover:bg-surface-hover hover:text-fg">
            <Plus className="size-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function TabItem({
  tab,
  active,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
}: {
  tab: Tab;
  active: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
}) {
  const pending = useApp((s) => pendingCount(s.pending[tab.id]));
  const running = useApp((s) => s.runs[tab.id]?.status === "running");
  const tx = useApp((s) => s.txStatus[tab.id]);
  const Icon = ICONS[tab.kind];
  const unsavedQuery = tab.kind === "query" && tab.savedId && tab.sql !== tab.savedSql;
  const dirty = pending > 0 || unsavedQuery;
  const close = () => {
    if (pending > 0 && !confirm(`Discard ${pending} unsaved change${pending === 1 ? "" : "s"} in ${tabTitle(tab)}?`)) return;
    actions.closeTab(tab.id);
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            role="tab"
            aria-selected={active}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropOn}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                close();
              }
            }}
            onClick={() => actions.activate(tab.id)}
            onDoubleClick={() => tab.kind === "table" && tab.preview && actions.updateTab(tab.id, { preview: false })}
            title={tab.kind === "table" ? `${tab.schema}.${tab.table}` : undefined}
            className={cn(
              "no-drag group relative flex h-7 min-w-0 max-w-[200px] shrink-0 items-center gap-1.5 rounded-lg pl-2.5 pr-1 text-xs transition-colors",
              active ? "bg-surface-hover text-fg" : "text-fg/55 hover:bg-surface hover:text-fg/85",
              dragging && "opacity-40",
            )}
          />
        }
      >
        <Icon className={cn("size-[15px] shrink-0 transition-opacity", active ? "opacity-100" : "opacity-60", running && "animate-pulse")} style={{ color: running ? "rgb(var(--accent))" : TAB_COLOR[tab.kind] }} />
        <span className={cn("truncate", tab.kind === "table" && tab.preview && "italic")}>
          {tab.kind === "table" && tab.schema !== "public" && <span className="text-fg/40">{tab.schema}.</span>}
          {tabTitle(tab)}
        </span>
        {tx && tx !== "I" && <span className={cn("ml-0.5 rounded px-1 text-[9px] font-semibold uppercase", tx === "E" ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn")}>tx</span>}
        <button
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          aria-label="Close tab"
          className={cn(
            "relative flex size-5 shrink-0 items-center justify-center rounded-md text-fg/40 hover:bg-surface-strong hover:text-fg",
            !active && !dirty && "opacity-0 group-hover:opacity-100",
          )}
        >
          {dirty && <span className="absolute size-1.5 rounded-full bg-warn group-hover:opacity-0" />}
          <X className={cn("size-3", dirty && "opacity-0 group-hover:opacity-100")} />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuItem onClick={close} shortcut="⌘W">
          Close
        </MenuItem>
        <MenuItem onClick={() => actions.closeOthers(tab.id)}>Close others</MenuItem>
        {tab.kind === "query" && (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => actions.openQuery(tab.connectionId, tab.database, { sql: tab.sql, title: `${tab.title} copy` })}>Duplicate</MenuItem>
            <MenuItem
              onClick={async () => {
                const title = await promptText({ title: "Rename tab", initial: tab.title, confirmLabel: "Rename" });
                if (title?.trim()) actions.updateTab(tab.id, { title: title.trim() });
              }}
            >
              Rename…
            </MenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
