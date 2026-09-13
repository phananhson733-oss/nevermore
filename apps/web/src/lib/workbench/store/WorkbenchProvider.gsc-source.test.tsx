/** @vitest-environment jsdom */

/**
 * The provider loads persisted state through two doors (Q6, 裁决 A): first
 * hydration, and a cross-tab `storage` event. Only the first settles
 * interrupted runs — the second must not, or it would roll another tab's
 * in-flight visibility run back to `lastVis`. A GSC mark with no rows under it
 * can arrive through either one (an older build writing the same key in another
 * tab is exactly the case the normalisation exists for), so both are driven here
 * against the real provider rather than by calling a normaliser directly: a test
 * of the function would pass while a door skipped it.
 *
 * Split from WorkbenchProvider.test.tsx, which is already past 600 lines.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { profileDocMarkdown } from "../mock/builders/profile.ts";
import type { ProfileDoc, WorkbenchProjectState } from "../types.ts";
import { useWorkbench } from "./hooks.ts";
import { storageKey } from "./persistence.ts";
import { initialProjectState, type ProjectSeed } from "./reducer.ts";
import { PERSISTED_VERSION } from "./schema.ts";
import { populatedProjectState } from "./test-fixtures.ts";
import { WorkbenchProvider, type WorkbenchContextValue } from "./WorkbenchProvider.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const PID = "00000000-0000-4000-8000-000000000042";

type Holder = { current: WorkbenchContextValue | null };

function Probe({ holder }: { readonly holder: Holder }) {
  holder.current = useWorkbench();
  return null;
}

const mounted: { readonly root: Root; readonly container: HTMLElement }[] = [];

function mount(): () => WorkbenchContextValue {
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
  return () => {
    if (!holder.current) throw new Error("provider never rendered its children");
    return holder.current;
  };
}

function bytes(state: WorkbenchProjectState): string {
  return JSON.stringify({ v: PERSISTED_VERSION, state });
}

/** Another tab's write, as it lands here: on disk, then announced by the event. */
function crossTabWrite(state: WorkbenchProjectState): void {
  const value = bytes(state);
  window.localStorage.setItem(storageKey(PID), value);
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key: storageKey(PID), newValue: value, storageArea: window.localStorage }),
    );
  });
}

/** A mark with no rows under it, next to a field that proves the envelope was actually loaded. */
function staleMark(seeds: string): WorkbenchProjectState {
  return { ...initialProjectState(SEED), seeds, gscRows: [], gscRowsSource: "sample" };
}

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  window.localStorage.clear();
});

describe("a GSC mark with no rows cannot come in through either door (Q6)", () => {
  it("first hydration drops it", () => {
    window.localStorage.setItem(storageKey(PID), bytes(staleMark("from disk")));
    const probe = mount();
    expect(probe().ready).toBe(true);
    expect(probe().state.seeds).toBe("from disk");
    expect(probe().state.gscRowsSource).toBeNull();
  });

  it("a cross-tab write drops it too", () => {
    const probe = mount();
    expect(probe().state.seeds).toBe("");
    crossTabWrite(staleMark("from another tab"));
    // Loaded, not ignored: the rest of the envelope arrived.
    expect(probe().state.seeds).toBe("from another tab");
    expect(probe().state.gscRowsSource).toBeNull();
  });

  it("a cross-tab write followed by a local edit does not write the mark back to disk", () => {
    // The worse half of the second door: loaded un-normalised, the mark survives
    // actions that do not touch the rows, and this tab's next write persists it.
    const probe = mount();
    crossTabWrite(staleMark("from another tab"));
    act(() => probe().dispatch({ type: "setSeeds", seeds: "edited here" }));
    const raw = window.localStorage.getItem(storageKey(PID));
    if (raw === null) throw new Error("nothing persisted");
    const onDisk = (JSON.parse(raw) as { readonly state: WorkbenchProjectState }).state;
    // Proves this tab did write after the cross-tab load.
    expect(onDisk.seeds).toBe("edited here");
    expect(onDisk.gscRowsSource).toBeNull();
  });

  it("a cross-tab write still does not settle the other tab's in-flight run", () => {
    // The reason the two doors differ at all. If the source fix were done by
    // routing the storage event through `normalizeInterrupted`, this is what
    // would break.
    const probe = mount();
    const results = [{ p: "q", platform: "ChatGPT", hit: true, rank: 1, brands: [], domains: [], real: false }] as const;
    crossTabWrite({ ...staleMark("mid-run"), visPartial: true, visResults: results });
    expect(probe().state.visPartial).toBe(true);
    expect(probe().state.visResults).toEqual(results);
    expect(probe().state.gscRowsSource).toBeNull();
  });
});

/**
 * The other direction (裁决 C): rows whose source is `null`. Only a tampered
 * envelope makes them, and nothing is enforced here on purpose — the rows cannot
 * say whether they are the sample or the user's, `state.demo` is not an answer
 * (it is `true` in this fixture and must not turn into "sample"), and deleting
 * the user's rows to keep the pair tidy would be worse than the lie it prevents.
 * What is enforced is at the reader: unknown provenance is said as unknown.
 */
describe("rows with an unknown source stay unknown through either door, and read as unknown (Q6)", () => {
  function unknownSource(seeds: string): WorkbenchProjectState {
    const base = populatedProjectState(SEED);
    const doc = base.profileDoc;
    if (doc === null || doc.gsc === null) throw new Error("fixture must carry a GSC snapshot");
    const snapshot: ProfileDoc = { ...doc, gscSource: null };
    return { ...base, seeds, gscRowsSource: null, profileDoc: snapshot };
  }

  function assertUnknown(state: WorkbenchProjectState, door: string): void {
    expect(state.gscRows.length, door).toBe(1);
    expect(state.gscRowsSource, door).toBeNull();
    expect(state.demo, door).toBe(true);
    const doc = state.profileDoc;
    if (doc === null) throw new Error(`${door}: the snapshot must have survived`);
    const markdown = profileDocMarkdown({ profile: state.profile, doc });
    expect(markdown, door).toContain("## 搜索表现（来源未知）");
    expect(markdown, door).not.toContain("## 搜索表现（示例数据）");
    expect(markdown.split("\n"), door).not.toContain("## 搜索表现");
  }

  it("first hydration neither invents a source nor drops the rows", () => {
    window.localStorage.setItem(storageKey(PID), bytes(unknownSource("from disk")));
    const probe = mount();
    expect(probe().state.seeds).toBe("from disk");
    assertUnknown(probe().state, "hydration");
  });

  it("a cross-tab write neither invents a source nor drops the rows", () => {
    const probe = mount();
    crossTabWrite(unknownSource("from another tab"));
    expect(probe().state.seeds).toBe("from another tab");
    assertUnknown(probe().state, "cross-tab");
  });
});
