/**
 * Claim gate (MPG-091-c) — decides when to offer the non-blocking "claim a
 * handle" prompt, and owns the small state machine behind it (claim → show
 * recovery code once → done, plus an adopt-by-code branch for returning
 * players).
 *
 * Offline pillar, enforced here: the prompt is offered ONLY when a boot-time
 * `fetchIdentity` confirmed the backend is reachable AND this session hasn't
 * already claimed. If the backend is unreachable the affordance is simply
 * absent — never an error in front of the game. The auto-offer fires at most
 * once per app load (`autoOfferedThisLoad`), and never again once the player
 * claims or dismisses.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  adoptIdentity,
  claimHandle,
  fetchIdentity,
  getStoredHandle,
  isValidHandleFormat,
  isValidRecoveryCodeFormat,
  onValueMoment,
} from "../api/identity.js";

/** Which face of the claim modal is showing. */
export type ClaimView = "claim" | "recovery" | "adopt" | "restored";

export interface UseClaimGateResult {
  isOpen: boolean;
  view: ClaimView;
  /** The recovery code to display once, after a successful claim. */
  recoveryCode: string | undefined;
  /** The handle just claimed/adopted — shown on the recovery view. */
  claimedHandle: string | undefined;
  /** Inline error for the claim form (plain language), if any. */
  claimError: string | undefined;
  /** Inline error for the adopt form, if any. */
  adoptError: string | undefined;
  submitting: boolean;
  /** Manually open the claim prompt (e.g. an opt-in entry). */
  openClaim: () => void;
  submitClaim: (handle: string) => void;
  submitAdopt: (code: string) => void;
  /** Player confirmed they saved the recovery code — closes the flow. */
  confirmSaved: () => void;
  switchToAdopt: () => void;
  switchToClaim: () => void;
  cancel: () => void;
}

const COPY = {
  formatError: "3–20 characters: letters, numbers, _ or - only.",
  taken: "That handle's taken — try another.",
  invalid: "That handle isn't allowed — try another.",
  codeFormatError: "That doesn't look like a full code — check and re-enter it.",
  codeInvalid: "We couldn't find that code. Check it and try again.",
  offline: "Couldn't reach the server — try again in a moment.",
} as const;

/**
 * Module-level so a component remount (StrictMode double-mount, route change)
 * doesn't re-arm the auto-offer. Once true for this load, the prompt won't
 * auto-open again — the player either acted on it or dismissed it.
 */
let autoOfferedThisLoad = false;

export function useClaimGate(): UseClaimGateResult {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<ClaimView>("claim");
  const [recoveryCode, setRecoveryCode] = useState<string | undefined>(undefined);
  const [claimedHandle, setClaimedHandle] = useState<string | undefined>(undefined);
  const [claimError, setClaimError] = useState<string | undefined>(undefined);
  const [adoptError, setAdoptError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  // Gating facts read inside the value-moment listener without re-subscribing.
  const reachableRef = useRef(false);
  const claimedRef = useRef(getStoredHandle() !== null);
  const openRef = useRef(false);
  openRef.current = isOpen;

  // Boot probe: learn whether the backend is reachable and whether we've
  // already claimed. Failure resolves to `null` → stays unreachable → no
  // prompt is ever offered (degrade to absence).
  useEffect(() => {
    let cancelled = false;
    void fetchIdentity().then((state) => {
      if (cancelled || state === null) return;
      reachableRef.current = true;
      claimedRef.current = state.claimed;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Offer the claim prompt on a value moment, subject to the gates above.
  useEffect(
    () =>
      onValueMoment(() => {
        if (autoOfferedThisLoad) return;
        if (!reachableRef.current || claimedRef.current || openRef.current) return;
        autoOfferedThisLoad = true;
        setView("claim");
        setClaimError(undefined);
        setIsOpen(true);
      }),
    [],
  );

  const openClaim = useCallback(() => {
    setView("claim");
    setClaimError(undefined);
    setIsOpen(true);
  }, []);

  const submitClaim = useCallback((handle: string) => {
    const trimmed = handle.trim();
    if (!isValidHandleFormat(trimmed)) {
      setClaimError(COPY.formatError);
      return;
    }
    setClaimError(undefined);
    setSubmitting(true);
    void claimHandle(trimmed).then((result) => {
      setSubmitting(false);
      if (result.ok) {
        claimedRef.current = true;
        setClaimedHandle(result.handle);
        setRecoveryCode(result.recoveryCode);
        setView("recovery");
        return;
      }
      switch (result.reason) {
        case "taken":
          setClaimError(COPY.taken);
          break;
        case "invalid":
          setClaimError(COPY.invalid);
          break;
        case "already_claimed":
          // Another tab/device already claimed for this session — nothing to do.
          claimedRef.current = true;
          setIsOpen(false);
          break;
        case "offline":
          // The player deliberately hit "Save", so don't vanish on them —
          // say so inline and let them retry. (The game itself is untouched;
          // the offline pillar is about never erroring in front of the board,
          // not about swallowing a control the player chose to use.)
          setClaimError(COPY.offline);
          break;
      }
    });
  }, []);

  const submitAdopt = useCallback((code: string) => {
    if (!isValidRecoveryCodeFormat(code)) {
      setAdoptError(COPY.codeFormatError);
      return;
    }
    setAdoptError(undefined);
    setSubmitting(true);
    void adoptIdentity(code).then((result) => {
      setSubmitting(false);
      if (result.ok) {
        claimedRef.current = true;
        setClaimedHandle(result.handle);
        // Confirm the restore rather than silently closing — the player just
        // typed a code and needs to know it worked.
        setView("restored");
        return;
      }
      setAdoptError(result.reason === "invalid" ? COPY.codeInvalid : COPY.offline);
    });
  }, []);

  const confirmSaved = useCallback(() => {
    setIsOpen(false);
    setRecoveryCode(undefined);
  }, []);

  const switchToAdopt = useCallback(() => {
    setView("adopt");
    setAdoptError(undefined);
  }, []);

  const switchToClaim = useCallback(() => {
    setView("claim");
    setClaimError(undefined);
  }, []);

  const cancel = useCallback(() => {
    setIsOpen(false);
    setClaimError(undefined);
    setAdoptError(undefined);
  }, []);

  return {
    isOpen,
    view,
    recoveryCode,
    claimedHandle,
    claimError,
    adoptError,
    submitting,
    openClaim,
    submitClaim,
    submitAdopt,
    confirmSaved,
    switchToAdopt,
    switchToClaim,
    cancel,
  };
}
