// Local persistence for connections, saved queries and history.
// Files live in ~/.slate (override with SLATE_HOME) with owner-only permissions,
// the same trust model as ~/.pgpass.
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Connection, ConnectionInput, HistoryEntry, SavedQuery } from "../shared/types.js";

const HOME = process.env.SLATE_HOME ?? path.join(homedir(), ".slate");
const HISTORY_LIMIT = 500;

interface StoredConnection extends Omit<ConnectionInput, "password"> {
  id: string;
  password: string;
  createdAt: string;
}

async function ensureHome() {
  await mkdir(HOME, { recursive: true, mode: 0o700 });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(HOME, file), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

// Serialise writes per file so concurrent requests never interleave.
const queues = new Map<string, Promise<unknown>>();
async function writeJson(file: string, value: unknown) {
  const run = async () => {
    await ensureHome();
    const target = path.join(HOME, file);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(tmp, target);
    await chmod(target, 0o600);
  };
  const next = (queues.get(file) ?? Promise.resolve()).then(run, run);
  queues.set(file, next);
  return next;
}

function toPublic(c: StoredConnection): Connection {
  const { password, ...rest } = c;
  return { ...rest, hasPassword: password.length > 0 };
}

export const store = {
  home: HOME,

  async listConnections(): Promise<Connection[]> {
    return (await readJson<StoredConnection[]>("connections.json", [])).map(toPublic);
  },

  async getConnection(id: string): Promise<StoredConnection | undefined> {
    return (await readJson<StoredConnection[]>("connections.json", [])).find((c) => c.id === id);
  },

  async createConnection(input: ConnectionInput): Promise<Connection> {
    const all = await readJson<StoredConnection[]>("connections.json", []);
    const conn: StoredConnection = {
      ...sanitize(input),
      id: randomUUID(),
      password: input.password ?? "",
      createdAt: new Date().toISOString(),
    };
    all.push(conn);
    await writeJson("connections.json", all);
    return toPublic(conn);
  },

  async updateConnection(id: string, input: ConnectionInput): Promise<Connection | undefined> {
    const all = await readJson<StoredConnection[]>("connections.json", []);
    const index = all.findIndex((c) => c.id === id);
    if (index < 0) return undefined;
    const current = all[index];
    all[index] = {
      ...current,
      ...sanitize(input),
      password: input.password === undefined ? current.password : input.password,
    };
    await writeJson("connections.json", all);
    return toPublic(all[index]);
  },

  async deleteConnection(id: string) {
    const all = await readJson<StoredConnection[]>("connections.json", []);
    await writeJson("connections.json", all.filter((c) => c.id !== id));
  },

  async listSaved(): Promise<SavedQuery[]> {
    return readJson<SavedQuery[]>("queries.json", []);
  },

  async upsertSaved(query: Omit<SavedQuery, "id" | "updatedAt"> & { id?: string }): Promise<SavedQuery> {
    const all = await readJson<SavedQuery[]>("queries.json", []);
    const saved: SavedQuery = {
      id: query.id ?? randomUUID(),
      connectionId: query.connectionId,
      name: query.name.trim() || "Untitled query",
      sql: query.sql,
      updatedAt: new Date().toISOString(),
    };
    const index = all.findIndex((q) => q.id === saved.id);
    if (index >= 0) all[index] = saved;
    else all.unshift(saved);
    await writeJson("queries.json", all);
    return saved;
  },

  async deleteSaved(id: string) {
    const all = await readJson<SavedQuery[]>("queries.json", []);
    await writeJson("queries.json", all.filter((q) => q.id !== id));
  },

  async listHistory(): Promise<HistoryEntry[]> {
    return readJson<HistoryEntry[]>("history.json", []);
  },

  async addHistory(entry: Omit<HistoryEntry, "id" | "at">) {
    const all = await readJson<HistoryEntry[]>("history.json", []);
    // Collapse immediate repeats of the same statement.
    if (all[0]?.sql === entry.sql && all[0]?.connectionId === entry.connectionId) all.shift();
    all.unshift({ ...entry, id: randomUUID(), at: new Date().toISOString() });
    await writeJson("history.json", all.slice(0, HISTORY_LIMIT));
  },

  async clearHistory() {
    await writeJson("history.json", []);
  },
};

function sanitize(input: ConnectionInput): Omit<ConnectionInput, "password"> {
  return {
    name: String(input.name ?? "").trim() || `${input.host}/${input.database}`,
    color: String(input.color ?? "zinc"),
    host: String(input.host ?? "localhost").trim(),
    port: Number(input.port) || 5432,
    database: String(input.database ?? "postgres").trim(),
    user: String(input.user ?? "").trim(),
    ssl: (["disable", "prefer", "require", "verify-full"] as const).includes(input.ssl) ? input.ssl : "prefer",
    readOnly: Boolean(input.readOnly),
  };
}

export type { StoredConnection };
