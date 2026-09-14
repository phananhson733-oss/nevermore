"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { profileDocBasis } from "@/lib/workbench/store/reducer";
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
 * - A run writes only over what it read (T9 review #1). The rows, their
 *   provenance, the last audit and the stored document are its basis; the
 *   reducer refuses the document when any of them changed meanwhile (a sample
 *   loaded or cleared, rows imported), and the run reads the committed document
 *   back after a synchronous dispatch (the `useAddArtifact` pattern) and says
 *   through `refused` that nothing was saved, until the next run starts.
 *
 * The inputs are frozen when the run starts — rows and their provenance are
 * read together, so the snapshot's `gscSource` always describes the rows it
 * summarises (Q6). The clock is read when the run finishes, inside the timer
 * callback, never during render (Q22): the stamp is when the profile was made.
 *
 * Known residue (PR-4, with visibility run leases): the refusal sees only
 * changes that reached this store before the run writes.
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
  /** The last run's document was refused because the data changed while it ran. */
  readonly refused: boolean;
} {
  const { state, dispatch, projectId } = useWorkbench();
  const [progress, setProgress] = useState<ProfileRunProgress | null>(null);
  const [refused, setRefused] = useState(false);
  const token = useRef<symbol | null>(null);
  // The stored document as last COMMITTED, so a run can read back whether its
  // write landed: a refused write leaves the reducer's state as it was.
  const committedDoc = useRef(state.profileDoc);
  useLayoutEffect(() => {
    committedDoc.current = state.profileDoc;
  }, [state.profileDoc]);

  useEffect(
    () => () => {
      // The project changed or the page is going: whatever run is in flight is
      // no longer this page's to finish.
      token.current = null;
      setProgress(null);
      setRefused(false);
    },
    [projectId],
  );

  function start(srcs: ProfileSources): void {
    const mine = Symbol("profile-run");
    token.current = mine;
    setRefused(false);
    const basis = profileDocBasis(state);
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
      const doc = buildProfileDoc({ ...frozen, now: new Date() });
      flushSync(() => dispatch({ type: "setProfileDoc", doc, basis }));
      setRefused(committedDoc.current !== doc);
    };
    advance(0);
  }

  return { progress, start, refused };
}
