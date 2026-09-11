"use client";

import { useEffect } from "react";
import { isComposingKey } from "../ui/keyboard.ts";

/** ⌘K / Ctrl+K toggles the palette; Escape closes whatever is open (jsx L22–29). */
export function useGlobalShortcut(handlers: {
  readonly onTogglePalette: () => void;
  readonly onEscape: () => void;
}): void {
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      // A composing Escape reaches the window because Dialog lets it through
      // on purpose; it is the IME's, not ours (see `isComposingKey`).
      if (isComposingKey(event)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        handlers.onTogglePalette();
      } else if (event.key === "Escape") {
        handlers.onEscape();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
