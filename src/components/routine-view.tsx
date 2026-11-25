import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { actions, type RoutineTab } from "@/lib/store";
import { copyText } from "@/lib/utils";
import { SqlEditor } from "./query/sql-editor";
import { Button } from "./ui/button";
import { Copy, Function, Terminal } from "./ui/icons";
import { Empty, Spinner } from "./ui/misc";

export function RoutineView({ tab }: { tab: RoutineTab }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["routine", tab.connectionId, tab.database, tab.schema, tab.name, tab.args],
    queryFn: () =>
      api.get<{ definition: string }>(
        `/api/c/${tab.connectionId}/routine?db=${encodeURIComponent(tab.database)}&schema=${encodeURIComponent(tab.schema)}&name=${encodeURIComponent(tab.name)}&args=${encodeURIComponent(tab.args)}`,
      ),
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-fg/[0.06] px-3">
        <Function className="size-4 text-fg/40" />
        <span className="truncate text-sm">
          <span className="text-fg/45">{tab.schema}.</span>
          <span className="font-medium">{tab.name}</span>
          <span className="font-mono text-xs text-fg/45">({tab.args})</span>
        </span>
        <div className="flex-1" />
        {data && (
          <>
            <Button size="sm" variant="ghost" onClick={() => copyText(data.definition)}>
              <Copy className="size-3.5" /> Copy
            </Button>
            <Button size="sm" variant="secondary" onClick={() => actions.openQuery(tab.connectionId, tab.database, { sql: data.definition, title: tab.name })}>
              <Terminal className="size-3.5" /> Edit in query
            </Button>
          </>
        )}
      </div>
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : error ? (
        <Empty title="Couldn't load definition">{errorMessage(error)}</Empty>
      ) : (
        <div className="min-h-0 flex-1">
          <SqlEditor value={data?.definition ?? ""} readOnly />
        </div>
      )}
    </div>
  );
}
