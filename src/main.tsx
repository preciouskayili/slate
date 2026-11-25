import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { ErrorBoundary } from "./components/error-boundary";
import { queryClient } from "./lib/queries";
import { applyTheme, useApp } from "./lib/store";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

applyTheme(useApp.getState().theme);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(useApp.getState().theme));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary scope="window">
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
