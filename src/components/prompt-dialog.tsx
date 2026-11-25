import { useEffect, useState } from "react";
import { create } from "zustand";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

interface PromptRequest {
  title: string;
  description?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  mono?: boolean;
  resolve: (value: string | null) => void;
}

const usePrompt = create<{ request: PromptRequest | null }>(() => ({ request: null }));

/** Promise-based replacement for window.prompt (which Electron does not support). */
export function promptText(opts: Omit<PromptRequest, "resolve">): Promise<string | null> {
  return new Promise((resolve) => usePrompt.setState({ request: { ...opts, resolve } }));
}

export function PromptDialog() {
  const request = usePrompt((s) => s.request);
  const [value, setValue] = useState("");
  useEffect(() => setValue(request?.initial ?? ""), [request]);
  const finish = (v: string | null) => {
    request?.resolve(v);
    usePrompt.setState({ request: null });
  };
  return (
    <Dialog open={Boolean(request)} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent className="max-w-[420px]" showClose={false}>
        {request && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              finish(value);
            }}
          >
            <div className="px-5 pt-5">
              <DialogTitle>{request.title}</DialogTitle>
              {request.description && <DialogDescription>{request.description}</DialogDescription>}
              <input
                autoFocus
                value={value}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setValue(e.target.value)}
                placeholder={request.placeholder}
                spellCheck={false}
                className={`field mt-4 ${request.mono ? "font-mono text-xs" : ""}`}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2 rounded-b-2xl bg-surface px-5 py-3">
              <Button variant="ghost" onClick={() => finish(null)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                {request.confirmLabel ?? "OK"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
