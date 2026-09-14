/** @vitest-environment jsdom */

/**
 * The palette shortcut is ⌘K on a Mac and Ctrl+K everywhere else, and the hint
 * has to say which. What this pins is the two things a reader cannot see in the
 * markup: which signal decides the platform (the modern `userAgentData` hint
 * first, `navigator.platform` only as the fallback Safari and Firefox still
 * need), and that the value is settled during the first client render rather
 * than flipped by an effect afterwards.
 *
 * The interpolated sentence itself is pinned at its two real consumers
 * (`Sidebar.test.tsx`, `Topbar.test.tsx`): a hook test plus a hand-written
 * expectation would be two halves agreeing with each other about a seam neither
 * of them crosses.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useShortcutLabel } from "./useShortcutLabel.ts";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom reports `navigator.platform` as "" and ships no `userAgentData`, so
 * both are installed as own properties per test and deleted afterwards, which
 * puts the prototype's own answer back.
 */
function fakePlatform(fake: {
  readonly platform?: string;
  readonly userAgentData?: string;
}): void {
  Object.defineProperty(window.navigator, "platform", {
    value: fake.platform ?? "",
    configurable: true,
  });
  if (fake.userAgentData !== undefined) {
    Object.defineProperty(window.navigator, "userAgentData", {
      value: { platform: fake.userAgentData },
      configurable: true,
    });
  }
}

let root: Root | null = null;
let container: HTMLElement | null = null;
/** Every value the hook returned, in render order: an effect-driven flip shows up as two. */
let seen: string[] = [];

function Host() {
  seen.push(useShortcutLabel());
  return null;
}

beforeEach(() => {
  seen = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  Reflect.deleteProperty(window.navigator, "platform");
  Reflect.deleteProperty(window.navigator, "userAgentData");
});

function mount(): void {
  act(() => root?.render(<Host />));
}

describe("useShortcutLabel", () => {
  it("says ⌘K on a Mac", () => {
    fakePlatform({ platform: "MacIntel" });
    mount();
    expect(seen.at(-1)).toBe("⌘K");
  });

  it("says Ctrl+K off a Mac", () => {
    fakePlatform({ platform: "Win32" });
    mount();
    expect(seen.at(-1)).toBe("Ctrl+K");
  });

  it("prefers the userAgentData hint over the deprecated platform string", () => {
    // A Windows browser freezing `navigator.platform` at a Mac-looking value
    // is the case the fallback alone gets wrong.
    fakePlatform({ platform: "MacIntel", userAgentData: "Windows" });
    mount();
    expect(seen.at(-1)).toBe("Ctrl+K");
  });

  it("treats an iPad reporting MacIntel as a Mac keyboard", () => {
    fakePlatform({ platform: "iPad" });
    mount();
    expect(seen.at(-1)).toBe("⌘K");
  });

  it("settles on the first render instead of flipping afterwards", () => {
    // The failure this rules out is the useState+useEffect shape: first paint
    // shows ⌘K on a PC, then an effect rewrites it. `useSyncExternalStore` reads
    // the platform during render, so every render of this mount agrees.
    fakePlatform({ platform: "Win32" });
    mount();
    expect(seen.length).toBeGreaterThan(0);
    expect([...new Set(seen)]).toEqual(["Ctrl+K"]);
  });
});
