"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefCallback,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { demoFields } from "@/lib/workbench/store/demo-fields";
import type { PublicWorkbenchAction } from "@/lib/workbench/store/WorkbenchProvider";
import type { WorkbenchProjectState } from "@/lib/workbench/types";

/**
 * "Clear sample" in the topbar: the control, its confirmation (Q32), and the
 * things that can move under them.
 *
 * - What the yes covers. `confirm` takes a `demoFields` snapshot of the render
 *   the operator pressed it in, and `clearDemo` carries it: the reducer clears
 *   only while the project is still the sample AND those fields still hold the
 *   same content (codex S6r2 #2; `sameDemoFields`: the same reference, or equal
 *   once JSON-encoded, codex S6r3 #2). Sample mode alone is not enough — another
 *   tab can load a second sample and add to it while the box is open. What was
 *   on screen when confirm was pressed is what was agreed to, so a newer sample
 *   that had rendered by then is cleared; content still queued behind that
 *   render is not.
 * - Whether it went. The dispatch runs in `flushSync`, which renders it with
 *   the updates queued ahead of it in the sync lanes (Sync, InputContinuous,
 *   Default), which is every store write the workbench makes today, so
 *   `stateRef` says afterwards what the reducer did. A write queued in a
 *   Transition would be skipped by that render and replayed after the
 *   read-back, undoing its answer (codex S6r3 #3), so no store write may be
 *   wrapped in one (`lib/workbench/no-transition-store-writes.test.ts` is the
 *   gate). A clear that landed leaves sample mode; still in it means it
 *   was refused, and the box opens again over what is there now (focus on
 *   Cancel, as on any open) instead of closing as if it had cleared.
 * - Another tab replacing the sample while the box is open closes it: confirming
 *   then would aim `clearDemo` at the operator's own data. The old "asked" is
 *   dropped rather than parked, or the box would pop back up unasked if the
 *   sample returned. Reset during render, not in an effect, so no frame commits
 *   with the box open over real data.
 * - Focus. Cancel returns it to the button that asked. Confirm, and that forced
 *   close, remove the button in the same commit, so each points the box at the
 *   next control in the row instead, or focus would drop to <body>. Dialog
 *   reads the ref when it closes, which is why a handler or the render-time
 *   reset can re-point it. With no box open the button itself can hold focus
 *   when another tab removes it (codex S6r2 #4): its ref cleanup, which runs
 *   while the node is still in the document, records that, and a layout effect
 *   hands focus to the same next control — only then, never on every exit from
 *   sample mode.
 */
export interface ClearSample {
  /** Whether the confirmation is open. */
  readonly boxOpen: boolean;
  /** For the clear button's `ref`. Stable, so it attaches once per mount. */
  readonly attachButton: RefCallback<HTMLButtonElement>;
  /** For the confirmation's `returnFocusTo`. */
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly ask: () => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
}

export function useClearSample({
  state,
  sampleLoaded,
  dispatch,
  drawerButtonRef,
}: {
  readonly state: WorkbenchProjectState;
  /** `ready && state.demo`: before storage is read, `demo` is the seed's false, not an answer. */
  readonly sampleLoaded: boolean;
  readonly dispatch: Dispatch<PublicWorkbenchAction>;
  /** The next control in the row, which takes focus when the clear button leaves under it. */
  readonly drawerButtonRef: RefObject<HTMLButtonElement | null>;
}): ClearSample {
  const [asked, setAsked] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const buttonHadFocusRef = useRef(false);
  // The latest render's state, read right after the `flushSync` in `confirm`.
  const stateRef = useRef(state);
  stateRef.current = state;

  if (asked && !sampleLoaded) {
    returnFocusRef.current = drawerButtonRef.current;
    setAsked(false);
  }

  useLayoutEffect(() => {
    if (sampleLoaded || !buttonHadFocusRef.current) return;
    buttonHadFocusRef.current = false;
    const next = drawerButtonRef.current;
    if (next?.isConnected && next.closest("[inert]") === null) next.focus();
  }, [sampleLoaded, drawerButtonRef]);

  const attachButton = useCallback((node: HTMLButtonElement | null) => {
    buttonRef.current = node;
    if (node === null) return undefined;
    return () => {
      buttonHadFocusRef.current = node.ownerDocument.activeElement === node;
      buttonRef.current = null;
    };
  }, []);

  function ask(): void {
    returnFocusRef.current = buttonRef.current;
    setAsked(true);
  }

  function confirm(): void {
    const expected = demoFields(state);
    returnFocusRef.current = drawerButtonRef.current;
    flushSync(() => {
      setAsked(false);
      dispatch({ type: "clearDemo", expected });
    });
    if (!stateRef.current.demo) return;
    returnFocusRef.current = buttonRef.current;
    setAsked(true);
  }

  return {
    boxOpen: asked && sampleLoaded,
    attachButton,
    returnFocusRef,
    ask,
    cancel: () => setAsked(false),
    confirm,
  };
}
