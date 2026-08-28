// @input  -- an optional callback from the component that mounts the sign-in dialog
// @output -- that callback registered with gsi-client for as long as the component is mounted
// @pos    -- the one line of SignInDialog that has behaviour, kept apart so it can be tested
//            without the dialog chrome (whose `@/` imports the unit project cannot resolve)
"use client";

import { useEffect } from "react";

import { onGoogleSignedIn, type SignedInListener } from "../../lib/auth/gsi-client";

/**
 * What the dialog does when a credential became a session: it closes itself
 * first (a vetoed reload must not leave a modal covering the notice that
 * explains the veto), then forwards to the caller and returns the caller's
 * verdict. Pure, so it can be tested without the dialog's chrome.
 */
export function signedInHandler(
  onOpenChange: (open: boolean) => void,
  onSignedIn: SignedInListener | undefined,
): SignedInListener {
  return () => {
    onOpenChange(false);
    return onSignedIn?.();
  };
}

/**
 * Registered while mounted, open or closed: a credential posted before the
 * dialog closed still completes, and the caller's state must still survive
 * the reload that follows.
 */
export function useSignedInListener(listener: SignedInListener | undefined): void {
  useEffect(() => {
    if (listener === undefined) return;
    return onGoogleSignedIn(listener);
  }, [listener]);
}
