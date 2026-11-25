import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import type { Connection, RelationSummary, RoutineSummary, SavedQuery } from "@shared/types";
import { qualified } from "@shared/sql";
import { api, errorMessage } from "@/lib/api";
import { queryClient, refreshSchema, useInfo, useSaved, useSchema } from "@/lib/queries";
import { actions, useActiveTab, useApp } from "@/lib/store";
import { cn, copyText, download, formatBytes, formatCount } from "@/lib/utils";
import { confirmSql, runSql } from "./confirm-sql";
import { ConnectionAvatar } from "./connection-avatar";
import { HistoryDialog } from "./history-dialog";
import { Logo } from "./logo";
import { EnumIcon, FunctionIcon, KIND_COLOR, QueryIcon, RelationIcon } from "./ui/object-icons";
import {
  ArrowsClockwise,
  BookmarkSimple,
  CaretDown,
  CaretRight,
  CaretUpDown,
  Check,
  ClockCounterClockwise,
  Code,
  Columns,
  Copy,
  DownloadSimple,
  Lock,
  MagnifyingGlass,
  Pulse,
  SidebarSimple,
  Trash,
  X,
} from "./ui/icons";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, SubMenu } from "./ui/menu";
import { Spinner } from "./ui/misc";
import { toast } from "./ui/toast";
import { Tooltip } from "./ui/tooltip";
import { openEditConnection, openNewConnection, ThemeMenu } from "./welcome";
import { useConnections } from "@/lib/queries";
import { isElectron } from "@/lib/platform";

export function Sidebar({ connection }: { connection: Connection }) {
  const collapsed = useApp((s) => s.sidebarCollapsed);
  const width = useApp((s) => s.sidebarWidth);
  const db = useApp((s) => s.databases[connection.id]) ?? connection.database;
  const [filter, setFilter] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const { data: schema, isLoading, error, isFetching } = useSchema(connection.id, db);

  if (collapsed) return null;

  return (
    <aside style={{ width }} className="chrome relative flex shrink-0 flex-col">
      <div className={cn("window-drag flex h-11 shrink-0 items-center gap-1 pr-2", isElectron ? "pl-[78px]" : "pl-3.5")}>
        {!isElectron && <Logo className="mr-1 size-5" />}
        <div className="flex-1" />
        <Tooltip label="Search" shortcut="⌘K">
          <button onClick={() => useApp.setState({ paletteOpen: true })} className="flex size-7 items-center justify-center rounded-lg text-fg/50 hover:bg-surface-hover hover:text-fg">
            <MagnifyingGlass className="size-4" />
          </button>
        </Tooltip>
        <Tooltip label="Hide sidebar" shortcut="⌘\">
          <button onClick={() => useApp.setState({ sidebarCollapsed: true })} className="flex size-7 items-center justify-center rounded-lg text-fg/50 hover:bg-surface-hover hover:text-fg">
            <SidebarSimple className="size-4" />
          </button>
        </Tooltip>
      </div>

      <div className="px-2.5">
        <ConnectionSwitcher connection={connection} database={db} />
      </div>

      <nav className="mt-2 space-y-px px-2.5">
        <NavRow icon={<QueryIcon />} label="New query" shortcut="⌘T" onClick={() => actions.openQuery(connection.id, db)} />
        <NavRow icon={<ClockCounterClockwise weight="duotone" />} label="History" onClick={() => setHistoryOpen(true)} />
        <NavRow icon={<Pulse weight="duotone" />} label="Activity" onClick={() => actions.openActivity(connection.id, db)} />
      </nav>

      <div className="mt-3 flex items-center gap-1 px-2.5">
        <div className="relative flex-1">
          <MagnifyingGlass className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg/35" />
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")}
            placeholder="Filter tables"
            spellCheck={false}
            className="h-7 w-full rounded-lg bg-surface pl-7 pr-6 text-xs outline-none placeholder:text-fg/35 focus:ring-2 focus:ring-accent/40"
          />
          {filter && (
            <button onClick={() => setFilter("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg/40 hover:text-fg">
              <X className="size-3" />
            </button>
          )}
        </div>
        <Tooltip label="Refresh schema">
          <button onClick={() => refreshSchema(connection.id)} className="flex size-7 items-center justify-center rounded-lg text-fg/45 hover:bg-surface-hover hover:text-fg">
            <ArrowsClockwise className={cn("size-3.5", isFetching && "animate-spin")} />
          </button>
        </Tooltip>
      </div>

      <div className="thin-scroll mt-2 min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        <SavedQueries connectionId={connection.id} database={db} filter={filter} />
        {isLoading && (
          <div className="space-y-1.5 px-2 pt-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-4 animate-shimmer rounded bg-[linear-gradient(90deg,rgb(var(--fg)/0.04),rgb(var(--fg)/0.08),rgb(var(--fg)/0.04))] bg-[length:200%_100%]" style={{ width: `${55 + ((i * 37) % 40)}%` }} />
            ))}
          </div>
        )}
        {error && <div className="selectable m-1 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{errorMessage(error)}</div>}
        {schema && <SchemaTreeView connection={connection} database={db} filter={filter} schema={schema} />}
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 px-2.5">
        <ServerBadge connectionId={connection.id} database={db} />
        <div className="flex-1" />
        <ThemeMenu />
      </div>
      <ResizeHandle />
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} connectionId={connection.id} database={db} />
    </aside>
  );
}

function NavRow({ icon, label, shortcut, onClick }: { icon: React.ReactNode; label: string; shortcut?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex h-7 w-full items-center gap-2.5 rounded-lg px-2 text-sm text-fg/75 hover:bg-surface-hover hover:text-fg [&>svg]:size-[15px] [&>svg]:text-fg/50">
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-2xs text-fg/30 opacity-0 group-hover:opacity-100">{shortcut}</span>}
    </button>
  );
}

function ConnectionSwitcher({ connection, database }: { connection: Connection; database: string }) {
  const { data: connections } = useConnections();
  const { data: info, error } = useInfo(connection.id, database);
  const showDb = database !== connection.name;
  return (
    <Menu>
      <MenuTrigger className="group flex h-8 w-full items-center gap-2 rounded-lg px-1.5 text-left hover:bg-surface-hover data-[popup-open]:bg-surface-hover">
        <ConnectionAvatar connection={connection} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate text-sm">
          <span className="truncate font-medium">{connection.name}</span>
          {error ? <span className="shrink-0 text-xs text-danger">offline</span> : showDb && <span className="truncate text-xs text-fg/40">{database}</span>}
        </span>
        {(connection.readOnly || info?.readOnly) && <Lock className="size-3 shrink-0 text-fg/35" />}
        <CaretUpDown className="size-3.5 shrink-0 text-fg/30 group-hover:text-fg/55" />
      </MenuTrigger>
      <MenuContent className="w-[--anchor-width] min-w-56">
        {info && info.databases.length > 1 && (
          <>
            <MenuLabel>Database</MenuLabel>
            <div className="max-h-48 overflow-y-auto">
              {info.databases.map((d) => (
                <MenuItem key={d} onClick={() => actions.setDatabase(connection.id, d)} shortcut={d === database ? <Check weight="bold" className="size-3.5 text-fg/70" /> : undefined}>
                  {d}
                </MenuItem>
              ))}
            </div>
            <MenuSeparator />
          </>
        )}
        <MenuLabel>Connection</MenuLabel>
        {connections?.map((c) => (
          <MenuItem
            key={c.id}
            onClick={() => actions.selectConnection(c.id)}
            icon={<ConnectionAvatar connection={c} className="size-4 rounded-[4px] text-[9px]" />}
            shortcut={c.id === connection.id ? <Check weight="bold" className="size-3.5 text-fg/70" /> : undefined}
          >
            {c.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={openNewConnection}>New connection</MenuItem>
        <MenuItem onClick={() => openEditConnection(connection.id)}>Edit connection</MenuItem>
        <MenuItem onClick={() => actions.selectConnection(null)}>All connections</MenuItem>
      </MenuContent>
    </Menu>
  );
}

function ServerBadge({ connectionId, database }: { connectionId: string; database: string }) {
  const { data: info, error } = useInfo(connectionId, database);
  if (error) return <span className="truncate text-2xs text-danger">Disconnected</span>;
  if (!info) return <Spinner className="size-3" />;
  return (
    <span className="truncate text-2xs text-fg/40" title={info.versionString}>
      PostgreSQL {info.version.split(" ")[0]} · {info.user} · {formatBytes(info.bytes)}
    </span>
  );
}

function ResizeHandle() {
  return (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = useApp.getState().sidebarWidth;
        const move = (ev: PointerEvent) => useApp.setState({ sidebarWidth: Math.min(480, Math.max(200, startW + ev.clientX - startX)) });
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          document.body.style.cursor = "";
        };
        document.body.style.cursor = "col-resize";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onDoubleClick={() => useApp.setState({ sidebarWidth: 264 })}
      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize"
    />
  );
}

// ---- Schema tree

function matches(name: string, filter: string) {
  if (!filter) return true;
  const n = name.toLowerCase();
  const f = filter.toLowerCase();
  if (n.includes(f)) return true;
  let i = 0;
  for (const ch of n) if (ch === f[i]) i++;
  return i === f.length;
}

function SchemaTreeView({ connection, database, filter, schema }: { connection: Connection; database: string; filter: string; schema: NonNullable<ReturnType<typeof useSchema>["data"]> }) {
  const collapsedGroups = useApp((s) => s.collapsedGroups);
  const grouped = useMemo(() => {
    return schema.schemas
      .map((name) => ({
        name,
        relations: schema.relations.filter((r) => r.schema === name && matches(r.name, filter)),
        routines: schema.routines.filter((r) => r.schema === name && matches(r.name, filter)),
        enums: schema.enums.filter((e) => e.schema === name && matches(e.name, filter)),
      }))
      .filter((g, _i, all) => g.relations.length || g.routines.length || (!filter && (g.enums.length || all.length === 1)));
  }, [schema, filter]);

  if (!grouped.some((g) => g.relations.length || g.routines.length)) {
    return <div className="px-2 py-6 text-center text-xs text-fg/40">{filter ? "No matches" : "No tables"}</div>;
  }

  return (
    <div className="space-y-3">
      {grouped.map((g) => {
        const key = `${connection.id}:${database}:${g.name}`;
        const open = filter ? true : !collapsedGroups[key];
        const empty = !g.relations.length && !g.routines.length && !g.enums.length;
        return (
          <div key={g.name}>
            <button onClick={() => actions.toggleGroup(key)} className="group flex h-7 w-full items-center gap-1 rounded-lg px-2 text-xs font-medium text-fg/50 hover:text-fg/80">
              <span className="truncate text-left">{g.name}</span>
              <CaretDown weight="fill" className={cn("size-2 shrink-0 opacity-70 transition-transform", !open && "-rotate-90")} />
              <span className="ml-auto text-2xs font-normal text-fg/30">{g.relations.length || ""}</span>
            </button>
            {open && (
              <div className="space-y-px">
                {empty && <div className="py-1 pl-7 text-2xs text-fg/30">Empty schema</div>}
                {g.relations.map((r) => (
                  <RelationRow key={r.name} relation={r} connectionId={connection.id} database={database} />
                ))}
                {g.routines.length > 0 && (
                  <SubGroup id={`${key}:fn`} label="Functions" count={g.routines.length} defaultCollapsed forceOpen={Boolean(filter)}>
                    {g.routines.map((r) => (
                      <RoutineRow key={r.name + r.args} routine={r} connectionId={connection.id} database={database} />
                    ))}
                  </SubGroup>
                )}
                {g.enums.length > 0 && !filter && (
                  <SubGroup id={`${key}:enum`} label="Enums" count={g.enums.length} defaultCollapsed>
                    {g.enums.map((e) => (
                      <div key={e.name} title={e.values.join(", ")} className="flex h-7 items-center gap-2 rounded-lg pl-7 pr-2 text-sm text-fg/65">
                        <EnumIcon className="size-[15px] opacity-80" style={{ color: KIND_COLOR.enum }} />
                        <span className="truncate">{e.name}</span>
                        <span className="ml-auto truncate text-2xs text-fg/30">{e.values.length}</span>
                      </div>
                    ))}
                  </SubGroup>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SubGroup({ id, label, count, defaultCollapsed, forceOpen, children }: { id: string; label: string; count: number; defaultCollapsed?: boolean; forceOpen?: boolean; children: React.ReactNode }) {
  const toggled = useApp((s) => s.collapsedGroups[id]);
  const open = forceOpen || (defaultCollapsed ? Boolean(toggled) : !toggled);
  return (
    <div>
      <button onClick={() => actions.toggleGroup(id)} className="flex h-7 w-full items-center gap-2 rounded-lg pl-4 pr-2 text-xs text-fg/45 hover:bg-surface hover:text-fg/70">
        <CaretRight className={cn("size-2.5 transition-transform", open && "rotate-90")} />
        <span className="flex-1 text-left">{label}</span>
        <span className="text-2xs text-fg/30">{count}</span>
      </button>
      {open && <div className="space-y-px">{children}</div>}
    </div>
  );
}

async function exportRelation(connectionId: string, database: string, r: { schema: string; name: string }, format: "csv" | "json" | "sql") {
  const id = toast(`Exporting ${r.name}…`, { kind: "info" });
  try {
    const blob = await api.blob(`/api/c/${connectionId}/export`, { database, schema: r.schema, table: r.name, filters: [], match: "all", sort: [], limit: 0, offset: 0, format });
    download(`${r.name}.${format}`, blob);
    toast(`Exported ${r.name}.${format}`);
  } catch (e) {
    toast.error("Export failed", errorMessage(e));
  }
  void id;
}

function RelationRow({ relation: r, connectionId, database }: { relation: RelationSummary; connectionId: string; database: string }) {
  const active = useActiveTab();
  const isActive = active?.kind === "table" && active.schema === r.schema && active.table === r.name && active.database === database;
  const name = qualified(r.schema, r.name);
  const afterChange = () => {
    refreshSchema(connectionId);
    queryClient.invalidateQueries({ queryKey: ["rows", connectionId] });
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", name)}
            onClick={() => actions.openTable(connectionId, database, r.schema, r.name, { preview: true })}
            onDoubleClick={() => actions.openTable(connectionId, database, r.schema, r.name, { preview: false })}
            title={r.comment ?? undefined}
            className={cn(
              "group flex h-7 w-full items-center gap-2 rounded-lg pl-6 pr-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              isActive ? "bg-surface-hover text-fg" : "text-fg/75 hover:bg-surface hover:text-fg data-[popup-open]:bg-surface-hover",
            )}
          />
        }
      >
        <RelationIcon kind={r.kind} className={cn("size-[15px] transition-opacity", isActive ? "opacity-100" : "opacity-75 group-hover:opacity-100")} />
        <span className="min-w-0 flex-1 truncate">{r.name}</span>
        {r.rowEstimate !== null && r.rowEstimate > 0 && <span className="shrink-0 text-2xs tabular-nums text-fg/30">{formatCount(r.rowEstimate)}</span>}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuItem icon={<RelationIcon kind={r.kind} muted />} onClick={() => actions.openTable(connectionId, database, r.schema, r.name, { preview: false, newTab: true })}>
          Open in new tab
        </MenuItem>
        <MenuItem icon={<Columns />} onClick={() => actions.openTable(connectionId, database, r.schema, r.name, { preview: false, view: "structure" })}>
          View structure
        </MenuItem>
        <MenuItem icon={<QueryIcon />} onClick={() => actions.openQuery(connectionId, database, { sql: `SELECT *\nFROM ${name}\nLIMIT 100;`, title: r.name })}>
          Query in editor
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Copy />} onClick={() => copyText(name)}>
          Copy name
        </MenuItem>
        <SubMenu label="Export" icon={<DownloadSimple />}>
          <MenuItem onClick={() => exportRelation(connectionId, database, r, "csv")}>CSV</MenuItem>
          <MenuItem onClick={() => exportRelation(connectionId, database, r, "json")}>JSON</MenuItem>
          <MenuItem onClick={() => exportRelation(connectionId, database, r, "sql")}>SQL inserts</MenuItem>
        </SubMenu>
        {r.kind === "materialized" && (
          <MenuItem
            icon={<ArrowsClockwise />}
            onClick={() =>
              confirmSql({ title: `Refresh ${r.name}?`, sql: `REFRESH MATERIALIZED VIEW ${name};`, confirmLabel: "Refresh", run: async () => {
                  await runSql(connectionId, database, `REFRESH MATERIALIZED VIEW ${name}`);
                  afterChange();
                  toast("Materialized view refreshed");
                },
              })
            }
          >
            Refresh view
          </MenuItem>
        )}
        <MenuSeparator />
        {r.kind === "table" && (
          <MenuItem
            danger
            icon={<Trash />}
            onClick={() =>
              confirmSql({
                title: `Truncate ${r.name}?`,
                description: "This can’t be undone.",
                sql: `TRUNCATE TABLE ${name};`,
                danger: true,
                confirmLabel: "Truncate",
                run: async () => {
                  await runSql(connectionId, database, `TRUNCATE TABLE ${name}`);
                  afterChange();
                  toast(`${r.name} truncated`);
                },
              })
            }
          >
            Truncate…
          </MenuItem>
        )}
        <MenuItem
          danger
          icon={<Trash />}
          onClick={() => {
            const kind = r.kind === "view" ? "VIEW" : r.kind === "materialized" ? "MATERIALIZED VIEW" : r.kind === "foreign" ? "FOREIGN TABLE" : "TABLE";
            const sql = `DROP ${kind} ${name};`;
            confirmSql({
              title: `Drop ${r.name}?`,
              description: "This can’t be undone.",
              sql,
              danger: true,
              confirmLabel: "Drop",
              run: async () => {
                await runSql(connectionId, database, sql);
                for (const t of useApp.getState().tabs) if (t.kind === "table" && t.schema === r.schema && t.table === r.name) actions.closeTab(t.id);
                afterChange();
                toast(`${r.name} dropped`);
              },
            });
          }}
        >
          Drop…
        </MenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RoutineRow({ routine: r, connectionId, database }: { routine: RoutineSummary; connectionId: string; database: string }) {
  const active = useActiveTab();
  const isActive = active?.kind === "routine" && active.schema === r.schema && active.name === r.name && active.args === r.args;
  return (
    <button
      onClick={() => r.kind !== "aggregate" && actions.openRoutine(connectionId, database, r.schema, r.name, r.args)}
      title={`${r.name}(${r.args}) → ${r.returns}`}
      className={cn("flex h-7 w-full items-center gap-2 rounded-lg pl-7 pr-2 text-left text-sm", isActive ? "bg-surface-hover text-fg" : "text-fg/65 hover:bg-surface hover:text-fg")}
    >
      <FunctionIcon className="size-[15px] opacity-80" style={{ color: KIND_COLOR.function }} />
      <span className="truncate">{r.name}</span>
      <span className="ml-auto truncate pl-2 font-mono text-2xs text-fg/30">({r.args ? "…" : ""})</span>
    </button>
  );
}

function SavedQueries({ connectionId, database, filter }: { connectionId: string; database: string; filter: string }) {
  const { data } = useSaved();
  const active = useActiveTab();
  const toggled = useApp((s) => s.collapsedGroups["saved"]);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/saved/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved"] }),
  });
  const items = (data ?? []).filter((q: SavedQuery) => (!q.connectionId || q.connectionId === connectionId) && matches(q.name, filter));
  if (!items.length) return null;
  const open = filter ? true : !toggled;
  return (
    <div className="mb-3">
      <button onClick={() => actions.toggleGroup("saved")} className="flex h-7 w-full items-center gap-1 rounded-lg px-2 text-xs font-medium text-fg/50 hover:text-fg/80">
        <span className="text-left">Saved queries</span>
        <CaretDown weight="fill" className={cn("size-2 shrink-0 opacity-70 transition-transform", !open && "-rotate-90")} />
        <span className="ml-auto text-2xs font-normal text-fg/30">{items.length}</span>
      </button>
      {open &&
        items.map((q) => (
          <ContextMenu key={q.id}>
            <ContextMenuTrigger
              render={
                <button
                  onClick={() => actions.openQuery(connectionId, database, { sql: q.sql, title: q.name, savedId: q.id })}
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded-lg pl-6 pr-2 text-left text-sm",
                    active?.kind === "query" && active.savedId === q.id ? "bg-surface-hover text-fg" : "text-fg/75 hover:bg-surface hover:text-fg",
                  )}
                />
              }
            >
              <BookmarkSimple weight="duotone" className="size-[15px] shrink-0 text-brand" />
              <span className="truncate">{q.name}</span>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <MenuItem icon={<Code />} onClick={() => copyText(q.sql)}>
                Copy SQL
              </MenuItem>
              <MenuItem danger icon={<Trash />} onClick={() => confirm(`Delete saved query “${q.name}”?`) && remove.mutate(q.id)}>
                Delete
              </MenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
    </div>
  );
}
