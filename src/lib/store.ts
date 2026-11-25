import { create } from "zustand";
import type { ApiError, Cell, Filter, QueryResultSet, RowKey, Sort } from "@shared/types";
import { storageGet, storageSet, uid } from "./utils";
import { api } from "./api";

export type Theme = "system" | "light" | "dark";

interface TabBase {
  id: string;
  connectionId: string;
  database: string;
}

export interface TableTab extends TabBase {
  kind: "table";
  schema: string;
  table: string;
  preview: boolean;
  view: "data" | "structure";
  filters: Filter[];
  match: "all" | "any";
  where: string;
  search: string;
  sort: Sort[];
  page: number;
  pageSize: number;
  showFilters: boolean;
  hiddenColumns: string[];
}

export interface QueryTab extends TabBase {
  kind: "query";
  title: string;
  sql: string;
  savedId?: string;
  savedSql?: string;
  split: number;
}

export interface RoutineTab extends TabBase {
  kind: "routine";
  schema: string;
  name: string;
  args: string;
}

export interface ActivityTab extends TabBase {
  kind: "activity";
}

export type Tab = TableTab | QueryTab | RoutineTab | ActivityTab;

export interface Pending {
  updates: Record<string, { key: RowKey; values: Record<string, Cell> }>;
  inserts: { tempId: string; values: Record<string, Cell> }[];
  deletes: Record<string, RowKey>;
}

export const emptyPending = (): Pending => ({ updates: {}, inserts: [], deletes: {} });
export const pendingCount = (p?: Pending) =>
  p ? Object.keys(p.updates).length + p.inserts.length + Object.keys(p.deletes).length : 0;

export interface QueryRun {
  status: "running" | "done" | "error";
  queryId: string;
  startedAt: number;
  results: QueryResultSet[];
  notices: string[];
  error?: ApiError;
  ms?: number;
  sql: string;
  /** Offset of the executed text inside the editor document. */
  offset: number;
  activeResult: number;
  explain?: boolean;
}

interface State {
  theme: Theme;
  connectionId: string | null;
  databases: Record<string, string>;
  tabs: Tab[];
  activeTab: Record<string, string | null>;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  collapsedGroups: Record<string, boolean>;
  schemaFilter: Record<string, string>;
  pending: Record<string, Pending>;
  runs: Record<string, QueryRun>;
  txStatus: Record<string, "I" | "T" | "E">;
  paletteOpen: boolean;
  connectionDialog: { open: boolean; editId?: string; url?: string };
  /** When each connection was last opened (ms epoch). */
  lastOpened: Record<string, number>;
}

const persisted = storageGet<Partial<State>>("slate.state", {});

export const useApp = create<State>(() => ({
  theme: storageGet<Theme>("slate.theme", "system"),
  connectionId: persisted.connectionId ?? null,
  databases: persisted.databases ?? {},
  tabs: (persisted.tabs ?? []).map((t) => (t.kind === "table" ? { ...t, preview: false } : t)),
  activeTab: persisted.activeTab ?? {},
  sidebarWidth: persisted.sidebarWidth ?? 264,
  sidebarCollapsed: persisted.sidebarCollapsed ?? false,
  inspectorOpen: persisted.inspectorOpen ?? false,
  collapsedGroups: persisted.collapsedGroups ?? {},
  schemaFilter: persisted.schemaFilter ?? {},
  pending: {},
  runs: {},
  txStatus: {},
  paletteOpen: false,
  connectionDialog: { open: false },
  lastOpened: persisted.lastOpened ?? {},
}));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useApp.subscribe((s) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    storageSet("slate.state", {
      connectionId: s.connectionId,
      databases: s.databases,
      tabs: s.tabs,
      activeTab: s.activeTab,
      sidebarWidth: s.sidebarWidth,
      sidebarCollapsed: s.sidebarCollapsed,
      inspectorOpen: s.inspectorOpen,
      collapsedGroups: s.collapsedGroups,
      schemaFilter: s.schemaFilter,
      lastOpened: s.lastOpened,
    });
  }, 250);
});

const set = useApp.setState;
const get = useApp.getState;

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export const actions = {
  setTheme(theme: Theme) {
    storageSet("slate.theme", theme);
    set({ theme });
    applyTheme(theme);
  },

  selectConnection(id: string | null) {
    set((s) => ({ connectionId: id, lastOpened: id ? { ...s.lastOpened, [id]: Date.now() } : s.lastOpened }));
  },

  /** Open a connection straight onto one of its existing tabs. */
  resumeTab(tab: Tab) {
    set((s) => ({
      connectionId: tab.connectionId,
      lastOpened: { ...s.lastOpened, [tab.connectionId]: Date.now() },
      databases: { ...s.databases, [tab.connectionId]: tab.database },
      activeTab: { ...s.activeTab, [tab.connectionId]: tab.id },
    }));
  },

  setDatabase(connectionId: string, database: string) {
    set((s) => ({ databases: { ...s.databases, [connectionId]: database } }));
  },

  currentDatabase(connectionId: string, fallback: string) {
    return get().databases[connectionId] ?? fallback;
  },

  activate(tabId: string | null) {
    const { connectionId } = get();
    if (!connectionId) return;
    set((s) => ({ activeTab: { ...s.activeTab, [connectionId]: tabId } }));
  },

  openTable(
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    opts: { preview?: boolean; filters?: Filter[]; view?: TableTab["view"]; newTab?: boolean } = {},
  ) {
    const s = get();
    const existing = s.tabs.find(
      (t) => t.kind === "table" && t.connectionId === connectionId && t.database === database && t.schema === schema && t.table === table,
    ) as TableTab | undefined;
    if (existing && !opts.newTab) {
      const patch: Partial<TableTab> = {};
      if (opts.filters) Object.assign(patch, { filters: opts.filters, showFilters: true, page: 0 });
      if (opts.view) patch.view = opts.view;
      if (opts.preview === false) patch.preview = false;
      actions.updateTab(existing.id, patch);
      actions.activate(existing.id);
      return existing.id;
    }
    const tab: TableTab = {
      id: uid(),
      kind: "table",
      connectionId,
      database,
      schema,
      table,
      preview: opts.preview ?? false,
      view: opts.view ?? "data",
      filters: opts.filters ?? [],
      match: "all",
      where: "",
      search: "",
      sort: [],
      page: 0,
      pageSize: 100,
      showFilters: Boolean(opts.filters?.length),
      hiddenColumns: [],
    };
    // Replace the current preview tab (unless it has unsaved edits).
    const previewTab = s.tabs.find(
      (t) => t.kind === "table" && t.preview && t.connectionId === connectionId && pendingCount(s.pending[t.id]) === 0,
    );
    set((st) => {
      const tabs = [...st.tabs];
      if (tab.preview && previewTab) tabs[tabs.indexOf(previewTab)] = tab;
      else {
        const activeIndex = tabs.findIndex((t) => t.id === st.activeTab[connectionId]);
        tabs.splice(activeIndex >= 0 ? activeIndex + 1 : tabs.length, 0, tab);
      }
      return { tabs, activeTab: { ...st.activeTab, [connectionId]: tab.id } };
    });
    return tab.id;
  },

  openQuery(connectionId: string, database: string, opts: { sql?: string; title?: string; savedId?: string } = {}) {
    const s = get();
    if (opts.savedId) {
      const existing = s.tabs.find((t) => t.kind === "query" && t.savedId === opts.savedId);
      if (existing) {
        actions.activate(existing.id);
        return existing.id;
      }
    }
    const count = s.tabs.filter((t) => t.kind === "query" && t.connectionId === connectionId).length;
    const tab: QueryTab = {
      id: uid(),
      kind: "query",
      connectionId,
      database,
      title: opts.title ?? (count ? `Query ${count + 1}` : "Query"),
      sql: opts.sql ?? "",
      savedId: opts.savedId,
      savedSql: opts.savedId ? opts.sql : undefined,
      split: 0.45,
    };
    set((st) => ({ tabs: [...st.tabs, tab], activeTab: { ...st.activeTab, [connectionId]: tab.id } }));
    return tab.id;
  },

  openRoutine(connectionId: string, database: string, schema: string, name: string, args: string) {
    const existing = get().tabs.find(
      (t) => t.kind === "routine" && t.connectionId === connectionId && t.schema === schema && t.name === name && t.args === args,
    );
    if (existing) return actions.activate(existing.id);
    const tab: RoutineTab = { id: uid(), kind: "routine", connectionId, database, schema, name, args };
    set((st) => ({ tabs: [...st.tabs, tab], activeTab: { ...st.activeTab, [connectionId]: tab.id } }));
  },

  openActivity(connectionId: string, database: string) {
    const existing = get().tabs.find((t) => t.kind === "activity" && t.connectionId === connectionId);
    if (existing) return actions.activate(existing.id);
    const tab: ActivityTab = { id: uid(), kind: "activity", connectionId, database };
    set((st) => ({ tabs: [...st.tabs, tab], activeTab: { ...st.activeTab, [connectionId]: tab.id } }));
  },

  updateTab<T extends Tab>(id: string, patch: Partial<T>) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) }));
  },

  closeTab(id: string) {
    const closing = get().tabs.find((t) => t.id === id);
    if (closing?.kind === "query") api.del(`/api/c/${closing.connectionId}/session/${id}`).catch(() => undefined);
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === id);
      if (index < 0) return s;
      const tab = s.tabs[index];
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTab = { ...s.activeTab };
      if (activeTab[tab.connectionId] === id) {
        const siblings = tabs.filter((t) => t.connectionId === tab.connectionId);
        const before = s.tabs.slice(0, index).filter((t) => t.connectionId === tab.connectionId).pop();
        activeTab[tab.connectionId] = before?.id ?? siblings[0]?.id ?? null;
      }
      const { [id]: _p, ...pending } = s.pending;
      const { [id]: _r, ...runs } = s.runs;
      return { tabs, activeTab, pending, runs };
    });
  },

  closeOthers(id: string) {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    for (const t of get().tabs) if (t.connectionId === tab.connectionId && t.id !== id) actions.closeTab(t.id);
  },

  moveTab(id: string, toIndex: number) {
    set((s) => {
      const tabs = [...s.tabs];
      const from = tabs.findIndex((t) => t.id === id);
      if (from < 0) return s;
      const [tab] = tabs.splice(from, 1);
      tabs.splice(toIndex, 0, tab);
      return { tabs };
    });
  },

  setPending(tabId: string, fn: (p: Pending) => Pending) {
    set((s) => ({ pending: { ...s.pending, [tabId]: fn(s.pending[tabId] ?? emptyPending()) } }));
    const tab = get().tabs.find((t) => t.id === tabId);
    if (tab?.kind === "table" && tab.preview) actions.updateTab(tabId, { preview: false });
  },

  clearPending(tabId: string) {
    set((s) => ({ pending: { ...s.pending, [tabId]: emptyPending() } }));
  },

  setRun(tabId: string, run: QueryRun | ((prev: QueryRun | undefined) => QueryRun)) {
    set((s) => ({ runs: { ...s.runs, [tabId]: typeof run === "function" ? run(s.runs[tabId]) : run } }));
  },

  setTx(tabId: string, status: "I" | "T" | "E") {
    set((s) => ({ txStatus: { ...s.txStatus, [tabId]: status } }));
  },

  toggleGroup(key: string) {
    set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [key]: !s.collapsedGroups[key] } }));
  },
};

export const useActiveTab = () =>
  useApp((s) => {
    if (!s.connectionId) return undefined;
    const id = s.activeTab[s.connectionId];
    return s.tabs.find((t) => t.id === id && t.connectionId === s.connectionId);
  });
