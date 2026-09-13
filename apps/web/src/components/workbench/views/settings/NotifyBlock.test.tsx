/** @vitest-environment jsdom */

/**
 * The notification preferences block (T11 Step 2), driven through the real
 * `WorkbenchProvider` so a flip goes through the real reducer.
 *
 * - A flip writes its own switch only (codex S11 #2): each flip dispatches
 *   exactly one `{ type: "setNotify", key, value }`, read off a context that
 *   passes the real dispatch through, and the reducer merges it into the notify
 *   it holds then. The start state below is not the default, so a write that
 *   fell back to `DEFAULT_NOTIFY` fails.
 * - Two flips before a commit (codex S11r2 F1). `Toggle` is wrapped to record
 *   the public `onChange` each switch received; two handlers from one render,
 *   called one after the other inside one synchronous `act`, both run before
 *   React commits the first write. That is where a write built from the
 *   rendered notify, or from a ref written during render, loses the first
 *   flip. A second case calls a recorded handler after the first flip has
 *   committed. Nothing here reads React's private props.
 * - The sentence saying nothing is sent is a promise about the product; it is
 *   pinned on its load-bearing clause in both locales, not only on "equals the
 *   catalogue", so a catalogue edit that drops the clause fails here too.
 * - Before storage is read there are no switches at all: the in-memory value is
 *   the seed, and a row of switches drawn from it would state preferences the
 *   operator may not have.
 * - The block carries no sample marker (codex S11 #1): the switches read and
 *   write the operator's own local preferences, so "Sample data" would be false
 *   after a flip, and the note already says nothing is sent.
 */

import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { initialProjectState } from "@/lib/workbench/store/reducer";
import {
  WorkbenchContext,
  type PublicWorkbenchAction,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import {
  DS_MESSAGES,
  DS_PROJECT_ID,
  DS_SEED,
  mountPlain,
  mountWithStore,
  settle,
  type DsLocale,
  type MountedStore,
} from "../data-sources/data-sources-test-harness.tsx";
import { NotifyBlock } from "./NotifyBlock.tsx";

interface RecordedToggle {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
}

/** Every `Toggle` render, in order, with the props the block handed it. */
const toggleLog = vi.hoisted(() => ({
  renders: [] as readonly RecordedToggle[],
}));

vi.mock("../../ui/Toggle.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/Toggle.tsx")>();
  const { createElement } = await import("react");
  type ToggleProps = Parameters<typeof actual.Toggle>[0];
  return {
    ...actual,
    // Records, then renders the real switch: labels, descriptions and the
    // native checked state below are still the real component's.
    Toggle: (props: ToggleProps) => {
      toggleLog.renders = [
        ...toggleLog.renders,
        { label: props.label, checked: props.checked, onChange: props.onChange },
      ];
      return createElement(actual.Toggle, props);
    },
  };
});

const NOTIFY = DS_MESSAGES.en.workbench.settings.notify;
const SHELL = DS_MESSAGES.en.workbench.shell;

const LABELS = [
  "Weekly report",
  "Health score or mention rate drops",
  "Brand appears in an AI answer for the first time",
  "GSC import fails",
] as const;

/** Not `DEFAULT_NOTIFY` ({ weekly: true, drop: true, mention: false, gsc: true }). */
const START = { weekly: false, drop: true, mention: true, gsc: false } as const;

/** What the block dispatched. Setup writes go straight to the store and are not here. */
let dispatched: readonly PublicWorkbenchAction[] = [];

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  dispatched = [];
  toggleLog.renders = [];
  localStorage.clear();
});

/** Hands the block the real store with a dispatch that records, then forwards. */
function RecordDispatches({ children }: { readonly children: ReactNode }) {
  const real = useWorkbench();
  const recording: WorkbenchContextValue = {
    ...real,
    dispatch: (action) => {
      dispatched = [...dispatched, action];
      real.dispatch(action);
    },
  };
  return (
    <WorkbenchContext.Provider value={recording}>
      {children}
    </WorkbenchContext.Provider>
  );
}

async function renderBlock(locale: DsLocale = "en"): Promise<MountedStore> {
  const view = mountWithStore(
    <RecordDispatches>
      <NotifyBlock />
    </RecordDispatches>,
    locale,
  );
  cleanup = view.unmount;
  await settle();
  for (const [key, value] of Object.entries(START) as [
    keyof typeof START,
    boolean,
  ][]) {
    view.dispatch({ type: "setNotify", key, value });
  }
  return view;
}

function block(scope: ParentNode): HTMLElement {
  const found = scope.querySelector<HTMLElement>("[data-wb-notify]");
  if (found === null) throw new Error("no notify block");
  return found;
}

function switches(scope: ParentNode): readonly HTMLInputElement[] {
  return [
    ...block(scope).querySelectorAll<HTMLInputElement>('input[role="switch"]'),
  ];
}

/** The label the platform associates with the input (`for` = its id), not a sibling lookup. */
function labelOf(input: HTMLInputElement): string | null {
  const labels = input.labels ?? [];
  return labels.length === 1 ? (labels[0]?.textContent ?? null) : null;
}

/**
 * The four switches as the last render handed them out. `NotifyToggles`
 * renders all four in one pass, so the last four records are one render's; the
 * callers take this before any flip, so nothing re-renders in between.
 */
function lastRenderPass(): {
  readonly weekly: RecordedToggle;
  readonly gsc: RecordedToggle;
} {
  const pass = toggleLog.renders.slice(-4);
  expect(pass.map((entry) => entry.label)).toEqual([...LABELS]);
  expect(pass.map((entry) => entry.checked)).toEqual([false, true, true, false]);
  const [weekly, , , gsc] = pass;
  if (weekly === undefined || gsc === undefined) {
    throw new Error("fewer than four switches rendered");
  }
  return { weekly, gsc };
}

const ALL_ON = { weekly: true, drop: true, mention: true, gsc: true } as const;

describe("NotifyBlock: once the store is read", () => {
  it("renders the four preferences in order with their stored values", async () => {
    const view = await renderBlock();
    const found = switches(view.app);
    expect(found).toHaveLength(4);
    expect(found.map(labelOf)).toEqual([...LABELS]);
    expect(found.map((input) => input.checked)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(found.map((input) => input.disabled)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const descriptions = found.map(
      (input) =>
        document.getElementById(input.getAttribute("aria-describedby") ?? "")
          ?.textContent,
    );
    expect(descriptions).toEqual([
      NOTIFY.weekly.description,
      NOTIFY.drop.description,
      NOTIFY.mention.description,
      NOTIFY.gsc.description,
    ]);
  });

  it("a flip changes its own switch, with exactly one setNotify for that key", async () => {
    const view = await renderBlock();
    expect(dispatched).toEqual([]);
    const mention = switches(view.app)[2];
    expect(mention?.checked).toBe(true);
    act(() => mention?.click());
    expect(view.store().state.notify).toEqual({
      weekly: false,
      drop: true,
      mention: false,
      gsc: false,
    });
    expect(switches(view.app).map((input) => input.checked)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(dispatched).toEqual([
      { type: "setNotify", key: "mention", value: false },
    ]);

    act(() => switches(view.app)[0]?.click());
    expect(view.store().state.notify).toEqual({
      weekly: true,
      drop: true,
      mention: false,
      gsc: false,
    });
    expect(switches(view.app).map((input) => input.checked)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(dispatched).toEqual([
      { type: "setNotify", key: "mention", value: false },
      { type: "setNotify", key: "weekly", value: true },
    ]);
  });

  it("keeps both flips when two handlers from one render run before React commits", async () => {
    const view = await renderBlock();
    const pass = lastRenderPass();
    const rendersBefore = toggleLog.renders.length;

    // One synchronous act: both calls run before the first write commits. No
    // flush, no await and no re-reading of handlers between them, and no
    // switch rendered in between (asserted inside the act).
    act(() => {
      pass.weekly.onChange(true);
      expect(toggleLog.renders.length).toBe(rendersBefore);
      pass.gsc.onChange(true);
    });

    expect(view.store().state.notify).toEqual(ALL_ON);
    expect(switches(view.app).map((input) => input.checked)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(dispatched).toEqual([
      { type: "setNotify", key: "weekly", value: true },
      { type: "setNotify", key: "gsc", value: true },
    ]);
  });

  it("keeps the first flip when a handler from the render before it runs after it committed", async () => {
    const view = await renderBlock();
    const pass = lastRenderPass();
    const rendersBefore = toggleLog.renders.length;

    act(() => pass.weekly.onChange(true));
    expect(view.store().state.notify.weekly).toBe(true);
    // The first flip committed and the switches rendered again, so the gsc
    // handler below is the earlier render's, arriving late.
    expect(toggleLog.renders.length).toBeGreaterThan(rendersBefore);
    act(() => pass.gsc.onChange(true));

    expect(view.store().state.notify).toEqual(ALL_ON);
    expect(switches(view.app).map((input) => input.checked)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(dispatched).toEqual([
      { type: "setNotify", key: "weekly", value: true },
      { type: "setNotify", key: "gsc", value: true },
    ]);
  });
});

describe("NotifyBlock: what it says about itself", () => {
  it("says the preferences stay in this browser and nothing is sent (en)", async () => {
    const view = await renderBlock();
    const notes = block(view.app).querySelectorAll("[data-wb-notify-note]");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe(NOTIFY.note);
    expect(notes[0]?.textContent).toContain("only in this browser");
    expect(notes[0]?.textContent).toContain("nothing is sent");
  });

  it("says the preferences stay in this browser and nothing is sent (zh-CN)", async () => {
    const view = await renderBlock("zh-CN");
    const notes = block(view.app).querySelectorAll("[data-wb-notify-note]");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe(
      DS_MESSAGES["zh-CN"].workbench.settings.notify.note,
    );
    expect(notes[0]?.textContent).toContain("只保存在这个浏览器");
    expect(notes[0]?.textContent).toContain("不会发送任何通知");
  });

  it("names itself and carries no sample marker", async () => {
    const view = await renderBlock();
    const headings = block(view.app).querySelectorAll("h2");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("Notification preferences");
    expect(block(view.app).getAttribute("aria-labelledby")).toBe(
      headings[0]?.id,
    );
    expect(switches(view.app)).toHaveLength(4);
    expect(
      block(view.app).querySelectorAll(`span[title="${SHELL.sampleTitle}"]`),
    ).toHaveLength(0);
    const text = block(view.app).textContent ?? "";
    expect(text).toContain("Notification preferences");
    expect(text).not.toContain("Sample data");
    expect(text).not.toContain("Sample site");
  });
});

describe("NotifyBlock: before the store is read", () => {
  it("draws a skeleton instead of switches, and still states the note", async () => {
    const notReady: WorkbenchContextValue = {
      projectId: DS_PROJECT_ID,
      state: initialProjectState(DS_SEED),
      dispatch: () => {
        throw new Error("nothing may write before the store is read");
      },
      ready: false,
      storageMode: "ok",
      keywordRows: [],
      keywordRowCount: null,
      forgetProject: () => {},
    };
    const mounted = mountPlain(
      <WorkbenchContext.Provider value={notReady}>
        <NotifyBlock />
      </WorkbenchContext.Provider>,
    );
    cleanup = mounted.unmount;
    await settle();
    const scope = block(mounted.container);
    expect(scope.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    expect(scope.querySelectorAll("input")).toHaveLength(0);
    expect(scope.querySelectorAll("label")).toHaveLength(0);
    expect(toggleLog.renders).toHaveLength(0);
    expect(scope.querySelector("[data-wb-notify-note]")?.textContent).toBe(
      NOTIFY.note,
    );
    expect(
      scope.querySelectorAll(`span[title="${SHELL.sampleTitle}"]`),
    ).toHaveLength(0);
    expect(scope.textContent).not.toContain("Sample data");
  });
});
