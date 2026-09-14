"use client";

import { useEffect, useEffectEvent } from "react";
import { isComposingKey } from "../ui/keyboard.ts";

/**
 * ⌘K / Ctrl+K toggles the palette; Escape closes whatever is open (jsx L22–29).
 *
 * Subscribes to `window` once per mount; callers may pass a fresh handlers
 * object every render. The listener calls an effect event, which React points
 * at the handlers of the latest *committed* render. It is deliberately not a
 * ref assigned during render: a concurrent render that React discards would
 * still have overwritten that ref, and a shortcut could then run a handler from
 * props that never reached the screen.
 */
export function useGlobalShortcut(handlers: {
  readonly onTogglePalette: () => void;
  readonly onEscape: () => void;
}): void {
  const onShortcutKey = useEffectEvent((event: globalThis.KeyboardEvent): void => {
    // A composing Escape reaches the window because Dialog lets it through
    // on purpose; it is the IME's, not ours (see `isComposingKey`).
    if (isComposingKey(event)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      handlers.onTogglePalette();
    } else if (event.key === "Escape") {
      handlers.onEscape();
    }
  });

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      onShortcutKey(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
