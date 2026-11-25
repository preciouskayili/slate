// Table browsing, editing, export and the SQL runner.
import type pg from "pg";
import Cursor from "pg-cursor";
import { leadingKeyword, qualified, quoteIdent, quoteLiteral, splitStatements } from "../shared/sql.js";
import type {
  Cell,
  Filter,
  MutateRequest,
  MutateResponse,
  QueryResponse,
  QueryResultSet,
  RowKey,
  RowsRequest,
  RowsResponse,
  TableDetails,
} from "../shared/types.js";
import { checkout, describeFields, HttpError, rawTypes, type Session } from "./pg.js";

const CTID = "__slate_ctid";

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (m) => "\\" + m);
}

export function buildWhere(req: Pick<RowsRequest, "filters" | "match" | "search" | "where">, table: TableDetails) {
  const params: unknown[] = [];
  const p = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const known = new Set(table.columns.map((c) => c.name));
  const parts: string[] = [];

  for (const f of req.filters ?? []) {
    if (!f.enabled) continue;
    if (!known.has(f.column)) throw new HttpError(400, `Unknown column "${f.column}"`);
    const clause = filterClause(f, quoteIdent(f.column), p);
    if (clause) parts.push(clause);
  }

  const clauses: string[] = [];
  if (parts.length) clauses.push(parts.length === 1 ? parts[0] : `(${parts.join(req.match === "any" ? " OR " : " AND ")})`);

  const search = req.search?.trim();
  if (search) {
    const needle = p(`%${escapeLike(search)}%`);
    const searchable = table.columns.filter((c) => c.udt !== "bytea");
    if (searchable.length) clauses.push(`(${searchable.map((c) => `${quoteIdent(c.name)}::text ILIKE ${needle}`).join(" OR ")})`);
  }
  if (req.where?.trim()) clauses.push(`(${req.where.trim()})`);

  return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", params };
}

function filterClause(f: Filter, col: string, p: (v: unknown) => string): string | null {
  const v = f.value;
  switch (f.op) {
    case "eq":
      return `${col} = ${p(v)}`;
    case "neq":
      return `${col} IS DISTINCT FROM ${p(v)}`;
    case "lt":
      return `${col} < ${p(v)}`;
    case "lte":
      return `${col} <= ${p(v)}`;
    case "gt":
      return `${col} > ${p(v)}`;
    case "gte":
      return `${col} >= ${p(v)}`;
    case "contains":
      return `${col}::text ILIKE ${p(`%${escapeLike(v)}%`)}`;
    case "not_contains":
      return `(${col} IS NULL OR ${col}::text NOT ILIKE ${p(`%${escapeLike(v)}%`)})`;
    case "starts":
      return `${col}::text ILIKE ${p(`${escapeLike(v)}%`)}`;
    case "ends":
      return `${col}::text ILIKE ${p(`%${escapeLike(v)}`)}`;
    case "in":
    case "not_in": {
      const list = v.split(",").map((s) => s.trim()).filter(Boolean);
      if (!list.length) return null;
      return f.op === "in" ? `${col}::text = ANY(${p(list)}::text[])` : `NOT (${col}::text = ANY(${p(list)}::text[]))`;
    }
    case "null":
      return `${col} IS NULL`;
    case "not_null":
      return `${col} IS NOT NULL`;
    case "true":
      return `${col} IS TRUE`;
    case "false":
      return `${col} IS FALSE`;
    case "regex":
      return `${col}::text ~* ${p(v)}`;
    default:
      throw new HttpError(400, `Unknown operator ${(f as Filter).op}`);
  }
}

function orderBy(req: RowsRequest, table: TableDetails) {
  const known = new Set(table.columns.map((c) => c.name));
  const sort = (req.sort ?? []).filter((s) => known.has(s.column));
  if (sort.length) return ` ORDER BY ${sort.map((s) => `${quoteIdent(s.column)} ${s.dir === "desc" ? "DESC" : "ASC"} NULLS LAST`).join(", ")}`;
  // Stable pagination by primary key when the user has not chosen an order.
  if (table.primaryKey.length) return ` ORDER BY ${table.primaryKey.map(quoteIdent).join(", ")}`;
  return "";
}

export async function fetchRows(pool: pg.Pool, req: RowsRequest, table: TableDetails): Promise<RowsResponse> {
  const started = performance.now();
  const where = buildWhere(req, table);
  const useCtid = table.kind === "table" && table.primaryKey.length === 0;
  const limit = Math.min(Math.max(1, Number(req.limit) || 100), 10_000);
  const offset = Math.max(0, Number(req.offset) || 0);
  const target = qualified(req.schema, req.table);
  const select = `SELECT t.*${useCtid ? `, t.ctid::text AS ${CTID}` : ""} FROM ${target} t${where.sql}${orderBy(req, table)} LIMIT ${limit} OFFSET ${offset}`;

  const client = await checkout(pool);
  try {
    // Browsing never writes, even if a raw WHERE clause calls a volatile function.
    await client.query("BEGIN READ ONLY");
    const result = await client.query({ text: select, values: where.params, rowMode: "array", types: rawTypes });
    let total: number | null = null;
    let totalIsEstimate = false;
    const filtered = where.sql.length > 0;
    if (!filtered && table.rowEstimate !== null && table.rowEstimate > 250_000) {
      total = table.rowEstimate;
      totalIsEstimate = true;
    } else {
      try {
        await client.query("SAVEPOINT count");
        await client.query("SET LOCAL statement_timeout = 2500");
        const count = await client.query(`SELECT count(*)::bigint AS n FROM ${target} t${where.sql}`, where.params);
        total = Number(count.rows[0].n);
        await client.query("RELEASE SAVEPOINT count");
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT count");
        if (!filtered && table.rowEstimate !== null) {
          total = table.rowEstimate;
          totalIsEstimate = true;
        }
      }
    }
    await client.query("COMMIT");

    let fields = result.fields;
    let rows = result.rows as Cell[][];
    let ctids: (string | null)[] = rows.map(() => null);
    if (useCtid) {
      const index = fields.findIndex((f) => f.name === CTID);
      ctids = rows.map((r) => r[index]);
      rows = rows.map((r) => r.filter((_, i) => i !== index));
      fields = fields.filter((_, i) => i !== index);
    }
    return {
      fields: fields.map((f) => ({ name: f.name, typeId: f.dataTypeID, type: table.columns.find((c) => c.name === f.name)?.type ?? "" })),
      rows,
      ctids,
      total,
      totalIsEstimate,
      ms: Math.round(performance.now() - started),
      sql: select,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.done();
  }
}

// ---- Mutations

function keyClause(key: RowKey, table: TableDetails, p: (v: unknown) => string) {
  const entries = Object.entries(key);
  if (!entries.length) throw new HttpError(400, "Row key is required");
  return entries
    .map(([column, value]) => {
      if (column === "ctid") return `ctid = ${p(value)}::tid`;
      if (!table.primaryKey.includes(column)) throw new HttpError(400, `"${column}" is not part of the primary key`);
      return `${quoteIdent(column)} = ${p(value)}`;
    })
    .join(" AND ");
}

function checkColumns(values: Record<string, Cell>, table: TableDetails) {
  for (const column of Object.keys(values)) {
    const info = table.columns.find((c) => c.name === column);
    if (!info) throw new HttpError(400, `Unknown column "${column}"`);
    if (info.generated) throw new HttpError(400, `"${column}" is a generated column`);
  }
}

export function buildMutations(req: MutateRequest, table: TableDetails, inline: boolean) {
  const target = qualified(req.schema, req.table);
  return req.mutations.map((m) => {
    const params: unknown[] = [];
    const p = (value: unknown) => {
      if (inline) return value === null ? "NULL" : quoteLiteral(String(value));
      params.push(value);
      return `$${params.length}`;
    };
    let text: string;
    let expectOne = true;
    if (m.kind === "update") {
      checkColumns(m.values, table);
      const sets = Object.entries(m.values).map(([c, v]) => `${quoteIdent(c)} = ${p(v)}`);
      if (!sets.length) throw new HttpError(400, "Nothing to update");
      text = `UPDATE ${target} SET ${sets.join(", ")} WHERE ${keyClause(m.key, table, p)}`;
    } else if (m.kind === "insert") {
      checkColumns(m.values, table);
      const entries = Object.entries(m.values);
      const overriding = entries.some(([c]) => table.columns.find((x) => x.name === c)?.identity === "always");
      text = entries.length
        ? `INSERT INTO ${target} (${entries.map(([c]) => quoteIdent(c)).join(", ")})${overriding ? " OVERRIDING SYSTEM VALUE" : ""} VALUES (${entries.map(([, v]) => p(v)).join(", ")})`
        : `INSERT INTO ${target} DEFAULT VALUES`;
      expectOne = false;
    } else {
      text = `DELETE FROM ${target} WHERE ${keyClause(m.key, table, p)}`;
    }
    return { text, params, expectOne };
  });
}

export async function mutate(pool: pg.Pool, req: MutateRequest, table: TableDetails): Promise<MutateResponse> {
  if (!table.editable) throw new HttpError(400, `${req.schema}.${req.table} is not editable`);
  if (!Array.isArray(req.mutations) || req.mutations.length === 0) throw new HttpError(400, "No changes to apply");
  const preview = buildMutations(req, table, true).map((s) => s.text + ";");
  if (req.dryRun) return { sql: preview, affected: 0 };

  const statements = buildMutations(req, table, false);
  const client = await checkout(pool);
  let affected = 0;
  try {
    await client.query("BEGIN");
    for (const [i, s] of statements.entries()) {
      const result = await client.query({ text: s.text, values: s.params, types: rawTypes });
      if (s.expectOne && result.rowCount !== 1) {
        throw new HttpError(409, `Change ${i + 1} matched ${result.rowCount} rows instead of 1. The row may have been changed or deleted elsewhere; reload and try again.`, {
          detail: preview[i],
        });
      }
      affected += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { sql: preview, affected };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.done();
  }
}

// ---- Export

export function csvCell(value: Cell): string {
  if (value === null) return "";
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function* exportRows(pool: pg.Pool, req: RowsRequest, table: TableDetails, format: "csv" | "json" | "sql") {
  const where = buildWhere(req, table);
  const text = `SELECT t.* FROM ${qualified(req.schema, req.table)} t${where.sql}${orderBy(req, table)}`;
  const client = await checkout(pool);
  try {
    await client.query("BEGIN READ ONLY");
    const cursor = client.query(new Cursor(text, where.params, { rowMode: "array", types: rawTypes } as never));
    let names: string[] | null = null;
    let first = true;
    if (format === "json") yield "[\n";
    for (;;) {
      const rows = (await cursor.read(2000)) as Cell[][];
      if (!names) {
        names = ((cursor as unknown as { _result: { fields: { name: string }[] } })._result?.fields ?? []).map((f) => f.name);
        if (!names.length) names = table.columns.map((c) => c.name);
        if (format === "csv") yield names.map(csvCell).join(",") + "\n";
      }
      if (!rows.length) break;
      let chunk = "";
      for (const row of rows) {
        if (format === "csv") chunk += row.map(csvCell).join(",") + "\n";
        else if (format === "json") {
          chunk += (first ? "  " : ",\n  ") + JSON.stringify(Object.fromEntries(names.map((n, i) => [n, row[i]])));
        } else {
          chunk += `INSERT INTO ${qualified(req.schema, req.table)} (${names.map(quoteIdent).join(", ")}) VALUES (${row.map(quoteLiteral).join(", ")});\n`;
        }
        first = false;
      }
      yield chunk;
    }
    if (format === "json") yield "\n]\n";
    await cursor.close();
    await client.query("COMMIT");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.done();
  }
}

// ---- SQL runner

const running = new Map<string, Session>();

export function runningSession(queryId: string) {
  return running.get(queryId);
}

export async function runQuery(
  session: Session,
  entry: Parameters<typeof describeFields>[0],
  sql: string,
  queryId: string,
  maxRows = 5000,
): Promise<QueryResponse & { txStatus: Session["txStatus"]; error?: unknown; failedAt?: number }> {
  if (session.busy) throw new HttpError(409, "This tab is still running a query. Cancel it or wait for it to finish.");
  const statements = splitStatements(sql);
  if (!statements.length) throw new HttpError(400, "Nothing to run");
  session.busy = true;
  session.notices = [];
  running.set(queryId, session);
  const started = performance.now();
  const results: QueryResultSet[] = [];
  try {
    for (const statement of statements) {
      try {
        results.push(await runStatement(session, entry, statement.text, maxRows));
      } catch (error) {
        // Report results so far plus the failing statement's position in the script.
        return {
          results,
          notices: session.notices,
          ms: Math.round(performance.now() - started),
          txStatus: session.txStatus,
          error,
          failedAt: statement.from + (Number((error as { position?: string }).position) || 1) - 1,
        };
      }
    }
    return { results, notices: session.notices, ms: Math.round(performance.now() - started), txStatus: session.txStatus };
  } finally {
    session.busy = false;
    session.lastUsed = Date.now();
    running.delete(queryId);
  }
}

async function runStatement(session: Session, entry: Parameters<typeof describeFields>[0], text: string, maxRows: number): Promise<QueryResultSet> {
  const keyword = leadingKeyword(text);
  // COPY and a few utility statements cannot run through a portal; use the simple protocol.
  if (["COPY", "VACUUM", "BEGIN", "COMMIT", "ROLLBACK", "END", "START", "SAVEPOINT", "RELEASE", "SET", "RESET", "LISTEN", "NOTIFY", "DISCARD", "CHECKPOINT", "REINDEX", "CLUSTER"].includes(keyword) || /^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(text) || /^(CREATE|DROP)\s+DATABASE/i.test(text)) {
    const result = await session.client.query({ text, rowMode: "array", types: rawTypes });
    const r = Array.isArray(result) ? result[result.length - 1] : result;
    return {
      command: r.command ?? keyword,
      rowCount: r.rowCount ?? null,
      fields: await describeFields(entry, r.fields ?? []),
      rows: (r.rows ?? []).slice(0, maxRows) as Cell[][],
      truncated: (r.rows?.length ?? 0) > maxRows,
    };
  }
  const cursor = session.client.query(new Cursor(text, undefined, { rowMode: "array", types: rawTypes } as never));
  try {
    const rows = (await cursor.read(maxRows + 1)) as Cell[][];
    const truncated = rows.length > maxRows;
    if (truncated) rows.length = maxRows;
    const internal = (cursor as unknown as { _result: { fields: { name: string; dataTypeID: number }[]; command: string; rowCount: number | null } })._result;
    return {
      command: internal?.command || keyword,
      rowCount: truncated ? null : (internal?.rowCount ?? rows.length),
      fields: await describeFields(entry, internal?.fields ?? []),
      rows,
      truncated,
    };
  } finally {
    await cursor.close().catch(() => undefined);
  }
}
