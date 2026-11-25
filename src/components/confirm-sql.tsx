import { useState } from "react";
import { create } from "zustand";
import type { QueryResponse } from "@shared/types";
import { api, errorMessage } from "@/lib/api";
import { uid } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Spinner } from "./ui/misc";

interface Request {
  title: string;
  description?: React.ReactNode;
  sql: string;
  danger?: boolean;
  confirmLabel?: string;
  run: () => Promise<void>;
}

const useConfirm = create<{ request: Request | null }>(() => ({ request: null }));

/** Run a one-off statement outside any query tab session. Throws on SQL errors. */
export async function runSql(connectionId: string, database: string, sql: string): Promise<QueryResponse> {
  const queryId = uid();
  const result = await api.post<QueryResponse & { error?: { error: string } }>(`/api/c/${connectionId}/query`, {
    sql,
    database,
    queryId,
    sessionId: `oneoff-${queryId}`,
  });
  api.del(`/api/c/${connectionId}/session/oneoff-${queryId}`).catch(() => undefined);
  if (result.error) throw new Error(result.error.error);
  return result;
}

/** Show SQL for review, then run it on confirm. */
export function confirmSql(request: Request) {
  useConfirm.setState({ request });
}

export function ConfirmSqlDialog() {
  const request = useConfirm((s) => s.request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    useConfirm.setState({ request: null });
    setError("");
  };
  return (
    <Dialog open={Boolean(request)} onOpenChange={(o) => !o && !busy && close()}>
      <DialogContent className="max-w-[560px]">
        {request && (
          <div>
            <div className="px-6 pt-5">
              <DialogTitle>{request.title}</DialogTitle>
              {request.description && <DialogDescription>{request.description}</DialogDescription>}
            </div>
            <pre className="selectable mx-6 mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-surface p-3.5 font-mono text-xs leading-5 text-fg/80">{request.sql}</pre>
            {error && <div className="selectable mx-6 mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
            <div className="mt-5 flex justify-end gap-2 rounded-b-2xl bg-surface px-6 py-3.5">
              <Button variant="ghost" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                autoFocus
                variant={request.danger ? "dangerSolid" : "primary"}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await request.run();
                    close();
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy && <Spinner className="size-3.5 text-current" />}
                {request.confirmLabel ?? "Run"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
