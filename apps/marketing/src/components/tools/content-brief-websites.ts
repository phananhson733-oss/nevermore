// @input  -- the session endpoint and the account website list endpoint
// @output -- the signed-in visitor's websites for the product-profile select, or the
//            state that explains why the select is disabled
// @pos    -- the same two fetches components/account/website-profile-picker.tsx makes,
//            without the picker's target-URL matching (a brief has no URL to match)

"use client";

import { useEffect, useState } from "react";

import {
  parseWebsiteList,
  type WebsiteSummary,
} from "../../lib/account-websites/contracts.ts";

export type AccountWebsitesState =
  | { readonly phase: "loading" }
  | { readonly phase: "signed_out" }
  | { readonly phase: "unavailable" }
  | { readonly phase: "ready"; readonly websites: readonly WebsiteSummary[] };

async function readSignedIn(signal: AbortSignal): Promise<boolean | null> {
  const response = await fetch("/api/auth/session", {
    signal,
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    readonly signedIn?: unknown;
  } | null;
  if (!response.ok || body === null || typeof body.signedIn !== "boolean") {
    return null;
  }
  return body.signedIn;
}

async function readWebsites(
  signal: AbortSignal,
): Promise<readonly WebsiteSummary[] | null> {
  const response = await fetch("/api/account/websites", {
    signal,
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.status !== 200) return null;
  const value =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as { readonly data?: { readonly websites?: unknown } }).data
          ?.websites
      : null;
  return parseWebsiteList(value);
}

/**
 * Loads once on mount. The session check comes first so a signed-out visitor
 * never hits the account endpoint; a failed parse or a non-200 is
 * `unavailable`, which the form renders as "could not load", never as "you
 * have no websites".
 */
export function useAccountWebsites(): AccountWebsitesState {
  const [state, setState] = useState<AccountWebsitesState>({
    phase: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const signedIn = await readSignedIn(controller.signal);
        if (controller.signal.aborted) return;
        if (signedIn === null) {
          setState({ phase: "unavailable" });
          return;
        }
        if (!signedIn) {
          setState({ phase: "signed_out" });
          return;
        }
        const websites = await readWebsites(controller.signal);
        if (controller.signal.aborted) return;
        setState(
          websites === null
            ? { phase: "unavailable" }
            : { phase: "ready", websites },
        );
      } catch {
        if (!controller.signal.aborted) setState({ phase: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, []);

  return state;
}
