import { keepPreviousData, QueryClient, useQuery } from "@tanstack/react-query";
import type { Connection, HistoryEntry, RowsRequest, RowsResponse, SavedQuery, SchemaTree, TableDetails } from "@shared/types";
import { api } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

export interface ServerInfo {
  database: string;
  defaultDatabase: string;
  databases: string[];
  version: string;
  versionString: string;
  user: string;
  bytes: number;
  readOnly: boolean;
}

export const useConnections = () => useQuery({ queryKey: ["connections"], queryFn: () => api.get<Connection[]>("/api/connections") });

export const useInfo = (id: string | null, db?: string) =>
  useQuery({
    queryKey: ["info", id, db],
    queryFn: () => api.get<ServerInfo>(`/api/c/${id}/info${db ? `?db=${encodeURIComponent(db)}` : ""}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });

export const useSchema = (id: string | null, db?: string) =>
  useQuery({
    queryKey: ["schema", id, db],
    queryFn: () => api.get<SchemaTree>(`/api/c/${id}/schema?db=${encodeURIComponent(db ?? "")}`),
    enabled: Boolean(id && db),
    staleTime: 5 * 60_000,
  });

export const useTable = (id: string, db: string, schema: string, name: string) =>
  useQuery({
    queryKey: ["table", id, db, schema, name],
    queryFn: () =>
      api.get<TableDetails>(`/api/c/${id}/table?db=${encodeURIComponent(db)}&schema=${encodeURIComponent(schema)}&name=${encodeURIComponent(name)}`),
    staleTime: 60_000,
  });

export const useRows = (id: string, req: RowsRequest, enabled = true) =>
  useQuery({
    queryKey: ["rows", id, req],
    queryFn: ({ signal }) => api.post<RowsResponse>(`/api/c/${id}/rows`, req, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
    enabled,
  });

export const useSaved = () => useQuery({ queryKey: ["saved"], queryFn: () => api.get<SavedQuery[]>("/api/saved") });
export const useHistory = () => useQuery({ queryKey: ["history"], queryFn: () => api.get<HistoryEntry[]>("/api/history") });

export function refreshSchema(connectionId: string) {
  queryClient.invalidateQueries({ queryKey: ["schema", connectionId] });
  queryClient.invalidateQueries({ queryKey: ["table", connectionId] });
  queryClient.invalidateQueries({ queryKey: ["rows", connectionId] });
}
