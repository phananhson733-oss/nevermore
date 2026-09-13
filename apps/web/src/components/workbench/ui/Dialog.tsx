"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "./cn.ts";
import { FOCUSABLE, nextTrapIndex } from "./focus-order.ts";
import { WB_APP_ROOT_ID, WB_MAIN_ID } from "./ids.ts";
import { isComposingKey } from "./keyboard.ts";

/** How many Dialogs are open; `#wb-app` is inert while it is > 0. */
let openDialogs = 0;
/**
 * Whether `#wb-app` was already inert when the first of the open dialogs
 * opened. The legacy modals (Product Profile editor, action override) make
 * every `document.body` child inert and restore only what they set; an inert
 * they own must survive our last close, or their background wakes up under
 * them. Snapshotted at 0→1 and consulted at 1→0 only. That is enough because
 * the two kinds of modal cannot interleave: while one of ours is open the
 * legacy page is inert and cannot open its modal, and while a legacy modal is
 * open `ShellChrome` refuses to open ours — so the only reachable orders are
 * strictly nested, and a boolean covers them.
 */
let rootHadInert = false;

/** A subtree another modal has fenced off. */
const FENCED = "[inert], [aria-hidden='true']";

/**
 * Hands focus to `target` if it can take it, and says whether it did.
 *
 * - Not tried once it has left the document: the button that opened a confirm
 *   can be removed by that confirm, and `focus()` on a detached node does
 *   nothing.
 * - Not tried under someone else's `inert` / `aria-hidden`: focusing into a
 *   subtree another modal has fenced off would put the caret behind its scrim
 *   (the browser refuses for `inert`, jsdom would not, and `aria-hidden` stops
 *   neither).
 * - Otherwise tried, then read back from the document: `focus()` is a silent
 *   no-op on a hidden or disabled element. `offsetParent === null` would
 *   misjudge fixed-position targets and is null for everything under jsdom.
 */
function handFocusBack(target: Element | null | undefined): boolean {
  if (!(target instanceof HTMLElement) || !target.isConnected) return false;
  if (target.closest(FENCED) !== null) return false;
  target.focus();
  return document.activeElement === target;
}

/**
 * Accessible modal (design §4.3): role=dialog + aria-modal, focus moves in on
 * open, is trapped while open, and on close goes to the first target that can
 * take it (listed in the close path). The app root (`#wb-app`) is made inert so
 * the background is unreachable by keyboard and AT.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  initialFocus,
  returnFocusTo,
  fallbackFocus,
  className,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly labelledBy: string;
  /** Must be a stable ref: it is an effect dependency. */
  readonly initialFocus?: RefObject<HTMLElement | null> | undefined;
  /**
   * Preferred focus target on close; falls back to whatever was focused on open.
   * Must be a stable ref: it is an effect dependency.
   */
  readonly returnFocusTo?: RefObject<HTMLElement | null> | undefined;
  /**
   * Where focus goes on close when neither `returnFocusTo` nor the opener can
   * take it, e.g. because the confirm removed the button that opened the
   * dialog. `<main>` (`WB_MAIN_ID`) is tried after it either way. Must be a
   * stable ref: it is an effect dependency.
   */
  readonly fallbackFocus?: RefObject<HTMLElement | null> | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const root = document.getElementById(WB_APP_ROOT_ID);
    if (process.env.NODE_ENV !== "production" && !root) {
      console.warn(`Dialog: #${WB_APP_ROOT_ID} not found; the background is not inert`);
    }
    // `inert` is one shared attribute for however many dialogs are open, so it
    // is ref-counted on the way out: only the last close removes it, and only
    // if it was ours to set. Setting it is unconditional, and the cleanup looks
    // the root up again instead of reusing this node, so the two always touch
    // the same element even if `#wb-app` were replaced under an open dialog.
    // Both are defensive; the root is not currently remounted between opens.
    if (openDialogs === 0) rootHadInert = root?.hasAttribute("inert") ?? false;
    root?.setAttribute("inert", "");
    openDialogs += 1;
    const entry =
      initialFocus?.current ??
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      panelRef.current;
    entry?.focus();
    return () => {
      openDialogs -= 1;
      // A dialog closing behind another one must not pull focus out of the one
      // still on top, nor lift `inert` from the background it still covers.
      if (openDialogs > 0) return;
      // Order matters: focus() on a node inside an inert subtree is a no-op,
      // so inert comes off first. Next's layout-router focuses the changed
      // segment after navigation, so activeElement-on-open is only a fallback.
      if (!rootHadInert) {
        document.getElementById(WB_APP_ROOT_ID)?.removeAttribute("inert");
      }
      // The first of these that takes focus gets it: the preferred target, the
      // opener, the caller's fallback, then `<main>`. Any of them can fail: the
      // preferred target can be hidden by a responsive utility, the opener can
      // be the button a confirm removed in the same commit, and either can
      // have ended up under another modal's `inert` / `aria-hidden` while this
      // dialog was open. With none left, focus stays where the browser put it.
      const targets = [
        returnFocusTo?.current,
        openerRef.current,
        fallbackFocus?.current,
        document.getElementById(WB_MAIN_ID),
      ];
      for (const target of targets) {
        if (handFocusBack(target)) break;
      }
    };
  }, [open, initialFocus, returnFocusTo, fallbackFocus]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // Mid-composition keys belong to the IME (see `isComposingKey`): a
    // composing Escape cancels the candidate list, it does not close the
    // dialog. Not stopped here either; `useGlobalShortcut` has the same guard.
    if (isComposingKey(event.nativeEvent)) return;
    if (event.key === "Escape") {
      // Suppresses useGlobalShortcut's window-level Escape (bubble phase) so the dialog closes once.
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const active = items.indexOf(document.activeElement as HTMLElement);
    const next = nextTrapIndex(items.length, active, event.shiftKey);
    if (next === -1) {
      // Nothing focusable inside: keep focus on the panel rather than letting
      // Tab escape into the (inert, but not in every browser) background.
      event.preventDefault();
      return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

  if (!open) return null;
  return (
    <div className="wb-reset fixed inset-0 z-50 font-sans text-slate-900">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 bg-slate-900/50"
        // mousedown is what moves focus; without this a click on the backdrop
        // blurs the panel before `onClose` runs, so the close handler returns
        // focus from <body> instead of from inside the trap.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn("absolute bg-white shadow-xl outline-none", className)}
      >
        {children}
      </div>
    </div>
  );
}
