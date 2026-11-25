import type { Connection } from "@shared/types";
import { actions, useActiveTab, useApp } from "@/lib/store";
import { ActivityView } from "./activity-view";
import { QueryView } from "./query/query-view";
import { RoutineView } from "./routine-view";
import { TableView } from "./table/table-view";
import { QueryIcon } from "./ui/object-icons";
import { Kbd } from "./ui/misc";
import { Button } from "./ui/button";

export function TabContent({ connection }: { connection: Connection }) {
  const tab = useActiveTab();
  const db = useApp((s) => s.databases[connection.id]) ?? connection.database;
  if (!tab) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <Button variant="secondary" onClick={() => actions.openQuery(connection.id, db)}>
          <QueryIcon className="size-3.5" /> New query <Kbd className="ml-1">⌘T</Kbd>
        </Button>
      </div>
    );
  }
  // Keyed by tab id so each tab keeps its own component state (scroll, selection, editor).
  switch (tab.kind) {
    case "table":
      return <TableView key={tab.id} tab={tab} connection={connection} />;
    case "query":
      return <QueryView key={tab.id} tab={tab} connection={connection} />;
    case "routine":
      return <RoutineView key={tab.id} tab={tab} />;
    case "activity":
      return <ActivityView key={tab.id} tab={tab} />;
  }
}
