"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type MouseEvent } from "react";
import {
  hasUnsavedContextChanges,
  shouldConfirmContextNavigation,
} from "@/app/p/[projectId]/_context-navigation-guard";
import {
  projectHistoryPosition,
  withProjectHistoryPosition,
} from "@/app/p/[projectId]/_project-history-position";

/**
 * The two behaviours the retired `_nav.tsx` carried besides rendering
 * (design §4.3): a history position on every project-shell entry (Studio
 * reverses a cancelled Back/Forward with it) and the Context unsaved-changes
 * confirm. Both must keep running under the workbench shell.
 */
export function useProjectShellEffects(): {
  readonly confirmNavigation: (
    event: MouseEvent<HTMLAnchorElement>,
    current: boolean,
  ) => void;
} {
  const tContext = useTranslations("context");
  const pathname = usePathname();
  const historyPositionRef = useRef<number | null>(null);
  const historyPathRef = useRef<string | null>(null);

  // Give every project-shell entry a position without pushing a duplicate
  // entry. Studio can then reverse a cancelled Back or Forward traversal while
  // preserving Next's opaque router state and the browser's forward history.
  useEffect(() => {
    const existing = projectHistoryPosition(window.history.state);
    const previousPath = historyPathRef.current;
    if (previousPath === pathname) return;

    if (
      existing !== null &&
      (previousPath === null || existing !== historyPositionRef.current)
    ) {
      historyPositionRef.current = existing;
      historyPathRef.current = pathname;
      return;
    }
    // A push may preserve the custom state from the prior entry. Equal to the
    // previous position on a new pathname means inherited, not a traversal.
    const next = (historyPositionRef.current ?? -1) + 1;
    window.history.replaceState(
      withProjectHistoryPosition(window.history.state, next),
      "",
    );
    historyPositionRef.current = next;
    historyPathRef.current = pathname;
  }, [pathname]);

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
