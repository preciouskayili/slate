import { useEffect, useState } from "react";
import type { ColumnInfo, Filter, FilterOperator } from "@shared/types";
import { valueKind, type ValueKind } from "@/lib/format";
import { actions, type TableTab } from "@/lib/store";
import { cn, uid } from "@/lib/utils";
import { Button } from "../ui/button";
import { Code, Plus, X } from "../ui/icons";

export const OPERATORS: { op: FilterOperator; label: string; kinds?: ValueKind[]; noValue?: boolean }[] = [
  { op: "eq", label: "=" },
  { op: "neq", label: "≠" },
  { op: "contains", label: "contains", kinds: ["text", "json", "array", "uuid", "enum", "date", "number"] },
  { op: "not_contains", label: "doesn't contain", kinds: ["text", "json", "array", "uuid", "enum"] },
  { op: "starts", label: "starts with", kinds: ["text", "uuid", "enum"] },
  { op: "ends", label: "ends with", kinds: ["text", "uuid", "enum"] },
  { op: "lt", label: "<", kinds: ["number", "date", "text"] },
  { op: "lte", label: "≤", kinds: ["number", "date", "text"] },
  { op: "gt", label: ">", kinds: ["number", "date", "text"] },
  { op: "gte", label: "≥", kinds: ["number", "date", "text"] },
  { op: "in", label: "in list" },
  { op: "not_in", label: "not in list" },
  { op: "regex", label: "matches regex", kinds: ["text", "json", "uuid", "array", "enum"] },
  { op: "true", label: "is true", kinds: ["bool"], noValue: true },
  { op: "false", label: "is false", kinds: ["bool"], noValue: true },
  { op: "null", label: "is null", noValue: true },
  { op: "not_null", label: "is not null", noValue: true },
];

export const opLabel = (op: FilterOperator) => OPERATORS.find((o) => o.op === op)?.label ?? op;

export function defaultOp(kind: ValueKind): FilterOperator {
  return kind === "text" || kind === "json" || kind === "array" ? "contains" : kind === "bool" ? "true" : "eq";
}

export function newFilter(column: ColumnInfo): Filter {
  return { id: uid(), column: column.name, op: defaultOp(valueKind(column.type, column.category)), value: "", enabled: true };
}

export function FilterBar({ tab, columns }: { tab: TableTab; columns: ColumnInfo[] }) {
  const setFilters = (filters: Filter[]) => actions.updateTab<TableTab>(tab.id, { filters, page: 0 });
  const update = (id: string, patch: Partial<Filter>) => setFilters(tab.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const [showWhere, setShowWhere] = useState(Boolean(tab.where));
  const [where, setWhere] = useState(tab.where);
  useEffect(() => setWhere(tab.where), [tab.where]);

  return (
    <div className="border-b border-fg/[0.06] bg-panel px-3 py-2">
      <div className="space-y-1.5">
        {tab.filters.map((f, i) => {
          const column = columns.find((c) => c.name === f.column);
          const kind = column ? valueKind(column.type, column.category) : "text";
          const ops = OPERATORS.filter((o) => !o.kinds || o.kinds.includes(kind) || o.op === f.op);
          const noValue = OPERATORS.find((o) => o.op === f.op)?.noValue;
          return (
            <div key={f.id} className="flex items-center gap-1.5">
              <div className="w-12 shrink-0 text-right text-2xs font-medium text-fg/40">
                {i === 0 ? (
                  "where"
                ) : (
                  <button onClick={() => actions.updateTab<TableTab>(tab.id, { match: tab.match === "all" ? "any" : "all", page: 0 })} className="rounded px-1 hover:bg-surface-hover hover:text-fg">
                    {tab.match === "all" ? "and" : "or"}
                  </button>
                )}
              </div>
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => update(f.id, { enabled: e.target.checked })}
                className="size-3.5 shrink-0 accent-[rgb(var(--accent))]"
                title="Enable filter"
              />
              <select
                value={f.column}
                onChange={(e) => {
                  const col = columns.find((c) => c.name === e.target.value);
                  const nextKind = col ? valueKind(col.type, col.category) : "text";
                  const keepOp = OPERATORS.find((o) => o.op === f.op && (!o.kinds || o.kinds.includes(nextKind)));
                  update(f.id, { column: e.target.value, op: keepOp && f.value ? f.op : defaultOp(nextKind) });
                }}
                className={cn("field h-7 w-44 shrink-0 appearance-none text-xs font-medium", !f.enabled && "opacity-50")}
              >
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select value={f.op} onChange={(e) => update(f.id, { op: e.target.value as FilterOperator })} className={cn("field h-7 w-36 shrink-0 appearance-none text-xs", !f.enabled && "opacity-50")}>
                {ops.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              {!noValue &&
                (column?.enumValues && (f.op === "eq" || f.op === "neq") ? (
                  <select value={f.value} onChange={(e) => update(f.id, { value: e.target.value })} className="field h-7 min-w-0 flex-1 appearance-none text-xs">
                    <option value="">Choose…</option>
                    {column.enumValues.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    autoFocus={!f.value && i === tab.filters.length - 1}
                    value={f.value}
                    onChange={(e) => update(f.id, { value: e.target.value })}
                    placeholder={f.op === "in" || f.op === "not_in" ? "a, b, c" : kind === "date" ? "2026-01-31" : "value"}
                    spellCheck={false}
                    className={cn("field h-7 min-w-0 flex-1 font-mono text-xs", !f.enabled && "opacity-50")}
                  />
                ))}
              {noValue && <div className="flex-1" />}
              <button onClick={() => setFilters(tab.filters.filter((x) => x.id !== f.id))} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-fg/40 hover:bg-surface-hover hover:text-fg">
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
        {showWhere && (
          <div className="flex items-center gap-1.5">
            <div className="w-12 shrink-0 text-right text-2xs font-medium text-fg/40">{tab.filters.length ? "and" : "where"}</div>
            <Code className="size-3.5 shrink-0 text-fg/40" />
            <input
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              onBlur={() => actions.updateTab<TableTab>(tab.id, { where, page: 0 })}
              onKeyDown={(e) => {
                if (e.key === "Enter") actions.updateTab<TableTab>(tab.id, { where, page: 0 });
                if (e.key === "Escape") setWhere(tab.where);
              }}
              placeholder="created_at > now() - interval '7 days'"
              spellCheck={false}
              className="field h-7 min-w-0 flex-1 font-mono text-xs"
            />
            <button
              onClick={() => {
                setShowWhere(false);
                setWhere("");
                actions.updateTab<TableTab>(tab.id, { where: "", page: 0 });
              }}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-fg/40 hover:bg-surface-hover hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className={cn("flex items-center gap-1", (tab.filters.length > 0 || showWhere) && "mt-2 pl-[54px]")}>
        <Button size="xs" variant="ghost" onClick={() => columns[0] && setFilters([...tab.filters, newFilter(columns[0])])}>
          <Plus weight="bold" className="size-3" /> Add filter
        </Button>
        {!showWhere && (
          <Button size="xs" variant="ghost" onClick={() => setShowWhere(true)}>
            <Code className="size-3" /> SQL condition
          </Button>
        )}
        {(tab.filters.length > 0 || tab.where) && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              setShowWhere(false);
              setWhere("");
              actions.updateTab<TableTab>(tab.id, { filters: [], where: "", page: 0 });
            }}
          >
            Clear all
          </Button>
        )}
      </div>
    </div>
  );
}
