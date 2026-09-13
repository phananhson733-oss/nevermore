"use client";

import { useSyncExternalStore } from "react";

/**
 * How the palette shortcut is spelled. Not translated copy: ⌘ and Ctrl are key
 * names printed on the reader's keyboard, and neither locale renames them. The
 * sentence around the label is the translated part (`workbench.shell.
 * shortcutHint`, ICU `{key}`); this hook only supplies the key.
 */
const MAC_LABEL = "⌘K";
const OTHER_LABEL = "Ctrl+K";

/**
 * `navigator.userAgentData` is not in TypeScript's DOM lib and this workspace
 * carries no ambient declaration for it (checked: zero), so the one field read
 * here is declared narrowly rather than reached for through `any` — `any` would
 * also swallow a rename or a shape change without a word.
 */
interface NavigatorPlatformHints {
  readonly userAgentData?: { readonly platform?: string } | undefined;
  readonly platform?: string | undefined;
}

/** iPadOS reports `MacIntel`, and its hardware keyboard really does carry ⌘. */
const MAC_PLATFORM = /^(?:Mac|iPhone|iPad|iPod)/u;

function isMacKeyboard(): boolean {
  const hints: NavigatorPlatformHints = navigator;
  const hinted = hints.userAgentData?.platform;
  // The UA-Client-Hints value where it exists; a Windows browser can report a
  // frozen, Mac-looking `navigator.platform`, so the hint wins when present.
  if (typeof hinted === "string" && hinted !== "") return hinted === "macOS";
  // Deprecated, and still the only answer Safari and Firefox give.
  return MAC_PLATFORM.test(hints.platform ?? "");
}

/**
 * Nothing to subscribe to: the platform does not change for the life of the
 * document. `useSyncExternalStore` still wants a stable `subscribe`, and this
 * is the point of using it — the value is read during render rather than
 * written by an effect, so a PC reader never sees ⌘K for one paint.
 */
function subscribe(): () => void {
  return () => {};
}

function getSnapshot(): string {
  return isMacKeyboard() ? MAC_LABEL : OTHER_LABEL;
}

/**
 * Fixed on the server, where there is no platform to read. ⌘K is the design's
 * spelling, so the prerendered HTML matches what most readers get; React
 * reconciles the other case after hydration without a mismatch warning, which
 * is the whole reason this is `useSyncExternalStore` and not `useState`.
 */
function getServerSnapshot(): string {
  return MAC_LABEL;
}

/** The key chord that opens the command palette, spelled for this reader. */
export function useShortcutLabel(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
