/**
 * A tiny, reusable boot-time reachability probe (MPG-089-c), factored out of
 * the pattern `useClaimGate` established for the claim prompt: probe once at
 * mount, and treat anything short of a confirmed answer as "unreachable" —
 * never as an error to surface.
 *
 * This is the offline pillar applied to any network-optional affordance
 * ("save this variant", "claim a handle", …): the feature is offered ONLY
 * once a real response confirms the backend is up, and a down/slow/absent
 * backend just means the affordance never appears. `fetchIdentity` already
 * resolves to `null` for every failure mode (network error, timeout, 5xx),
 * so reusing it here costs no extra endpoint and keeps "is the backend up"
 * answered exactly one way across the app.
 */

import { useEffect, useState } from "react";

import { fetchIdentity } from "../api/identity.js";

/**
 * `true` once a boot probe confirms the backend is reachable; `false` before
 * that resolves and for the rest of the session if it never does. Never
 * flips back to `false` after becoming `true` — a probe result this session
 * is good enough for the lifetime of the tab, and flickering an affordance
 * on a later transient failure would be worse than leaving it be.
 */
export function useBackendReachable(): boolean {
  const [reachable, setReachable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchIdentity().then((state) => {
      if (!cancelled && state !== null) setReachable(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return reachable;
}
