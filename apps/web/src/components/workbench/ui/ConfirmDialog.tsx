"use client";

import { useId, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./Dialog.tsx";
import { WB_ROOT_ID } from "./ids.ts";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, PANEL_FOOT, PANEL_TITLE } from "./panel.ts";

/**
 * "Are you sure?" for the two destructive things a view can do: replacing the
 * project with the sample site, and clearing it again.
 *
 * It is a portal out of `#wb-app`, and that is the whole reason this file
 * exists (裁决 Q32). `Dialog` makes `#wb-app` inert while it is open, and the
 * views and the topbar are inside `#wb-app` — a confirm box rendered where it is
 * declared would land inside the subtree it just fenced off: initial focus a
 * no-op, buttons dead, invisible to assistive technology, while an e2e check for
 * "exactly one dialog root" still passes. `ShellChrome` keeps the command
 * palette and the artifact drawer outside `#wb-app` for the same reason; a view
 * cannot, so the portal does it here.
 *
 * The target is `#wb-root` (the project layout's root, `#wb-app`'s parent), not
 * `document.body`: the next/font variable class lives on `#wb-root`, so a box
 * portalled into `<body>` renders in the fallback face and says nothing about
 * it. `document.body` remains the fallback for a mount without the shell around
 * it — being reachable matters more than the typeface — and the test below pins
 * which one is preferred.
 *
 * Nothing is rendered while it is closed, so `document` is never touched during
 * SSR (a portal has no server rendering).
 *
 * Initial focus is the cancel button, not the confirm one: the reason to open
 * this box is that the action is not undoable, and Enter on a freshly opened
 * dialog should not be the thing that performs it.
 *
 * `onConfirm` is not wrapped: the caller decides what happens, including closing
 * the box (this component never closes itself on confirm, so an action that
 * takes a moment can keep it open). A caller that never closes it leaves the
 * background inert, so it must set `open` back to false.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  returnFocusTo,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  /** What the confirmation costs, in the caller's words; it names what is lost. */
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Where focus goes on close; must be a stable ref (Dialog depends on it). */
  readonly returnFocusTo?: RefObject<HTMLElement | null> | undefined;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (!open) return null;
  return createPortal(
    <Dialog
      open
      onClose={onClose}
      labelledBy={titleId}
      initialFocus={cancelRef}
      returnFocusTo={returnFocusTo}
      className="left-1/2 top-1/2 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200"
    >
      <div className="p-6">
        <h2 id={titleId} className={PANEL_TITLE}>
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
      </div>
      <div className={PANEL_FOOT}>
        <button ref={cancelRef} type="button" onClick={onClose} className={BUTTON_SECONDARY}>
          {cancelLabel}
        </button>
        <button type="button" onClick={onConfirm} className={BUTTON_PRIMARY}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>,
    document.getElementById(WB_ROOT_ID) ?? document.body,
  );
}
