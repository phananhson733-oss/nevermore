/** @vitest-environment jsdom */

import { act, useEffect, useRef, type ReactNode } from "react";
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

/** What is on disk right now, parsed; throws when the key is absent. */
function stored(): WorkbenchProjectState {
  const raw = window.localStorage.getItem(storageKey(PID));
  if (raw === null) throw new Error("nothing persisted");
  return (JSON.parse(raw) as { readonly state: WorkbenchProjectState }).state;
}

interface Mounted {
  readonly root: Root;
  readonly container: HTMLElement;
}

/** Roots still mounted, so `afterEach` tears down even when a test throws midway. */
const active: Mounted[] = [];

function mount(seed: ProjectSeed = SEED, extra: ReactNode = null) {
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
            {extra}
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

/**
 * What another tab's write delivers here: the key and its new value. The
 * provider re-reads storage itself; `newValue` only has to be non-null, since
 * a null one is the shape of a removal (see `crossTabRemoval`).
 */
function crossTabEvent(): void {
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: storageKey(PID),
        newValue: window.localStorage.getItem(storageKey(PID)),
        storageArea: window.localStorage,
      }),
    );
  });
}

/** What another tab's `removeItem` (`key`) or `clear()` (`key === null`) delivers here. */
function crossTabRemoval(key: string | null = storageKey(PID)): void {
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key, oldValue: "{}", newValue: null, storageArea: window.localStorage }),
    );
  });
}

/**
 * Calls `forgetProject()` from a child effect. React runs a child's passive
 * effects BEFORE the parent's in the same commit, so this lands in the commit
 * where `ready` flips true, ahead of the provider's own write effect.
 */
function ForgetOnReady() {
  const { ready, forgetProject } = useWorkbench();
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    forgetProject();
  }, [ready, forgetProject]);
  return null;
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

    // Hydration itself writes nothing (the state came from disk); the first
    // write is the first local change, and it carries the hydrated state,
    // never the SSR-shaped initial one.
    expect(setItem).not.toHaveBeenCalled();
    act(() => view.probe().dispatch({ type: "setBuilt", built: true }));
    expect(setItem).toHaveBeenCalledTimes(1);
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
    crossTabRemoval();

    expect(view.probe().state).toEqual(initialProjectState(SEED));
    // `swept`, not `volatile`: the key went away because someone signed out or
    // deleted the project, which is no reason to warn about this browser.
    expect(view.probe().storageMode).toBe("swept");
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

    expect(view.probe().storageMode).toBe("swept");
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

  it("resets and goes swept when another tab clears the whole store (key === null)", () => {
    persist(fromDisk);
    const view = mount();
    expect(view.probe().state.seeds).toBe("from disk");

    window.localStorage.removeItem(storageKey(PID));
    crossTabRemoval(null);

    expect(view.probe().storageMode).toBe("swept");
    expect(view.probe().state).toEqual(initialProjectState(SEED));
    view.unmount();
  });

  it("goes volatile without losing state when the cross-tab re-read finds storage unavailable", () => {
    persist(fromDisk);
    const view = mount();
    expect(view.probe().state.seeds).toBe("from disk");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    act(() => {
      // Write-shaped (non-null `newValue`): the provider re-reads rather than
      // trusting the payload, and that re-read is what throws here.
      window.dispatchEvent(
        new StorageEvent("storage", { key: storageKey(PID), newValue: "{}", storageArea: window.localStorage }),
      );
    });

    expect(view.probe().storageMode).toBe("volatile");
    expect(view.probe().state.seeds).toBe("from disk");
    view.unmount();
  });

  it("freezes writes as well as clearing the key when the project is deleted", () => {
    persist(fromDisk);
    const view = mount();
    expect(view.probe().state.seeds).toBe("from disk");

    act(() => view.probe().forgetProject());

    expect(view.probe().storageMode).toBe("swept");
    expect(window.localStorage.getItem(storageKey(PID))).toBeNull();

    // Without the latch, any dispatch arriving before the caller's navigation
    // completes re-creates the deleted project's key from the live state.
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    act(() => view.probe().dispatch({ type: "setSeeds", seeds: "after the delete" }));
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(storageKey(PID))).toBeNull();
    view.unmount();
  });

  it("never echoes a state that came from another tab, even when the two seeds disagree", () => {
    persist(fromDisk);
    const view = mount();

    // The other tab was opened from a stale server mirror (the project was
    // renamed since), so its copy is stamped with a different brand.
    persist({ ...fromDisk, seeds: "stamped elsewhere", profile: { ...fromDisk.profile, brand: "Renamed" } });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    crossTabEvent();

    expect(view.probe().state.seeds).toBe("stamped elsewhere");
    // This tab's seed still overlays the UI ...
    expect(view.probe().state.profile.brand).toBe(SEED.brand);
    // ... but is never written back: that echo, re-stamped on each side by
    // `withProjectSeed`, is what made two tabs overwrite each other forever.
    expect(setItem).not.toHaveBeenCalled();
    expect(stored().profile.brand).toBe("Renamed");
    view.unmount();
  });

  it("keeps the hydration rollback off disk until the first local change", () => {
    const populated = populatedProjectState(SEED);
    persist({ ...populated, visPartial: true });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const view = mount();

    expect(view.probe().state.visPartial).toBe(false);
    // Another tab may still be streaming that run; broadcasting this tab's
    // rollback as authoritative would kill it.
    expect(setItem).not.toHaveBeenCalled();
    expect(stored().visPartial).toBe(true);

    act(() => view.probe().dispatch({ type: "setSeeds", seeds: "local edit" }));

    expect(stored().visPartial).toBe(false);
    expect(stored().seeds).toBe("local edit");
    view.unmount();
  });

  it("sweeps on a removal event even after this tab's own write re-created the key", () => {
    persist(fromDisk);
    const view = mount();
    expect(view.probe().state.seeds).toBe("from disk");

    act(() => {
      // Another tab removed the key, and this tab's pending write put it back
      // before the event was delivered: a re-read would find our own bytes and
      // conclude nothing was removed.
      window.localStorage.removeItem(storageKey(PID));
      persist({ ...fromDisk, seeds: "resurrected by our own write" });
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: storageKey(PID),
          oldValue: "{}",
          newValue: null,
          storageArea: window.localStorage,
        }),
      );
    });

    expect(view.probe().storageMode).toBe("swept");
    expect(view.probe().state).toEqual(initialProjectState(SEED));
    expect(window.localStorage.getItem(storageKey(PID))).toBeNull();
    view.unmount();
  });

  it("ignores storage events from sessionStorage", () => {
    persist(fromDisk);
    const view = mount();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: storageKey(PID), newValue: null, storageArea: window.sessionStorage }),
      );
    });

    expect(view.probe().storageMode).toBe("ok");
    expect(view.probe().state.seeds).toBe("from disk");
    expect(window.localStorage.getItem(storageKey(PID))).toContain("from disk");
    view.unmount();
  });

  it("blocks a write effect already scheduled in the commit that forgets the project", () => {
    // Empty storage on purpose: the commit where `ready` flips true is exactly
    // the one whose write effect would persist the seed mirror, and the child
    // effect calls `forgetProject()` earlier in that same commit. A state
    // setter cannot reach an effect closure that is already captured; only the
    // synchronous ref gate can.
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const view = mount(SEED, <ForgetOnReady />);

    expect(view.probe().ready).toBe(true);
    expect(view.probe().storageMode).toBe("swept");
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(storageKey(PID))).toBeNull();
    view.unmount();
  });
});
