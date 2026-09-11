/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisResult, WorkbenchProjectState } from "../types.ts";
import { useWorkbench } from "./hooks.ts";
import { storageKey, WORKBENCH_SWEPT_EVENT } from "./persistence.ts";
import { initialProjectState, type ProjectSeed } from "./reducer.ts";
import { PERSISTED_VERSION } from "./schema.ts";
import { populatedProjectState } from "./test-fixtures.ts";
import { WorkbenchProvider, type WorkbenchContextValue } from "./WorkbenchProvider.tsx";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const PID = "00000000-0000-4000-8000-000000000042";

type Holder = { current: WorkbenchContextValue | null };

function Probe({ holder }: { readonly holder: Holder }) {
  holder.current = useWorkbench();
  return null;
}

function persist(state: WorkbenchProjectState): void {
  window.localStorage.setItem(storageKey(PID), JSON.stringify({ v: PERSISTED_VERSION, state }));
}

interface Mounted {
  readonly root: Root;
  readonly container: HTMLElement;
}

/** Roots still mounted, so `afterEach` tears down even when a test throws midway. */
const active: Mounted[] = [];

function mount(seed: ProjectSeed = SEED) {
  const holder: Holder = { current: null };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const entry: Mounted = { root, container };
  active.push(entry);
  const view = {
    /** Renders into the SAME root, which is how the remount guard gets exercised. */
    render(projectId: string): void {
      act(() => {
        root.render(
          <WorkbenchProvider projectId={projectId} seed={seed}>
            <Probe holder={holder} />
          </WorkbenchProvider>,
        );
      });
    },
    probe(): WorkbenchContextValue {
      if (!holder.current) throw new Error("provider never rendered its children");
      return holder.current;
    },
    unmount(): void {
      const at = active.indexOf(entry);
      if (at >= 0) active.splice(at, 1);
      act(() => root.unmount());
      container.remove();
    },
  };
  view.render(PID);
  return view;
}

/** Fires the cross-tab notification; the provider re-reads storage itself. */
function crossTabEvent(): void {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey(PID) }));
  });
}

const fromDisk: WorkbenchProjectState = {
  ...initialProjectState(SEED),
  seeds: "from disk",
  profile: { url: "https://stale.test", brand: "Stale", market: "DE", positioning: "kept", features: "", competitors: "" },
};

describe("WorkbenchProvider", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    for (let entry = active.pop(); entry !== undefined; entry = active.pop()) {
      try {
        act(() => entry.root.unmount());
      } catch {
        // A test that deliberately made the provider throw leaves React unable
        // to unmount cleanly; the container still has to leave the document.
      }
      entry.container.remove();
    }
    vi.restoreAllMocks();
  });

  it("hydrates from storage and re-applies the project seed", () => {
    persist(fromDisk);
    const view = mount();

    expect(view.probe().ready).toBe(true);
    expect(view.probe().state.seeds).toBe("from disk");
    expect(view.probe().state.profile.positioning).toBe("kept");
    expect(view.probe().state.profile).toMatchObject({ url: SEED.url, brand: SEED.brand, market: SEED.market });
    view.unmount();
  });

  it("never writes the pre-hydration state back over the persisted one", () => {
    persist(fromDisk);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const view = mount();

    expect(setItem).toHaveBeenCalled();
    for (const [, value] of setItem.mock.calls) expect(String(value)).toContain("from disk");
    view.unmount();
  });

  it("writes after a dispatch", () => {
    const view = mount();
    act(() => view.probe().dispatch({ type: "setSeeds", seeds: "typed by hand" }));

    expect(window.localStorage.getItem(storageKey(PID))).toContain("typed by hand");
    view.unmount();
  });

  it("latches to quota and stops writing after the first QuotaExceededError", () => {
    const view = mount();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    act(() => view.probe().dispatch({ type: "setSeeds", seeds: "one" }));
    expect(view.probe().storageMode).toBe("quota");
    const callsAtLatch = setItem.mock.calls.length;

    act(() => view.probe().dispatch({ type: "setSeeds", seeds: "two" }));
    act(() => view.probe().dispatch({ type: "setBuilt", built: true }));
    expect(setItem.mock.calls.length).toBe(callsAtLatch);
    expect(view.probe().state.seeds).toBe("two");
    view.unmount();
  });

  it("goes volatile, and still ready, when storage access throws", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      get() { throw new Error("denied"); },
      configurable: true,
    });
    try {
      const view = mount();
      expect(view.probe().storageMode).toBe("volatile");
      expect(view.probe().ready).toBe(true);
      view.unmount();
    } finally {
      // jsdom defines `localStorage` on `window` itself, but do not assume it:
      // without a descriptor to put back, the throwing stub has to be deleted
      // or every later test in the file would see storage as unavailable.
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
      else Reflect.deleteProperty(window, "localStorage");
    }
  });

  it("reloads when another tab writes the key", () => {
    persist(fromDisk);
    const view = mount();

    persist({ ...fromDisk, seeds: "from the other tab" });
    crossTabEvent();

    expect(view.probe().state.seeds).toBe("from the other tab");
    view.unmount();
  });

  it("resets and stops writing when another tab removes the key", () => {
    persist(fromDisk);
    const view = mount();
    expect(view.probe().state.seeds).toBe("from disk");

    window.localStorage.removeItem(storageKey(PID));
    crossTabEvent();

    expect(view.probe().state).toEqual(initialProjectState(SEED));
    expect(view.probe().storageMode).toBe("volatile");
    // The reset must not re-create the key the sign-out sweep just removed.
    expect(window.localStorage.getItem(storageKey(PID))).toBeNull();
    view.unmount();
  });

  it("mirrors another tab's in-flight run instead of rolling it back", () => {
    const view = mount();
    const populated = populatedProjectState(SEED);
    const partial: VisResult = {
      p: "partial probe", platform: "Perplexity", hit: false, rank: null,
      brands: [], domains: [], real: false,
    };
    // Written after mount so hydration cannot normalise it away first.
    persist({ ...populated, visPartial: true, visResults: [partial] });
    crossTabEvent();

    // The same bytes are rolled back to `lastVis` on hydrate (test below); on
    // the cross-tab path they must survive, or this tab would echo the rollback
    // to disk and kill the other tab's running probe set.
    expect(view.probe().state.visPartial).toBe(true);
    expect(view.probe().state.visResults).toEqual([partial]);
    expect(populated.lastVis?.results).not.toEqual([partial]);
    view.unmount();
  });

  it("forgets and freezes when this tab itself sweeps storage", () => {
    persist(fromDisk);
    const view = mount();
    expect(view.probe().state.seeds).toBe("from disk");

    // What `SignOutButton` does: wipe, then announce (no `storage` event fires
    // in the document that made the change).
    window.localStorage.clear();
    act(() => window.dispatchEvent(new Event(WORKBENCH_SWEPT_EVENT)));

    expect(view.probe().storageMode).toBe("volatile");
    expect(view.probe().state).toEqual(initialProjectState(SEED));

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    act(() => view.probe().dispatch({ type: "setSeeds", seeds: "after the sweep" }));
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(storageKey(PID))).toBeNull();
    view.unmount();
  });

  it("throws rather than switching projects in place", () => {
    const view = mount();
    // React logs uncaught render errors itself; the throw is the assertion.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => view.render("other")).toThrow(/must be remounted/);
    } finally {
      logged.mockRestore();
    }
  });

  it("normalises an interrupted visibility run on hydrate", () => {
    const populated = populatedProjectState(SEED);
    const partial: VisResult = {
      p: "partial probe", platform: "Perplexity", hit: false, rank: null,
      brands: [], domains: [], real: false,
    };
    persist({ ...populated, visPartial: true, visResults: [partial] });
    const view = mount();

    expect(view.probe().state.visResults).toEqual(populated.lastVis?.results);
    expect(view.probe().state.visPartial).toBe(false);
    view.unmount();
  });
});
