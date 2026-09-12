"use client";

import { useEffect } from "react";
import {
  clearAllWorkbenchState,
  WORKBENCH_SWEPT_EVENT,
} from "@/lib/workbench/store/persistence";

/**
 * Sweeps every `gg.workbench.*` key when the login page mounts (design §6.5).
 *
 * The workbench topbar's `SignOutButton` sweeps before it submits, but it is
 * not the only way out: the legacy `/new-project` shell signs out with a bare
 * server-action form that runs no client code, and an expired session never
 * passes through a sign-out at all. Every one of those paths lands here, so
 * this is the converging point — a second account on the same browser must
 * never see the previous one's local workbench data. Renders nothing.
 *
 * The page renders it only when the request carries no session
 * (`hasAuthSession`): a signed-in operator who lands here keeps their state.
 */
export function WorkbenchSweep() {
  useEffect(() => {
    try {
      clearAllWorkbenchState(window.localStorage);
      // This document gets no `storage` event for its own writes; any provider
      // still mounted in this tab has to be told the sweep happened.
      window.dispatchEvent(new Event(WORKBENCH_SWEPT_EVENT));
    } catch {
      // Storage unavailable: nothing persisted to clear.
    }
  }, []);
  return null;
}
