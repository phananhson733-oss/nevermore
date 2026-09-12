/** @vitest-environment jsdom */

/**
 * The login page is where every sign-out and every expired session converges,
 * so it is the one place that can guarantee a departing account's local
 * workbench data is gone before the next one signs in (design §6.5). The
 * component renders nothing; its whole contract is the side effect on mount.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKBENCH_SWEPT_EVENT } from "@/lib/workbench/store/persistence";
import { WorkbenchSweep } from "./_workbench-sweep.tsx";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/** Current envelope, a retired one, and a key that is not ours at all. */
const CURRENT_KEY = "gg.workbench.v1.a";
const OLDER_KEY = "gg.workbench.v0.b";
const FOREIGN_KEY = "gg.locale";

const swept = vi.fn();
let cleanup: (() => void) | null = null;

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<WorkbenchSweep />));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(CURRENT_KEY, "{}");
  window.localStorage.setItem(OLDER_KEY, "{}");
  window.localStorage.setItem(FOREIGN_KEY, "en");
  swept.mockReset();
  window.addEventListener(WORKBENCH_SWEPT_EVENT, swept);
});

afterEach(() => {
  window.removeEventListener(WORKBENCH_SWEPT_EVENT, swept);
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
});

describe("WorkbenchSweep", () => {
  it("removes every gg.workbench.* key on mount, keeps foreign keys, and announces once", () => {
    const container = mount();

    expect(window.localStorage.getItem(CURRENT_KEY)).toBeNull();
    expect(window.localStorage.getItem(OLDER_KEY)).toBeNull();
    expect(window.localStorage.getItem(FOREIGN_KEY)).toBe("en");
    expect(swept).toHaveBeenCalledTimes(1);
    expect(container.childNodes).toHaveLength(0);
  });

  it("survives a storage that throws on access", () => {
    // Private browsing / blocked storage: the sweep is best-effort and the page
    // must still render. `clearAllWorkbenchState` swallows the read, so the
    // component's own try/catch is exercised through a `localStorage` getter
    // that throws the way Safari's did.
    // jsdom may define the getter on the window itself or on its prototype;
    // restore whichever shape was there so later tests see real storage.
    const own = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(() => mount()).not.toThrow();
    } finally {
      if (own) Object.defineProperty(window, "localStorage", own);
      else delete (window as unknown as { localStorage?: Storage }).localStorage;
    }
    expect(swept).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(FOREIGN_KEY)).toBe("en");
  });
});
