"use client";

import { useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useTranslations } from "next-intl";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { BUTTON_SECONDARY } from "../../ui/panel.ts";

/**
 * "Clear" for the GSC rows saved in this browser, behind a confirmation (T10
 * Step 3), shaped like the topbar's "clear sample" (`shell/useClearSample.ts`).
 *
 * - What the yes covers (codex S6r3). `confirm` snapshots the rows array and its
 *   provenance from the render the operator pressed it in, and `clearGscRows`
 *   carries that snapshot: the reducer clears only while both are still what
 *   was on screen. A bare `setGscRows([])` would also delete rows another tab
 *   imported while the box was open, or an import of ours queued behind that
 *   render — neither of which the operator saw.
 * - Whether it went. The dispatch runs in `flushSync`, so `stateRef` says what
 *   the reducer did. An accepted clear always leaves no rows, so rows still
 *   there mean it was refused (they are, by then, not the snapshot): the box
 *   opens again over what is there now, focus on Cancel, instead of closing as
 *   if it had cleared.
 * - Rows gone while the box is open (another tab cleared them) close it, reset
 *   during render so no frame commits a box asking about nothing; the "asked" is
 *   dropped, not parked, or it would reopen unasked when rows come back.
 * - Focus. Cancel returns to this button. A confirmed clear and that forced
 *   close remove the button in the same commit, so the box is pointed at
 *   `focusAfterClear` (the paste field) instead of dropping focus to <body>.
 *   Dialog reads the ref when it closes, which is why the handlers and the
 *   render-time reset can re-point it.
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function ClearGscRowsButton({
  onCleared,
  focusAfterClear,
}: {
  /** Called once the reducer accepted the clear. */
  readonly onCleared: () => void;
  /** Where focus goes when this button leaves under it. Must be a stable ref. */
  readonly focusAfterClear: RefObject<HTMLElement | null>;
}) {
  const { state, dispatch } = useWorkbench();
  const t = useTranslations("workbench.dataSources.import");
  const [asked, setAsked] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // The latest render's state, read right after the `flushSync` in `confirm`.
  const stateRef = useRef(state);
  stateRef.current = state;
  const hasRows = state.gscRows.length > 0;

  if (asked && !hasRows) {
    returnFocusRef.current = focusAfterClear.current;
    setAsked(false);
  }

  function ask(): void {
    returnFocusRef.current = buttonRef.current;
    setAsked(true);
  }

  function cancel(): void {
    returnFocusRef.current = buttonRef.current;
    setAsked(false);
  }

  function confirm(): void {
    const expected = { rows: state.gscRows, source: state.gscRowsSource };
    returnFocusRef.current = focusAfterClear.current;
    flushSync(() => {
      setAsked(false);
      dispatch({ type: "clearGscRows", expected });
    });
    if (stateRef.current.gscRows.length === 0) {
      onCleared();
      return;
    }
    returnFocusRef.current = buttonRef.current;
    setAsked(true);
  }

  return (
    <>
      {hasRows ? (
        <button ref={buttonRef} type="button" onClick={ask} className={BUTTON_SECONDARY}>
          {t("clear")}
        </button>
      ) : null}
      <ConfirmDialog
        open={asked && hasRows}
        onClose={cancel}
        onConfirm={confirm}
        title={t("clearConfirmTitle")}
        body={t("clearConfirmBody")}
        confirmLabel={t("clear")}
        cancelLabel={t("cancel")}
        returnFocusTo={returnFocusRef}
      />
    </>
  );
}
