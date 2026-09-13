/** @vitest-environment jsdom */

/**
 * The loader judges a click against the render it happened in, but dispatches
 * only after a dynamic import, and the store it writes to outlives it (the
 * provider sits in `app/p/[projectId]/layout.tsx`, across views). Two things can
 * change inside that gap:
 *
 * - the project gains data the click never saw (another control, another tab):
 *   loading then would overwrite it with no confirmation, which Q11 forbids;
 * - the button unmounts (the operator moved on): the sample must not land in a
 *   project nobody asked to replace;
 * - the project changes after the operator confirmed, or while the loader's
 *   last look is already stale: the yes covered what the confirm's render
 *   showed, and the reducer refuses a load that no longer matches it.
 *
 * `LoadDemoButton.test.tsx` cannot see any of these: its context value is a fixed
 * object, so the state cannot change between the click and the dispatch. Both
 * cases here run against the real `WorkbenchProvider`, with a probe to dispatch
 * into it after the click and before the import settles.
 */

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import type { ProjectSeed } from "@/lib/workbench/store/reducer";
import { WorkbenchProvider, type WorkbenchContextValue } from "@/lib/workbench/store/WorkbenchProvider";
import type { GscRow } from "@/lib/workbench/types";
import { WB_APP_ROOT_ID, WB_ROOT_ID } from "../../ui/ids.ts";
import { LoadDemoButton } from "./LoadDemoButton.tsx";

// Wrapped, not replaced: the payload is the real one. One case uses the wrapper
// to write to the store at the one moment a write is queued but not rendered —
// between the loader's last look at the store and its dispatch.
vi.mock("@/lib/workbench/mock/demo.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workbench/mock/demo")>();
  return { ...actual, makeDemoSite: vi.fn(actual.makeDemoSite) };
});

// Warm the module the loader imports, so `settle` waits on the loader and not on
// a cold module graph. The loader's own `await import` still yields.
const demo = await import("@/lib/workbench/mock/demo.ts");
const { makeDemoSite: realMakeDemoSite } = await vi.importActual<typeof import("@/lib/workbench/mock/demo")>(
  "@/lib/workbench/mock/demo.ts",
);

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const en = getMessages("en");
const COPY = en.workbench.overview.loadDemo;
const PID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const USER_ROWS: readonly GscRow[] = [
  { query: "example geo audit", clicks: 5, impressions: 120, ctr: 0.04, position: 14.2 },
];

interface Holder {
  store: WorkbenchContextValue | null;
  setShown: ((shown: boolean) => void) | null;
}

function Probe({ holder }: { readonly holder: Holder }) {
  holder.store = useWorkbench();
  return null;
}

function Harness({ holder }: { readonly holder: Holder }) {
  const [shown, setShown] = useState(true);
  holder.setShown = setShown;
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <WorkbenchProvider projectId={PID} seed={SEED}>
        <Probe holder={holder} />
        <div id={WB_ROOT_ID}>
          <div id={WB_APP_ROOT_ID}>{shown ? <LoadDemoButton /> : null}</div>
        </div>
      </WorkbenchProvider>
    </NextIntlClientProvider>
  );
}

let cleanup: (() => void) | null = null;

interface Mounted {
  readonly store: () => WorkbenchContextValue;
  readonly hide: () => void;
  readonly button: () => HTMLButtonElement | null;
}

function mount(): Mounted {
  const holder: Holder = { store: null, setShown: null };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Harness holder={holder} />));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return {
    store: () => {
      if (holder.store === null) throw new Error("provider never rendered");
      return holder.store;
    },
    hide: () => holder.setShown?.(false),
    button: () => container.querySelector<HTMLButtonElement>(`#${WB_APP_ROOT_ID} button`),
  };
}

function requireButton(view: Mounted): HTMLButtonElement {
  const found = view.button();
  if (!found) throw new Error("no load button");
  return found;
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function dialogButton(label: string): HTMLButtonElement {
  const found = [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
  if (!found) throw new Error(`no dialog button ${label}`);
  return found;
}

/** Lets the loader's dynamic import and everything after it settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(demo.makeDemoSite).mockClear();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
});

describe("LoadDemoButton: the state moves between the click and the dispatch", () => {
  it("asks instead of overwriting rows that arrived after the click, and loads once confirmed", async () => {
    const view = mount();
    expect(view.store().ready).toBe(true);
    expect(view.store().state.demo).toBe(false);

    act(() => {
      // The click sees a blank project and starts loading without asking…
      requireButton(view).click();
      // …and before the import settles, the operator's own rows land.
      view.store().dispatch({ type: "setGscRows", rows: USER_ROWS, source: "user" });
    });
    await settle();

    expect(view.store().state.demo).toBe(false);
    expect(view.store().state.gscRows).toEqual(USER_ROWS);
    expect(view.store().state.gscRowsSource).toBe("user");
    expect(dialog()?.textContent).toContain(COPY.confirmBody);
    expect(requireButton(view).disabled).toBe(false);

    // Confirming is the answer: the load goes through without asking again.
    act(() => dialogButton(COPY.confirmOk).click());
    await settle();

    expect(dialog()).toBeNull();
    expect(view.store().state.demo).toBe(true);
    expect(view.store().state.gscRowsSource).toBe("sample");
  });

  it("abandons the load when the button unmounts before the import settles", async () => {
    // React 19 no longer warns about a state update on an unmounted component,
    // so this spy cannot see a stray setState; it catches act() warnings and
    // anything the abandoned continuation throws into React. The store is the
    // load-bearing assertion.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = mount();

    act(() => {
      requireButton(view).click();
      view.hide();
    });
    expect(view.button()).toBeNull();
    await settle();

    expect(view.store().state.demo).toBe(false);
    expect(view.store().state.gscRows).toEqual([]);
    expect(dialog()).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("LoadDemoButton: a confirmation covers the content it was given for", () => {
  it("does not spend a confirmation on rows that arrive after it, and asks again", async () => {
    const view = mount();
    act(() => view.store().dispatch({ type: "setSeeds", seeds: "geo audit" }));
    act(() => requireButton(view).click());
    expect(dialog()?.textContent).toContain(COPY.confirmBody);

    // Confirmed over the seeds alone…
    act(() => dialogButton(COPY.confirmOk).click());
    expect(dialog()).toBeNull();
    // …and the operator's own rows land, and render, before the import settles.
    act(() => view.store().dispatch({ type: "setGscRows", rows: USER_ROWS, source: "user" }));
    await settle();

    expect(view.store().state.demo).toBe(false);
    expect(view.store().state.gscRows).toEqual(USER_ROWS);
    expect(view.store().state.gscRowsSource).toBe("user");
    expect(view.store().state.seeds).toBe("geo audit");
    expect(dialog()?.textContent).toContain(COPY.confirmBody);
    expect(requireButton(view).disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("refuses to load over rows queued behind the render it last read, and asks instead", async () => {
    const view = mount();
    vi.mocked(demo.makeDemoSite).mockImplementationOnce((...args) => {
      // Between the loader's last look at the store and its dispatch: this
      // update is queued, not rendered, so nothing in the component can see it.
      view.store().dispatch({ type: "setGscRows", rows: USER_ROWS, source: "user" });
      return realMakeDemoSite(...args);
    });

    act(() => requireButton(view).click());
    await settle();

    expect(demo.makeDemoSite).toHaveBeenCalledTimes(1);
    expect(view.store().state.demo).toBe(false);
    expect(view.store().state.gscRows).toEqual(USER_ROWS);
    expect(view.store().state.gscRowsSource).toBe("user");
    expect(dialog()?.textContent).toContain(COPY.confirmBody);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("loads without asking again when what the confirmation covered is gone before the import settles", async () => {
    const view = mount();
    act(() => view.store().dispatch({ type: "setSeeds", seeds: "geo audit" }));
    act(() => requireButton(view).click());
    act(() => dialogButton(COPY.confirmOk).click());
    // Nothing is left to overwrite: the same judgement as a click on a blank project.
    act(() => view.store().dispatch({ type: "setSeeds", seeds: "" }));
    await settle();

    expect(view.store().state.demo).toBe(true);
    expect(view.store().state.gscRowsSource).toBe("sample");
    expect(dialog()).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("closes the confirmation once nothing is left to overwrite, and returns focus to the button", () => {
    const view = mount();
    act(() => view.store().dispatch({ type: "setSeeds", seeds: "geo audit" }));
    act(() => requireButton(view).click());
    expect(dialog()).not.toBeNull();

    act(() => view.store().dispatch({ type: "setSeeds", seeds: "" }));

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(requireButton(view));
    expect(view.store().state.demo).toBe(false);
  });
});
