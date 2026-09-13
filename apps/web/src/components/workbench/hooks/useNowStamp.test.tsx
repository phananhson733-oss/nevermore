/** @vitest-environment jsdom */

/**
 * The whole contract is *when* the clock is read (Q22), and that is unreachable
 * from the settled DOM: a lazy `useState` initialiser produces the same final
 * markup as an effect. So these tests record what the hook returned on each
 * render pass, and render the same component on the server, where a clock read
 * during render would show up as a time in the HTML.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatLocalStamp } from "@/lib/workbench/mock/time";
import { initialProjectState } from "@/lib/workbench/store/reducer";
import {
  WorkbenchContext,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import { useNowStamp, type NowStamp } from "./useNowStamp.ts";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SEED = { url: "https://example.test", brand: "Example", market: "US" };
const AT = new Date(2026, 8, 13, 10, 30, 45);

function context(ready: boolean): WorkbenchContextValue {
  return {
    projectId: "00000000-0000-4000-8000-000000000042",
    state: initialProjectState(SEED),
    dispatch: () => {},
    ready,
    storageMode: "ok",
    keywordRows: [],
    keywordRowCount: null,
    forgetProject: () => {},
  };
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
});

interface Mounted {
  /** What the hook returned on each render pass, oldest first. */
  readonly seen: readonly (NowStamp | null)[];
  readonly rerender: (ready: boolean) => void;
}

function mount(ready: boolean): Mounted {
  const seen: (NowStamp | null)[] = [];
  function Probe() {
    seen.push(useNowStamp());
    return null;
  }
  const tree = (value: boolean) => (
    <WorkbenchContext.Provider value={context(value)}>
      <Probe />
    </WorkbenchContext.Provider>
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(tree(ready)));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { seen, rerender: (value) => act(() => root.render(tree(value))) };
}

describe("useNowStamp", () => {
  it("returns null while the project is not hydrated, however many times it renders", () => {
    const { seen, rerender } = mount(false);
    rerender(false);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((value) => value === null)).toBe(true);
  });

  it("returns null on the first render pass and the clock only after the effect ran", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AT);
    const { seen } = mount(true);
    // A lazy `useState(() => new Date())` initialiser would have filled this in.
    expect(seen[0]).toBeNull();
    expect(seen.at(-1)).not.toBeNull();
    expect(seen.at(-1)?.stamp).toBe("2026-09-13 10:30");
  });

  it("reads one clock for both fields", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AT);
    const value = mount(true).seen.at(-1);
    if (!value) throw new Error("the hook must have a reading once ready");
    expect(value.now.getTime()).toBe(AT.getTime());
    expect(value.stamp).toBe(formatLocalStamp(value.now));
  });

  it("keeps the first reading across later renders", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AT);
    const mounted = mount(true);
    const first = mounted.seen.at(-1);
    vi.setSystemTime(new Date(2026, 8, 13, 16, 0, 0));
    mounted.rerender(true);
    expect(mounted.seen.at(-1)).toBe(first);
    expect(mounted.seen.at(-1)?.stamp).toBe("2026-09-13 10:30");
  });

  it("renders no time on the server, where effects never run", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AT);
    function Probe() {
      const value = useNowStamp();
      return <span>{value === null ? "skeleton" : value.stamp}</span>;
    }
    const html = renderToString(
      <WorkbenchContext.Provider value={context(true)}>
        <Probe />
      </WorkbenchContext.Provider>,
    );
    expect(html).toContain("skeleton");
    expect(html).not.toContain("2026-09-13");
  });
});
