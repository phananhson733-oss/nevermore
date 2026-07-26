"use client";

/**
 * Browser-navigation guard for an editor holding unsaved work. Shared by the
 * Studio artifact editor and the Product Profile editor modal.
 *
 * The decision has to be synchronous: `popstate` is not cancelable and the
 * Navigation API's `navigate` event is only conditionally cancelable, so an
 * in-app dialog cannot be awaited from here. `window.confirm` is the only
 * prompt available. A refused traversal is undone by traversing the exact
 * inverse delta (or by recreating the guarded entry when the delta is unknown)
 * rather than by reloading the document.
 *
 * `confirmLinkClick` is optional on purpose. On a surface whose shell is
 * `inert` for as long as the editor is open, no shell link can be clicked, so a
 * click listener there would be one more code path that reads as protection and
 * can never run. That is the defect recorded as R4 in the Slice 2 stop gate
 * (`docs/reviews/2026-07-25-seo-geo-content-shadow-stop-gate.md` §14.8); this
 * guard must not add a fresh instance of it.
 */

import { useLayoutEffect } from "react";

import {
  projectHistoryPosition,
  projectHistoryTraversalDelta,
} from "./_project-history-position.ts";

/**
 * Structurally identical to the Studio editor's `ArtifactNavigationIntent` so
 * `shouldConfirmArtifactNavigation` can be passed straight in.
 */
export interface LinkNavigationIntent {
  readonly dirty: boolean;
  readonly willLeaveEditor: boolean;
  readonly button: number;
  readonly modified: boolean;
  readonly opensNewContext: boolean;
  readonly download: boolean;
}

export interface UnsavedNavigationGuardOptions {
  /** Arm the guard. Pass `open && dirty` for an editor that lives in a modal. */
  readonly dirty: boolean;
  /** Shown by `window.confirm`; must read as "leave and lose the edits?". */
  readonly confirmationMessage: string;
  /** Runs once the operator has confirmed; the guard is disarmed first. */
  readonly discardChanges: () => void;
  /** Omit where the shell is `inert` while the editor is open — see above. */
  readonly confirmLinkClick?: (intent: LinkNavigationIntent) => boolean;
}

export function useUnsavedNavigationGuard({
  dirty,
  confirmationMessage,
  discardChanges,
  confirmLinkClick,
}: UnsavedNavigationGuardOptions): void {
  useLayoutEffect(() => {
    if (!dirty) return;
    const guardedUrl = window.location.href;
    const guardedState: unknown = window.history.state;
    const guardedPosition = projectHistoryPosition(window.history.state);
    const guardedNavigationIndex = browserNavigationIndex();
    let restoringTraversal = false;
    let guardActive = true;

    function beforeUnload(event: BeforeUnloadEvent): void {
      if (!guardActive) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function documentClick(event: MouseEvent): void {
      if (
        confirmLinkClick === undefined ||
        !guardActive ||
        event.defaultPrevented ||
        !(event.target instanceof Element)
      ) {
        return;
      }
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (anchor === null) return;

      const current = new URL(window.location.href);
      const destination = new URL(anchor.href, current);
      const sameDocument =
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search;
      const internalNavigation = destination.origin === current.origin;
      const target = anchor.getAttribute("target");
      const modified =
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

      if (
        !confirmLinkClick({
          dirty,
          willLeaveEditor: internalNavigation && !sameDocument,
          button: event.button,
          modified,
          opensNewContext:
            target !== null && target !== "" && target !== "_self",
          download: anchor.hasAttribute("download"),
        })
      ) {
        return;
      }
      if (window.confirm(confirmationMessage)) {
        guardActive = false;
        discardChanges();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    function popState(event: PopStateEvent): void {
      if (!guardActive) return;
      if (restoringTraversal) {
        restoringTraversal = false;
        return;
      }
      const delta = projectHistoryTraversalDelta(
        guardedPosition,
        event.state,
        guardedNavigationIndex,
        browserNavigationIndex(),
      );
      if (delta === 0) {
        return;
      }
      if (delta === null) {
        // Older browsers may expose neither Navigation API indices nor a stamp
        // on the entry that predates the project shell. Never interpret that
        // uncertainty as permission to discard edits. If the operator cancels,
        // suppress downstream router listeners and recreate the guarded entry
        // from its exact Next history state without reloading the document.
        if (window.confirm(confirmationMessage)) {
          guardActive = false;
          discardChanges();
          return;
        }
        event.stopImmediatePropagation();
        window.history.pushState(guardedState, "", guardedUrl);
        return;
      }
      if (window.confirm(confirmationMessage)) {
        guardActive = false;
        discardChanges();
        return;
      }

      // popstate itself is not cancelable. Stop Next's restore handler, then
      // traverse the exact inverse delta. The restoration event is allowed
      // through so router state and URL settle back on the guarded entry.
      event.stopImmediatePropagation();
      restoringTraversal = true;
      window.history.go(-delta);
    }

    function navigate(event: Event): void {
      if (!guardActive) return;
      const navigationEvent = event as BrowserNavigateEvent;
      if (
        navigationEvent.navigationType !== "traverse" ||
        !navigationEvent.destination.sameDocument
      ) {
        return;
      }
      if (window.confirm(confirmationMessage)) {
        guardActive = false;
        discardChanges();
        return;
      }
      if (event.cancelable) event.preventDefault();
    }

    const navigation = browserNavigation();
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", popState, true);
    navigation?.addEventListener("navigate", navigate);
    if (confirmLinkClick !== undefined) {
      document.addEventListener("click", documentClick, true);
    }
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", popState, true);
      navigation?.removeEventListener("navigate", navigate);
      document.removeEventListener("click", documentClick, true);
    };
  }, [confirmLinkClick, confirmationMessage, dirty, discardChanges]);
}

interface BrowserNavigateEvent extends Event {
  readonly navigationType: string;
  readonly destination: {
    readonly sameDocument: boolean;
  };
}

interface BrowserNavigation extends EventTarget {
  readonly currentEntry?: {
    readonly index: number;
  };
}

function browserNavigation(): BrowserNavigation | undefined {
  return (window as typeof window & { readonly navigation?: BrowserNavigation })
    .navigation;
}

/** Navigation API fallback for entries created before the project shell. */
function browserNavigationIndex(): number | null {
  const navigation = browserNavigation();
  const index = navigation?.currentEntry?.index;
  return typeof index === "number" && index >= 0 ? index : null;
}
