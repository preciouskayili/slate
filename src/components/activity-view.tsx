import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { ActivityTab } from "@/lib/store";
import { cn } from "@/lib/utils";
import { confirmSql, runSql } from "./confirm-sql";
import { Button } from "./ui/button";
import { ArrowsClockwise, Pulse, Stop, X } from "./ui/icons";
import { Empty, Spinner, Switch } from "./ui/misc";
import { toast } from "./ui/toast";

interface Backend {
  pid: number;
  user: string;
  database: string;
  app: string;
  client: string | null;
  state: string | null;
  wait: string | null;
  seconds: number | null;
  query: string;
}

export function ActivityView({ tab }: { tab: ActivityTab }) {
  const [live, setLive] = useState(true);
  const [hideIdle, setHideIdle] = useState(true);
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["activity", tab.connectionId, tab.database],
    queryFn: () => api.get<Backend[]>(`/api/c/${tab.connectionId}/activity?db=${encodeURIComponent(tab.database)}`),
    refetchInterval: live ? 2000 : false,
  });
  const rows = (data ?? []).filter((b) => !hideIdle || (b.state && b.state !== "idle"));
  const signal = (pid: number, fn: "pg_cancel_backend" | "pg_terminate_backend") =>
    confirmSql({
      title: fn === "pg_cancel_backend" ? `Cancel query on backend ${pid}?` : `Terminate backend ${pid}?`,
      description: fn === "pg_terminate_backend" ? "Any open transaction is rolled back." : undefined,
      sql: `SELECT ${fn}(${pid});`,
      danger: fn === "pg_terminate_backend",
      confirmLabel: fn === "pg_cancel_backend" ? "Cancel query" : "Terminate",
      run: async () => {
        await runSql(tab.connectionId, tab.database, `SELECT ${fn}(${pid})`);
        toast(fn === "pg_cancel_backend" ? "Cancel signal sent" : "Backend terminated");
        refetch();
      },
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-fg/[0.06] px-3">
        <Pulse className="size-4 text-fg/40" />
        <span className="text-sm font-medium">Server activity</span>
        <span className="text-xs text-fg/40">{rows.length} backends</span>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs text-fg/60">
          Hide idle <Switch checked={hideIdle} onChange={setHideIdle} />
        </label>
        <label className="flex items-center gap-2 text-xs text-fg/60">
          Live <Switch checked={live} onChange={setLive} />
        </label>
        <Button size="icon-sm" variant="ghost" onClick={() => refetch()}>
          <ArrowsClockwise className={cn("size-4", isFetching && "animate-spin")} />
        </Button>
      </div>
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : error ? (
        <Empty title="Couldn't read pg_stat_activity">{errorMessage(error)}</Empty>
      ) : rows.length === 0 ? (
        <Empty title="Nothing running" />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-canvas text-left text-2xs uppercase tracking-wide text-fg/40">
              <tr>
                {["PID", "User", "Database", "App", "State", "Wait", "Duration", "Query", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.pid} className="group border-t border-fg/[0.05] align-top hover:bg-surface">
                  <td className="px-3 py-2 font-mono text-xs tabular-nums">{b.pid}</td>
                  <td className="px-3 py-2 text-xs">{b.user}</td>
                  <td className="px-3 py-2 text-xs">{b.database}</td>
                  <td className="max-w-[140px] truncate px-3 py-2 text-xs text-fg/60">{b.app}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded px-1.5 py-px text-2xs", b.state === "active" ? "bg-ok/15 text-ok" : b.state?.startsWith("idle in") ? "bg-warn/15 text-warn" : "bg-surface-hover text-fg/55")}>{b.state ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-fg/50">{b.wait}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-fg/60">{b.seconds !== null ? `${b.seconds.toFixed(1)}s` : ""}</td>
                  <td className="selectable max-w-[520px] px-3 py-2">
                    <code className="line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs text-fg/70">{b.query}</code>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <Button size="icon-xs" variant="ghost" title="Cancel query" onClick={() => signal(b.pid, "pg_cancel_backend")}>
                        <Stop className="size-3.5" />
                      </Button>
                      <Button size="icon-xs" variant="ghost" title="Terminate backend" className="hover:text-danger" onClick={() => signal(b.pid, "pg_terminate_backend")}>
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
