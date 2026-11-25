import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Cell } from "@shared/types";
import { isTrue, prettyJson, type ValueKind } from "@/lib/format";
import { cn, mod } from "@/lib/utils";
import type { GridColumn } from "./data-grid";

type Move = "down" | "right" | "left" | "none";

interface Props {
  column: GridColumn;
  kind: ValueKind;
  value: Cell;
  seed?: string;
  width: number;
  height: number;
  /** value === undefined means cancelled. */
  onCommit: (value: Cell | undefined, move: Move) => void;
}

export function CellEditor(props: Props) {
  const { kind, value, column } = props;
  if (kind === "bool" || (kind === "enum" && column.enumValues?.length)) {
    const options = kind === "bool" ? ["true", "false"] : column.enumValues!;
    return <OptionEditor {...props} options={options} current={kind === "bool" ? (value === null ? null : isTrue(value) ? "true" : "false") : value} />;
  }
  const long = kind === "json" || (value?.length ?? 0) > 60 || value?.includes("\n");
  return long && props.seed === undefined ? <TextAreaEditor {...props} /> : <InputEditor {...props} />;
}

function InputEditor({ value, seed, width, height, onCommit, column }: Props) {
  const [text, setText] = useState(seed ?? value ?? "");
  const [isNull, setNull] = useState(value === null && seed === undefined);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.focus();
    if (seed === undefined) el.select();
  }, []);
  const commit = (move: Move, v: Cell | undefined = isNull ? null : text) => {
    if (done.current) return;
    done.current = true;
    onCommit(v, move);
  };
  return (
    <div className="flex items-center rounded-[3px] bg-elevated shadow-pop" style={{ minWidth: width, height }}>
      <input
        ref={ref}
        value={isNull ? "" : text}
        placeholder={isNull ? "NULL" : ""}
        spellCheck={false}
        onChange={(e) => {
          setNull(false);
          setText(e.target.value);
        }}
        onBlur={() => commit("none")}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit("down");
          } else if (e.key === "Tab") {
            e.preventDefault();
            commit(e.shiftKey ? "left" : "right");
          } else if (e.key === "Escape") {
            e.preventDefault();
            commit("none", undefined);
          } else if (mod(e) && e.key === "Backspace" && column.nullable !== false) {
            e.preventDefault();
            commit("none", null);
          }
        }}
        style={{ width: Math.max(width, text.length * 7.4 + 32), height }}
        className="rounded-[3px] bg-transparent px-2.5 text-sm outline outline-2 -outline-offset-1 outline-accent placeholder:italic placeholder:text-fg/30"
      />
    </div>
  );
}

function TextAreaEditor({ value, kind, width, onCommit, column }: Props) {
  const [text, setText] = useState(() => (value === null ? "" : kind === "json" ? prettyJson(value) : value));
  const [isNull, setNull] = useState(value === null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => ref.current?.focus(), []);
  const commit = (v: Cell | undefined) => {
    if (done.current) return;
    if (v !== undefined && v !== null && kind === "json") {
      try {
        JSON.parse(v);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    done.current = true;
    // Keep the original text when the user only re-formatted nothing.
    if (v !== null && v !== undefined && kind === "json" && value !== null && prettyJson(value) === v) v = value;
    onCommit(v, "none");
  };
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.parentElement?.contains(e.target as Node)) commit(isNull ? null : text);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  });
  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-elevated shadow-pop" style={{ width: Math.max(width, 420) }}>
      <textarea
        ref={ref}
        value={isNull ? "" : text}
        placeholder={isNull ? "NULL" : ""}
        spellCheck={false}
        onChange={(e) => {
          setNull(false);
          setError("");
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && mod(e)) {
            e.preventDefault();
            commit(isNull ? null : text);
          } else if (e.key === "Escape") {
            e.preventDefault();
            commit(undefined);
          }
        }}
        rows={Math.min(14, Math.max(5, text.split("\n").length + 1))}
        className="selectable resize-y bg-transparent p-3 font-mono text-xs leading-5 outline-none placeholder:italic placeholder:text-fg/30"
      />
      <div className="flex items-center gap-2 bg-surface px-2.5 py-1.5 text-2xs text-fg/45">
        {error ? <span className="truncate text-danger">{error}</span> : <span>⌘↵ save · esc cancel</span>}
        <div className="ml-auto flex gap-1">
          {kind === "json" && (
            <button onClick={() => setText((t) => prettyJson(t))} className="rounded-md px-1.5 py-0.5 hover:bg-surface-hover hover:text-fg">
              Format
            </button>
          )}
          {column.nullable !== false && (
            <button onClick={() => commit(null)} className="rounded-md px-1.5 py-0.5 hover:bg-surface-hover hover:text-fg">
              Set NULL
            </button>
          )}
          <button onClick={() => commit(isNull ? null : text)} className="rounded-md bg-accent px-2 py-0.5 font-medium text-white hover:bg-accent/90">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionEditor({ width, onCommit, column, options, current }: Props & { options: string[]; current: Cell }) {
  const all: Cell[] = column.nullable === false ? options : [...options, null];
  const [index, setIndex] = useState(Math.max(0, all.indexOf(current)));
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => ref.current?.focus(), []);
  return (
    <div
      ref={ref}
      tabIndex={0}
      onBlur={() => onCommit(undefined, "none")}
      onKeyDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.key === "ArrowDown") setIndex((i) => Math.min(all.length - 1, i + 1));
        else if (e.key === "ArrowUp") setIndex((i) => Math.max(0, i - 1));
        else if (e.key === "Enter") onCommit(all[index], "down");
        else if (e.key === "Escape") onCommit(undefined, "none");
      }}
      className="max-h-64 overflow-y-auto rounded-xl bg-elevated p-1 shadow-pop outline-none"
      style={{ minWidth: Math.max(width, 140) }}
    >
      {all.map((option, i) => (
        <button
          key={String(option)}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onCommit(option, "none")}
          onMouseEnter={() => setIndex(i)}
          className={cn("flex h-7 w-full items-center rounded-lg px-2 text-left text-sm", i === index && "bg-surface-hover", option === current && "font-medium text-accent", option === null && "italic text-fg/40")}
        >
          {option ?? "NULL"}
        </button>
      ))}
    </div>
  );
}
