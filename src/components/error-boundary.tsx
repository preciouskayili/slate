import { Component, type ReactNode } from "react";
import { copyText } from "@/lib/utils";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
  /** "window" fills the whole app; "panel" stays inside a tab. */
  scope?: "window" | "panel";
  /** Changing this clears the error (e.g. switching tabs). */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
  resetKey?: unknown;
}

/** Keeps a render error inside one tab (or shows a recoverable screen) instead of blanking the window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[slate] render error:", error, info.componentStack ?? "");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const full = this.props.scope === "window";
    const details = `${error.name}: ${error.message}\n${error.stack ?? ""}`;
    return (
      <div className={full ? "flex h-screen items-center justify-center bg-canvas p-8 text-fg" : "flex flex-1 items-center justify-center p-8"}>
        <div className="w-full max-w-lg space-y-3">
          <div className="text-sm font-medium">Something went wrong</div>
          <pre className="max-h-48 overflow-auto rounded-lg bg-surface-hover p-3 font-mono text-2xs leading-relaxed text-fg/60">{details}</pre>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button size="sm" variant="secondary" onClick={() => location.reload()}>
              Reload window
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copyText(details)}>
              Copy details
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
