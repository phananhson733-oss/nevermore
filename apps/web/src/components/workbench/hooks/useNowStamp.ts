"use client";

import { useEffect, useState } from "react";
import { formatLocalStamp } from "@/lib/workbench/mock/time";
import { useWorkbench } from "@/lib/workbench/store/hooks";

export interface NowStamp {
  /** The clock this stamp was read from, for the day-window helpers in `mock/time.ts`. */
  readonly now: Date;
  /** Local wall clock, `YYYY-MM-DD HH:mm`: the only stamp format the workbench stores. */
  readonly stamp: string;
}

function readClock(): NowStamp {
  const now = new Date();
  return { now, stamp: formatLocalStamp(now) };
}

/**
 * The clock a view is allowed to show, read once in an effect after the project
 * is hydrated (Q22), and `null` until then so the caller renders a skeleton
 * rather than a time.
 *
 * Deliberately not `useState(() => new Date())`: a lazy initialiser runs during
 * render, on the server and again on the client, which is exactly the SSR/CSR
 * mismatch this hook exists to prevent — and the mismatch is invisible in a test
 * that only looks at the settled DOM.
 *
 * One clock read fills both fields, so a stamp and a window computed from it can
 * never straddle a minute boundary. It does not tick: it is the clock at the
 * moment the project became ready, which is what a "generated at" line means.
 * Artifacts do not use it — `useAddArtifact` reads the clock when the operator
 * clicks, which is the time that belongs on an artifact.
 */
export function useNowStamp(): NowStamp | null {
  const { ready } = useWorkbench();
  const [nowStamp, setNowStamp] = useState<NowStamp | null>(null);
  useEffect(() => {
    if (!ready) return;
    // Keeps the first reading if the effect ever runs again.
    setNowStamp((current) => current ?? readClock());
  }, [ready]);
  return nowStamp;
}
