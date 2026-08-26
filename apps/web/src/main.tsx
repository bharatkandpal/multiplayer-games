import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// THROWAWAY SPIKE (MPG-039): reachable only via `?spike=floppy`; keeps App.tsx and
// all shared routing untouched. Remove when the spike is retired. See ADR 0002.
import { FloppySpike } from "./spike/floppy/FloppySpike";
import { initTheme } from "./lib/theme";
// Tokens must load before any component styles so every CSS Module below can
// rely on the custom properties being defined.
import "./styles/tokens.css";
import "./index.css";

// Apply the persisted/default theme to <html data-theme> before first paint
// to avoid a flash of the wrong theme.
initTheme();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

const isFloppySpike =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("spike") === "floppy";

createRoot(container).render(
  <StrictMode>{isFloppySpike ? <FloppySpike /> : <App />}</StrictMode>,
);
