"use client";

import { useEffect, useState } from "react";
import {
  useAddArtifact,
  type ArtifactDraft,
  type PreparedArtifact,
} from "../../hooks/useAddArtifact.ts";

/**
 * One prepared (stamped) artifact per draft content (Q23), the same pattern as
 * `views/week/WeekReport.tsx`'s private `usePreparedArtifact` (`67dd4264`,
 * codex S7b #3). Copied rather than imported because that one is private to the
 * week view; both belong in `components/workbench/hooks/` once a third view
 * needs it (recorded in the T9 report).
 *
 * Prepared in an effect keyed by what the draft says, so the same object
 * survives re-renders until the content changes — preparing during render
 * would mint a new id and read the clock on every pass. Only a prepared
 * artifact whose key matches the CURRENT draft is returned: in the render after
 * the tab or the profile changes, and before the effect prepares the new text,
 * the caller gets `null` and shows a skeleton instead of offering last render's
 * text to copy, export or save.
 */

interface PreparedSlot {
  readonly key: string;
  readonly prepared: PreparedArtifact;
}

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
  return slot?.key === key ? slot.prepared : null;
}
