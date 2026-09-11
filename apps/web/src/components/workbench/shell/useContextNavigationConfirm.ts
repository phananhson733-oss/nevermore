"use client";

import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";
import {
  hasUnsavedContextChanges,
  shouldConfirmContextNavigation,
} from "@/app/p/[projectId]/_context-navigation-guard";

export interface ContextNavigationConfirm {
  /** Link handler: cancels the click when the operator declines to leave. */
  readonly confirmNavigation: (
    event: MouseEvent<HTMLAnchorElement>,
    current: boolean,
  ) => void;
  /**
   * The same guard for navigations that are not a link click (the command
   * palette pushes through the router). Returns false when the operator chose
   * to stay, so the caller can abort.
   */
  readonly confirmLeave: () => boolean;
}

/**
 * The Context unsaved-changes confirm (design §4.3), shared by every navigation
 * affordance the workbench shell owns. Every route out of a dirty Context
 * editor has to ask, or the rail asks and the palette silently discards.
 */
export function useContextNavigationConfirm(): ContextNavigationConfirm {
  const tContext = useTranslations("context");

  function confirmNavigation(
    event: MouseEvent<HTMLAnchorElement>,
    current: boolean,
  ): void {
    const modified =
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    const dirty = hasUnsavedContextChanges();
    if (
      !shouldConfirmContextNavigation({
        dirty,
        current,
        button: event.button,
        modified,
      })
    ) {
      return;
    }
    if (!window.confirm(tContext("leaveWarning"))) event.preventDefault();
  }

  function confirmLeave(): boolean {
    // A palette jump is always an ordinary primary navigation away from the
    // current page, hence the fixed `current` / `button` / `modified` values.
    if (
      !shouldConfirmContextNavigation({
        dirty: hasUnsavedContextChanges(),
        current: false,
        button: 0,
        modified: false,
      })
    ) {
      return true;
    }
    return window.confirm(tContext("leaveWarning"));
  }

  return { confirmNavigation, confirmLeave };
}
