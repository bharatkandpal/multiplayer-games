/**
 * "Clear local data" (MPG-147): the only sign-out this product has. Identity is
 * local-first (no account, no login), so forgetting it means emptying this
 * browser's storage. Synchronous and network-free: it must work with the
 * backend down, and it never waits on or reports anything from a request.
 */
export function clearLocalData(): void {
  for (const getStorage of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      getStorage().clear();
    } catch {
      // Storage unavailable (privacy mode, disabled storage): nothing to clear.
    }
  }
}
