import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { format as formatSql } from "sql-formatter";
import type { Connection, QueryResponse, SavedQuery } from "@shared/types";
import { leadingKeyword, splitStatements } from "@shared/sql";
import { api, errorMessage } from "@/lib/api";
import { toCsv, toJson, toMarkdown, toTsv } from "@/lib/format";
import { queryClient, refreshSchema, useSchema } from "@/lib/queries";
import { actions, useApp, type QueryRun, type QueryTab } from "@/lib/store";
import { cn, copyText, download, formatMs, formatNumber, uid } from "@/lib/utils";
import { DataGrid, type GridContext, type GridRow } from "../grid/data-grid";
import { promptText } from "../prompt-dialog";
import { Button } from "../ui/button";
import {
  ArrowCounterClockwise,
  BookmarkSimple,
  CaretDown,
  Check,
  Copy,
  DownloadSimple,
  Lightning,
  Play,
  Stop,
  TextAlignLeft,
  WarningCircle,
} from "../ui/icons";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, SubMenu } from "../ui/menu";
import { Kbd, Spinner } from "../ui/misc";
import { toast } from "../ui/toast";
import { Tooltip } from "../ui/tooltip";
import { buildNamespace, SqlEditor, type RunRequest, type SqlEditorHandle } from "./sql-editor";

const SCHEMA_CHANGING = new Set(["CREATE", "ALTER", "DROP", "TRUNCATE", "COMMENT", "RENAME", "REFRESH", "IMPORT"]);
const READS = new Set(["SELECT", "WITH", "VALUES", "TABLE", "SHOW", "EXPLAIN"]);

export function QueryView({ tab, connection }: { tab: QueryTab; connection: Connection }) {
  const editor = useRef<SqlEditorHandle>(null);
  const run = useApp((s) => s.runs[tab.id]);
  const tx = useApp((s) => s.txStatus[tab.id]) ?? "I";
  const { data: schema } = useSchema(connection.id, tab.database);
  const namespace = useMemo(() => buildNamespace(schema?.columns), [schema?.columns]);
  const container = useRef<HTMLDivElement>(null);

  const execute = async (req: RunRequest, explain?: "plain" | "analyze") => {
    if (useApp.getState().runs[tab.id]?.status === "running") return;
    let sql = req.text.trim().replace(/;\s*$/, "");
    if (!sql) return;
    if (explain) {
      const stmt = splitStatements(sql)[0]?.text ?? sql;
      const writes = !READS.has(leadingKeyword(stmt));
      if (explain === "analyze") {
        if (writes && tx !== "I") {
          toast.error("Commit or roll back first", "EXPLAIN ANALYZE runs the statement.");
          return;
        }
        sql = writes ? `BEGIN;\nEXPLAIN (ANALYZE, BUFFERS) ${stmt};\nROLLBACK` : `EXPLAIN (ANALYZE, BUFFERS) ${stmt}`;
      } else sql = `EXPLAIN ${stmt}`;
    }
    editor.current?.showError(undefined);
    const queryId = uid();
    actions.setRun(tab.id, { status: "running", queryId, startedAt: Date.now(), results: [], notices: [], sql, offset: req.offset, activeResult: 0, explain: Boolean(explain) });
    try {
      const res = await api.post<QueryResponse & { txStatus: "I" | "T" | "E"; error?: QueryRun["error"] }>(`/api/c/${connection.id}/query`, {
        sql,
        database: tab.database,
        queryId,
        sessionId: tab.id,
      });
      actions.setTx(tab.id, res.txStatus);
      const results = explain ? res.results.filter((r) => r.fields.length) : res.results;
      const lastWithRows = results.reduce((best, r, i) => (r.fields.length ? i : best), -1);
      actions.setRun(tab.id, (prev) => ({
        ...prev!,
        status: res.error ? "error" : "done",
        results,
        notices: res.notices,
        ms: res.ms,
        error: res.error,
        activeResult: res.error ? -1 : lastWithRows,
      }));
      if (res.error && !explain && res.error.position !== undefined) editor.current?.showError(req.offset + res.error.position);
      if (!explain && splitStatements(sql).some((s) => SCHEMA_CHANGING.has(leadingKeyword(s.text)))) refreshSchema(connection.id);
      else if (!explain && splitStatements(sql).some((s) => !READS.has(leadingKeyword(s.text)))) queryClient.invalidateQueries({ queryKey: ["rows", connection.id] });
      queryClient.invalidateQueries({ queryKey: ["history"] });
      editor.current?.focus();
    } catch (e) {
      actions.setRun(tab.id, (prev) => ({ ...prev!, status: "error", error: { error: errorMessage(e) }, activeResult: -1, ms: Date.now() - (prev?.startedAt ?? Date.now()) }));
    }
  };

  const cancel = () => run?.status === "running" && api.post(`/api/c/${connection.id}/cancel`, { queryId: run.queryId }).catch(() => undefined);

  const save = useMutation({
    mutationFn: async () => {
      let name = tab.savedId ? tab.title : null;
      if (!name) {
        name = await promptText({ title: "Save query", initial: tab.title.startsWith("Query") ? "" : tab.title, placeholder: "Monthly active users", confirmLabel: "Save" });
        if (!name?.trim()) return null;
      }
      return api.post<SavedQuery>("/api/saved", { id: tab.savedId, connectionId: connection.id, name: name.trim(), sql: tab.sql });
    },
    onSuccess: (saved) => {
      if (!saved) return;
      actions.updateTab<QueryTab>(tab.id, { savedId: saved.id, savedSql: saved.sql, title: saved.name });
      queryClient.invalidateQueries({ queryKey: ["saved"] });
      toast(tab.savedId ? "Query saved" : `Saved “${saved.name}”`);
    },
    onError: (e) => toast.error("Couldn't save query", errorMessage(e)),
  });

  const format = () => {
    try {
      const formatted = formatSql(tab.sql, { language: "postgresql", keywordCase: "upper", tabWidth: 2, linesBetweenQueries: 1 });
      editor.current?.setValue(formatted);
    } catch (e) {
      toast.error("Couldn't format", errorMessage(e));
    }
  };

  const txAction = (sql: "COMMIT" | "ROLLBACK") => execute({ text: sql, offset: 0, all: true });

  const running = run?.status === "running";
  const dirtySaved = tab.savedId && tab.sql !== tab.savedSql;

  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = container.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => actions.updateTab<QueryTab>(tab.id, { split: Math.min(0.85, Math.max(0.12, (ev.clientY - rect.top) / rect.height)) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "row-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-fg/[0.06] px-3">
        {running ? (
          <Button size="sm" variant="danger" onClick={cancel}>
            <Stop weight="fill" className="size-3.5" /> Cancel
          </Button>
        ) : (
          <div className="flex">
            <Button size="sm" variant="primary" className="rounded-r-none pr-2" onClick={() => editor.current?.target() && execute(editor.current.target()!)}>
              <Play weight="fill" className="size-3" /> Run <span className="opacity-50">⌘↵</span>
            </Button>
            <Menu>
              <MenuTrigger className="flex h-7 items-center rounded-r-lg border-l border-canvas/20 bg-fg px-1.5 text-canvas hover:bg-fg/90">
                <CaretDown weight="bold" className="size-3" />
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Play />} shortcut="⌘↵" onClick={() => editor.current?.target() && execute(editor.current.target()!)}>
                  Run statement / selection
                </MenuItem>
                <MenuItem icon={<Play weight="fill" />} shortcut="⇧⌘↵" onClick={() => execute(editor.current!.target(true)!)}>
                  Run all
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Lightning />} shortcut="⌘E" onClick={() => editor.current?.target() && execute(editor.current.target()!, "plain")}>
                  Explain
                </MenuItem>
                <MenuItem icon={<Lightning weight="fill" />} onClick={() => editor.current?.target() && execute(editor.current.target()!, "analyze")}>
                  Explain analyze
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        )}
        <Tooltip label="Explain" shortcut="⌘E">
          <Button size="icon-sm" variant="ghost" disabled={running} onClick={() => editor.current?.target() && execute(editor.current.target()!, "plain")}>
            <Lightning className="size-4" />
          </Button>
        </Tooltip>
        <Tooltip label="Format" shortcut="⇧⌥F">
          <Button size="icon-sm" variant="ghost" onClick={format}>
            <TextAlignLeft className="size-4" />
          </Button>
        </Tooltip>
        <Tooltip label={tab.savedId ? "Save changes" : "Save query"} shortcut="⌘S">
          <Button size="icon-sm" variant="ghost" onClick={() => save.mutate()} className={cn(dirtySaved && "text-warn")}>
            <BookmarkSimple weight={tab.savedId ? "fill" : "regular"} className={cn("size-4", tab.savedId && !dirtySaved && "text-brand")} />
          </Button>
        </Tooltip>

        {tx !== "I" && (
          <div className={cn("ml-2 flex items-center gap-1 rounded-lg py-0.5 pl-2.5 pr-0.5 text-xs", tx === "E" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn")}>
            <span className="size-1.5 rounded-full bg-current" />
            <span className="font-medium">{tx === "E" ? "Transaction failed" : "Transaction open"}</span>
            {tx === "T" && (
              <Button size="xs" variant="ghost" className="ml-1 text-current hover:bg-warn/15 hover:text-current" onClick={() => txAction("COMMIT")}>
                <Check weight="bold" className="size-3" /> Commit
              </Button>
            )}
            <Button size="xs" variant="ghost" className="text-current hover:bg-fg/10 hover:text-current" onClick={() => txAction("ROLLBACK")}>
              <ArrowCounterClockwise className="size-3" /> Rollback
            </Button>
          </div>
        )}

        <div className="flex-1" />
        <span className="truncate text-xs text-fg/40">
          {connection.readOnly && "read-only · "}
          {tab.database}
        </span>
      </div>

      <div ref={container} className="flex min-h-0 flex-1 flex-col">
        <div style={{ height: `${tab.split * 100}%` }} className="min-h-0 shrink-0">
          <SqlEditor
            ref={editor}
            value={tab.sql}
            autoFocus
            schema={namespace}
            placeholder="SELECT * FROM …"
            onChange={(sql) => actions.updateTab<QueryTab>(tab.id, { sql })}
            onRun={(req) => execute(req)}
            onExplain={(req) => execute(req, "plain")}
            onSave={() => save.mutate()}
            onFormat={format}
          />
        </div>
        <div onPointerDown={startSplitDrag} onDoubleClick={() => actions.updateTab<QueryTab>(tab.id, { split: 0.45 })} className="group relative h-px shrink-0 cursor-row-resize bg-fg/[0.08]">
          <div className="absolute -inset-y-1.5 inset-x-0 group-hover:bg-accent/20" />
        </div>
        <Results tab={tab} run={run} />
      </div>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{((now - since) / 1000).toFixed(1)}s</span>;
}

function Results({ tab, run }: { tab: QueryTab; run?: QueryRun }) {
  if (!run) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 text-xs text-fg/40">
        <div className="flex items-center gap-2">
          <Kbd>⌘↵</Kbd> run statement at cursor or selection
        </div>
        <div className="flex items-center gap-2">
          <Kbd>⇧⌘↵</Kbd> run everything
        </div>
        <div className="flex items-center gap-2">
          <Kbd>⌘E</Kbd> explain
        </div>
      </div>
    );
  }
  if (run.status === "running") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-fg/50">
        <Spinner /> Running… <Elapsed since={run.startedAt} />
      </div>
    );
  }

  const active = run.activeResult;
  const result = active >= 0 ? run.results[active] : undefined;
  const hasMessages = run.results.length > 0 || run.notices.length > 0 || run.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-fg/[0.06] px-2">
        {run.results.map((r, i) =>
          r.fields.length ? (
            <button
              key={i}
              onClick={() => actions.setRun(tab.id, { ...run, activeResult: i })}
              className={cn("flex h-6 items-center gap-1.5 rounded-md px-2 text-xs", active === i ? "bg-surface-hover font-medium text-fg" : "text-fg/50 hover:text-fg")}
            >
              {run.explain ? "Plan" : run.results.filter((x) => x.fields.length).length > 1 ? `Result ${i + 1}` : "Result"}
              <span className="text-2xs font-normal text-fg/40">{r.truncated ? `${formatNumber(r.rows.length)}+` : formatNumber(r.rows.length)}</span>
            </button>
          ) : null,
        )}
        {hasMessages && (
          <button
            onClick={() => actions.setRun(tab.id, { ...run, activeResult: -1 })}
            className={cn("flex h-6 items-center gap-1.5 rounded-md px-2 text-xs", active === -1 ? "bg-surface-hover font-medium text-fg" : "text-fg/50 hover:text-fg", run.error && "text-danger")}
          >
            {run.error && <WarningCircle weight="fill" className="size-3.5" />}
            Messages
          </button>
        )}
        <div className="flex-1" />
        {run.error && active !== -1 && <span className="truncate text-xs text-danger">{run.error.error}</span>}
        <span className="shrink-0 text-xs tabular-nums text-fg/40">{run.ms !== undefined && formatMs(run.ms)}</span>
        {result && result.fields.length > 0 && <ExportMenu fields={result.fields.map((f) => f.name)} rows={result.rows} name={tab.title} />}
      </div>
      {active === -1 || !result ? (
        <Messages run={run} />
      ) : run.explain && result.fields.length === 1 && result.fields[0].name === "QUERY PLAN" ? (
        <Plan rows={result.rows.map((r) => r[0] ?? "")} />
      ) : (
        <ResultGrid key={`${run.queryId}:${active}`} storageKey={`${tab.id}:${run.queryId}:${active}`} result={result} />
      )}
      {result?.truncated && active >= 0 && (
        <div className="shrink-0 border-t border-fg/[0.06] bg-warn/[0.06] px-3 py-1.5 text-xs text-warn">
          Showing the first {formatNumber(result.rows.length)} rows. Add a LIMIT or export from the table view for everything.
        </div>
      )}
    </div>
  );
}

function ResultGrid({ result, storageKey }: { result: QueryRun["results"][number]; storageKey: string }) {
  const columns = useMemo(() => result.fields.map((f) => ({ name: f.name, type: f.type })), [result]);
  const rows: GridRow[] = useMemo(() => result.rows.map((cells, i) => ({ key: String(i), cells })), [result]);
  const header = columns.map((c) => c.name);
  return (
    <DataGrid
      columns={columns}
      rows={rows}
      storageKey={storageKey}
      renderCellMenu={(ctx: GridContext) => {
        const selected = ctx.rows.map((i) => result.rows[i]);
        return (
          <>
            <MenuItem icon={<Copy />} shortcut="⌘C" onClick={() => copyText(toTsv(ctx.rows.map((i) => result.rows[i].slice(ctx.range.c1, ctx.range.c2 + 1))))}>
              Copy
            </MenuItem>
            <SubMenu label={`Copy ${selected.length > 1 ? `${selected.length} rows` : "row"} as`} icon={<Copy />}>
              <MenuItem onClick={() => copyText(toJson(selected, header))}>JSON</MenuItem>
              <MenuItem onClick={() => copyText(toCsv(selected, header))}>CSV</MenuItem>
              <MenuItem onClick={() => copyText(toTsv(selected, header))}>TSV (spreadsheet)</MenuItem>
              <MenuItem onClick={() => copyText(toMarkdown(selected, header))}>Markdown table</MenuItem>
            </SubMenu>
          </>
        );
      }}
      emptyState={<div className="flex h-full items-center justify-center text-xs text-fg/40">No rows</div>}
    />
  );
}

function ExportMenu({ fields, rows, name }: { fields: string[]; rows: QueryRun["results"][number]["rows"]; name: string }) {
  const file = name.replace(/[^\w.-]+/g, "_").toLowerCase() || "result";
  return (
    <Menu>
      <MenuTrigger className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-fg/50 hover:bg-surface-hover hover:text-fg">
        <DownloadSimple className="size-3.5" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onClick={() => download(`${file}.csv`, toCsv(rows, fields), "text/csv")}>Download CSV</MenuItem>
        <MenuItem onClick={() => download(`${file}.json`, toJson(rows, fields), "application/json")}>Download JSON</MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => (copyText(toTsv(rows, fields)), toast("Copied for spreadsheets"))}>Copy as TSV</MenuItem>
        <MenuItem onClick={() => (copyText(toMarkdown(rows, fields)), toast("Copied as Markdown"))}>Copy as Markdown</MenuItem>
        <MenuItem onClick={() => (copyText(toJson(rows, fields)), toast("Copied as JSON"))}>Copy as JSON</MenuItem>
      </MenuContent>
    </Menu>
  );
}

function Messages({ run }: { run: QueryRun }) {
  return (
    <div className="selectable min-h-0 flex-1 space-y-2 overflow-y-auto p-4 font-mono text-xs">
      {run.results.map((r, i) => (
        <div key={i} className="flex gap-3 text-fg/70">
          <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
          <span>
            {r.command || "OK"}
            {r.rowCount !== null && <span className="text-fg/45"> · {formatNumber(r.rowCount)} row{r.rowCount === 1 ? "" : "s"}</span>}
          </span>
        </div>
      ))}
      {run.notices.map((n, i) => (
        <div key={`n${i}`} className="flex gap-3 text-accent">
          <span className="shrink-0">ℹ</span>
          <span className="whitespace-pre-wrap">{n}</span>
        </div>
      ))}
      {run.error && (
        <div className="rounded-xl bg-danger/[0.08] p-3.5 font-sans text-danger">
          <div className="flex items-center gap-2 text-sm font-medium">
            <WarningCircle weight="fill" className="size-4" /> {run.error.error}
          </div>
          {run.error.detail && <div className="mt-1.5 whitespace-pre-wrap text-xs text-fg/70">{run.error.detail}</div>}
          {run.error.hint && <div className="mt-1.5 text-xs text-fg/60">Hint: {run.error.hint}</div>}
          {run.error.code && <div className="mt-1.5 font-mono text-2xs text-fg/40">SQLSTATE {run.error.code}</div>}
          {run.results.length > 0 && <div className="mt-1.5 text-xs text-fg/50">Statements before the error ran; later ones were skipped.</div>}
        </div>
      )}
      {!run.results.length && !run.error && !run.notices.length && <div className="text-fg/40">Done.</div>}
    </div>
  );
}

function Plan({ rows }: { rows: string[] }) {
  return (
    <div className="selectable min-h-0 flex-1 overflow-auto p-4">
      <pre className="font-mono text-xs leading-6">
        {rows.map((line, i) => {
          const node = /^(\s*)(->\s*)?(.*?)(\s+\(cost=.*)?$/.exec(line);
          const [, indent = "", arrow = "", label = line, rest = ""] = node ?? [];
          return (
            <div key={i}>
              {indent}
              {arrow && <span className="text-fg/30">{arrow}</span>}
              <span className={cn(/^(Seq Scan|Index|Bitmap|Hash|Nested Loop|Merge|Sort|Aggregate|HashAggregate|Limit|Gather|Append|CTE|Subquery|Result|Unique|WindowAgg|Materialize)/.test(label) ? "font-semibold text-fg" : "text-fg/60")}>{label}</span>
              {rest && <span className="text-fg/40">{rest}</span>}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
