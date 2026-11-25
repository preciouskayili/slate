// Slate local server. Binds to loopback only and refuses cross-site requests.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { stream } from "hono/streaming";
import { existsSync } from "node:fs";
import path from "node:path";
import { leadingKeyword, splitStatements } from "../shared/sql.js";
import type { ConnectionInput, MutateRequest, QueryRequest, RowsRequest, TableDetails } from "../shared/types.js";
import { exportRows, fetchRows, mutate, runningSession, runQuery } from "./data.js";
import { routineDefinition, schemaTree, tableDetails } from "./introspect.js";
import { closeConnection, closeSession, connectClient, findSession, getPool, getSession, HttpError, toApiError } from "./pg.js";
import { store } from "./store.js";

let token: string | undefined = process.env.SLATE_TOKEN;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const LOOPBACK_ORIGIN = /^(https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?|file:\/\/|null)$/;

export const app = new Hono();

// DNS-rebinding and CSRF protection: loopback Host, loopback Origin, and a custom header
// (which a cross-site page cannot send without a CORS preflight this server never approves).
app.use("/api/*", async (c, next) => {
  const host = c.req.header("host") ?? "";
  const origin = c.req.header("origin");
  if (!LOOPBACK_HOST.test(host) || (origin && !LOOPBACK_ORIGIN.test(origin)) || c.req.header("x-slate-client") !== "1") {
    return c.json({ error: "Forbidden" }, 403);
  }
  if (token && c.req.header("authorization") !== `Bearer ${token}`) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

app.onError((error, c) => {
  const { status, body } = toApiError(error);
  if (status >= 500) console.error(`[slate] ${c.req.method} ${c.req.path}:`, body.error);
  return c.json(body, status as 400);
});

const body = async <T>(c: Context) => (await c.req.json().catch(() => ({}))) as T;

// ---- Connections

app.get("/api/connections", async (c) => c.json(await store.listConnections()));

app.post("/api/connections", async (c) => c.json(await store.createConnection(await body<ConnectionInput>(c))));

app.put("/api/connections/:id", async (c) => {
  const id = c.req.param("id");
  const updated = await store.updateConnection(id, await body<ConnectionInput>(c));
  if (!updated) throw new HttpError(404, "Connection not found");
  await closeConnection(id);
  return c.json(updated);
});

app.delete("/api/connections/:id", async (c) => {
  const id = c.req.param("id");
  await closeConnection(id);
  await store.deleteConnection(id);
  return c.json({ ok: true });
});

/** Test settings before saving. `id` lets an edit reuse the stored password. */
app.post("/api/connections/test", async (c) => {
  const input = await body<ConnectionInput & { id?: string }>(c);
  const existing = input.id ? await store.getConnection(input.id) : undefined;
  const conn = {
    ...input,
    id: "test",
    createdAt: "",
    port: Number(input.port) || 5432,
    password: input.password === undefined ? (existing?.password ?? "") : input.password,
  };
  const started = performance.now();
  const client = await connectClient(conn, conn.database || "postgres");
  try {
    const { rows } = await client.query("select version() as version, current_user as user");
    return c.json({ ok: true, version: rows[0].version, user: rows[0].user, ms: Math.round(performance.now() - started) });
  } finally {
    await client.end().catch(() => undefined);
  }
});

// ---- Introspection

const detailsCache = new Map<string, { at: number; value: Promise<TableDetails> }>();
const DETAILS_TTL = 20_000;

function cachedDetails(id: string, database: string, pool: Parameters<typeof tableDetails>[0], schema: string, table: string, fresh = false) {
  const key = [id, database, schema, table].join("\u0000");
  const hit = detailsCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < DETAILS_TTL) return hit.value;
  const value = tableDetails(pool, schema, table);
  detailsCache.set(key, { at: Date.now(), value });
  value.catch(() => detailsCache.delete(key));
  return value;
}

function invalidateDetails(id: string) {
  for (const key of detailsCache.keys()) if (key.startsWith(id + "\u0000")) detailsCache.delete(key);
}

app.get("/api/c/:id/info", async (c) => {
  const { entry, conn, database } = await getPool(c.req.param("id"), c.req.query("db"));
  const [info, dbs] = await Promise.all([
    entry.pool.query(
      `select version() as version, current_setting('server_version') as server_version, current_user as user,
              pg_database_size(current_database()) as bytes, current_setting('default_transaction_read_only') = 'on' as read_only`,
    ),
    entry.pool.query("select datname from pg_database where datallowconn and not datistemplate order by datname"),
  ]);
  return c.json({
    database,
    defaultDatabase: conn.database,
    databases: dbs.rows.map((r) => r.datname),
    version: info.rows[0].server_version,
    versionString: info.rows[0].version,
    user: info.rows[0].user,
    bytes: Number(info.rows[0].bytes),
    readOnly: info.rows[0].read_only,
  });
});

app.get("/api/c/:id/schema", async (c) => {
  const id = c.req.param("id");
  const { entry } = await getPool(id, c.req.query("db"));
  invalidateDetails(id);
  return c.json(await schemaTree(entry.pool));
});

app.get("/api/c/:id/table", async (c) => {
  const id = c.req.param("id");
  const { entry, database } = await getPool(id, c.req.query("db"));
  return c.json(await cachedDetails(id, database, entry.pool, c.req.query("schema") ?? "public", c.req.query("name") ?? "", c.req.query("fresh") === "1"));
});

app.get("/api/c/:id/routine", async (c) => {
  const { entry } = await getPool(c.req.param("id"), c.req.query("db"));
  return c.json({ definition: await routineDefinition(entry.pool, c.req.query("schema")!, c.req.query("name")!, c.req.query("args") ?? "") });
});

// ---- Data

app.post("/api/c/:id/rows", async (c) => {
  const id = c.req.param("id");
  const req = await body<RowsRequest>(c);
  const { entry, database } = await getPool(id, req.database);
  const details = await cachedDetails(id, database, entry.pool, req.schema, req.table);
  return c.json(await fetchRows(entry.pool, req, details));
});

app.post("/api/c/:id/mutate", async (c) => {
  const id = c.req.param("id");
  const req = await body<MutateRequest>(c);
  const { entry, database } = await getPool(id, req.database);
  const details = await cachedDetails(id, database, entry.pool, req.schema, req.table);
  return c.json(await mutate(entry.pool, req, details));
});

app.post("/api/c/:id/export", async (c) => {
  const id = c.req.param("id");
  const req = await body<RowsRequest & { format: "csv" | "json" | "sql" }>(c);
  const format = (["csv", "json", "sql"] as const).includes(req.format) ? req.format : "csv";
  const { entry, database } = await getPool(id, req.database);
  const details = await cachedDetails(id, database, entry.pool, req.schema, req.table);
  const types = { csv: "text/csv", json: "application/json", sql: "application/sql" };
  c.header("content-type", `${types[format]}; charset=utf-8`);
  return stream(c, async (s) => {
    for await (const chunk of exportRows(entry.pool, req, details, format)) await s.write(chunk);
  });
});

// ---- SQL runner

const MUTATING = new Set(["CREATE", "ALTER", "DROP", "TRUNCATE", "COMMENT", "GRANT", "REVOKE", "REFRESH", "REINDEX"]);

app.post("/api/c/:id/query", async (c) => {
  const id = c.req.param("id");
  const req = await body<QueryRequest & { sessionId: string }>(c);
  const { entry, database } = await getPool(id, req.database);
  const session = await getSession(id, req.sessionId || req.queryId, database);
  const result = await runQuery(session, entry, req.sql, req.queryId, Math.min(req.maxRows ?? 5000, 100_000));
  if (splitStatements(req.sql).some((s) => MUTATING.has(leadingKeyword(s.text)))) invalidateDetails(id);
  const rows = result.results.reduce<number | null>((sum, r) => (r.rowCount === null ? sum : (sum ?? 0) + r.rowCount), null);
  store.addHistory({ connectionId: id, database, sql: req.sql.trim(), ok: !result.error, ms: result.ms, rows }).catch(() => undefined);
  if (result.error) {
    const { body: err } = toApiError(result.error);
    return c.json({ ...result, error: { ...err, position: result.failedAt } });
  }
  return c.json(result);
});

app.post("/api/c/:id/cancel", async (c) => {
  const { queryId } = await body<{ queryId: string }>(c);
  const session = runningSession(queryId);
  if (!session) return c.json({ ok: false });
  const { entry } = await getPool(session.connectionId, session.database);
  await entry.pool.query("select pg_cancel_backend($1)", [session.pid]);
  return c.json({ ok: true });
});

app.get("/api/c/:id/session/:sid", (c) => {
  const session = findSession(c.req.param("id"), c.req.param("sid"));
  return c.json({ txStatus: session?.txStatus ?? "I", open: Boolean(session) });
});

app.delete("/api/c/:id/session/:sid", async (c) => {
  await closeSession(c.req.param("id"), c.req.param("sid"));
  return c.json({ ok: true });
});

app.get("/api/c/:id/activity", async (c) => {
  const { entry } = await getPool(c.req.param("id"), c.req.query("db"));
  const { rows } = await entry.pool.query(
    `select pid, usename as user, datname as database, application_name as app, client_addr::text as client,
            state, wait_event_type || coalesce(':' || wait_event, '') as wait,
            extract(epoch from now() - query_start)::float as seconds, left(query, 2000) as query
     from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid()
     order by query_start nulls last`,
  );
  return c.json(rows);
});

// ---- Saved queries and history

app.get("/api/saved", async (c) => c.json(await store.listSaved()));
app.post("/api/saved", async (c) => c.json(await store.upsertSaved(await body(c))));
app.delete("/api/saved/:id", async (c) => {
  await store.deleteSaved(c.req.param("id"));
  return c.json({ ok: true });
});
app.get("/api/history", async (c) => c.json(await store.listHistory()));
app.delete("/api/history", async (c) => {
  await store.clearHistory();
  return c.json({ ok: true });
});

// ---- Startup

export interface StartOptions {
  port: number;
  /** Require `Authorization: Bearer <token>` on every API call. */
  token?: string;
  /** Serve the built web app from this directory. */
  webRoot?: string;
}

let staticMounted = false;

export function startServer(options: StartOptions): Promise<{ port: number; close: () => void }> {
  if (options.token) token = options.token;
  if (options.webRoot && existsSync(options.webRoot) && !staticMounted) {
    staticMounted = true;
    const root = path.resolve(options.webRoot);
    app.use("/*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" }));
  }
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: options.port }, (info) => {
      resolve({ port: info.port, close: () => server.close() });
    });
    server.once("error", reject); // e.g. EADDRINUSE
  });
}
