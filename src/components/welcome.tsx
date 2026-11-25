import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Connection } from "@shared/types";
import { api, errorMessage } from "@/lib/api";
import { connectionColor } from "@/lib/colors";
import { queryClient, useConnections, useHistory } from "@/lib/queries";
import { actions, useApp, type Tab, type Theme } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";
import { ConnectionAvatar } from "./connection-avatar";
import { Logo } from "./logo";
import { Button } from "./ui/button";
import { ArrowRight, Copy, DotsThree, Lock, Monitor, Moon, PencilSimple, Plus, Pulse, Sun, Trash } from "./ui/icons";
import { FunctionIcon, KIND_COLOR, QueryIcon, TableIcon } from "./ui/object-icons";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./ui/menu";
import { Kbd, Spinner } from "./ui/misc";
import { toast } from "./ui/toast";

export const openNewConnection = () => useApp.setState({ connectionDialog: { open: true } });
export const openEditConnection = (id: string) => useApp.setState({ connectionDialog: { open: true, editId: id } });

export function Welcome() {
  const { data: connections, isLoading, error } = useConnections();
  const hasConnections = Boolean(connections?.length);

  // Paste a postgres:// URL anywhere on this screen to start a connection with it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target;
      if ((target instanceof Element && target.closest("input, textarea, [contenteditable]")) || useApp.getState().connectionDialog.open) return;
      const text = e.clipboardData?.getData("text")?.trim() ?? "";
      if (/^postgres(ql)?:\/\//i.test(text)) {
        e.preventDefault();
        useApp.setState({ connectionDialog: { open: true, url: text } });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <div className="chrome window-drag flex h-11 shrink-0 items-center justify-end px-3">
        <ThemeMenu className="no-drag" />
      </div>
      {/* Same inset panel as the workspace. */}
      <div className="relative mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-canvas shadow-[0_1px_2px_rgb(0_0_0/0.05),0_6px_20px_-6px_rgb(0_0_0/0.08)] dark:shadow-none">
        <Backdrop />
        <div className="relative z-10 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[880px] px-8 pb-16 pt-[7vh]">
            <header className="flex animate-fade-in flex-wrap items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="absolute inset-1 rounded-2xl bg-[#2F6BEB] opacity-40 blur-xl" />
                  <Logo className="relative size-14 drop-shadow-[0_6px_14px_rgba(0,0,0,0.25)]" />
                </div>
                <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">Slate</h1>
              </div>
              {hasConnections && (
                <Button variant="primary" onClick={openNewConnection}>
                  <Plus weight="bold" className="size-3.5" /> New connection
                </Button>
              )}
            </header>

            {isLoading && (
              <div className="mt-16 flex justify-center">
                <Spinner />
              </div>
            )}
            {error && <div className="mt-8 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">Can't reach the Slate server: {errorMessage(error)}</div>}

            {connections && !hasConnections && <FirstRun />}

            {hasConnections && (
              <>
                <Section title="Connections" className="mt-10">
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                    {connections!.map((c) => (
                      <ConnectionCard key={c.id} connection={c} />
                    ))}
                  </div>
                </Section>
                <JumpBackIn connections={connections!} />
                <RecentQueries connections={connections!} />
              </>
            )}

            <footer className="mt-16 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg/40">
              {[
                ["⌘K", "Jump to anything"],
                ["⌘T", "New query"],
                ["⌘↵", "Run statement"],
                ["⌘S", "Save edits"],
                ["⌘\\", "Sidebar"],
              ].map(([k, label]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <Kbd>{k}</Kbd>
                  {label}
                </span>
              ))}
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dotted grid that fades out from the top, with a soft glow in the Slate blue. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0 opacity-[0.55] dark:opacity-[0.35]"
        style={{
          backgroundImage: "radial-gradient(rgb(var(--fg) / 0.13) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse 70% 55% at 50% 0%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 55% at 50% 0%, black 30%, transparent 100%)",
        }}
      />
      <div className="absolute left-1/2 top-[-260px] h-[480px] w-[760px] -translate-x-1/2 rounded-full bg-[#2F6BEB] opacity-[0.10] blur-[90px] dark:opacity-[0.16]" />
    </div>
  );
}

function Section({ title, action, className, children }: { title: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("animate-fade-in", className ?? "mt-10")}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="section-label">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function FirstRun() {
  return (
    <div className="mt-10 grid animate-fade-in grid-cols-1 items-center gap-6 rounded-3xl bg-surface p-8 md:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col justify-center gap-5">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Connect a database</h2>
        <div>
          <Button variant="primary" onClick={openNewConnection}>
            <Plus weight="bold" className="size-3.5" /> New connection
          </Button>
        </div>
      </div>
      <GridIllustration />
    </div>
  );
}

/** A tiny, static data grid that echoes the app icon. */
function GridIllustration() {
  const rows = [
    ["1", "Ada", "admin"],
    ["2", "Grace", "editor"],
    ["3", "Linus", "viewer"],
    ["4", "Barbara", "editor"],
  ];
  return (
    <div className="hidden md:block">
      <div className="ml-auto w-full max-w-[300px] rounded-xl bg-canvas p-1.5 text-2xs">
        <div className="grid grid-cols-[32px_1fr_1fr] font-medium text-fg/40">
          {["id", "name", "role"].map((h) => (
            <div key={h} className="px-2.5 py-1.5">
              {h}
            </div>
          ))}
        </div>
        {rows.map((r, i) => (
          <div key={r[0]} className="grid grid-cols-[32px_1fr_1fr]">
            <div className="px-2.5 py-1.5 font-mono text-fg/35">{r[0]}</div>
            <div className="px-2.5 py-1.5 text-fg/75">{r[1]}</div>
            <div className={cn("px-2.5 py-1.5", i === 1 ? "rounded-md bg-accent/15 text-accent" : "text-fg/55")}>{r[2]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function tabLabel(t: Tab): string {
  switch (t.kind) {
    case "table":
      return t.schema === "public" ? t.table : `${t.schema}.${t.table}`;
    case "query":
      return t.title || "Query";
    case "routine":
      return `${t.name}()`;
    case "activity":
      return "Activity";
  }
}

function TabGlyph({ tab }: { tab: Tab }) {
  if (tab.kind === "table") return <TableIcon style={{ color: KIND_COLOR.table }} />;
  if (tab.kind === "query") return <QueryIcon style={{ color: KIND_COLOR.query }} />;
  if (tab.kind === "routine") return <FunctionIcon style={{ color: KIND_COLOR.function }} />;
  return <Pulse weight="duotone" className="size-4 text-ok" />;
}

function JumpBackIn({ connections }: { connections: Connection[] }) {
  const tabs = useApp((s) => s.tabs);
  const byId = new Map(connections.map((c) => [c.id, c]));
  const recent = [...tabs].reverse().filter((t) => byId.has(t.connectionId)).slice(0, 6);
  if (!recent.length) return null;
  return (
    <Section title="Recent">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {recent.map((t) => {
          const c = byId.get(t.connectionId)!;
          return (
            <button
              key={t.id}
              onClick={() => actions.resumeTab(t)}
              className="group flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-strong">
                <TabGlyph tab={t} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{tabLabel(t)}</span>
                <span className="flex items-center gap-1.5 truncate text-2xs text-fg/40">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: connectionColor(c.color) }} />
                  <span className="truncate">
                    {c.name}
                    {t.database !== c.database ? ` · ${t.database}` : ""}
                  </span>
                </span>
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-fg/30 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/** Transaction control and session settings aren't worth resurfacing. */
const TRIVIAL = /^\s*(begin|commit|rollback|end|abort|start transaction|savepoint|release|set|reset|show|discard)\b[^;]*;?\s*$/i;

function RecentQueries({ connections }: { connections: Connection[] }) {
  const { data: history } = useHistory();
  const byId = new Map(connections.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const recent = (history ?? [])
    .filter((h) => h.ok && byId.has(h.connectionId) && !TRIVIAL.test(h.sql) && !seen.has(h.sql.trim()) && seen.add(h.sql.trim()))
    .slice(0, 5);
  if (!recent.length) return null;
  return (
    <Section title="Recent queries">
      <div className="rounded-2xl bg-surface p-1.5">
        {recent.map((h) => {
          const c = byId.get(h.connectionId)!;
          return (
            <button
              key={h.id}
              onClick={() => {
                actions.selectConnection(c.id);
                actions.setDatabase(c.id, h.database);
                actions.openQuery(c.id, h.database, { sql: h.sql });
              }}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-hover"
            >
              <QueryIcon className="opacity-60" style={{ color: KIND_COLOR.query }} />
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg/75">{h.sql.replace(/\s+/g, " ").trim()}</code>
              <span className="flex shrink-0 items-center gap-1.5 text-2xs text-fg/35">
                <span className="size-1.5 rounded-full" style={{ background: connectionColor(c.color) }} />
                {c.name}
              </span>
              <span className="w-16 shrink-0 text-right text-2xs tabular-nums text-fg/30">{timeAgo(h.at)}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function ConnectionCard({ connection: c }: { connection: Connection }) {
  const remove = useMutation({
    mutationFn: () => api.del(`/api/connections/${c.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      toast("Connection removed");
    },
    onError: (e) => toast.error("Could not remove connection", errorMessage(e)),
  });
  const duplicate = useMutation({
    mutationFn: () => api.post<Connection>("/api/connections", { ...c, name: `${c.name} copy`, password: undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections"] }),
  });
  const lastOpened = useApp((s) => s.lastOpened[c.id]);
  const tabCount = useApp((s) => s.tabs.filter((t) => t.connectionId === c.id).length);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => actions.selectConnection(c.id)}
      onKeyDown={(e) => e.key === "Enter" && actions.selectConnection(c.id)}
      className="group relative flex min-h-[96px] flex-col justify-between gap-3 rounded-2xl bg-surface p-4 outline-none transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover"
    >
      <div className="flex items-start gap-3">
        <ConnectionAvatar connection={c} className="size-9 rounded-[9px] text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-[15px] font-medium tracking-[-0.01em]">
            {c.name}
            {c.readOnly && <Lock className="size-3 text-fg/40" />}
          </div>
          <div className="truncate font-mono text-2xs text-fg/45">
            {c.user ? `${c.user}@` : ""}
            {c.host}:{c.port}/{c.database}
          </div>
        </div>
      <Menu>
        <MenuTrigger
          onClick={(e) => e.stopPropagation()}
          className="-mr-1.5 -mt-1.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-fg/40 opacity-0 hover:bg-surface-strong hover:text-fg group-hover:opacity-100 data-[popup-open]:opacity-100"
        >
          <DotsThree weight="bold" className="size-4" />
        </MenuTrigger>
        <MenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={<PencilSimple />} onClick={() => openEditConnection(c.id)}>
            Edit…
          </MenuItem>
          <MenuItem icon={<Copy />} onClick={() => duplicate.mutate()}>
            Duplicate
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            danger
            icon={<Trash />}
            onClick={() => {
              if (confirm(`Remove “${c.name}”? Your database isn’t touched.`)) remove.mutate();
            }}
          >
            Remove
          </MenuItem>
        </MenuContent>
      </Menu>
      </div>
      <div className="flex items-center gap-1.5 text-2xs text-fg/45">
        {tabCount > 0 && <span className="rounded-md bg-surface-strong px-1.5 py-0.5">{tabCount === 1 ? "1 tab" : `${tabCount} tabs`}</span>}
        {lastOpened && <span className="ml-auto text-fg/35">{timeAgo(new Date(lastOpened).toISOString())}</span>}
      </div>
    </div>
  );
}

export function ThemeMenu({ className }: { className?: string }) {
  const theme = useApp((s) => s.theme);
  const icons: Record<Theme, React.ReactNode> = { system: <Monitor />, light: <Sun />, dark: <Moon /> };
  return (
    <Menu>
      <MenuTrigger
        aria-label="Theme"
        className={cn("flex size-7 items-center justify-center rounded-lg text-fg/50 hover:bg-surface-hover hover:text-fg [&_svg]:size-4", className)}
      >
        {icons[theme]}
      </MenuTrigger>
      <MenuContent align="end" className="min-w-36">
        {(["system", "light", "dark"] as Theme[]).map((t) => (
          <MenuItem key={t} icon={icons[t]} onClick={() => actions.setTheme(t)} className={cn(theme === t && "text-accent")}>
            {t[0].toUpperCase() + t.slice(1)}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
