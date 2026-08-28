// @input  -- an optional callback from the component that mounts the sign-in dialog
// @output -- that callback registered with gsi-client for as long as the component is mounted
// @pos    -- the one line of SignInDialog that has behaviour, kept apart so it can be tested
//            without the dialog chrome (whose `@/` imports the unit project cannot resolve)
"use client";

import { useEffect } from "react";

import { onGoogleSignedIn, type SignedInListener } from "../../lib/auth/gsi-client";

/**
 * Registered while mounted, open or closed: a credential posted before the
 * dialog closed still completes, and the caller's state must still survive
 * the reload that follows. Callers that pass nothing register nothing.
 */
export function useSignedInListener(onSignedIn: SignedInListener | undefined): void {
  useEffect(() => {
    if (onSignedIn === undefined) return;
    return onGoogleSignedIn(onSignedIn);
  }, [onSignedIn]);
}
