"use client";

import { useEffect, useState } from "react";
import { useAddArtifact, type ArtifactDraft, type PreparedArtifact } from "./useAddArtifact.ts";

/**
 * One prepared (stamped) artifact per draft content (Q23), shared by the weekly
 * report and the profile page's actions (T9 review P3-5; first written in
 * `views/week/WeekReport.tsx`, 67dd4264).
 *
 * Prepared in an effect keyed by what the draft says, so the same
 * `PreparedArtifact` object survives every re-render until the content changes.
 * Preparing during render would mint a new id and read the clock on every pass;
 * one object per content keeps whatever the shared row ties to the object it is
 * handed out of the caller's concern.
 *
 * `null` in two cases, and the caller shows a skeleton instead of actions:
 * - The slot's key is not the current draft's (codex S7b #3). In the render
 *   after the content changes and before the effect prepares the new text, the
 *   previous object would otherwise reach the row, and a click in that window
 *   would copy, export or save last render's text.
 * - `useAddArtifact` answers `null`: the store cannot take a save (codex S7r2
 *   #2). The effect then prepares nothing and keeps the old slot, so the key
 *   alone would go on handing that object out for as long as the content stays
 *   the same.
 *
 * Whatever the row was showing for the previous text (a "Saved" flash, a
 * refusal) goes with it, which is the price of never offering text the page no
 * longer says.
 */

interface PreparedSlot {
  readonly key: string;
  readonly prepared: PreparedArtifact;
}

/** Everything the draft says: two drafts with the same key prepare the same text. */
function draftKey(draft: ArtifactDraft): string {
  return JSON.stringify([
    draft.module,
    draft.type,
    draft.engine,
    draft.title,
    draft.filename ?? null,
    draft.body,
  ]);
}

export function usePreparedArtifact(draft: ArtifactDraft): PreparedArtifact | null {
  const prepare = useAddArtifact();
  const key = draftKey(draft);
  const [slot, setSlot] = useState<PreparedSlot | null>(null);
  const canPrepare = prepare !== null;
  useEffect(() => {
    if (prepare === null) return;
    setSlot({ key, prepared: prepare(draft) });
    // `prepare` and `draft` are new objects on every render; `key` is what they
    // carry and `canPrepare` is whether the store can take a save at all.
  }, [key, canPrepare]);
  return canPrepare && slot?.key === key ? slot.prepared : null;
}
