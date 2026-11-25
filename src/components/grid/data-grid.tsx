import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Cell, ForeignKey, Sort } from "@shared/types";
import { displayValue, estimateWidth, isTrue, toTsv, valueKind, type ValueKind } from "@/lib/format";
import { cn, copyText, mod } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpRight, Key, LinkSimple } from "../ui/icons";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../ui/menu";
import { CellEditor } from "./cell-editor";

export interface GridColumn {
  name: string;
  type: string;
  category?: string;
  isPrimaryKey?: boolean;
  fk?: ForeignKey;
  nullable?: boolean;
  enumValues?: string[] | null;
  readOnly?: boolean;
  comment?: string | null;
}

export interface GridRow {
  key: string;
  cells: Cell[];
  status?: "new" | "deleted";
  /** Column indexes with unsaved edits. */
  dirty?: Set<number>;
}

export interface Range {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface GridContext {
  row: number;
  col: number;
  range: Range;
  /** Row indexes covered by the selection. */
  rows: number[];
}

interface Props {
  columns: GridColumn[];
  rows: GridRow[];
  storageKey: string;
  rowNumberOffset?: number;
  sort?: Sort[];
  onSort?: (column: string, additive: boolean) => void;
  editable?: boolean;
  onEdit?: (row: number, col: number, value: Cell) => void;
  onDeleteRows?: (rows: number[]) => void;
  onFollowFk?: (column: GridColumn, value: string) => void;
  onActiveRowChange?: (row: number | null) => void;
  onToggleInspector?: () => void;
  renderCellMenu?: (ctx: GridContext) => React.ReactNode;
  renderHeaderMenu?: (column: GridColumn, index: number) => React.ReactNode;
  emptyState?: React.ReactNode;
}

const ROW_H = 30;
const HEAD_H = 34;

const widthCache = new Map<string, Record<string, number>>();
const scrollCache = new Map<string, { top: number; left: number }>();

const norm = (r: Range): Range => ({
  r1: Math.min(r.r1, r.r2),
  r2: Math.max(r.r1, r.r2),
  c1: Math.min(r.c1, r.c2),
  c2: Math.max(r.c1, r.c2),
});

export function DataGrid({
  columns,
  rows,
  storageKey,
  rowNumberOffset = 0,
  sort = [],
  onSort,
  editable,
  onEdit,
  onDeleteRows,
  onFollowFk,
  onActiveRowChange,
  onToggleInspector,
  renderCellMenu,
  renderHeaderMenu,
  emptyState,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const kinds = useMemo(() => columns.map((c) => valueKind(c.type, c.category)), [columns]);

  // Column widths: estimated from the first rows, remembered per tab.
  const [widths, setWidths] = useState<Record<string, number>>(() => widthCache.get(storageKey) ?? {});
  useEffect(() => {
    setWidths((current) => {
      const next = { ...current };
      let changed = false;
      columns.forEach((c, i) => {
        if (next[c.name] === undefined) {
          next[c.name] = estimateWidth(c.name, rows.slice(0, 60).map((r) => r.cells[i]), kinds[i]);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [columns, rows, kinds]);
  useEffect(() => {
    widthCache.set(storageKey, widths);
  }, [storageKey, widths]);

  const colWidths = columns.map((c) => widths[c.name] ?? 140);
  const gutter = Math.max(44, String(rowNumberOffset + rows.length).length * 7.5 + 22);
  const offsets = useMemo(() => {
    const out: number[] = [];
    let x = gutter;
    for (const w of colWidths) {
      out.push(x);
      x += w;
    }
    out.push(x);
    return out;
  }, [colWidths.join(","), gutter]);
  const totalWidth = offsets[offsets.length - 1];

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 14,
    paddingStart: HEAD_H,
  });

  // Selection
  const [range, setRange] = useState<Range | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: number; seed?: string } | null>(null);
  const cursor = range ? { row: range.r2, col: range.c2 } : null;
  const anchorRef = useRef<{ row: number; col: number } | null>(null);
  const selection = range ? norm(range) : null;
  const fullRows = Boolean(selection && selection.c1 === 0 && selection.c2 === columns.length - 1 && columns.length > 0);

  useEffect(() => {
    onActiveRowChange?.(cursor ? cursor.row : null);
  }, [cursor?.row]);

  // Clamp selection when data changes.
  useEffect(() => {
    if (range && (range.r1 >= rows.length || range.r2 >= rows.length || range.c2 >= columns.length)) {
      setRange(rows.length && columns.length ? { r1: 0, c1: 0, r2: 0, c2: 0 } : null);
      setEditing(null);
    }
  }, [rows.length, columns.length]);

  // Restore scroll per tab.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const saved = scrollCache.get(storageKey);
    if (el && saved) {
      el.scrollTop = saved.top;
      el.scrollLeft = saved.left;
    }
    return () => {
      if (el) scrollCache.set(storageKey, { top: el.scrollTop, left: el.scrollLeft });
    };
  }, [storageKey]);

  const scrollIntoView = useCallback(
    (row: number, col: number) => {
      const el = scrollRef.current;
      if (!el) return;
      virtualizer.scrollToIndex(row, { align: "auto" });
      const left = offsets[col] - gutter;
      const right = offsets[col + 1];
      if (left < el.scrollLeft) el.scrollLeft = left;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    },
    [offsets, gutter, virtualizer],
  );

  const select = (row: number, col: number, extend = false) => {
    row = Math.max(0, Math.min(rows.length - 1, row));
    col = Math.max(0, Math.min(columns.length - 1, col));
    if (extend && anchorRef.current) setRange({ r1: anchorRef.current.row, c1: anchorRef.current.col, r2: row, c2: col });
    else {
      anchorRef.current = { row, col };
      setRange({ r1: row, c1: col, r2: row, c2: col });
    }
    scrollIntoView(row, col);
  };

  const canEditCell = (row: number, col: number) =>
    Boolean(editable && onEdit && !columns[col]?.readOnly && rows[row] && rows[row].status !== "deleted");

  const startEdit = (row: number, col: number, seed?: string) => {
    if (!canEditCell(row, col)) return;
    scrollIntoView(row, col);
    setEditing({ row, col, seed });
  };

  const copySelection = () => {
    if (!selection) return;
    const out: Cell[][] = [];
    for (let r = selection.r1; r <= selection.r2; r++) out.push(rows[r].cells.slice(selection.c1, selection.c2 + 1));
    const header = fullRows ? columns.map((c) => c.name) : undefined;
    copyText(out.length === 1 && out[0].length === 1 ? (out[0][0] ?? "") : toTsv(out, header));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || !rows.length || !columns.length) return;
    const cur = cursor ?? { row: 0, col: 0 };
    const extend = e.shiftKey;
    const jump = mod(e);
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 300) / ROW_H) - 2);
    const handlers: Record<string, () => void> = {
      ArrowDown: () => select(jump ? rows.length - 1 : cur.row + 1, cur.col, extend),
      ArrowUp: () => select(jump ? 0 : cur.row - 1, cur.col, extend),
      ArrowRight: () => select(cur.row, jump ? columns.length - 1 : cur.col + 1, extend),
      ArrowLeft: () => select(cur.row, jump ? 0 : cur.col - 1, extend),
      PageDown: () => select(cur.row + page, cur.col, extend),
      PageUp: () => select(cur.row - page, cur.col, extend),
      Home: () => select(jump ? 0 : cur.row, 0, extend),
      End: () => select(jump ? rows.length - 1 : cur.row, columns.length - 1, extend),
      Tab: () => select(cur.row, cur.col + (e.shiftKey ? -1 : 1)),
      Enter: () => (cursor ? startEdit(cur.row, cur.col) : select(0, 0)),
      F2: () => startEdit(cur.row, cur.col),
      Escape: () => cursor && select(cur.row, cur.col),
      " ": () => onToggleInspector?.(),
    };
    if (jump && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copySelection();
      return;
    }
    if (jump && e.key.toLowerCase() === "a") {
      e.preventDefault();
      anchorRef.current = { row: 0, col: 0 };
      setRange({ r1: 0, c1: 0, r2: rows.length - 1, c2: columns.length - 1 });
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && editable && onDeleteRows && selection && fullRows) {
      e.preventDefault();
      onDeleteRows(Array.from({ length: selection.r2 - selection.r1 + 1 }, (_, i) => selection.r1 + i));
      return;
    }
    const handler = handlers[e.key];
    if (handler) {
      e.preventDefault();
      handler();
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && cursor && canEditCell(cur.row, cur.col)) {
      const kind = kinds[cur.col];
      if (kind !== "bool" && kind !== "enum") {
        e.preventDefault();
        startEdit(cur.row, cur.col, e.key);
      }
    }
  };

  // Mouse drag selection
  const dragging = useRef(false);
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const onCellPointerDown = (e: React.PointerEvent, row: number, col: number) => {
    if (e.button !== 0) return;
    scrollRef.current?.focus({ preventScroll: true });
    if (editing) setEditing(null);
    if (col < 0) {
      // Gutter: whole-row selection
      if (e.shiftKey && anchorRef.current) setRange({ r1: anchorRef.current.row, c1: 0, r2: row, c2: columns.length - 1 });
      else {
        anchorRef.current = { row, col: 0 };
        setRange({ r1: row, c1: 0, r2: row, c2: columns.length - 1 });
      }
      dragging.current = true;
      return;
    }
    select(row, col, e.shiftKey);
    dragging.current = true;
  };

  const onCellPointerEnter = (row: number, col: number) => {
    if (!dragging.current || !anchorRef.current) return;
    if (col < 0) setRange((r) => (r ? { ...r, r2: row } : r));
    else setRange({ r1: anchorRef.current.row, c1: anchorRef.current.col, r2: row, c2: col });
  };

  const [menuCtx, setMenuCtx] = useState<GridContext | null>(null);
  const onContextMenu = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!target || !renderCellMenu) {
      setMenuCtx(null);
      return;
    }
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    let current = selection;
    const inside = current && row >= current.r1 && row <= current.r2 && (col < 0 || (col >= current.c1 && col <= current.c2));
    if (!inside) {
      current = col < 0 ? { r1: row, c1: 0, r2: row, c2: columns.length - 1 } : { r1: row, c1: col, r2: row, c2: col };
      anchorRef.current = { row, col: Math.max(col, 0) };
      setRange(current);
    }
    const r = current!;
    setMenuCtx({ row, col: Math.max(col, r.c1), range: r, rows: Array.from({ length: r.r2 - r.r1 + 1 }, (_, i) => r.r1 + i) });
  };

  // Column resize
  const startResize = (e: React.PointerEvent, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[name] ?? 140;
    const move = (ev: PointerEvent) => setWidths((w) => ({ ...w, [name]: Math.max(48, startW + ev.clientX - startX) }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const autoSize = (index: number) => {
    const c = columns[index];
    const sample = rows.slice(0, 300).map((r) => r.cells[index]);
    setWidths((w) => ({ ...w, [c.name]: Math.max(estimateWidth(c.name, sample, kinds[index]), 60) }));
  };

  const items = virtualizer.getVirtualItems();
  const editRow = editing ? rows[editing.row] : undefined;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            ref={scrollRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onContextMenu={onContextMenu}
            className="relative min-h-0 flex-1 overflow-auto outline-none"
          />
        }
      >
        <div style={{ width: totalWidth, height: virtualizer.getTotalSize() }} className="relative">
          {/* Header */}
          <div className="sticky top-0 z-20 flex bg-canvas" style={{ height: HEAD_H, width: totalWidth }}>
            <div className="sticky left-0 z-10 shrink-0 bg-canvas grid-cell" style={{ width: gutter }} />
            {columns.map((c, i) => (
              <HeaderCell
                key={c.name + i}
                column={c}
                index={i}
                width={colWidths[i]}
                kind={kinds[i]}
                sort={sort}
                onSort={onSort}
                onResize={startResize}
                onAutoSize={autoSize}
                selected={Boolean(selection && i >= selection.c1 && i <= selection.c2)}
                onSelectColumn={(extend) => {
                  if (!rows.length) return;
                  if (extend && anchorRef.current) setRange({ r1: 0, c1: anchorRef.current.col, r2: rows.length - 1, c2: i });
                  else {
                    anchorRef.current = { row: 0, col: i };
                    setRange({ r1: 0, c1: i, r2: rows.length - 1, c2: i });
                  }
                  scrollRef.current?.focus({ preventScroll: true });
                }}
                menu={renderHeaderMenu?.(c, i)}
              />
            ))}
          </div>

          {items.map((item) => {
            const row = rows[item.index];
            const inRange = selection && item.index >= selection.r1 && item.index <= selection.r2;
            return (
              <GridRowView
                key={row.key}
                row={row}
                index={item.index}
                top={item.start}
                number={rowNumberOffset + item.index + 1}
                gutter={gutter}
                widths={colWidths}
                kinds={kinds}
                columns={columns}
                selCols={inRange ? `${selection!.c1}:${selection!.c2}` : ""}
                cursorCol={cursor && cursor.row === item.index ? cursor.col : -1}
                rowSelected={Boolean(inRange && fullRows)}
                onPointerDown={onCellPointerDown}
                onPointerEnter={onCellPointerEnter}
                onDoubleClick={(r, c) => startEdit(r, c)}
                onFollowFk={onFollowFk}
              />
            );
          })}

          {editing && editRow && (
            <div className="absolute z-30" style={{ top: HEAD_H + editing.row * ROW_H, left: offsets[editing.col] }}>
              <CellEditor
                key={`${editing.row}:${editing.col}`}
                column={columns[editing.col]}
                kind={kinds[editing.col]}
                value={editRow.cells[editing.col]}
                seed={editing.seed}
                width={colWidths[editing.col]}
                height={ROW_H}
                onCommit={(value, move) => {
                  if (value !== undefined && value !== editRow.cells[editing.col]) onEdit?.(editing.row, editing.col, value);
                  setEditing(null);
                  scrollRef.current?.focus({ preventScroll: true });
                  if (move === "down") select(editing.row + 1, editing.col);
                  else if (move === "right") select(editing.row, editing.col + 1);
                  else if (move === "left") select(editing.row, editing.col - 1);
                }}
              />
            </div>
          )}
        </div>
        {rows.length === 0 && emptyState && <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[34px]">{emptyState}</div>}
      </ContextMenuTrigger>
      {renderCellMenu && menuCtx && <ContextMenuContent>{renderCellMenu(menuCtx)}</ContextMenuContent>}
    </ContextMenu>
  );
}

const HeaderCell = memo(function HeaderCell({
  column,
  index,
  width,
  kind,
  sort,
  onSort,
  onResize,
  onAutoSize,
  selected,
  onSelectColumn,
  menu,
}: {
  column: GridColumn;
  index: number;
  width: number;
  kind: ValueKind;
  sort: Sort[];
  onSort?: (column: string, additive: boolean) => void;
  onResize: (e: React.PointerEvent, name: string) => void;
  onAutoSize: (index: number) => void;
  selected: boolean;
  onSelectColumn: (extend: boolean) => void;
  menu?: React.ReactNode;
}) {
  const sortIndex = sort.findIndex((s) => s.column === column.name);
  const dir = sortIndex >= 0 ? sort[sortIndex].dir : null;
  const content = (
    <div
      onClick={(e) => (onSort ? onSort(column.name, e.shiftKey) : onSelectColumn(e.shiftKey))}
      title={[column.name, column.type, column.comment].filter(Boolean).join(" · ")}
      className={cn(
        "group relative flex h-full shrink-0 cursor-default items-center gap-1.5 px-2.5 grid-cell",
        kind === "number" && "flex-row-reverse text-right",
        selected ? "bg-accent/[0.07]" : "hover:bg-fg/[0.03]",
      )}
      style={{ width }}
    >
      <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", kind === "number" && "flex-row-reverse")}>
        {column.isPrimaryKey && <Key weight="fill" className="size-3 shrink-0 text-warn/80" />}
        {column.fk && <LinkSimple className="size-3 shrink-0 text-accent/80" />}
        <span className="truncate text-xs font-semibold text-fg/80">{column.name}</span>
        <span className="hidden truncate font-mono text-[10px] text-fg/30 group-hover:inline">{shortType(column.type)}</span>
      </div>
      {dir && (
        <span className="flex shrink-0 items-center text-accent">
          {dir === "asc" ? <ArrowUp weight="bold" className="size-3" /> : <ArrowDown weight="bold" className="size-3" />}
          {sort.length > 1 && <span className="text-[9px] font-semibold">{sortIndex + 1}</span>}
        </span>
      )}
      <div
        onPointerDown={(e) => onResize(e, column.name)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onAutoSize(index);
        }}
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/40"
      />
    </div>
  );
  if (!menu) return content;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={content} />
      <ContextMenuContent>{menu}</ContextMenuContent>
    </ContextMenu>
  );
});

function shortType(type: string) {
  return type
    .replace("timestamp with time zone", "timestamptz")
    .replace("timestamp without time zone", "timestamp")
    .replace("character varying", "varchar")
    .replace("double precision", "float8");
}

const GridRowView = memo(function GridRowView({
  row,
  index,
  top,
  number,
  gutter,
  widths,
  kinds,
  columns,
  selCols,
  cursorCol,
  rowSelected,
  onPointerDown,
  onPointerEnter,
  onDoubleClick,
  onFollowFk,
}: {
  row: GridRow;
  index: number;
  top: number;
  number: number;
  gutter: number;
  widths: number[];
  kinds: ValueKind[];
  columns: GridColumn[];
  selCols: string;
  cursorCol: number;
  rowSelected: boolean;
  onPointerDown: (e: React.PointerEvent, row: number, col: number) => void;
  onPointerEnter: (row: number, col: number) => void;
  onDoubleClick: (row: number, col: number) => void;
  onFollowFk?: (column: GridColumn, value: string) => void;
}) {
  const [c1, c2] = selCols ? selCols.split(":").map(Number) : [-1, -2];
  const deleted = row.status === "deleted";
  return (
    <div
      className={cn(
        "group/row absolute left-0 flex",
        row.status === "new" && "bg-ok/[0.06]",
        deleted && "bg-danger/[0.07]",
      )}
      style={{ top, height: ROW_H }}
    >
      <div
        data-cell
        data-row={index}
        data-col={-1}
        onPointerDown={(e) => onPointerDown(e, index, -1)}
        onPointerEnter={() => onPointerEnter(index, -1)}
        className={cn(
          "sticky left-0 z-10 flex shrink-0 items-center justify-end pr-2.5 text-2xs tabular-nums grid-cell",
          rowSelected ? "bg-accent/15 text-accent" : "bg-canvas text-fg/30 group-hover/row:text-fg/50",
          row.status === "new" && !rowSelected && "text-ok",
          deleted && !rowSelected && "text-danger",
        )}
        style={{ width: gutter }}
      >
        {row.status === "new" ? "+" : deleted ? "−" : number}
      </div>
      {row.cells.map((value, col) => {
        const selected = col >= c1 && col <= c2;
        const kind = kinds[col];
        const column = columns[col];
        return (
          <div
            key={col}
            data-cell
            data-row={index}
            data-col={col}
            onPointerDown={(e) => onPointerDown(e, index, col)}
            onPointerEnter={() => onPointerEnter(index, col)}
            onDoubleClick={() => onDoubleClick(index, col)}
            className={cn(
              "group/cell relative flex shrink-0 items-center overflow-hidden px-2.5 text-sm grid-cell",
              selected && "bg-accent/[0.1]",
              row.dirty?.has(col) && "bg-warn/[0.14]",
              cursorCol === col && "z-[1] outline outline-[1.5px] -outline-offset-[1.5px] outline-accent",
              deleted && "text-fg/40 line-through",
              kind === "number" && "justify-end",
            )}
            style={{ width: widths[col] }}
          >
            {row.status === "new" && !row.dirty?.has(col) ? <span className="text-xs italic text-fg/25">default</span> : <CellValue value={value} kind={kind} />}
            {column.fk && value !== null && onFollowFk && !deleted && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onFollowFk(column, value)}
                title={`Open ${column.fk.refTable} where ${column.fk.refColumns[0]} = ${value}`}
                className="absolute right-1 hidden size-5 items-center justify-center rounded-md bg-elevated text-accent shadow-[0_1px_3px_rgb(0_0_0/0.18)] hover:bg-accent hover:text-white group-hover/cell:flex"
              >
                <ArrowUpRight weight="bold" className="size-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});

export function CellValue({ value: raw, kind }: { value: Cell; kind: ValueKind }) {
  if (raw === null) return <span className="text-xs italic text-fg/25">NULL</span>;
  // Cells are one line wide; never hand the DOM a multi-megabyte string.
  const value = raw.length > 400 ? raw.slice(0, 400) + "…" : raw;
  switch (kind) {
    case "bool": {
      const on = isTrue(value);
      return (
        <span className={cn("flex size-[15px] items-center justify-center rounded-[4px] text-[10px] font-bold", on ? "bg-accent text-white" : "bg-surface-strong")}>
          {on ? "✓" : ""}
        </span>
      );
    }
    case "number":
      return <span className="truncate font-mono text-[12px] tabular-nums">{value}</span>;
    case "json":
      return <span className="truncate font-mono text-[11.5px] text-fg/70">{displayValue(value, kind)}</span>;
    case "uuid":
    case "bytes":
      return <span className="truncate font-mono text-[11.5px] text-fg/65">{value}</span>;
    case "date":
      return <span className="truncate font-mono text-[11.5px] tabular-nums text-fg/75">{value}</span>;
    case "array":
      return <span className="truncate font-mono text-[11.5px] text-fg/75">{value}</span>;
    case "enum":
      return <span className="truncate rounded-md bg-surface-hover px-1.5 py-px text-xs text-fg/80">{value}</span>;
    default:
      return <span className="truncate">{displayValue(value, kind)}</span>;
  }
}
