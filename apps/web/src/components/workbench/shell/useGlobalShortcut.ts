"use client";

import { useEffect, useRef } from "react";
import { isComposingKey } from "../ui/keyboard.ts";

/**
 * ⌘K / Ctrl+K toggles the palette; Escape closes whatever is open (jsx L22–29).
 *
 * Subscribes to `window` once per mount. The listener reads the handlers from a
 * ref that every render overwrites, so callers may pass a fresh object each
 * render without the hook tearing down and re-adding the listener, and a key
 * still reaches the handlers from the latest render rather than the first.
 */
export function useGlobalShortcut(handlers: {
  readonly onTogglePalette: () => void;
  readonly onEscape: () => void;
}): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      // A composing Escape reaches the window because Dialog lets it through
      // on purpose; it is the IME's, not ours (see `isComposingKey`).
      if (isComposingKey(event)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        latest.current.onTogglePalette();
      } else if (event.key === "Escape") {
        latest.current.onEscape();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
