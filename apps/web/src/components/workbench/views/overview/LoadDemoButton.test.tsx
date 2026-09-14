/** @vitest-environment jsdom */

/**
 * "Load sample site" replaces seventeen fields of the project in one dispatch,
 * so the two ways it can go wrong are both about when that dispatch happens:
 * asking for confirmation on a project that holds nothing (Q11 — the check is
 * by value, and a hydrated blank project must not prompt), and dispatching
 * twice for one intent (a double click, a double confirm). Both are counted by a
 * spy in front of a real reducer: the reducer alone would make a second load
 * invisible, and a spy alone changes nothing — the loader reads the store back
 * to learn whether its dispatch landed, and would take every load as refused.
 *
 * `mock/demo.ts` is wrapped, not replaced: the payload is the real one, and the
 * wrapper only lets one case make the sample builder throw.
 */

import { act, useMemo, useReducer, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_LEVEL, DEMO_SEEDS } from "@/lib/workbench/mock/demo-constants";
import { initialProjectState, reduce, type ProjectSeed } from "@/lib/workbench/store/reducer";
import {
  WorkbenchContext,
  type PublicWorkbenchAction,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import type { WorkbenchProjectState } from "@/lib/workbench/types";

vi.mock("@/lib/workbench/mock/demo.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workbench/mock/demo")>();
  return { ...actual, makeDemoSite: vi.fn(actual.makeDemoSite) };
});

const demo = await import("@/lib/workbench/mock/demo.ts");
const { LoadDemoButton } = await import("./LoadDemoButton.tsx");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const en = getMessages("en");
const COPY = en.workbench.overview.loadDemo;
const PID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };

/** The context a view sees: each dispatch is recorded by `spy`, then applied by the real reducer. */
function Host({
  initial,
  spy,
  children,
}: {
  readonly initial: WorkbenchProjectState;
  readonly spy: (action: PublicWorkbenchAction) => void;
  readonly children: ReactNode;
}) {
  const [state, apply] = useReducer(reduce, initial);
  const value = useMemo<WorkbenchContextValue>(
    () => ({
      projectId: PID,
      state,
      dispatch: (action) => {
        spy(action);
        apply(action);
      },
      ready: true,
      storageMode: "ok",
      keywordRows: [],
      keywordRowCount: null,
      forgetProject: () => {},
    }),
    [state, spy],
  );
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

let cleanup: (() => void) | null = null;

interface Rendered {
  readonly scope: HTMLElement;
  readonly dispatch: ReturnType<typeof vi.fn<(action: PublicWorkbenchAction) => void>>;
  readonly button: () => HTMLButtonElement;
}

function render(state: WorkbenchProjectState): Rendered {
  const dispatch = vi.fn<(action: PublicWorkbenchAction) => void>();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <Host initial={state} spy={dispatch}>
          <div id="wb-app">
            <LoadDemoButton />
          </div>
        </Host>
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return {
    scope: container,
    dispatch,
    button: () => {
      const found = container.querySelector("button");
      if (!found) throw new Error("no button");
      return found;
    },
  };
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function dialogButton(label: string): HTMLButtonElement {
  const found = [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
  if (!found) throw new Error(`no dialog button ${label}`);
  return found;
}

/** Lets the dynamic import and everything after it settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

beforeEach(() => {
  vi.mocked(demo.makeDemoSite).mockClear();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("LoadDemoButton: nothing to overwrite (Q11)", () => {
  it.each([
    ["a fresh initial state", () => initialProjectState(SEED)],
    // Hydration hands over objects JSON.parse made: new arrays, new objects.
    ["a hydrated blank project", () => JSON.parse(JSON.stringify(initialProjectState(SEED))) as WorkbenchProjectState],
    ["another initial state", () => initialProjectState({ ...SEED })],
  ])("loads without asking on %s", async (_label, make) => {
    const state = make();
    const view = render(state);

    act(() => view.button().click());
    expect(dialog()).toBeNull();
    await settle();

    expect(view.dispatch).toHaveBeenCalledTimes(1);
    const action = view.dispatch.mock.calls[0]?.[0];
    expect(action?.type).toBe("loadDemo");
    expect(action?.type === "loadDemo" ? action.payload.gscRows.length : 0).toBeGreaterThan(0);
    expect(demo.makeDemoSite).toHaveBeenCalledWith(
      state.profile,
      DEMO_LEVEL,
      [...DEMO_SEEDS],
      expect.objectContaining({ now: expect.any(Date), provenanceLine: expect.any(Function) }),
    );
  });
});

describe("LoadDemoButton: something to overwrite", () => {
  const touched = (): WorkbenchProjectState => ({ ...initialProjectState(SEED), seeds: "geo audit" });

  it("asks first, names what is overwritten, and dispatches nothing until confirmed", async () => {
    const view = render(touched());

    act(() => view.button().click());
    expect(dialog()?.textContent).toContain(COPY.confirmTitle);
    expect(dialog()?.textContent).toContain(COPY.confirmBody);
    await settle();
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(demo.makeDemoSite).not.toHaveBeenCalled();
  });

  it("cancels without loading and closes the box", async () => {
    const view = render(touched());

    act(() => view.button().click());
    act(() => dialogButton(COPY.cancel).click());
    await settle();

    expect(dialog()).toBeNull();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("closes the box on confirm and loads exactly once, even when confirm is hit twice", async () => {
    const view = render(touched());

    act(() => view.button().click());
    const ok = dialogButton(COPY.confirmOk);
    act(() => {
      ok.click();
      ok.click();
    });
    await settle();

    expect(dialog()).toBeNull();
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(demo.makeDemoSite).toHaveBeenCalledTimes(1);
  });
});

describe("LoadDemoButton: one load per intent", () => {
  it("dispatches once for a double click, and shows it is busy meanwhile", async () => {
    const view = render(initialProjectState(SEED));

    act(() => {
      view.button().click();
      view.button().click();
    });
    expect(view.button().disabled).toBe(true);
    expect(view.button().textContent).toBe(COPY.busy);
    await settle();

    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(demo.makeDemoSite).toHaveBeenCalledTimes(1);
    expect(view.button().disabled).toBe(false);
    expect(view.button().textContent).toBe(COPY.button);
  });

  it("says a failed load did not go through, and lets the operator try again", async () => {
    vi.mocked(demo.makeDemoSite).mockImplementationOnce(() => {
      throw new Error("sample builder failed");
    });
    const view = render(initialProjectState(SEED));
    expect(view.scope.querySelector('[role="alert"]')).toBeNull();

    act(() => view.button().click());
    await settle();

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.scope.querySelector('[role="alert"]')?.textContent).toBe(COPY.failed);
    expect(view.button().disabled).toBe(false);

    act(() => view.button().click());
    await settle();
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(view.scope.querySelector('[role="alert"]')).toBeNull();
  });

  it("carries no inline style, open or closed", () => {
    const view = render({ ...initialProjectState(SEED), seeds: "x" });
    expect(view.scope.querySelectorAll("[style]")).toHaveLength(0);
    act(() => view.button().click());
    expect(document.body.querySelectorAll("[style]")).toHaveLength(0);
  });
});
