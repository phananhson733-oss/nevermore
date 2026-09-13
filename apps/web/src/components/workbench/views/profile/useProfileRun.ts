"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { buildProfileDoc, type ProfileSources } from "./build-profile-doc.ts";

/**
 * A profile run: a short step animation, then ONE write (plan Task 9 Step 3;
 * Q14; design §6.4 run tokens; jsx `ProfileView.run`, jsx:1178-1202).
 *
 * Nothing about it is real work — the document is `buildProfileDoc`, a pure
 * function — so the steps name what is composed locally (Q16), one per enabled
 * source plus assembly, derived from the switches rather than from positions in
 * a fixed list.
 *
 * What it guarantees:
 * - The stored profile is never cleared. The prototype set it to null when a
 *   run started (jsx:1180); a run abandoned half-way then left the project with
 *   no profile at all, because `profileDoc` keeps no history. Here the old one
 *   stays in the store and on screen until the new one is written at the end.
 * - One run can write. Each start takes a fresh token; every timer callback
 *   first checks that its token is still the current one, so a second click
 *   replaces the first run instead of racing it.
 * - A run belongs to its project and its page. Changing `projectId` or
 *   unmounting drops the token (the effect cleanup), so a run started on one
 *   project cannot write its document into another, and a page left mid-run
 *   writes nothing. Timers are left to fire and do nothing: the token check is
 *   the single gate, so there is no second mechanism for a test to miss.
 *
 * The inputs are frozen when the run starts — rows and their provenance are
 * read together, so the snapshot's `gscSource` always describes the rows it
 * summarises (Q6). The clock is read when the run finishes, inside the timer
 * callback, never during render (Q22): the stamp is when the profile was made.
 *
 * Known residue (PR-4, with visibility run leases): another tab replacing this
 * project's state mid-run is not detected; the write still lands last.
 */

export const PROFILE_STEP_MS = 400;

export type ProfileStepId = "crawl" | "gsc" | "third" | "compose";

export interface ProfileRunProgress {
  readonly steps: readonly ProfileStepId[];
  /** Index into `steps` of the step in flight. */
  readonly current: number;
}

const SOURCE_STEPS = ["crawl", "gsc", "third"] as const;

export function profileRunSteps(srcs: ProfileSources): readonly ProfileStepId[] {
  return [...SOURCE_STEPS.filter((id) => srcs[id]), "compose"];
}

export function useProfileRun(): {
  readonly progress: ProfileRunProgress | null;
  readonly start: (srcs: ProfileSources) => void;
} {
  const { state, dispatch, projectId } = useWorkbench();
  const [progress, setProgress] = useState<ProfileRunProgress | null>(null);
  const token = useRef<symbol | null>(null);

  useEffect(
    () => () => {
      // The project changed or the page is going: whatever run is in flight is
      // no longer this page's to finish.
      token.current = null;
      setProgress(null);
    },
    [projectId],
  );

  function start(srcs: ProfileSources): void {
    const mine = Symbol("profile-run");
    token.current = mine;
    const frozen = {
      profile: state.profile,
      gscRows: state.gscRows,
      gscRowsSource: state.gscRowsSource,
      lastAudit: state.lastAudit,
      srcs,
    };
    const steps = profileRunSteps(srcs);
    const advance = (step: number): void => {
      if (token.current !== mine) return;
      if (step < steps.length) {
        setProgress({ steps, current: step });
        setTimeout(() => advance(step + 1), PROFILE_STEP_MS);
        return;
      }
      token.current = null;
      setProgress(null);
      dispatch({ type: "setProfileDoc", doc: buildProfileDoc({ ...frozen, now: new Date() }) });
    };
    advance(0);
  }

  return { progress, start };
}
