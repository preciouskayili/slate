// Connection pools, per-tab query sessions and type-name lookup.
import pg from "pg";
import type { ApiError, FieldInfo } from "../shared/types.js";
import { store, type StoredConnection } from "./store.js";

/** Return every value as the text Postgres sent, so nothing loses precision and edits round-trip. */
export const rawTypes = { getTypeParser: () => (value: string) => value } as unknown as pg.CustomTypesConfig;

interface PoolEntry {
  pool: pg.Pool;
  typeNames: Map<number, string>;
}

const pools = new Map<string, Promise<PoolEntry>>();

function sslOption(conn: StoredConnection, attemptSsl: boolean): pg.ClientConfig["ssl"] {
  if (conn.ssl === "disable" || !attemptSsl) return false;
  if (conn.ssl === "verify-full") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export function clientConfig(conn: StoredConnection, database: string, attemptSsl = true): pg.ClientConfig {
  return {
    host: conn.host,
    port: conn.port,
    user: conn.user || undefined,
    password: conn.password || undefined,
    database,
    ssl: sslOption(conn, attemptSsl),
    application_name: "Slate",
    connectionTimeoutMillis: 10_000,
    options: conn.readOnly ? "-c default_transaction_read_only=on" : undefined,
  };
}

const NO_SSL = /does not support SSL|SSL off|no pg_hba.conf entry.*SSL off/i;

/** Connect a standalone client, falling back from SSL to plain for `prefer`. */
export async function connectClient(conn: StoredConnection, database: string): Promise<pg.Client> {
  const client = new pg.Client(clientConfig(conn, database, true));
  // Never let a connection-level error escape as an unhandled event; callers see it via promises.
  client.on("error", () => undefined);
  try {
    await client.connect();
    return client;
  } catch (error) {
    if (conn.ssl !== "prefer" || !NO_SSL.test(String((error as Error).message))) throw error;
    const plain = new pg.Client(clientConfig(conn, database, false));
    plain.on("error", () => undefined);
    await plain.connect();
    return plain;
  }
}

/**
 * Check a client out of the pool. pg-pool removes its error listener while a client is checked out,
 * so a dropped connection mid-query would emit an unhandled 'error' and take the whole process down.
 * `done()` releases it, discarding the connection if it broke.
 */
export async function checkout(pool: pg.Pool): Promise<pg.PoolClient & { done(): void }> {
  const client = await pool.connect();
  let broken = false;
  const onError = () => {
    broken = true;
  };
  client.on("error", onError);
  return Object.assign(client, {
    done() {
      client.off("error", onError);
      client.release(broken || undefined);
    },
  });
}

async function createPool(conn: StoredConnection, database: string): Promise<PoolEntry> {
  // Probe once to learn whether SSL works for `prefer`.
  const probe = await connectClient(conn, database);
  const usedSsl = Boolean((probe as unknown as { ssl: unknown }).ssl);
  await probe.end();
  const pool = new pg.Pool({ ...clientConfig(conn, database, usedSsl || conn.ssl !== "prefer"), max: 6, idleTimeoutMillis: 60_000 });
  pool.on("error", () => {
    /* Idle client errors (server restarts) are recovered on next checkout. */
  });
  return { pool, typeNames: new Map() };
}

export async function getPool(connectionId: string, database?: string): Promise<{ entry: PoolEntry; conn: StoredConnection; database: string }> {
  const conn = await store.getConnection(connectionId);
  if (!conn) throw new HttpError(404, "Connection not found");
  const db = database || conn.database;
  const key = `${connectionId}\u0000${db}`;
  let promise = pools.get(key);
  if (!promise) {
    promise = createPool(conn, db);
    pools.set(key, promise);
    promise.catch(() => pools.delete(key));
  }
  return { entry: await promise, conn, database: db };
}

export async function closeConnection(connectionId: string) {
  for (const [key, promise] of pools) {
    if (key.startsWith(connectionId + "\u0000")) {
      pools.delete(key);
      promise.then((p) => p.pool.end()).catch(() => undefined);
    }
  }
  for (const [key, session] of sessions) {
    if (session.connectionId === connectionId) {
      sessions.delete(key);
      session.client.end().catch(() => undefined);
    }
  }
}

export async function resolveTypeNames(entry: PoolEntry, oids: number[]): Promise<Map<number, string>> {
  const missing = [...new Set(oids)].filter((oid) => !entry.typeNames.has(oid));
  if (missing.length) {
    const { rows } = await entry.pool.query<{ oid: number; name: string }>(
      "select oid::int as oid, format_type(oid, null) as name from pg_type where oid = any($1::oid[])",
      [missing],
    );
    for (const row of rows) entry.typeNames.set(row.oid, row.name);
  }
  return entry.typeNames;
}

export async function describeFields(entry: PoolEntry, fields: { name: string; dataTypeID: number }[]): Promise<FieldInfo[]> {
  const names = await resolveTypeNames(entry, fields.map((f) => f.dataTypeID));
  return fields.map((f) => ({ name: f.name, typeId: f.dataTypeID, type: names.get(f.dataTypeID) ?? String(f.dataTypeID) }));
}

// ---- Query sessions: one dedicated backend per query tab, so BEGIN/COMMIT and SET
// persist across runs exactly like a psql session.

export interface Session {
  key: string;
  connectionId: string;
  database: string;
  client: pg.Client;
  /** ReadyForQuery status: I idle, T in transaction, E failed transaction. */
  txStatus: "I" | "T" | "E";
  pid: number;
  lastUsed: number;
  busy: boolean;
  notices: string[];
}

const sessions = new Map<string, Session>();
const SESSION_IDLE_MS = 15 * 60_000;

export async function getSession(connectionId: string, sessionId: string, database?: string): Promise<Session> {
  const conn = await store.getConnection(connectionId);
  if (!conn) throw new HttpError(404, "Connection not found");
  const db = database || conn.database;
  const key = `${connectionId}\u0000${db}\u0000${sessionId}`;
  const existing = sessions.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }
  const client = await connectClient(conn, db);
  const session: Session = {
    key,
    connectionId,
    database: db,
    client,
    txStatus: "I",
    pid: (client as unknown as { processID: number }).processID,
    lastUsed: Date.now(),
    busy: false,
    notices: [],
  };
  const connection = (client as unknown as { connection: NodeJS.EventEmitter }).connection;
  connection.on("readyForQuery", (msg: { status: string }) => {
    session.txStatus = (msg.status as Session["txStatus"]) ?? "I";
  });
  client.on("notice", (msg) => session.notices.push(`${msg.severity ?? "NOTICE"}: ${msg.message}`));
  client.on("error", () => {
    sessions.delete(key);
  });
  client.on("end", () => sessions.delete(key));
  sessions.set(key, session);
  return session;
}

export function findSession(connectionId: string, sessionId: string): Session | undefined {
  for (const session of sessions.values()) {
    if (session.connectionId === connectionId && session.key.endsWith("\u0000" + sessionId)) return session;
  }
  return undefined;
}

export async function closeSession(connectionId: string, sessionId: string) {
  for (const [key, session] of sessions) {
    if (session.connectionId === connectionId && key.endsWith("\u0000" + sessionId)) {
      sessions.delete(key);
      await session.client.end().catch(() => undefined);
    }
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (!session.busy && now - session.lastUsed > SESSION_IDLE_MS) {
      sessions.delete(key);
      session.client.end().catch(() => undefined);
    }
  }
}, 60_000).unref();

// ---- Errors

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Partial<ApiError> = {},
  ) {
    super(message);
  }
}

export function toApiError(error: unknown): { status: number; body: ApiError } {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.message, ...error.extra } };
  const e = error as pg.DatabaseError & { code?: string };
  if (e && typeof e === "object" && "severity" in e) {
    return {
      status: 400,
      body: {
        error: e.message,
        detail: e.detail,
        hint: e.hint,
        position: e.position ? Number(e.position) : undefined,
        code: e.code,
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = (e as { code?: string })?.code;
  if (code === "ECONNREFUSED") return { status: 502, body: { error: "Connection refused", detail: message, code } };
  if (code === "ENOTFOUND") return { status: 502, body: { error: "Host not found", detail: message, code } };
  return { status: 500, body: { error: message || "Unexpected error", code } };
}
