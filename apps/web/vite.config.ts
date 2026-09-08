import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `loadEnv` with an empty prefix so a plain `API_PROXY_TARGET` works too —
  // this value never reaches the client bundle, it only configures the dev
  // server, so it doesn't need the `VITE_` exposure prefix.
  const env = loadEnv(mode, process.cwd(), "");

  // Dev-only proxy (MPG-080). `apiFetch`/`initSession` resolve their base URL
  // from `VITE_API_URL`, defaulting to "" (same-origin) — which in dev means
  // the Vite server on :5173, where `/api/*` does not exist. Without this every
  // REST call 404s against Vite instead of reaching the backend, and because
  // session bootstrap fails silently the app degrades to "no session token"
  // rather than erroring visibly. Proxying `/api` keeps same-origin the default
  // so no per-developer env var is required.
  //
  // Note this applies to `vite dev` only, not `vite preview`: a production
  // preview must point at a real backend via `VITE_API_URL`.
  const apiProxyTarget = env["API_PROXY_TARGET"] ?? "http://localhost:3001";

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
