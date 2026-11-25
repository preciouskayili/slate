// Catalog queries for the schema browser and structure view.
import type pg from "pg";
import { qualified, quoteIdent } from "../shared/sql.js";
import type { ColumnInfo, ConstraintInfo, ForeignKey, RelationKind, SchemaTree, TableDetails } from "../shared/types.js";
import { HttpError } from "./pg.js";

const SYSTEM_SCHEMA = `n.nspname !~ '^pg_(catalog|toast|temp_|toast_temp_)' and n.nspname <> 'information_schema'`;
const NOT_EXTENSION = (oid: string, catalog: string) =>
  `not exists (select 1 from pg_depend d where d.objid = ${oid} and d.classid = '${catalog}'::regclass and d.deptype = 'e')`;

const KIND: Record<string, RelationKind> = { r: "table", v: "view", m: "materialized", f: "foreign", p: "partitioned" };

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function schemaTree(pool: pg.Pool): Promise<SchemaTree> {
  const [schemas, relations, routines, enums, sequences, columns] = await Promise.all([
    pool.query(`select n.nspname as name from pg_namespace n where ${SYSTEM_SCHEMA} order by n.nspname = 'public' desc, 1`),
    pool.query(`
      select n.nspname as schema, c.relname as name, c.relkind as kind,
             case when c.reltuples < 0 then null else c.reltuples::bigint end as estimate,
             case when c.relkind in ('r','m','p') then pg_total_relation_size(c.oid) end as bytes,
             obj_description(c.oid, 'pg_class') as comment
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','v','m','f','p') and not c.relispartition and ${SYSTEM_SCHEMA}
        and ${NOT_EXTENSION("c.oid", "pg_class")}
      order by n.nspname, c.relname`),
    pool.query(`
      select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
             coalesce(pg_get_function_result(p.oid), '') as returns, p.prokind as kind
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ${SYSTEM_SCHEMA} and ${NOT_EXTENSION("p.oid", "pg_proc")}
      order by n.nspname, p.proname`),
    pool.query(`
      select n.nspname as schema, t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as values
      from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid
      where ${SYSTEM_SCHEMA} group by 1, 2 order by 1, 2`),
    pool.query(`
      select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'S' and ${SYSTEM_SCHEMA} order by 1, 2`),
    pool.query(`
      select n.nspname as schema, c.relname as table, array_agg(a.attname::text order by a.attnum) as columns
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','v','m','f','p') and a.attnum > 0 and not a.attisdropped and ${SYSTEM_SCHEMA}
      group by 1, 2`),
  ]);
  const routineKind = { f: "function", p: "procedure", a: "aggregate", w: "window" } as const;
  return {
    schemas: schemas.rows.map((r) => r.name),
    relations: relations.rows.map((r) => ({
      schema: r.schema,
      name: r.name,
      kind: KIND[r.kind] ?? "table",
      rowEstimate: num(r.estimate),
      bytes: num(r.bytes),
      comment: r.comment,
    })),
    routines: routines.rows.map((r) => ({
      schema: r.schema,
      name: r.name,
      args: r.args,
      returns: r.returns,
      kind: routineKind[r.kind as keyof typeof routineKind] ?? "function",
    })),
    enums: enums.rows,
    sequences: sequences.rows,
    columns: Object.fromEntries(columns.rows.map((r) => [`${r.schema}.${r.table}`, r.columns])),
  };
}

const FK_ACTION: Record<string, string> = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

export async function tableDetails(pool: pg.Pool, schema: string, name: string): Promise<TableDetails> {
  const rel = await pool.query(
    `select c.oid, c.relkind, obj_description(c.oid, 'pg_class') as comment,
            case when c.reltuples < 0 then null else c.reltuples::bigint end as estimate,
            case when c.relkind in ('r','m','p') then pg_total_relation_size(c.oid) end as bytes
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relname = $2 and c.relkind in ('r','v','m','f','p')`,
    [schema, name],
  );
  if (!rel.rows[0]) throw new HttpError(404, `Relation ${schema}.${name} not found`);
  const { oid, relkind } = rel.rows[0];

  const [columns, pk, fks, refs, indexes, constraints, triggers, viewdef] = await Promise.all([
    pool.query(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
              coalesce(bt.typname, t.typname) as udt, t.typcategory as category,
              not a.attnotnull as nullable, pg_get_expr(d.adbin, d.adrelid) as default,
              case a.attidentity when 'a' then 'always' when 'd' then 'by default' end as identity,
              a.attgenerated <> '' as generated, col_description(a.attrelid, a.attnum) as comment,
              a.attnum as position,
              case when t.typtype = 'e' then
                (select array_agg(e.enumlabel::text order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid) end as enum_values
       from pg_attribute a join pg_type t on t.oid = a.atttypid
       left join pg_type bt on t.typtype = 'd' and bt.oid = t.typbasetype
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped order by a.attnum`,
      [oid],
    ),
    pool.query(
      `select a.attname as name from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey::int2[])
       where i.indrelid = $1 and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)`,
      [oid],
    ),
    pool.query(fkQuery("con.conrelid = $1"), [oid]),
    pool.query(fkQuery("con.confrelid = $1"), [oid]),
    pool.query(
      `select ic.relname as name, pg_get_indexdef(i.indexrelid) as definition, i.indisunique as unique,
              i.indisprimary as primary, pg_relation_size(i.indexrelid) as bytes
       from pg_index i join pg_class ic on ic.oid = i.indexrelid where i.indrelid = $1 order by i.indisprimary desc, ic.relname`,
      [oid],
    ),
    pool.query(
      `select conname as name, contype as type, pg_get_constraintdef(oid, true) as definition
       from pg_constraint where conrelid = $1 and contype <> 'n' order by contype = 'p' desc, conname`,
      [oid],
    ),
    pool.query(
      `select tgname as name, pg_get_triggerdef(oid, true) as definition, tgenabled <> 'D' as enabled
       from pg_trigger where tgrelid = $1 and not tgisinternal order by tgname`,
      [oid],
    ),
    relkind === "v" || relkind === "m" ? pool.query(`select pg_get_viewdef($1::oid, true) as def`, [oid]) : null,
  ]);

  const pkNames = pk.rows.map((r) => r.name as string);
  const cols: ColumnInfo[] = columns.rows.map((r) => ({
    name: r.name,
    type: r.type,
    udt: r.udt,
    category: r.category,
    nullable: r.nullable,
    default: r.default,
    identity: r.identity,
    generated: r.generated,
    isPrimaryKey: pkNames.includes(r.name),
    comment: r.comment,
    enumValues: r.enum_values,
    position: r.position,
  }));
  const conTypes: Record<string, ConstraintInfo["type"]> = { p: "primary", u: "unique", c: "check", f: "foreign", x: "exclusion" };
  const constraintList: ConstraintInfo[] = constraints.rows.map((r) => ({
    name: r.name,
    type: conTypes[r.type] ?? "other",
    definition: r.definition,
  }));
  const kind = KIND[relkind] ?? "table";
  const details: TableDetails = {
    schema,
    name,
    kind,
    comment: rel.rows[0].comment,
    rowEstimate: num(rel.rows[0].estimate),
    bytes: num(rel.rows[0].bytes),
    columns: cols,
    primaryKey: pkNames,
    foreignKeys: fks.rows.map(mapFk),
    referencedBy: refs.rows.map((r) => ({ ...mapFk(r), schema: r.src_schema, table: r.src_table })),
    indexes: indexes.rows.map((r) => ({ ...r, bytes: num(r.bytes) })),
    constraints: constraintList,
    triggers: triggers.rows,
    ddl: "",
    editable: kind === "table" || (kind === "partitioned" && pkNames.length > 0),
  };
  details.ddl = viewdef
    ? `CREATE ${relkind === "m" ? "MATERIALIZED VIEW" : "OR REPLACE VIEW"} ${qualified(schema, name)} AS\n${viewdef.rows[0].def}`
    : buildTableDdl(details);
  return details;
}

function fkQuery(where: string) {
  return `
    select con.conname as name,
      sn.nspname as src_schema, sc.relname as src_table,
      (select array_agg(a.attname::text order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
      rn.nspname as ref_schema, rc.relname as ref_table,
      (select array_agg(a.attname::text order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as ref_columns,
      con.confdeltype as on_delete, con.confupdtype as on_update
    from pg_constraint con
    join pg_class rc on rc.oid = con.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
    join pg_class sc on sc.oid = con.conrelid join pg_namespace sn on sn.oid = sc.relnamespace
    where con.contype = 'f' and ${where} order by con.conname`;
}

function mapFk(r: Record<string, unknown>): ForeignKey {
  return {
    name: r.name as string,
    columns: r.columns as string[],
    refSchema: r.ref_schema as string,
    refTable: r.ref_table as string,
    refColumns: r.ref_columns as string[],
    onDelete: FK_ACTION[r.on_delete as string] ?? "NO ACTION",
    onUpdate: FK_ACTION[r.on_update as string] ?? "NO ACTION",
  };
}

function buildTableDdl(t: TableDetails): string {
  const lines = t.columns.map((c) => {
    let line = `  ${quoteIdent(c.name)} ${c.type}`;
    if (c.identity) line += ` GENERATED ${c.identity.toUpperCase()} AS IDENTITY`;
    else if (c.generated && c.default) line += ` GENERATED ALWAYS AS (${c.default}) STORED`;
    else if (c.default) line += ` DEFAULT ${c.default}`;
    if (!c.nullable) line += " NOT NULL";
    return line;
  });
  for (const con of t.constraints) lines.push(`  CONSTRAINT ${quoteIdent(con.name)} ${con.definition}`);
  let ddl = `CREATE TABLE ${qualified(t.schema, t.name)} (\n${lines.join(",\n")}\n);`;
  const constraintNames = new Set(t.constraints.map((c) => c.name));
  for (const index of t.indexes) {
    if (!constraintNames.has(index.name)) ddl += `\n\n${index.definition};`;
  }
  for (const trigger of t.triggers) ddl += `\n\n${trigger.definition};`;
  if (t.comment) ddl += `\n\nCOMMENT ON TABLE ${qualified(t.schema, t.name)} IS '${t.comment.replace(/'/g, "''")}';`;
  for (const c of t.columns) {
    if (c.comment)
      ddl += `\nCOMMENT ON COLUMN ${qualified(t.schema, t.name)}.${quoteIdent(c.name)} IS '${c.comment.replace(/'/g, "''")}';`;
  }
  return ddl;
}

export async function routineDefinition(pool: pg.Pool, schema: string, name: string, args: string): Promise<string> {
  const { rows } = await pool.query(
    `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = $1 and p.proname = $2 and pg_get_function_identity_arguments(p.oid) = $3 and p.prokind <> 'a'`,
    [schema, name, args],
  );
  if (!rows[0]) throw new HttpError(404, "Routine not found");
  return rows[0].def;
}
