import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { queryClient, useHistory } from "@/lib/queries";
import { actions } from "@/lib/store";
import { cn, copyText, formatMs, timeAgo } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Copy, MagnifyingGlass, Terminal } from "./ui/icons";
import { Empty, Spinner } from "./ui/misc";

export function HistoryDialog({ open, onOpenChange, connectionId, database }: { open: boolean; onOpenChange: (o: boolean) => void; connectionId: string; database: string }) {
  const { data, isLoading } = useHistory();
  const [search, setSearch] = useState("");
  const clear = useMutation({ mutationFn: () => api.del("/api/history"), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["history"] }) });
  const items = useMemo(
    () => (data ?? []).filter((h) => h.connectionId === connectionId && (!search || h.sql.toLowerCase().includes(search.toLowerCase()))),
    [data, connectionId, search],
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) queryClient.invalidateQueries({ queryKey: ["history"] });
        onOpenChange(o);
      }}
    >
      <DialogContent className="h-[min(640px,85vh)] max-w-[720px]">
        <div className="flex items-center gap-3 px-5 py-3.5 pr-12">
          <DialogTitle>Query history</DialogTitle>
          <div className="relative ml-auto w-64">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg/35" />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search history" className="field h-7 pl-8 text-xs" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isLoading && <Spinner className="m-6" />}
          {!isLoading && !items.length && <Empty title="No queries yet" />}
          {items.map((h) => (
            <div key={h.id} className="group flex gap-3 rounded-xl px-3 py-2.5 hover:bg-surface">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", h.ok ? "bg-ok" : "bg-danger")} />
              <div className="min-w-0 flex-1">
                <pre className="selectable line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-fg/85">{h.sql}</pre>
                <div className="mt-1 text-2xs text-fg/40">
                  {timeAgo(h.at)} · {h.database} · {formatMs(h.ms)}
                  {h.rows !== null && ` · ${h.rows} rows`}
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-1 opacity-0 group-hover:opacity-100">
                <Button size="icon-sm" variant="ghost" title="Copy" onClick={() => copyText(h.sql)}>
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    actions.openQuery(connectionId, h.database || database, { sql: h.sql });
                    onOpenChange(false);
                  }}
                >
                  <Terminal className="size-3.5" /> Open
                </Button>
              </div>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <div className="flex justify-end rounded-b-2xl bg-surface px-5 py-2.5">
            <Button size="sm" variant="ghost" onClick={() => confirm("Clear the query history for all connections?") && clear.mutate()}>
              Clear history
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
