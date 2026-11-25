import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Cell, Connection, MutateResponse, Mutation, RowKey, RowsRequest, TableDetails } from "@shared/types";
import { qualified, quoteIdent, quoteLiteral } from "@shared/sql";
import { api, errorMessage } from "@/lib/api";
import { toCsv, toJson, toMarkdown, toTsv } from "@/lib/format";
import { queryClient, useRows, useTable } from "@/lib/queries";
import { actions, emptyPending, pendingCount, useApp, type Pending, type TableTab } from "@/lib/store";
import { cn, copyText, download, formatMs, formatNumber, mod, uid, useDebounced } from "@/lib/utils";
import { confirmSql } from "../confirm-sql";
import { DataGrid, type GridColumn, type GridContext, type GridRow } from "../grid/data-grid";
import { Button } from "../ui/button";
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  ArrowUpRight,
  CaretLeft,
  CaretRight,
  Code,
  Columns,
  Copy,
  DotsThree,
  DownloadSimple,
  Eye,
  EyeSlash,
  FunnelSimple,
  Lock,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SidebarSimple,
  SortAscending,
  Table,
  Terminal,
  Trash,
  X,
} from "../ui/icons";
import { Menu, MenuCheck, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, SubMenu } from "../ui/menu";
import { Empty, Segmented, Spinner } from "../ui/misc";
import { toast } from "../ui/toast";
import { Tooltip } from "../ui/tooltip";
import { FilterBar, newFilter } from "./filter-bar";
import { RowInspector } from "./row-inspector";
import { StructureView } from "./structure-view";

const PAGE_SIZES = [50, 100, 250, 500, 1000, 5000];

export function TableView({ tab, connection }: { tab: TableTab; connection: Connection }) {
  const { data: details, error: detailsError, isLoading: detailsLoading } = useTable(connection.id, tab.database, tab.schema, tab.table);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar tab={tab} details={details} connection={connection} />
      {detailsError ? (
        <Empty title="Couldn't load this table">{errorMessage(detailsError)}</Empty>
      ) : detailsLoading || !details ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : tab.view === "structure" ? (
        <StructureView tab={tab} details={details} connectionId={connection.id} />
      ) : (
        <DataView tab={tab} details={details} connection={connection} />
      )}
    </div>
  );
}

function Toolbar({ tab, details, connection }: { tab: TableTab; details?: TableDetails; connection: Connection }) {
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const [search, setSearch] = useState(tab.search);
  const debounced = useDebounced(search, 300);
  useEffect(() => {
    if (debounced !== tab.search) actions.updateTab<TableTab>(tab.id, { search: debounced, page: 0 });
  }, [debounced]);
  const activeFilters = requestFor(tab, "", tab.filters, "").filters.length + (tab.where ? 1 : 0);
  const readOnly = connection.readOnly || (details && !details.editable);

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-fg/[0.06] px-3">
      <Segmented
        value={tab.view}
        onChange={(view) => actions.updateTab<TableTab>(tab.id, { view, preview: false })}
        options={[
          { value: "data", label: <><Table className="size-3.5" /> Data</> },
          { value: "structure", label: <><Columns className="size-3.5" /> Structure</> },
        ]}
      />
      <div className="flex min-w-0 items-center gap-1 truncate pl-1.5 text-sm text-fg/45">
        <span className="truncate">{tab.schema}</span>
        <CaretRight className="size-3 shrink-0 text-fg/30" />
        <span className="truncate font-medium text-fg/85">{tab.table}</span>
        {details?.kind && details.kind !== "table" && <span className="ml-1.5 rounded bg-surface-hover px-1 py-px text-2xs">{details.kind}</span>}
        {readOnly && details && (
          <span className="ml-1.5 inline-flex items-center gap-1 text-2xs text-fg/40" title={connection.readOnly ? "Read-only connection" : "No primary key or not a table"}>
            <Lock className="size-3" /> read-only
          </span>
        )}
      </div>
      <div className="flex-1" />
      {tab.view === "data" && (
        <>
          <div className="relative w-52">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg/35" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearch("")}
              placeholder="Search rows"
              spellCheck={false}
              className="field h-7 pl-8 pr-6 text-xs"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/40 hover:text-fg">
                <X className="size-3" />
              </button>
            )}
          </div>
          <Button
            size="sm"
            variant={tab.showFilters || activeFilters ? "secondary" : "ghost"}
            className={cn(activeFilters > 0 && "text-accent")}
            onClick={() => {
              const show = !tab.showFilters;
              const patch: Partial<TableTab> = { showFilters: show };
              if (show && tab.filters.length === 0 && details?.columns[0]) patch.filters = [newFilter(details.columns[0])];
              actions.updateTab<TableTab>(tab.id, patch);
            }}
          >
            <FunnelSimple className="size-3.5" />
            Filter
            {activeFilters > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white">{activeFilters}</span>}
          </Button>
          <Tooltip label="Inspector" shortcut="Space">
            <Button size="icon-sm" variant={inspectorOpen ? "secondary" : "ghost"} onClick={() => useApp.setState({ inspectorOpen: !inspectorOpen })}>
              <SidebarSimple className="size-4 -scale-x-100" />
            </Button>
          </Tooltip>
        </>
      )}
      <Tooltip label="Reload" shortcut="⌘R">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["table", connection.id, tab.database, tab.schema, tab.table] });
            queryClient.invalidateQueries({ queryKey: ["rows", connection.id] });
          }}
        >
          <ArrowsClockwise className="size-4" />
        </Button>
      </Tooltip>
      <Menu>
        <MenuTrigger className="flex size-7 items-center justify-center rounded-lg text-fg/55 hover:bg-surface-hover hover:text-fg data-[popup-open]:bg-surface-hover">
          <DotsThree weight="bold" className="size-4" />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<Terminal />} onClick={() => actions.openQuery(connection.id, tab.database, { sql: `SELECT *\nFROM ${qualified(tab.schema, tab.table)}\nLIMIT 100;`, title: tab.table })}>
            Open in query editor
          </MenuItem>
          <SubMenu label="Export all rows" icon={<DownloadSimple />}>
            {(["csv", "json", "sql"] as const).map((format) => (
              <MenuItem key={format} onClick={() => exportTable(connection.id, tab, format)}>
                {format === "sql" ? "SQL inserts" : format.toUpperCase()}
                {tab.filters.some((f) => f.enabled) || tab.search || tab.where ? " (filtered)" : ""}
              </MenuItem>
            ))}
          </SubMenu>
          {details && (
            <SubMenu label="Columns" icon={<Eye />}>
              {details.columns.map((c) => (
                <MenuCheck
                  key={c.name}
                  checked={!tab.hiddenColumns.includes(c.name)}
                  closeOnClick={false}
                  onCheckedChange={(checked) =>
                    actions.updateTab<TableTab>(tab.id, {
                      hiddenColumns: checked ? tab.hiddenColumns.filter((n) => n !== c.name) : [...tab.hiddenColumns, c.name],
                    })
                  }
                >
                  {c.name}
                </MenuCheck>
              ))}
              {tab.hiddenColumns.length > 0 && (
                <>
                  <MenuSeparator />
                  <MenuItem onClick={() => actions.updateTab<TableTab>(tab.id, { hiddenColumns: [] })}>Show all</MenuItem>
                </>
              )}
            </SubMenu>
          )}
          <MenuItem icon={<Copy />} onClick={() => copyText(qualified(tab.schema, tab.table))}>
            Copy table name
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

async function exportTable(connectionId: string, tab: TableTab, format: "csv" | "json" | "sql") {
  toast(`Exporting ${tab.table}…`, { kind: "info" });
  try {
    const blob = await api.blob(`/api/c/${connectionId}/export`, { ...requestFor(tab, tab.search, tab.filters, tab.where), format });
    download(`${tab.table}.${format}`, blob);
    toast(`Exported ${tab.table}.${format}`);
  } catch (e) {
    toast.error("Export failed", errorMessage(e));
  }
}

function requestFor(tab: TableTab, search: string, filters: TableTab["filters"], where: string): RowsRequest {
  return {
    database: tab.database,
    schema: tab.schema,
    table: tab.table,
    filters: filters.filter((f) => f.enabled && (f.value !== "" || ["null", "not_null", "true", "false"].includes(f.op))),
    match: tab.match,
    where,
    search,
    sort: tab.sort,
    limit: tab.pageSize,
    offset: tab.page * tab.pageSize,
  };
}

// ---- Data

function DataView({ tab, details, connection }: { tab: TableTab; details: TableDetails; connection: Connection }) {
  const filters = useDebounced(tab.filters, 300);
  const request = useMemo(() => requestFor(tab, tab.search, filters, tab.where), [tab, filters]);
  const { data, error, isFetching, isLoading, refetch } = useRows(connection.id, request);
  const pending = useApp((s) => s.pending[tab.id]) ?? emptyPending();
  const count = pendingCount(pending);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const editable = details.editable && !connection.readOnly;

  const fieldIndex = useMemo(() => new Map((data?.fields ?? []).map((f, i) => [f.name, i])), [data?.fields]);
  const fkByColumn = useMemo(() => {
    const map = new Map<string, TableDetails["foreignKeys"][number]>();
    for (const fk of details.foreignKeys) if (fk.columns.length === 1) map.set(fk.columns[0], fk);
    return map;
  }, [details]);

  const visible = useMemo(() => details.columns.filter((c) => !tab.hiddenColumns.includes(c.name) && fieldIndex.has(c.name)), [details, tab.hiddenColumns, fieldIndex]);
  const columns: GridColumn[] = useMemo(
    () =>
      visible.map((c) => ({
        name: c.name,
        type: c.type,
        category: c.category,
        isPrimaryKey: c.isPrimaryKey,
        fk: fkByColumn.get(c.name),
        nullable: c.nullable,
        enumValues: c.enumValues,
        readOnly: c.generated || c.identity === "always",
        comment: c.comment,
      })),
    [visible, fkByColumn],
  );

  const keyOf = useCallback(
    (rowIndex: number): { id: string; key: RowKey } | null => {
      if (!data) return null;
      const row = data.rows[rowIndex];
      if (details.primaryKey.length) {
        const key: RowKey = {};
        for (const pk of details.primaryKey) key[pk] = row[fieldIndex.get(pk)!];
        return { id: JSON.stringify(key), key };
      }
      const ctid = data.ctids[rowIndex];
      return ctid ? { id: `ctid:${ctid}`, key: { ctid } } : null;
    },
    [data, details, fieldIndex],
  );

  // Merge server rows with staged edits. New rows first.
  const { gridRows, sources } = useMemo(() => {
    const gridRows: GridRow[] = [];
    const sources: ({ kind: "new"; tempId: string } | { kind: "row"; index: number })[] = [];
    for (const insert of pending.inserts) {
      const cells = visible.map((c) => (c.name in insert.values ? insert.values[c.name] : null));
      const dirty = new Set(visible.flatMap((c, i) => (c.name in insert.values ? [i] : [])));
      gridRows.push({ key: insert.tempId, cells, status: "new", dirty });
      sources.push({ kind: "new", tempId: insert.tempId });
    }
    data?.rows.forEach((row, index) => {
      const id = keyOf(index)?.id ?? `row:${index}`;
      const update = pending.updates[id];
      const cells = visible.map((c) => {
        const v = row[fieldIndex.get(c.name)!];
        return update && c.name in update.values ? update.values[c.name] : v;
      });
      const dirty = update ? new Set(visible.flatMap((c, i) => (c.name in update.values ? [i] : []))) : undefined;
      gridRows.push({ key: id, cells, status: pending.deletes[id] ? "deleted" : undefined, dirty });
      sources.push({ kind: "row", index });
    });
    return { gridRows, sources };
  }, [data, pending, visible, fieldIndex, keyOf]);

  const editCell = (rowIndex: number, columnName: string, value: Cell) => {
    const source = sources[rowIndex];
    if (!source) return;
    actions.setPending(tab.id, (p) => {
      if (source.kind === "new") {
        return { ...p, inserts: p.inserts.map((r) => (r.tempId === source.tempId ? { ...r, values: { ...r.values, [columnName]: value } } : r)) };
      }
      const k = keyOf(source.index);
      if (!k) return p;
      const original = data!.rows[source.index][fieldIndex.get(columnName)!];
      const values = { ...(p.updates[k.id]?.values ?? {}) };
      if (value === original) delete values[columnName];
      else values[columnName] = value;
      const updates = { ...p.updates };
      if (Object.keys(values).length) updates[k.id] = { key: k.key, values };
      else delete updates[k.id];
      return { ...p, updates };
    });
  };

  const toggleDelete = (rowIndexes: number[]) => {
    actions.setPending(tab.id, (p) => {
      const next: Pending = { ...p, deletes: { ...p.deletes }, inserts: [...p.inserts] };
      const allDeleted = rowIndexes.every((i) => sources[i]?.kind === "row" && next.deletes[keyOf((sources[i] as { index: number }).index)?.id ?? ""]);
      for (const i of rowIndexes) {
        const source = sources[i];
        if (!source) continue;
        if (source.kind === "new") next.inserts = next.inserts.filter((r) => r.tempId !== source.tempId);
        else {
          const k = keyOf(source.index);
          if (!k) continue;
          if (allDeleted) delete next.deletes[k.id];
          else next.deletes[k.id] = k.key;
        }
      }
      return next;
    });
  };

  const addRow = (values: Record<string, Cell> = {}) => {
    actions.setPending(tab.id, (p) => ({ ...p, inserts: [{ tempId: uid(), values }, ...p.inserts] }));
  };

  const mutations = (): Mutation[] => [
    ...Object.values(pending.updates).map((u) => ({ kind: "update" as const, key: u.key, values: u.values })),
    ...pending.inserts.map((r) => ({ kind: "insert" as const, values: r.values })),
    ...Object.values(pending.deletes).map((key) => ({ kind: "delete" as const, key })),
  ];

  const save = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<MutateResponse>(`/api/c/${connection.id}/mutate`, { database: tab.database, schema: tab.schema, table: tab.table, mutations: mutations(), dryRun }),
    onSuccess: (result, dryRun) => {
      if (dryRun) {
        confirmSql({
          title: `Review ${count} change${count === 1 ? "" : "s"}`,
          sql: result.sql.join("\n"),
          confirmLabel: "Apply changes",
          run: async () => {
            await save.mutateAsync(false);
          },
        });
        return;
      }
      actions.clearPending(tab.id);
      queryClient.invalidateQueries({ queryKey: ["rows", connection.id] });
      toast(`Saved ${result.sql.length} change${result.sql.length === 1 ? "" : "s"}`, { detail: `${result.affected} row${result.affected === 1 ? "" : "s"} affected` });
    },
    onError: (e, dryRun) => {
      if (!dryRun) toast.error("Changes not saved", errorMessage(e));
      else toast.error("Couldn't build SQL", errorMessage(e));
    },
  });

  // ⌘S save, ⌘R reload, ⌘F filter, ⌘N new row
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!mod(e)) return;
      const key = e.key.toLowerCase();
      if (key === "s" && count > 0) {
        e.preventDefault();
        if (!save.isPending) save.mutate(false);
      } else if (key === "r" && !e.shiftKey) {
        e.preventDefault();
        refetch();
      } else if (key === "f" && !e.shiftKey) {
        e.preventDefault();
        actions.updateTab<TableTab>(tab.id, { showFilters: true, filters: tab.filters.length ? tab.filters : details.columns[0] ? [newFilter(details.columns[0])] : [] });
      } else if (key === "n" && editable && !e.shiftKey) {
        e.preventDefault();
        addRow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const followFk = (column: GridColumn, value: string) => {
    const fk = column.fk;
    if (!fk) return;
    actions.openTable(connection.id, tab.database, fk.refSchema, fk.refTable, {
      preview: false,
      newTab: true,
      filters: [{ id: uid(), column: fk.refColumns[0], op: "eq", value, enabled: true }],
    });
  };

  const onSort = (column: string, additive: boolean) => {
    const existing = tab.sort.find((s) => s.column === column);
    let sort = additive ? tab.sort.filter((s) => s.column !== column) : [];
    if (!existing) sort = [...sort, { column, dir: "asc" }];
    else if (existing.dir === "asc") sort = [...sort, { column, dir: "desc" }];
    actions.updateTab<TableTab>(tab.id, { sort, page: 0 });
  };

  const rowsAsObjects = (indexes: number[]) => indexes.map((i) => gridRows[i].cells);

  const renderCellMenu = (ctx: GridContext) => {
    const column = columns[ctx.col];
    const value = gridRows[ctx.row]?.cells[ctx.col] ?? null;
    const header = columns.map((c) => c.name);
    const selectedRows = rowsAsObjects(ctx.rows);
    const anyDeleted = ctx.rows.some((i) => gridRows[i]?.status === "deleted");
    const cellText = (v: Cell) => v ?? "";
    const insertSql = selectedRows
      .map((r) => `INSERT INTO ${qualified(tab.schema, tab.table)} (${header.map(quoteIdent).join(", ")}) VALUES (${r.map(quoteLiteral).join(", ")});`)
      .join("\n");
    return (
      <>
        <MenuItem icon={<Copy />} shortcut="⌘C" onClick={() => copyText(ctx.range.r1 === ctx.range.r2 && ctx.range.c1 === ctx.range.c2 ? cellText(value) : toTsv(ctx.rows.map((i) => gridRows[i].cells.slice(ctx.range.c1, ctx.range.c2 + 1))))}>
          Copy
        </MenuItem>
        <SubMenu label={`Copy ${ctx.rows.length > 1 ? `${ctx.rows.length} rows` : "row"} as`} icon={<Copy />}>
          <MenuItem onClick={() => copyText(toJson(selectedRows, header))}>JSON</MenuItem>
          <MenuItem onClick={() => copyText(toCsv(selectedRows, header))}>CSV</MenuItem>
          <MenuItem onClick={() => copyText(toTsv(selectedRows, header))}>TSV (spreadsheet)</MenuItem>
          <MenuItem onClick={() => copyText(toMarkdown(selectedRows, header))}>Markdown table</MenuItem>
          <MenuItem onClick={() => copyText(insertSql)}>SQL INSERT</MenuItem>
        </SubMenu>
        {column && (
          <>
            <MenuSeparator />
            <MenuLabel>Filter by {column.name}</MenuLabel>
            <MenuItem
              icon={<FunnelSimple />}
              onClick={() =>
                actions.updateTab<TableTab>(tab.id, {
                  showFilters: true,
                  page: 0,
                  filters: [...tab.filters, { id: uid(), column: column.name, op: value === null ? "null" : "eq", value: value ?? "", enabled: true }],
                })
              }
            >
              {value === null ? "is NULL" : `= ${value.length > 28 ? value.slice(0, 28) + "…" : value}`}
            </MenuItem>
            {value !== null && (
              <MenuItem
                icon={<FunnelSimple />}
                onClick={() =>
                  actions.updateTab<TableTab>(tab.id, { showFilters: true, page: 0, filters: [...tab.filters, { id: uid(), column: column.name, op: "neq", value, enabled: true }] })
                }
              >
                ≠ {value.length > 28 ? value.slice(0, 28) + "…" : value}
              </MenuItem>
            )}
            <MenuItem icon={<SortAscending />} onClick={() => onSort(column.name, false)}>
              Sort by {column.name}
            </MenuItem>
            {column.fk && value !== null && (
              <MenuItem icon={<ArrowUpRight />} onClick={() => followFk(column, value)}>
                Open {column.fk.refTable} row
              </MenuItem>
            )}
          </>
        )}
        {editable && (
          <>
            <MenuSeparator />
            {column && !column.readOnly && column.nullable !== false && (
              <MenuItem icon={<PencilSimple />} onClick={() => ctx.rows.forEach((r) => gridRows[r].status !== "deleted" && editCell(r, column.name, null))}>
                Set NULL
              </MenuItem>
            )}
            <MenuItem
              icon={<Plus />}
              onClick={() => {
                const src = gridRows[ctx.row];
                const values: Record<string, Cell> = {};
                columns.forEach((c, i) => {
                  if (!c.isPrimaryKey && !c.readOnly) values[c.name] = src.cells[i];
                });
                addRow(values);
              }}
            >
              Duplicate row
            </MenuItem>
            <MenuItem danger={!anyDeleted} icon={anyDeleted ? <ArrowCounterClockwise /> : <Trash />} shortcut="⌫" onClick={() => toggleDelete(ctx.rows)}>
              {anyDeleted ? "Restore" : "Delete"} {ctx.rows.length > 1 ? `${ctx.rows.length} rows` : "row"}
            </MenuItem>
          </>
        )}
      </>
    );
  };

  const renderHeaderMenu = (column: GridColumn) => (
    <>
      <MenuItem icon={<SortAscending />} onClick={() => actions.updateTab<TableTab>(tab.id, { sort: [{ column: column.name, dir: "asc" }], page: 0 })}>
        Sort ascending
      </MenuItem>
      <MenuItem icon={<SortAscending className="-scale-y-100" />} onClick={() => actions.updateTab<TableTab>(tab.id, { sort: [{ column: column.name, dir: "desc" }], page: 0 })}>
        Sort descending
      </MenuItem>
      {tab.sort.length > 0 && <MenuItem onClick={() => actions.updateTab<TableTab>(tab.id, { sort: [], page: 0 })}>Clear sort</MenuItem>}
      <MenuSeparator />
      <MenuItem
        icon={<FunnelSimple />}
        onClick={() => {
          const info = details.columns.find((c) => c.name === column.name);
          if (info) actions.updateTab<TableTab>(tab.id, { showFilters: true, filters: [...tab.filters, newFilter(info)] });
        }}
      >
        Filter by {column.name}…
      </MenuItem>
      <MenuItem icon={<EyeSlash />} onClick={() => actions.updateTab<TableTab>(tab.id, { hiddenColumns: [...tab.hiddenColumns, column.name] })}>
        Hide column
      </MenuItem>
      <MenuItem icon={<Copy />} onClick={() => copyText(column.name)}>
        Copy name
      </MenuItem>
    </>
  );

  const activeSource = activeRow !== null ? sources[activeRow] : undefined;
  const total = data?.total ?? null;
  const pageCount = total !== null ? Math.max(1, Math.ceil(total / tab.pageSize)) : null;

  return (
    <>
      {tab.showFilters && <FilterBar tab={tab} columns={details.columns} />}
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          {error && !isFetching ? (
            <div className="m-3 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
              <div className="font-medium">Query failed</div>
              <div className="selectable mt-0.5 text-xs">{errorMessage(error)}</div>
            </div>
          ) : isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <DataGrid
              columns={columns}
              rows={gridRows}
              storageKey={tab.id}
              rowNumberOffset={tab.page * tab.pageSize - pending.inserts.length}
              sort={tab.sort}
              onSort={onSort}
              editable={editable}
              onEdit={(r, c, v) => editCell(r, columns[c].name, v)}
              onDeleteRows={toggleDelete}
              onFollowFk={followFk}
              onActiveRowChange={setActiveRow}
              onToggleInspector={() => useApp.setState((s) => ({ inspectorOpen: !s.inspectorOpen }))}
              renderCellMenu={renderCellMenu}
              renderHeaderMenu={renderHeaderMenu}
              emptyState={<Empty title={request.filters.length || request.search || request.where ? "No rows match" : "No rows"} />}
            />
          )}
          {isFetching && !isLoading && <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-shimmer bg-[linear-gradient(90deg,transparent,rgb(var(--accent)),transparent)] bg-[length:200%_100%]" />}
        </div>
        {inspectorOpen && (
          <RowInspector
            details={details}
            connectionId={connection.id}
            database={tab.database}
            row={activeSource ? gridRows[activeRow!] : undefined}
            columns={visible}
            editable={editable && gridRows[activeRow ?? -1]?.status !== "deleted"}
            onEdit={(column, value) => activeRow !== null && editCell(activeRow, column, value)}
            onClose={() => useApp.setState({ inspectorOpen: false })}
          />
        )}
      </div>

      {count > 0 ? (
        <div className="flex h-11 shrink-0 items-center gap-2 border-t border-warn/25 bg-warn/[0.07] px-3 text-xs">
          <span className="size-1.5 rounded-full bg-warn" />
          <span className="font-medium">
            {count} pending change{count === 1 ? "" : "s"}
          </span>
          <span className="text-fg/45">
            {[
              Object.keys(pending.updates).length && `${Object.keys(pending.updates).length} edited`,
              pending.inserts.length && `${pending.inserts.length} new`,
              Object.keys(pending.deletes).length && `${Object.keys(pending.deletes).length} deleted`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => actions.clearPending(tab.id)}>
              Discard
            </Button>
            <Button size="sm" variant="secondary" onClick={() => save.mutate(true)} disabled={save.isPending}>
              <Code className="size-3.5" /> Review SQL
            </Button>
            <Button size="sm" variant="primary" onClick={() => save.mutate(false)} disabled={save.isPending}>
              {save.isPending && <Spinner className="size-3 text-current" />}
              Save <span className="opacity-50">⌘S</span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex h-9 shrink-0 items-center gap-3 border-t border-fg/[0.06] px-3 text-xs text-fg/50">
          {editable && (
            <Button size="xs" variant="ghost" className="-ml-1.5" onClick={() => addRow()}>
              <Plus weight="bold" className="size-3" /> Row
            </Button>
          )}
          <span className="tabular-nums">
            {data
              ? data.rows.length === 0
                ? "0 rows"
                : `${formatNumber(tab.page * tab.pageSize + 1)}–${formatNumber(tab.page * tab.pageSize + data.rows.length)} of ${total === null ? "many" : `${data.totalIsEstimate ? "~" : ""}${formatNumber(total)}`}`
              : ""}
          </span>
          {data && (
            <Tooltip label={<span className="max-w-md break-all font-mono">{data.sql}</span>}>
              <button onClick={() => actions.openQuery(connection.id, tab.database, { sql: data.sql.replace(/\$\d+/g, "?"), title: tab.table })} className="tabular-nums text-fg/35 hover:text-fg">
                {formatMs(data.ms)}
              </button>
            </Tooltip>
          )}
          <div className="flex-1" />
          <select
            value={tab.pageSize}
            onChange={(e) => actions.updateTab<TableTab>(tab.id, { pageSize: Number(e.target.value), page: 0 })}
            className="h-6 appearance-none rounded-md bg-transparent px-1.5 text-xs text-fg/50 outline-none hover:bg-surface-hover hover:text-fg"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
          <div className="flex items-center gap-0.5">
            <Button size="icon-xs" variant="ghost" disabled={tab.page === 0} onClick={() => actions.updateTab<TableTab>(tab.id, { page: tab.page - 1 })}>
              <CaretLeft className="size-3.5" />
            </Button>
            <span className="min-w-[64px] text-center tabular-nums">
              {tab.page + 1}
              {pageCount !== null && ` / ${formatNumber(pageCount)}`}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={!data || (pageCount !== null ? tab.page + 1 >= pageCount : data.rows.length < tab.pageSize)}
              onClick={() => actions.updateTab<TableTab>(tab.id, { page: tab.page + 1 })}
            >
              <CaretRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
