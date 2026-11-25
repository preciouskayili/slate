import { useState } from "react";
import type { ColumnInfo, TableDetails } from "@shared/types";
import { qualified, quoteIdent, quoteLiteral } from "@shared/sql";
import { refreshSchema } from "@/lib/queries";
import { actions, type TableTab } from "@/lib/store";
import { cn, copyText, formatBytes, formatNumber } from "@/lib/utils";
import { confirmSql, runSql } from "../confirm-sql";
import { promptText } from "../prompt-dialog";
import { SqlEditor } from "../query/sql-editor";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { ArrowUpRight, Copy, DotsThree, Key, LinkSimple, Plus, Terminal } from "../ui/icons";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Input, Switch } from "../ui/misc";
import { toast } from "../ui/toast";

const COMMON_TYPES = ["text", "varchar(255)", "integer", "bigint", "smallint", "numeric(12,2)", "boolean", "uuid", "jsonb", "timestamptz", "timestamp", "date", "time", "interval", "real", "double precision", "bytea", "text[]", "integer[]", "inet", "citext"];

export function StructureView({ tab, details, connectionId }: { tab: TableTab; details: TableDetails; connectionId: string }) {
  const target = qualified(tab.schema, tab.table);
  const isTable = details.kind === "table" || details.kind === "partitioned";
  const [addOpen, setAddOpen] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);

  const run = (title: string, sql: string, danger = false) =>
    confirmSql({
      title,
      sql,
      danger,
      confirmLabel: danger ? "Run" : "Apply",
      run: async () => {
        await runSql(connectionId, tab.database, sql);
        refreshSchema(connectionId);
        toast("Structure updated");
      },
    });

  const columnMenu = (c: ColumnInfo) => {
    const col = `${target} ALTER COLUMN ${quoteIdent(c.name)}`;
    return (
      <>
        <MenuItem
          onClick={async () => {
            const name = await promptText({ title: `Rename ${c.name}`, initial: c.name, confirmLabel: "Preview SQL", mono: true });
            if (name && name !== c.name) run("Rename column", `ALTER TABLE ${target} RENAME COLUMN ${quoteIdent(c.name)} TO ${quoteIdent(name)};`);
          }}
        >
          Rename…
        </MenuItem>
        <MenuItem
          onClick={async () => {
            const type = await promptText({ title: `Change type of ${c.name}`, initial: c.type, confirmLabel: "Preview SQL", mono: true });
            if (type && type !== c.type) run("Change column type", `ALTER TABLE ${col} TYPE ${type} USING ${quoteIdent(c.name)}::${type};`);
          }}
        >
          Change type…
        </MenuItem>
        <MenuItem
          onClick={async () => {
            const value = await promptText({ title: `Default for ${c.name}`, initial: c.default ?? "", placeholder: "Empty drops the default", confirmLabel: "Preview SQL", mono: true });
            if (value === null) return;
            run("Change default", value.trim() ? `ALTER TABLE ${col} SET DEFAULT ${value.trim()};` : `ALTER TABLE ${col} DROP DEFAULT;`);
          }}
        >
          Set default…
        </MenuItem>
        <MenuItem onClick={() => run(c.nullable ? "Make NOT NULL" : "Allow NULL", `ALTER TABLE ${col} ${c.nullable ? "SET" : "DROP"} NOT NULL;`)}>
          {c.nullable ? "Make NOT NULL" : "Allow NULL"}
        </MenuItem>
        <MenuItem
          onClick={async () => {
            const comment = await promptText({ title: `Comment on ${c.name}`, initial: c.comment ?? "", confirmLabel: "Preview SQL" });
            if (comment !== null) run("Set comment", `COMMENT ON COLUMN ${target}.${quoteIdent(c.name)} IS ${comment ? quoteLiteral(comment) : "NULL"};`);
          }}
        >
          Comment…
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Copy />} onClick={() => copyText(c.name)}>
          Copy name
        </MenuItem>
        <MenuItem danger onClick={() => run(`Drop column ${c.name}?`, `ALTER TABLE ${target} DROP COLUMN ${quoteIdent(c.name)};`, true)}>
          Drop column…
        </MenuItem>
      </>
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-8 px-6 py-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-fg/50">
          <Stat label="Kind" value={details.kind} />
          {details.rowEstimate !== null && <Stat label="Rows (est.)" value={formatNumber(details.rowEstimate)} />}
          {details.bytes !== null && <Stat label="Size" value={formatBytes(details.bytes)} />}
          <Stat label="Columns" value={String(details.columns.length)} />
          {details.primaryKey.length > 0 && <Stat label="Primary key" value={details.primaryKey.join(", ")} />}
          {details.comment && <span className="italic text-fg/60">“{details.comment}”</span>}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={async () => {
              const comment = await promptText({ title: `Comment on ${tab.table}`, initial: details.comment ?? "", confirmLabel: "Preview SQL" });
              if (comment !== null) run("Set table comment", `COMMENT ON ${details.kind === "view" ? "VIEW" : details.kind === "materialized" ? "MATERIALIZED VIEW" : "TABLE"} ${target} IS ${comment ? quoteLiteral(comment) : "NULL"};`);
            }}
          >
            Edit comment
          </Button>
        </div>

        <Section
          title="Columns"
          action={
            isTable && (
              <Button size="xs" variant="secondary" onClick={() => setAddOpen(true)}>
                <Plus weight="bold" className="size-3" /> Column
              </Button>
            )
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs font-medium uppercase tracking-wide text-fg/40">
                <Th className="w-8" />
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Nullable</Th>
                <Th>Default</Th>
                <Th>Comment</Th>
                <Th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {details.columns.map((c) => {
                const fk = details.foreignKeys.find((f) => f.columns.includes(c.name));
                return (
                  <tr key={c.name} className="group border-t border-fg/[0.05] hover:bg-surface">
                    <Td className="text-fg/30">
                      {c.isPrimaryKey ? <Key weight="fill" className="size-3.5 text-warn/80" /> : fk ? <LinkSimple className="size-3.5 text-accent/80" /> : <span className="text-2xs tabular-nums">{c.position}</span>}
                    </Td>
                    <Td className="font-medium">
                      <span className="selectable">{c.name}</span>
                      {fk && (
                        <button
                          onClick={() => actions.openTable(connectionId, tab.database, fk.refSchema, fk.refTable, { preview: false })}
                          className="ml-2 inline-flex items-center gap-0.5 text-2xs font-normal text-accent hover:underline"
                        >
                          → {fk.refTable}.{fk.refColumns.join(", ")}
                        </button>
                      )}
                    </Td>
                    <Td className="font-mono text-xs text-fg/70">
                      {c.type}
                      {c.identity && <span className="ml-1.5 rounded bg-surface-hover px-1 font-sans text-2xs text-fg/50">identity {c.identity}</span>}
                      {c.generated && <span className="ml-1.5 rounded bg-surface-hover px-1 font-sans text-2xs text-fg/50">generated</span>}
                      {c.enumValues && <div className="mt-0.5 truncate font-sans text-2xs text-fg/40">{c.enumValues.join(" · ")}</div>}
                    </Td>
                    <Td className={cn("text-xs", c.nullable ? "text-fg/50" : "font-medium text-fg/75")}>{c.nullable ? "yes" : "NOT NULL"}</Td>
                    <Td className="max-w-[220px] truncate font-mono text-xs text-fg/55" title={c.default ?? undefined}>
                      {c.default ?? ""}
                    </Td>
                    <Td className="max-w-[260px] truncate text-xs text-fg/50" title={c.comment ?? undefined}>
                      {c.comment}
                    </Td>
                    <Td>
                      {isTable && (
                        <Menu>
                          <MenuTrigger className="flex size-6 items-center justify-center rounded-md text-fg/40 opacity-0 hover:bg-surface-hover hover:text-fg group-hover:opacity-100 data-[popup-open]:opacity-100">
                            <DotsThree weight="bold" className="size-4" />
                          </MenuTrigger>
                          <MenuContent align="end">{columnMenu(c)}</MenuContent>
                        </Menu>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        {(isTable || details.kind === "materialized") && (
          <Section
            title="Indexes"
            action={
              <Button size="xs" variant="secondary" onClick={() => setIndexOpen(true)}>
                <Plus weight="bold" className="size-3" /> Index
              </Button>
            }
          >
            {details.indexes.length === 0 ? (
              <None>No indexes</None>
            ) : (
              details.indexes.map((i) => (
                <Row key={i.name}>
                  <span className="w-56 shrink-0 truncate font-medium">{i.name}</span>
                  <span className="flex shrink-0 gap-1">
                    {i.primary && <Badge>primary</Badge>}
                    {i.unique && !i.primary && <Badge>unique</Badge>}
                  </span>
                  <code className="selectable min-w-0 flex-1 truncate font-mono text-xs text-fg/55" title={i.definition}>
                    {i.definition.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ /, "")}
                  </code>
                  <span className="shrink-0 text-2xs text-fg/35">{formatBytes(i.bytes)}</span>
                  {!i.primary && (
                    <RowMenu>
                      <MenuItem icon={<Copy />} onClick={() => copyText(i.definition + ";")}>
                        Copy definition
                      </MenuItem>
                      <MenuItem danger onClick={() => run(`Drop index ${i.name}?`, `DROP INDEX ${qualified(tab.schema, i.name)};`, true)}>
                        Drop index…
                      </MenuItem>
                    </RowMenu>
                  )}
                </Row>
              ))
            )}
          </Section>
        )}

        {isTable && (
          <Section title="Constraints">
            {details.constraints.length === 0 ? (
              <None>No constraints</None>
            ) : (
              details.constraints.map((c) => (
                <Row key={c.name}>
                  <span className="w-56 shrink-0 truncate font-medium">{c.name}</span>
                  <Badge>{c.type}</Badge>
                  <code className="selectable min-w-0 flex-1 truncate font-mono text-xs text-fg/55" title={c.definition}>
                    {c.definition}
                  </code>
                  <RowMenu>
                    <MenuItem danger onClick={() => run(`Drop constraint ${c.name}?`, `ALTER TABLE ${target} DROP CONSTRAINT ${quoteIdent(c.name)};`, true)}>
                      Drop constraint…
                    </MenuItem>
                  </RowMenu>
                </Row>
              ))
            )}
          </Section>
        )}

        {details.foreignKeys.length > 0 && (
          <Section title="Foreign keys">
            {details.foreignKeys.map((fk) => (
              <Row key={fk.name}>
                <span className="w-56 shrink-0 truncate font-mono text-xs">{fk.columns.join(", ")}</span>
                <button onClick={() => actions.openTable(connectionId, tab.database, fk.refSchema, fk.refTable, { preview: false })} className="flex min-w-0 flex-1 items-center gap-1 truncate text-left text-accent hover:underline">
                  {fk.refSchema !== tab.schema && `${fk.refSchema}.`}
                  {fk.refTable}({fk.refColumns.join(", ")}) <ArrowUpRight className="size-3" />
                </button>
                <span className="shrink-0 text-2xs text-fg/40">
                  on delete {fk.onDelete.toLowerCase()} · on update {fk.onUpdate.toLowerCase()}
                </span>
              </Row>
            ))}
          </Section>
        )}

        {details.referencedBy.length > 0 && (
          <Section title="Referenced by">
            {details.referencedBy.map((fk) => (
              <Row key={fk.schema + fk.table + fk.name}>
                <button onClick={() => actions.openTable(connectionId, tab.database, fk.schema, fk.table, { preview: false })} className="flex w-56 shrink-0 items-center gap-1 truncate text-left font-medium text-accent hover:underline">
                  {fk.schema !== tab.schema && `${fk.schema}.`}
                  {fk.table} <ArrowUpRight className="size-3" />
                </button>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg/55">
                  ({fk.columns.join(", ")}) → ({fk.refColumns.join(", ")})
                </span>
                <span className="shrink-0 text-2xs text-fg/40">on delete {fk.onDelete.toLowerCase()}</span>
              </Row>
            ))}
          </Section>
        )}

        {details.triggers.length > 0 && (
          <Section title="Triggers">
            {details.triggers.map((t) => (
              <Row key={t.name}>
                <span className="w-56 shrink-0 truncate font-medium">{t.name}</span>
                {!t.enabled && <Badge>disabled</Badge>}
                <code className="selectable min-w-0 flex-1 truncate font-mono text-xs text-fg/55" title={t.definition}>
                  {t.definition}
                </code>
              </Row>
            ))}
          </Section>
        )}

        <Section
          title="Definition"
          action={
            <div className="flex gap-1">
              <Button size="xs" variant="ghost" onClick={() => copyText(details.ddl)}>
                <Copy className="size-3" /> Copy
              </Button>
              <Button size="xs" variant="ghost" onClick={() => actions.openQuery(connectionId, tab.database, { sql: details.ddl, title: `${tab.table} DDL` })}>
                <Terminal className="size-3" /> Open in editor
              </Button>
            </div>
          }
        >
          <div className="overflow-hidden rounded-xl bg-surface" style={{ height: Math.min(520, details.ddl.split("\n").length * 21.5 + 24) }}>
            <SqlEditor value={details.ddl} readOnly lineNumbers={false} />
          </div>
        </Section>
      </div>
      <AddColumnDialog open={addOpen} onOpenChange={setAddOpen} onSubmit={(sql) => run("Add column", sql.replace("%T", target))} />
      <AddIndexDialog open={indexOpen} onOpenChange={setIndexOpen} columns={details.columns} table={tab.table} onSubmit={(sql) => run("Create index", sql.replace("%T", target))} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-fg/40">{label}</span> <span className="font-medium text-fg/75">{value}</span>
    </span>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex h-7 items-center justify-between">
        <h3 className="section-label">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => <th className={cn("px-2 pb-2 font-medium", className)}>{children}</th>;
const Td = ({ children, className, title }: { children?: React.ReactNode; className?: string; title?: string }) => (
  <td title={title} className={cn("px-2 py-2 align-top", className)}>
    {children}
  </td>
);
const Row = ({ children }: { children: React.ReactNode }) => <div className="group flex items-center gap-3 border-t border-fg/[0.05] px-2 py-2 text-sm first:border-t-0">{children}</div>;
const Badge = ({ children }: { children: React.ReactNode }) => <span className="shrink-0 rounded bg-surface-hover px-1.5 py-px text-2xs text-fg/60">{children}</span>;
const None = ({ children }: { children: React.ReactNode }) => <div className="px-2 py-2 text-xs text-fg/40">{children}</div>;

function RowMenu({ children }: { children: React.ReactNode }) {
  return (
    <Menu>
      <MenuTrigger className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg/40 opacity-0 hover:bg-surface-hover hover:text-fg group-hover:opacity-100 data-[popup-open]:opacity-100">
        <DotsThree weight="bold" className="size-4" />
      </MenuTrigger>
      <MenuContent align="end">{children}</MenuContent>
    </Menu>
  );
}

function AddColumnDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (sql: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [nullable, setNullable] = useState(true);
  const [def, setDef] = useState("");
  const sql = `ALTER TABLE %T ADD COLUMN ${quoteIdent(name || "new_column")} ${type || "text"}${def.trim() ? ` DEFAULT ${def.trim()}` : ""}${nullable ? "" : " NOT NULL"};`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onOpenChange(false);
            onSubmit(sql);
            setName("");
            setDef("");
          }}
        >
          <div className="space-y-3.5 px-5 pt-5">
            <DialogTitle>Add column</DialogTitle>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-fg/60">Name</span>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="new_column" className="font-mono text-xs" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-fg/60">Type</span>
              <Input list="pg-types" value={type} onChange={(e) => setType(e.target.value)} className="font-mono text-xs" />
              <datalist id="pg-types">
                {COMMON_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-fg/60">Default (SQL expression)</span>
              <Input value={def} onChange={(e) => setDef(e.target.value)} placeholder="e.g. now(), 0, 'draft'" className="font-mono text-xs" />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm">Allow NULL</span>
              <Switch checked={nullable} onChange={setNullable} />
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t border-fg/[0.06] px-5 py-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!name.trim()}>
              Preview SQL
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddIndexDialog({ open, onOpenChange, columns, table, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; columns: ColumnInfo[]; table: string; onSubmit: (sql: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const [method, setMethod] = useState("btree");
  const name = `${table}_${picked.join("_") || "col"}_${unique ? "key" : "idx"}`.slice(0, 63);
  const sql = `CREATE ${unique ? "UNIQUE " : ""}INDEX ${quoteIdent(name)} ON %T${method !== "btree" ? ` USING ${method}` : ""} (${picked.map(quoteIdent).join(", ")});`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <div className="px-5 pt-5">
          <DialogTitle>Create index</DialogTitle>
          <div className="mt-4 max-h-56 space-y-0.5 overflow-y-auto rounded-xl bg-surface p-1.5">
            {columns.map((c) => (
              <label key={c.name} className="flex h-7 items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface">
                <input
                  type="checkbox"
                  checked={picked.includes(c.name)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.name] : p.filter((x) => x !== c.name)))}
                  className="accent-[rgb(var(--accent))]"
                />
                <span className="flex-1 truncate">{c.name}</span>
                {picked.includes(c.name) && <span className="text-2xs text-accent">{picked.indexOf(c.name) + 1}</span>}
                <span className="font-mono text-2xs text-fg/35">{c.type}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={unique} onChange={setUnique} /> Unique
            </label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="field ml-auto h-7 w-28 appearance-none text-xs">
              {["btree", "hash", "gin", "gist", "brin"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t border-fg/[0.06] px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!picked.length}
            onClick={() => {
              onOpenChange(false);
              onSubmit(sql);
              setPicked([]);
            }}
          >
            Preview SQL
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
