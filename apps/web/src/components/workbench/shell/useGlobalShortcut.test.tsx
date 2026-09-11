/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalShortcut } from "./useGlobalShortcut.ts";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// One stable object: the hook re-subscribes whenever `handlers` changes identity.
const handlers = { onTogglePalette: vi.fn(), onEscape: vi.fn() };

function Host() {
  useGlobalShortcut(handlers);
  return null;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  handlers.onTogglePalette.mockReset();
  handlers.onEscape.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Host />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Returns whether the handler called `preventDefault()`. */
function pressAtWindow(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe("useGlobalShortcut", () => {
  it("toggles the palette on Cmd/Ctrl+K and closes on Escape", () => {
    expect(pressAtWindow({ key: "k", metaKey: true })).toBe(true);
    expect(pressAtWindow({ key: "K", ctrlKey: true })).toBe(true);
    expect(handlers.onTogglePalette).toHaveBeenCalledTimes(2);

    pressAtWindow({ key: "Escape" });
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });

  it("ignores keys pressed mid-IME-composition, Escape included", () => {
    // Dialog lets a composing Escape bubble on purpose (it is the IME's
    // cancel, not a close), so this layer must not turn it into one either.
    expect(pressAtWindow({ key: "Escape", isComposing: true })).toBe(false);
    expect(pressAtWindow({ key: "Escape", keyCode: 229 })).toBe(false);
    expect(pressAtWindow({ key: "k", metaKey: true, isComposing: true })).toBe(false);

    expect(handlers.onEscape).not.toHaveBeenCalled();
    expect(handlers.onTogglePalette).not.toHaveBeenCalled();
  });

  it("leaves every other key alone, a bare k included", () => {
    // Typing into any field on the page passes through this listener, so a
    // plain "k" must neither open the palette nor be swallowed.
    expect(pressAtWindow({ key: "k" })).toBe(false);
    expect(pressAtWindow({ key: "Enter" })).toBe(false);
    expect(pressAtWindow({ key: "j", metaKey: true })).toBe(false);

    expect(handlers.onTogglePalette).not.toHaveBeenCalled();
    expect(handlers.onEscape).not.toHaveBeenCalled();
  });

  it("stops listening once the host unmounts", () => {
    act(() => root?.unmount());
    root = null;

    pressAtWindow({ key: "k", metaKey: true });
    pressAtWindow({ key: "Escape" });

    expect(handlers.onTogglePalette).not.toHaveBeenCalled();
    expect(handlers.onEscape).not.toHaveBeenCalled();
  });
});
