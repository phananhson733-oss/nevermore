"use client";

import { useEffect, useRef, useState } from "react";
import { downloadText } from "@/lib/workbench/download";
import { agentTaskWrapper } from "@/lib/workbench/mock/builders/agent-task";
import type { ArtifactType } from "@/lib/workbench/types";
import type { PreparedArtifact } from "../hooks/useAddArtifact.ts";
import { downloadName } from "../shell/ArtifactDrawer.tsx";
import { BUTTON_MINI } from "./panel.ts";

/**
 * The four things an operator can do with a finished artifact (`jsx:946` foot).
 *
 * One text, four actions (裁决 Q23). `prepared` is a whole `PreparedArtifact`
 * rather than a body plus a few loose fields, so the four cannot drift apart:
 * copy, export and "save to the basket" all hand over `prepared.content`
 * verbatim, and "copy for an AI" wraps that same string — `agentTaskWrapper`
 * puts it inside an announced fenced block and adds nothing of the artifact's to
 * the sentences around it. The provenance declaration was folded in once, by
 * `useAddArtifact`; nothing here stamps, re-stamps or trims it.
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

/**
 * Same table as `ArtifactDrawer.tsx`, and deliberately typed
 * `Record<ArtifactType, …>` in both places: a fifth artifact type is a compile
 * error here as well as there, so the two cannot silently cover different sets.
 */
const MIME: Readonly<Record<ArtifactType, string>> = {
  csv: "text/csv;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  json: "application/json;charset=utf-8",
  prompt: "text/plain;charset=utf-8",
};

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
              MIME[prepared.artifact.type],
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
            prepared.save();
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
    </>
  );
}
