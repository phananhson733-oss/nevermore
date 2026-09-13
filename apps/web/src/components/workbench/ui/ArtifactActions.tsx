"use client";

import { useEffect, useRef, useState } from "react";
import { ARTIFACT_MIME, downloadName } from "@/lib/workbench/artifact-file";
import { downloadText } from "@/lib/workbench/download";
import { agentTaskWrapper } from "@/lib/workbench/mock/builders/agent-task";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { ARTIFACT_LIMIT, type ArtifactType } from "@/lib/workbench/types";
import type { PreparedArtifact, SaveResult } from "../hooks/useAddArtifact.ts";
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
 * A full basket refuses too, rather than silently evicting the oldest artifact
 * to make room. That notice names its cause (there is exactly one) and the way
 * out: remove a few in the basket, then save again. Fullness belongs to the
 * basket rather than to this text, so the notice stays only while the basket is
 * still full, and the same artifact saves once there is room.
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
  /** Says the basket is full and the way out: remove a few there, then save again. */
  readonly basketFull: string;
}

/**
 * The `workbench.artifactActions` message keys, one per label field. The
 * `satisfies` binds this table to `ArtifactActionLabels` in both directions —
 * a field renamed, added or removed on the component side without this table
 * following is a compile error (a missing key, or an excess one) — and
 * `views-i18n.test.ts` holds the table equal to that subtree in both locales.
 * Together they stop a label the row reads from having no message behind it,
 * which next-intl would render as the key path in every artifact footer.
 */
export const ARTIFACT_ACTION_LABEL_KEYS = {
  copy: true,
  copied: true,
  copyFailed: true,
  copyForAi: true,
  exportFile: true,
  save: true,
  saved: true,
  tooLarge: true,
  basketFull: true,
} as const satisfies Record<keyof ArtifactActionLabels, true>;

/** A save the basket turned down, and the text it turned down. */
interface Refusal {
  readonly reason: Exclude<SaveResult, "saved">;
  readonly type: ArtifactType;
  readonly content: string;
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
  // Keyed on the TEXT a save was refused for, not on the object. A view that
  // prepares the same draft on every render hands over a new `PreparedArtifact`
  // (with a new id) each time, and a notice keyed on identity would vanish on
  // the next parent render while the refusal is still true. Type and content are
  // what the refusal is about; a different text drops the notice, with no
  // effect to keep in sync.
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const refusedFor =
    refusal !== null &&
    refusal.type === prepared.artifact.type &&
    refusal.content === prepared.content
      ? refusal.reason
      : null;
  // "Full" describes the basket, not this text: once the drawer has room the
  // notice would be false, so it is shown only while the basket still is full.
  const basketStillFull =
    useWorkbench().state.artifacts.length >= ARTIFACT_LIMIT;
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
            const result = prepared.save();
            if (result !== "saved") {
              setRefusal({
                reason: result,
                type: prepared.artifact.type,
                content: prepared.content,
              });
              return;
            }
            setRefusal(null);
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
      {refusedFor === "tooLarge" ? (
        <p role="alert" className="text-xs text-slate-700">
          {labels.tooLarge}
        </p>
      ) : null}
      {refusedFor === "full" && basketStillFull ? (
        <p role="alert" className="text-xs text-slate-700">
          {labels.basketFull}
        </p>
      ) : null}
    </>
  );
}
