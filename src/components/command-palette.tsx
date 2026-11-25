import { Dialog as D } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { connectionColor } from "@/lib/colors";
import { useConnections, useSaved, useSchema } from "@/lib/queries";
import { actions, useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BookmarkSimple, Monitor, Moon, Plus, Pulse, SidebarSimple, Sun } from "./ui/icons";
import { DatabaseIcon, FunctionIcon, KIND_COLOR, QueryIcon, RelationIcon } from "./ui/object-icons";
import { openNewConnection } from "./welcome";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

/** Subsequence match; lower is better, -1 = no match. */
function score(text: string, query: string): number {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return direct === 0 ? 0 : t[direct - 1] === "." || t[direct - 1] === "_" ? 1 : 2 + direct / 100;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    gaps += found - ti;
    ti = found + 1;
  }
  return 10 + gaps;
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const connectionId = useApp((s) => s.connectionId);
  const close = () => useApp.setState({ paletteOpen: false });
  const { data: connections } = useConnections();
  const connection = connections?.find((c) => c.id === connectionId);
  const db = useApp((s) => (connectionId ? s.databases[connectionId] : undefined)) ?? connection?.database;
  const { data: schema } = useSchema(connection?.id ?? null, db);
  const { data: saved } = useSaved();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (connection && db) {
      for (const r of schema?.relations ?? []) {
        out.push({
          id: `rel:${r.schema}.${r.name}`,
          group: "Tables & views",
          label: r.schema === "public" ? r.name : `${r.schema}.${r.name}`,
          hint: r.kind !== "table" ? r.kind : undefined,
          icon: <RelationIcon kind={r.kind} />,
          run: () => actions.openTable(connection.id, db, r.schema, r.name, { preview: false }),
        });
      }
      for (const q of saved ?? []) {
        if (q.connectionId && q.connectionId !== connection.id) continue;
        out.push({ id: `saved:${q.id}`, group: "Saved queries", label: q.name, icon: <BookmarkSimple weight="duotone" className="text-brand" />, run: () => actions.openQuery(connection.id, db, { sql: q.sql, title: q.name, savedId: q.id }) });
      }
      for (const r of schema?.routines ?? []) {
        if (r.kind === "aggregate") continue;
        out.push({ id: `fn:${r.schema}.${r.name}(${r.args})`, group: "Functions", label: `${r.schema === "public" ? "" : r.schema + "."}${r.name}`, hint: `(${r.args})`, icon: <FunctionIcon style={{ color: KIND_COLOR.function }} />, run: () => actions.openRoutine(connection.id, db, r.schema, r.name, r.args) });
      }
      out.push(
        { id: "act:query", group: "Actions", label: "New query", hint: "⌘T", icon: <QueryIcon />, run: () => actions.openQuery(connection.id, db) },
        { id: "act:activity", group: "Actions", label: "Server activity", icon: <Pulse weight="duotone" />, run: () => actions.openActivity(connection.id, db) },
        { id: "act:sidebar", group: "Actions", label: "Toggle sidebar", hint: "⌘\\", icon: <SidebarSimple />, run: () => useApp.setState((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })) },
      );
    }
    out.push(
      { id: "act:light", group: "Actions", label: "Theme: light", icon: <Sun />, run: () => actions.setTheme("light") },
      { id: "act:dark", group: "Actions", label: "Theme: dark", icon: <Moon />, run: () => actions.setTheme("dark") },
      { id: "act:system", group: "Actions", label: "Theme: match system", icon: <Monitor />, run: () => actions.setTheme("system") },
      { id: "act:newconn", group: "Actions", label: "New connection…", icon: <Plus />, run: openNewConnection },
    );
    for (const c of connections ?? []) {
      if (c.id === connection?.id) continue;
      out.push({
        id: `conn:${c.id}`,
        group: "Connections",
        label: `Switch to ${c.name}`,
        hint: c.host,
        icon: <span className="size-2 rounded-full" style={{ background: connectionColor(c.color) }} />,
        run: () => actions.selectConnection(c.id),
      });
    }
    if (connection) {
      out.push({ id: "conn:home", group: "Connections", label: "All connections", icon: <DatabaseIcon />, run: () => actions.selectConnection(null) });
    }
    return out;
  }, [connection, db, schema, saved, connections]);

  const results = useMemo(() => {
    if (!query) return items.filter((i) => i.group !== "Functions").slice(0, 60);
    return items
      .map((item) => ({ item, s: score(item.label, query) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.item.label.length - b.item.label.length)
      .slice(0, 60)
      .map((x) => x.item);
  }, [items, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (item?: Item) => {
    if (!item) return;
    close();
    item.run();
  };

  let lastGroup = "";
  return (
    <D.Root open={open} onOpenChange={(o) => !o && close()}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 z-50 bg-black/30 animate-fade-in dark:bg-black/50" />
        <D.Popup className="fixed inset-x-0 top-[14vh] z-50 mx-auto w-[min(600px,92vw)] origin-top overflow-hidden rounded-2xl bg-elevated shadow-dialog outline-none animate-pop-in">
          <D.Title className="sr-only">Command palette</D.Title>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(results[index]);
              }
            }}
            placeholder="Search…"
            spellCheck={false}
            className="h-14 w-full bg-transparent px-5 text-[15px] outline-none placeholder:text-fg/35"
          />
          <div ref={list} className="thin-scroll max-h-[52vh] overflow-y-auto p-1.5">
            {results.length === 0 && <div className="px-4 py-8 text-center text-sm text-fg/40">No matches</div>}
            {results.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {header && <div className="px-3 pb-1 pt-2.5 text-2xs font-medium text-fg/40">{header}</div>}
                  <button
                    data-index={i}
                    onMouseMove={() => setIndex(i)}
                    onClick={() => choose(item)}
                    className={cn("flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm", i === index ? "bg-surface-hover text-fg" : "text-fg/75")}
                  >
                    <span className="flex size-4 items-center justify-center text-fg/45 [&>svg]:size-4">{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="truncate text-xs text-fg/35">{item.hint}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </D.Popup>
      </D.Portal>
    </D.Root>
  );
}
