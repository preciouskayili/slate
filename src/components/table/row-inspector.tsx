import { useEffect, useRef, useState } from "react";
import type { Cell, ColumnInfo, TableDetails } from "@shared/types";
import { isTrue, prettyJson, valueKind } from "@/lib/format";
import { actions } from "@/lib/store";
import { cn, copyText, mod, uid } from "@/lib/utils";
import type { GridRow } from "../grid/data-grid";
import { ArrowUpRight, Copy, Key, LinkSimple, X } from "../ui/icons";
import { Empty } from "../ui/misc";

interface Props {
  details: TableDetails;
  connectionId: string;
  database: string;
  row?: GridRow;
  columns: ColumnInfo[];
  editable: boolean;
  onEdit: (column: string, value: Cell) => void;
  onClose: () => void;
}

export function RowInspector({ details, connectionId, database, row, columns, editable, onEdit, onClose }: Props) {
  const valueOf = (name: string) => {
    const i = columns.findIndex((c) => c.name === name);
    return i >= 0 && row ? row.cells[i] : undefined;
  };
  const fkFor = (name: string) => details.foreignKeys.find((fk) => fk.columns.length === 1 && fk.columns[0] === name);

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-fg/[0.06] bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-fg/[0.06] pl-3.5 pr-2">
        <span className="text-xs font-medium text-fg/70">Row</span>
        {row?.status === "new" && <span className="rounded bg-ok/15 px-1.5 text-2xs font-medium text-ok">new</span>}
        {row?.status === "deleted" && <span className="rounded bg-danger/15 px-1.5 text-2xs font-medium text-danger">deleted</span>}
        <div className="flex-1" />
        {row && (
          <button
            title="Copy row as JSON"
            onClick={() => copyText(JSON.stringify(Object.fromEntries(columns.map((c, i) => [c.name, row.cells[i]])), null, 2))}
            className="flex size-6 items-center justify-center rounded-md text-fg/45 hover:bg-surface-hover hover:text-fg"
          >
            <Copy className="size-3.5" />
          </button>
        )}
        <button onClick={onClose} className="flex size-6 items-center justify-center rounded-md text-fg/45 hover:bg-surface-hover hover:text-fg">
          <X className="size-3.5" />
        </button>
      </div>
      {!row ? (
        <Empty title="No row selected" />
      ) : (
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          <div className="space-y-3.5">
            {columns.map((c, i) => {
              const fk = fkFor(c.name);
              const value = row.cells[i];
              return (
                <div key={c.name}>
                  <div className="mb-1 flex items-center gap-1.5">
                    {c.isPrimaryKey && <Key weight="fill" className="size-3 text-warn/80" />}
                    {fk && <LinkSimple className="size-3 text-accent/80" />}
                    <span className="truncate text-xs font-medium text-fg/75" title={c.comment ?? undefined}>
                      {c.name}
                    </span>
                    <span className="truncate font-mono text-[10px] text-fg/30">{c.type}</span>
                    {row.dirty?.has(i) && <span className="size-1.5 shrink-0 rounded-full bg-warn" />}
                    {fk && value !== null && (
                      <button
                        onClick={() =>
                          actions.openTable(connectionId, database, fk.refSchema, fk.refTable, {
                            newTab: true,
                            filters: [{ id: uid(), column: fk.refColumns[0], op: "eq", value, enabled: true }],
                          })
                        }
                        className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md px-1 text-2xs text-accent hover:bg-accent/10"
                      >
                        {fk.refTable} <ArrowUpRight className="size-2.5" />
                      </button>
                    )}
                  </div>
                  <FieldValue column={c} value={value} editable={editable && !c.generated && c.identity !== "always"} onCommit={(v) => onEdit(c.name, v)} />
                </div>
              );
            })}
          </div>

          {details.referencedBy.length > 0 && (
            <div className="mt-6 border-t border-fg/[0.06] pt-4">
              <div className="section-label mb-2">Referenced by</div>
              <div className="space-y-1">
                {details.referencedBy
                  .filter((ref) => ref.columns.length === 1)
                  .map((ref) => {
                    const value = valueOf(ref.refColumns[0]);
                    return (
                      <button
                        key={ref.name}
                        disabled={value === undefined || value === null || row.status === "new"}
                        onClick={() =>
                          actions.openTable(connectionId, database, ref.schema, ref.table, {
                            newTab: true,
                            filters: [{ id: uid(), column: ref.columns[0], op: "eq", value: value!, enabled: true }],
                          })
                        }
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-hover disabled:opacity-40"
                      >
                        <span className="truncate font-medium">{ref.table}</span>
                        <span className="truncate text-fg/40">.{ref.columns[0]}</span>
                        <ArrowUpRight className="ml-auto size-3 shrink-0 text-fg/40" />
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function FieldValue({ column, value, editable, onCommit }: { column: ColumnInfo; value: Cell; editable: boolean; onCommit: (v: Cell) => void }) {
  const kind = valueKind(column.type, column.category);
  const display = value === null ? "" : kind === "json" ? prettyJson(value) : value;
  const [text, setText] = useState(display);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(display), [display]);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 320) + "px";
    }
  }, [text]);

  if (kind === "bool" && editable) {
    const options: { label: string; v: Cell }[] = [
      { label: "true", v: "true" },
      { label: "false", v: "false" },
      ...(column.nullable ? [{ label: "NULL", v: null }] : []),
    ];
    const current = value === null ? null : isTrue(value) ? "true" : "false";
    return (
      <div className="inline-flex rounded-lg bg-surface-hover p-0.5">
        {options.map((o) => (
          <button
            key={o.label}
            onClick={() => o.v !== current && onCommit(o.v)}
            className={cn("h-6 rounded-md px-2.5 text-xs", o.v === current ? "bg-canvas font-medium shadow-sm dark:bg-surface-strong" : "text-fg/50 hover:text-fg", o.v === null && "italic")}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  if (column.enumValues && editable) {
    return (
      <select value={value ?? "\u0000"} onChange={(e) => onCommit(e.target.value === "\u0000" ? null : e.target.value)} className="field h-7 appearance-none text-xs">
        {column.nullable && <option value={"\u0000"}>NULL</option>}
        {column.enumValues.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    );
  }

  if (!editable) {
    return (
      <div className={cn("selectable min-h-7 whitespace-pre-wrap break-words rounded-lg bg-surface px-2.5 py-1.5 font-mono text-xs leading-5", value === null && "italic text-fg/30")}>
        {value === null ? "NULL" : display}
      </div>
    );
  }

  const commit = () => {
    if (text === display) return;
    let v = text;
    if (kind === "json" && value !== null && prettyJson(value) === text) v = value;
    onCommit(v);
  };

  return (
    <div className="group relative">
      <textarea
        ref={ref}
        value={text}
        rows={1}
        spellCheck={false}
        placeholder={value === null ? "NULL" : ""}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (mod(e) || (!e.shiftKey && kind !== "json" && kind !== "text"))) {
            e.preventDefault();
            commit();
            (e.target as HTMLTextAreaElement).blur();
          }
          if (e.key === "Escape") {
            setText(display);
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        className="selectable block w-full resize-none rounded-lg bg-surface px-2.5 py-1.5 font-mono text-xs leading-5 outline-none ring-inset placeholder:italic placeholder:text-fg/30 focus:bg-canvas focus:ring-2 focus:ring-accent/50"
      />
      {column.nullable && value !== null && (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onCommit(null)}
          className="absolute right-1.5 top-1.5 hidden rounded-md bg-surface-hover px-1.5 text-[10px] font-medium text-fg/55 hover:text-fg group-hover:block"
        >
          NULL
        </button>
      )}
    </div>
  );
}
