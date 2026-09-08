/**
 * Client-side session identity (MPG-054).
 *
 * The server mints an opaque, no-PII session token (a UUID) per browser.
 * We cache it in localStorage and attach it to every API request via the
 * `x-session-token` header so the server can recognize returning visitors
 * without any auth.
 *
 * Bootstrapped once at app start from `App.tsx` (MPG-080). Best-effort: if the
 * server is unreachable the app stays fully playable without a session token,
 * it just has no durable identity.
 */

export const SESSION_HEADER = "x-session-token";

const STORAGE_KEY = "mpg_session_token";

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage can throw (privacy mode, disabled storage, …).
    return null;
  }
}

function writeStoredToken(token: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Best-effort persistence only; the token still works for this tab.
  }
}

function removeStoredToken(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

/** Resolves the API base URL. Empty string = same-origin (dev proxy / prod). */
function getApiBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env["VITE_API_URL"] ?? "";
}

/** Synchronously reads the cached session token, if any. Does not hit the network. */
export function getSessionToken(): string | null {
  return readStoredToken();
}

/**
 * De-duplicates concurrent `initSession()` calls. Without this, React
 * StrictMode's double-invoked mount effect (and any other parallel caller)
 * would each see an empty cache and mint a *separate* server-side session,
 * orphaning the first. Cleared once settled so a later call can retry after a
 * failure.
 */
let inFlightInit: Promise<string> | undefined;

/**
 * Ensures a session token exists, fetching one from the server if the
 * local cache is empty. Call once at app boot; safe to call repeatedly.
 */
export async function initSession(): Promise<string> {
  const cached = readStoredToken();
  if (cached) return cached;

  inFlightInit ??= (async () => {
    const res = await fetch(`${getApiBaseUrl()}/api/session`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Failed to initialize session: ${res.status}`);
    }

    const body = (await res.json()) as { token: string };
    writeStoredToken(body.token);
    return body.token;
  })();

  try {
    return await inFlightInit;
  } finally {
    inFlightInit = undefined;
  }
}

/** "Forget me": asks the server to erase all data for this session, then clears local state. */
export async function clearSession(): Promise<void> {
  const token = readStoredToken();
  if (token) {
    await fetch(`${getApiBaseUrl()}/api/session`, {
      method: "DELETE",
      headers: { [SESSION_HEADER]: token },
    }).catch(() => {
      // Best-effort — local state is cleared regardless.
    });
  }
  removeStoredToken();
}

/**
 * `fetch` wrapper that attaches the `x-session-token` header (and API base
 * URL) to every request. Use this for all session-scoped API calls.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = readStoredToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set(SESSION_HEADER, token);
  }
  return fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });
}
