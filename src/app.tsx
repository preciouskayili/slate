import { useEffect } from "react";
import { CommandPalette } from "./components/command-palette";
import { ConfirmSqlDialog } from "./components/confirm-sql";
import { PromptDialog } from "./components/prompt-dialog";
import { ConnectionDialog } from "./components/connection-dialog";
import { Sidebar } from "./components/sidebar";
import { TabBar } from "./components/tab-bar";
import { ErrorBoundary } from "./components/error-boundary";
import { TabContent } from "./components/tab-content";
import { Toaster } from "./components/ui/toast";
import { TooltipProvider } from "./components/ui/tooltip";
import { Welcome } from "./components/welcome";
import { useConnections } from "./lib/queries";
import { actions, useActiveTab, useApp } from "./lib/store";
import { cn, mod } from "./lib/utils";

export function App() {
  const connectionId = useApp((s) => s.connectionId);
  const { data: connections, isSuccess } = useConnections();
  const connection = connections?.find((c) => c.id === connectionId);
  const activeTabId = useActiveTab()?.id;
  const sidebarCollapsed = useApp((s) => s.sidebarCollapsed);

  // Drop a stale selection (connection deleted elsewhere).
  useEffect(() => {
    if (isSuccess && connectionId && !connection) actions.selectConnection(null);
  }, [isSuccess, connectionId, connection]);

  useGlobalShortcuts(connection?.id ?? null, connection?.database ?? "postgres");

  return (
    <TooltipProvider delay={500}>
      <div className={cn("flex h-full", connection && "bg-sidebar")}>
        {connection ? (
          <>
            <Sidebar connection={connection} />
            <main className="flex min-w-0 flex-1 flex-col">
              <TabBar connection={connection} />
              {/* The content panel: inset from the window chrome, like a sheet of paper on a desk. */}
              <div
                className={cn(
                  "mb-2 mr-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-canvas shadow-[0_1px_2px_rgb(0_0_0/0.05),0_6px_20px_-6px_rgb(0_0_0/0.08)] dark:shadow-none",
                  sidebarCollapsed && "ml-2",
                )}
              >
                <ErrorBoundary resetKey={activeTabId}>
                  <TabContent connection={connection} />
                </ErrorBoundary>
              </div>
            </main>
          </>
        ) : (
          <Welcome />
        )}
      </div>
      <CommandPalette />
      <ConnectionDialog />
      <ConfirmSqlDialog />
      <PromptDialog />
      <Toaster />
    </TooltipProvider>
  );
}

function useGlobalShortcuts(connectionId: string | null, defaultDb: string) {
  const tab = useActiveTab();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!mod(e)) return;
      const key = e.key.toLowerCase();
      if (key === "k" || (key === "p" && !e.shiftKey)) {
        e.preventDefault();
        useApp.setState((s) => ({ paletteOpen: !s.paletteOpen }));
      } else if (key === "t" && connectionId) {
        e.preventDefault();
        actions.openQuery(connectionId, actions.currentDatabase(connectionId, defaultDb));
      } else if (key === "w" && tab) {
        e.preventDefault();
        actions.closeTab(tab.id);
      } else if (key === "\\" || (key === "b" && !e.shiftKey && !(e.target as HTMLElement).closest(".cm-editor"))) {
        e.preventDefault();
        useApp.setState((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
      } else if (/^[1-9]$/.test(key) && connectionId) {
        const tabs = useApp.getState().tabs.filter((t) => t.connectionId === connectionId);
        const target = key === "9" ? tabs[tabs.length - 1] : tabs[Number(key) - 1];
        if (target) {
          e.preventDefault();
          actions.activate(target.id);
        }
      } else if ((key === "]" || key === "[") && e.shiftKey && connectionId) {
        const tabs = useApp.getState().tabs.filter((t) => t.connectionId === connectionId);
        const index = tabs.findIndex((t) => t.id === tab?.id);
        const next = tabs[(index + (key === "]" ? 1 : -1) + tabs.length) % tabs.length];
        if (next) {
          e.preventDefault();
          actions.activate(next.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connectionId, defaultDb, tab]);
}
