/** @vitest-environment jsdom */

/**
 * The notification preferences block (T11 Step 2), driven through the real
 * `WorkbenchProvider` so a flip goes through the real reducer.
 *
 * - Every write carries the whole preference object (`{...notify, key: next}`).
 *   A write of one field would leave the other three undefined, which the
 *   switches then render as off: the start state below is not the default, so a
 *   write that fell back to `DEFAULT_NOTIFY` does not pass either.
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

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { initialProjectState } from "@/lib/workbench/store/reducer";
import {
  WorkbenchContext,
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

const NOTIFY = DS_MESSAGES.en.workbench.settings.notify;
const SHELL = DS_MESSAGES.en.workbench.shell;

/** Not `DEFAULT_NOTIFY` ({ weekly: true, drop: true, mention: false, gsc: true }). */
const START = { weekly: false, drop: true, mention: true, gsc: false } as const;

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  localStorage.clear();
});

async function renderBlock(locale: DsLocale = "en"): Promise<MountedStore> {
  const view = mountWithStore(<NotifyBlock />, locale);
  cleanup = view.unmount;
  await settle();
  view.dispatch({ type: "setNotify", notify: START });
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

describe("NotifyBlock: once the store is read", () => {
  it("renders the four preferences in order with their stored values", async () => {
    const view = await renderBlock();
    const found = switches(view.app);
    expect(found).toHaveLength(4);
    expect(found.map(labelOf)).toEqual([
      "Weekly report",
      "Health score or mention rate drops",
      "Brand appears in an AI answer for the first time",
      "GSC import fails",
    ]);
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

  it("writes the whole preference object when one switch flips", async () => {
    const view = await renderBlock();
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
    expect(scope.querySelector("[data-wb-notify-note]")?.textContent).toBe(
      NOTIFY.note,
    );
    expect(
      scope.querySelectorAll(`span[title="${SHELL.sampleTitle}"]`),
    ).toHaveLength(0);
    expect(scope.textContent).not.toContain("Sample data");
  });
});
