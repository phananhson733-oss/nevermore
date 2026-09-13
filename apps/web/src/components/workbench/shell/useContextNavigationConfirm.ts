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
}

/**
 * The Context unsaved-changes confirm (design §4.3), shared by every navigation
 * affordance the workbench shell owns. Every route out of a dirty Context
 * editor has to ask, or the rail asks and the palette silently discards.
 *
 * Link clicks only: the command palette used to carry a second, click-less
 * variant for its router push, but its options are anchors now (so the Studio
 * editor guard sees them too) and they go through this same handler.
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

  return { confirmNavigation };
}
