/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchProjectState } from "../types.ts";
import { useWorkbench } from "./hooks.ts";
import { storageKey } from "./persistence.ts";
import { initialProjectState, type ProjectSeed } from "./reducer.ts";
import { PERSISTED_VERSION } from "./schema.ts";
import { populatedProjectState } from "./test-fixtures.ts";
import {
  WorkbenchProvider,
  type PublicWorkbenchAction,
  type WorkbenchContextValue,
} from "./WorkbenchProvider.tsx";

// Split from WorkbenchProvider.test.tsx (already past the 400-line file limit):
// the write boundary only. A newer build's write can land before its `storage`
// event reaches this tab, and in the tab that wrote it no event ever fires, so
// the provider cannot rely on the event alone to keep from overwriting it (R14).
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const PID = "00000000-0000-4000-8000-000000000042";

const fromDisk: WorkbenchProjectState = { ...initialProjectState(SEED), seeds: "from disk" };

type Holder = { current: WorkbenchContextValue | null };

function Probe({ holder }: { readonly holder: Holder }) {
  holder.current = useWorkbench();
  return null;
}

const mounted: { readonly root: Root; readonly container: HTMLElement }[] = [];

function mount(): Holder {
  const holder: Holder = { current: null };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(
      <WorkbenchProvider projectId={PID} seed={SEED}>
        <Probe holder={holder} />
      </WorkbenchProvider>,
    );
  });
  return holder;
}

function ctx(holder: Holder): WorkbenchContextValue {
  if (!holder.current) throw new Error("provider never rendered its children");
  return holder.current;
}

function send(holder: Holder, action: PublicWorkbenchAction): void {
  act(() => ctx(holder).dispatch(action));
}

function persist(state: WorkbenchProjectState): void {
  window.localStorage.setItem(storageKey(PID), JSON.stringify({ v: PERSISTED_VERSION, state }));
}

function onDisk(): string | null {
  return window.localStorage.getItem(storageKey(PID));
}

/** Bytes a newer build writes: a valid v1 envelope plus a key this build does not know. */
function newerBuildBytes(): string {
  return JSON.stringify({
    v: PERSISTED_VERSION,
    state: { ...populatedProjectState(SEED), seeds: "written by a newer build", futureField: 1 },
  });
}

describe("WorkbenchProvider write boundary (R14)", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    for (let entry = mounted.pop(); entry !== undefined; entry = mounted.pop()) {
      act(() => entry.root.unmount());
      entry.container.remove();
    }
    vi.restoreAllMocks();
  });

  it("keeps a newer build's bytes that landed before any storage event, and goes read-only", () => {
    persist(fromDisk);
    const view = mount();
    expect(ctx(view).storageMode).toBe("ok");

    // Another tab's newer build writes; its storage event has not been delivered.
    const bytes = newerBuildBytes();
    window.localStorage.setItem(storageKey(PID), bytes);
    send(view, { type: "setSeeds", seeds: "local edit" });

    expect(onDisk()).toBe(bytes);
    expect(ctx(view).storageMode).toBe("readonly");
    // The session keeps working in memory.
    expect(ctx(view).state.seeds).toBe("local edit");

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    send(view, { type: "setSeeds", seeds: "second edit" });
    send(view, { type: "setBuilt", built: true });
    expect(setItem).not.toHaveBeenCalled();
    expect(onDisk()).toBe(bytes);
  });

  it.each([
    ["unparseable JSON", "{not json"],
    ["an envelope with no state", JSON.stringify({ v: PERSISTED_VERSION })],
  ])("still overwrites corrupt bytes (%s) on the next local write, without locking", (_label, garbage) => {
    persist(fromDisk);
    const view = mount();
    window.localStorage.setItem(storageKey(PID), garbage);

    send(view, { type: "setSeeds", seeds: "local edit" });

    expect(ctx(view).storageMode).toBe("ok");
    expect(onDisk()).not.toBe(garbage);
    expect(onDisk()).toContain("local edit");
  });

  it("still overwrites data this build can read (last writer wins between compatible tabs)", () => {
    persist(fromDisk);
    const view = mount();
    persist({ ...fromDisk, seeds: "another compatible tab" });

    send(view, { type: "setSeeds", seeds: "local edit" });

    expect(ctx(view).storageMode).toBe("ok");
    expect(onDisk()).toContain("local edit");
  });

  it("goes volatile, and does not write, when the read before the write throws", () => {
    persist(fromDisk);
    const view = mount();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    send(view, { type: "setSeeds", seeds: "local edit" });

    expect(ctx(view).storageMode).toBe("volatile");
    expect(setItem).not.toHaveBeenCalled();
    expect(ctx(view).state.seeds).toBe("local edit");
  });
});
