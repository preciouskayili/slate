import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Connection, ConnectionInput, SslMode } from "@shared/types";
import { api, errorMessage } from "@/lib/api";
import { CONNECTION_COLORS } from "@/lib/colors";
import { queryClient, useConnections } from "@/lib/queries";
import { actions, useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Check, CheckCircle, LinkSimple, WarningCircle } from "./ui/icons";
import { Input, Select, Spinner, Switch } from "./ui/misc";
import { toast } from "./ui/toast";

const blank: ConnectionInput = {
  name: "",
  color: "emerald",
  host: "localhost",
  port: 5432,
  database: "postgres",
  user: "",
  password: "",
  ssl: "prefer",
  readOnly: false,
};

/** Parse postgres://user:pass@host:port/db?sslmode=require */
export function parseConnectionUrl(url: string): Partial<ConnectionInput> | null {
  try {
    const u = new URL(url.trim().replace(/^postgresql:/, "postgres:"));
    if (u.protocol !== "postgres:") return null;
    const sslmode = u.searchParams.get("sslmode");
    const ssl: SslMode | undefined =
      sslmode === "disable" ? "disable" : sslmode === "require" ? "require" : sslmode === "verify-full" || sslmode === "verify-ca" ? "verify-full" : sslmode ? "prefer" : undefined;
    return {
      host: decodeURIComponent(u.hostname) || "localhost",
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.slice(1)) || "postgres",
      ...(ssl ? { ssl } : {}),
    };
  } catch {
    return null;
  }
}

export function ConnectionDialog() {
  const { open, editId, url } = useApp((s) => s.connectionDialog);
  const { data: connections } = useConnections();
  const editing = connections?.find((c) => c.id === editId);
  const close = () => useApp.setState({ connectionDialog: { open: false } });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-[520px]">{open && <ConnectionForm editing={editing} initialUrl={url} onDone={close} />}</DialogContent>
    </Dialog>
  );
}

function ConnectionForm({ editing, initialUrl, onDone }: { editing?: Connection; initialUrl?: string; onDone: () => void }) {
  const [form, setForm] = useState<ConnectionInput>(() => (editing ? { ...editing, password: undefined } : { ...blank }));
  const [url, setUrl] = useState(initialUrl ?? "");
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const patch = (p: Partial<ConnectionInput>) => {
    setForm((f) => ({ ...f, ...p }));
    setTest(null);
  };

  useEffect(() => {
    const parsed = parseConnectionUrl(url);
    if (parsed) patch(parsed);
  }, [url]);

  const testMutation = useMutation({
    mutationFn: () => api.post<{ version: string; user: string; ms: number }>("/api/connections/test", { ...form, id: editing?.id }),
    onSuccess: (r) => setTest({ ok: true, message: `${r.version.split(" on ")[0].split(",")[0]} · ${r.ms} ms` }),
    onError: (e) => setTest({ ok: false, message: errorMessage(e) }),
  });

  const save = useMutation({
    mutationFn: () =>
      editing ? api.put<Connection>(`/api/connections/${editing.id}`, form) : api.post<Connection>("/api/connections", form),
    onSuccess: (conn) => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      queryClient.removeQueries({ queryKey: ["info", conn.id] });
      queryClient.removeQueries({ queryKey: ["schema", conn.id] });
      if (!editing) actions.selectConnection(conn.id);
      toast(editing ? "Connection updated" : "Connection saved");
      onDone();
    },
    onError: (e) => toast.error("Could not save connection", errorMessage(e)),
  });

  return (
    <form
      className="flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="px-6 pt-5">
        <DialogTitle>{editing ? "Edit connection" : "New connection"}</DialogTitle>
      </div>
      <div className="space-y-4 px-6 py-5">
        {!editing && (
          <div className="relative">
            <LinkSimple className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg/40" />
            <Input className="pl-8 font-mono text-xs" placeholder="postgres://user:password@host:5432/db" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Name">
            <Input autoFocus placeholder={form.host && form.database ? `${form.host}/${form.database}` : "Production"} value={form.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <div className="flex h-8 items-center gap-1">
            {Object.entries(CONNECTION_COLORS).map(([name, hex]) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                onClick={() => patch({ color: name })}
                className={cn("flex size-5 items-center justify-center rounded-full ring-offset-2 ring-offset-elevated", form.color === name && "ring-2 ring-fg/40")}
                style={{ background: hex }}
              >
                {form.color === name && <Check weight="bold" className="size-2.5 text-white" />}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label="Host">
            <Input value={form.host} onChange={(e) => patch({ host: e.target.value })} />
          </Field>
          <Field label="Port">
            <Input value={String(form.port)} inputMode="numeric" onChange={(e) => patch({ port: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="User">
            <Input value={form.user} onChange={(e) => patch({ user: e.target.value })} />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={form.password ?? ""}
              placeholder={editing?.hasPassword && form.password === undefined ? "Saved" : ""}
              onChange={(e) => patch({ password: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Database">
            <Input value={form.database} onChange={(e) => patch({ database: e.target.value })} />
          </Field>
          <Field label="SSL">
            <Select value={form.ssl} onChange={(e) => patch({ ssl: e.target.value as SslMode })}>
              <option value="prefer">Prefer</option>
              <option value="require">Require</option>
              <option value="verify-full">Verify full</option>
              <option value="disable">Disable</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-xl bg-surface px-3 py-2.5">
          <span className="text-sm font-medium">Read-only</span>
          <Switch checked={form.readOnly} onChange={(v) => patch({ readOnly: v })} label="Read-only" />
        </label>
      </div>
      <div className="flex items-center gap-2 rounded-b-2xl bg-surface px-6 py-3.5">
        <Button variant="secondary" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
          {testMutation.isPending ? <Spinner className="size-3.5" /> : null}
          Test
        </Button>
        {test && (
          <span className={cn("flex min-w-0 items-center gap-1.5 truncate text-xs", test.ok ? "text-ok" : "text-danger")} title={test.message}>
            {test.ok ? <CheckCircle weight="fill" className="size-3.5 shrink-0" /> : <WarningCircle weight="fill" className="size-3.5 shrink-0" />}
            <span className="truncate">{test.message}</span>
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={save.isPending || !form.host}>
            {editing ? "Save" : "Save & connect"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg/60">{label}</span>
      {children}
    </label>
  );
}
