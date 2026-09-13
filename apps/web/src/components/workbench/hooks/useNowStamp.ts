"use client";

import { useEffect, useRef, useState } from "react";
import { formatLocalStamp } from "@/lib/workbench/mock/time";
import { useWorkbench } from "@/lib/workbench/store/hooks";

export interface NowStamp {
  /** The clock this stamp was read from, for the day-window helpers in `mock/time.ts`. */
  readonly now: Date;
  /** Local wall clock, `YYYY-MM-DD HH:mm`: the only stamp format the workbench stores. */
  readonly stamp: string;
}

/** How often a mounted view re-reads the clock. The stamp has minute precision. */
export const NOW_STAMP_REFRESH_MS = 60_000;

function readClock(): NowStamp {
  const now = new Date();
  return { now, stamp: formatLocalStamp(now) };
}

/**
 * The clock a view is allowed to show, read in an effect once the project is
 * hydrated (Q22), and `null` until then so the caller renders a skeleton rather
 * than a time.
 *
 * Deliberately not `useState(() => new Date())`: a lazy initialiser runs during
 * render, on the server and again on the client, which is exactly the SSR/CSR
 * mismatch this hook exists to prevent — and the mismatch is invisible in a test
 * that only looks at the settled DOM.
 *
 * One clock read fills both fields, so a stamp and a window computed from it can
 * never straddle a minute boundary. The reading keeps up with the wall clock
 * while the view is mounted (week audit #2): the week page's range, counts and
 * feed are "the last 7 days", and a tab left open past midnight must not keep
 * yesterday's dates. It re-reads once a minute, and as soon as the tab is visible
 * again because a background tab's timers can be held back. A reading only
 * becomes new state when its minute differs, so an idle page does not re-render
 * on every tick. Artifacts do not use it — `useAddArtifact` reads the clock when
 * the operator clicks, which is the time that belongs on an artifact.
 */
export function useNowStamp(): NowStamp | null {
  const { ready } = useWorkbench();
  const [nowStamp, setNowStamp] = useState<NowStamp | null>(null);
  const shownStamp = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const refresh = (): void => {
      const next = readClock();
      if (next.stamp === shownStamp.current) return;
      shownStamp.current = next.stamp;
      setNowStamp(next);
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    const timer = setInterval(refresh, NOW_STAMP_REFRESH_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [ready]);
  return nowStamp;
}
