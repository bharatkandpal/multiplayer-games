import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
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

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
