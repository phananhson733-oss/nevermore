"use client";

import { useEffect, useRef, useState } from "react";
import { ARTIFACT_MIME, downloadName } from "@/lib/workbench/artifact-file";
import { downloadText } from "@/lib/workbench/download";
import { agentTaskWrapper } from "@/lib/workbench/mock/builders/agent-task";
import type { PreparedArtifact } from "../hooks/useAddArtifact.ts";
import { BUTTON_MINI } from "./panel.ts";

/**
 * The four things an operator can do with a finished artifact (`jsx:946` foot).
 *
 * One text, four actions (裁决 Q23). Copy and export hand over
 * `prepared.content` verbatim, "save to the basket" dispatches
 * `prepared.artifact` — frozen when it was prepared, so its `content` is still
 * that same string — and "copy for an AI"
 * passes the string to `agentTaskWrapper`. What comes out of that block equals
 * `prepared.content` because `stampArtifact` emits the canonical shape (LF, no
 * trailing newline) on which `fenceBlock`'s two rewrites do nothing — not
 * because this component takes one object: a whole `PreparedArtifact` gives the
 * four actions one source to read, it does not by itself make them agree.
 * `agentTaskWrapper` adds nothing of the artifact's to the sentences around the
 * block. The provenance declaration was folded in once, by `useAddArtifact`;
 * nothing here stamps, re-stamps or trims it.
 *
 * Over `ARTIFACT_CONTENT_MAX` the basket refuses the text rather than keep a
 * shortened copy of it (Q37). The row says so in a standing `role="alert"`
 * notice rather than a flash, because the refusal stays true for as long as
 * this artifact is on screen; the notice names the ways out, and copy and export
 * still hand over the whole text.
 *
 * The flash is `useState` plus one timer, and the timer is cleared on unmount:
 * a "Copied" that fires into an unmounted pane is a setState nobody reads.
 * A refused clipboard (a permission prompt denied, a non-secure context, a
 * browser with no `navigator.clipboard` at all) says so rather than flashing
 * "Copied" over a clipboard that still holds something else.
 *
 * Every label is the caller's: the workbench has no shared copy for these four
 * yet, and a view may not spell a literal (design §7).
 */

/** How long a flash stays up (jsx `flash()`). */
const FLASH_MS = 1300;

export interface ArtifactActionLabels {
  readonly copy: string;
  readonly copied: string;
  /** Says the clipboard refused and what to do instead; it must not blame the artifact. */
  readonly copyFailed: string;
  readonly copyForAi: string;
  /** `export` is a keyword at the call site often enough to be worth avoiding. */
  readonly exportFile: string;
  readonly save: string;
  readonly saved: string;
  /** Says the text is too large for the basket, and that export and copy still work. */
  readonly tooLarge: string;
}

export function ArtifactActions({
  prepared,
  labels,
  disabled,
}: {
  /** The stamped artifact from `useAddArtifact`; every action uses its text. */
  readonly prepared: PreparedArtifact;
  readonly labels: ArtifactActionLabels;
  /** True when there is nothing to act on yet (an empty weekly report, say). */
  readonly disabled?: boolean | undefined;
}) {
  const [flash, setFlash] = useState<string | null>(null);
  // The artifact a save was refused for, compared by identity at render: a view
  // that hands over a different artifact drops the notice with no effect to sync.
  const [refused, setRefused] = useState<PreparedArtifact | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  function show(text: string): void {
    setFlash(text);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setFlash(null);
    }, FLASH_MS);
  }

  async function copy(text: string): Promise<void> {
    try {
      // A browser without `navigator.clipboard` throws here rather than
      // returning a rejected promise; both land in the same branch.
      await navigator.clipboard.writeText(text);
      show(labels.copied);
    } catch {
      show(labels.copyFailed);
    }
  }

  const off = disabled === true;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={off}
          onClick={() => void copy(prepared.content)}
          className={BUTTON_MINI}
        >
          {labels.copy}
        </button>
        <button
          type="button"
          disabled={off}
          onClick={() => void copy(agentTaskWrapper(prepared.content))}
          className={BUTTON_MINI}
        >
          {labels.copyForAi}
        </button>
        <button
          type="button"
          disabled={off}
          onClick={() =>
            downloadText(
              downloadName(prepared.artifact),
              prepared.content,
              ARTIFACT_MIME[prepared.artifact.type],
            )
          }
          className={BUTTON_MINI}
        >
          {labels.exportFile}
        </button>
        <button
          type="button"
          disabled={off}
          onClick={() => {
            if (prepared.save() === "tooLarge") {
              setRefused(prepared);
              return;
            }
            show(labels.saved);
          }}
          className={BUTTON_MINI}
        >
          {labels.save}
        </button>
      </div>
      <span role="status" className="text-xs text-slate-500">
        {flash ?? ""}
      </span>
      {refused === prepared ? (
        <p role="alert" className="text-xs text-slate-700">
          {labels.tooLarge}
        </p>
      ) : null}
    </>
  );
}
