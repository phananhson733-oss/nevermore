/** @vitest-environment jsdom */

/**
 * "Clear" on the GSC import, against the real store and the real confirmation
 * (codex S6r3). Mounted through the import pane, its one consumer, so focus has
 * the paste field to land on.
 *
 * The case that matters most: rows another write puts in the store while the
 * box is open, at the one moment they are queued but not rendered. A capturing
 * `click` listener on `document` dispatches them inside the confirm click,
 * before React's handler runs — the handler's render still shows the old rows,
 * and the `flushSync` inside it renders the queued write ahead of the clear. The
 * reducer must refuse, the new rows must survive, and the box must ask again
 * rather than close as if it had cleared. Removing the reducer's guard, or the
 * component's reopen, turns this case red.
 *
 * A replacement that had already RENDERED when the operator pressed confirm is
 * covered by that yes (it was on screen), the same line the topbar's "clear
 * sample" draws; one case pins that too, so the guard is not over-read into
 * refusing everything that changed while the box was open.
 */

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonByText,
  DS_MESSAGES,
  gscRow,
  mountWithStore,
  typeInto,
  type MountedStore,
} from "./data-sources-test-harness.tsx";
import { GscImportPane } from "./GscImportPane.tsx";

const COPY = DS_MESSAGES.en.workbench.dataSources.import;
const ROWS_A = [gscRow("seo tool", 3, 90, 3.3, 7.5)];
const ROWS_B = [gscRow("another tab", 50, 900, 5, 12)];

let mounted: MountedStore | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  localStorage.clear();
});

function render(): MountedStore {
  mounted = mountWithStore(<GscImportPane />);
  return mounted;
}

function withRows(): MountedStore {
  const view = render();
  view.dispatch({ type: "setGscRows", rows: ROWS_A, source: "user" });
  return view;
}

function dialog(view: MountedStore): HTMLElement | null {
  const found = view.root.querySelector('[role="dialog"]');
  return found instanceof HTMLElement ? found : null;
}

function requireDialog(view: MountedStore): HTMLElement {
  const found = dialog(view);
  if (found === null) throw new Error("no dialog open");
  return found;
}

function clearButton(view: MountedStore): HTMLButtonElement {
  return buttonByText(view.app, COPY.clear);
}

function pasteField(view: MountedStore): HTMLTextAreaElement {
  const field = view.app.querySelector("textarea");
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("no paste field");
  return field;
}

describe("ClearGscRowsButton: the control", () => {
  it("is not offered while there are no rows", () => {
    const view = render();
    expect([...view.app.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(COPY.clear);
    view.dispatch({ type: "setGscRows", rows: ROWS_A, source: "user" });
    expect(clearButton(view)).toBeInstanceOf(HTMLButtonElement);
  });

  it("asks in a box portalled out of the inert app root", () => {
    const view = withRows();
    act(() => clearButton(view).click());
    const box = requireDialog(view);
    expect(view.app.contains(box)).toBe(false);
    expect(box.closest("#wb-root")).toBe(view.root);
    expect(box.textContent).toContain(COPY.clearConfirmTitle);
    expect(box.textContent).toContain(COPY.clearConfirmBody);
    expect(view.store().state.gscRows).toBe(ROWS_A);
  });
});

describe("ClearGscRowsButton: cancel and confirm", () => {
  it("keeps the rows on cancel and returns focus to the button", () => {
    const view = withRows();
    act(() => clearButton(view).click());
    act(() => buttonByText(requireDialog(view), COPY.cancel).click());
    expect(dialog(view)).toBeNull();
    expect(view.store().state.gscRows).toBe(ROWS_A);
    expect(document.activeElement).toBe(clearButton(view));
  });

  it("clears rows and provenance on confirm, drops the last result, and puts focus in the paste field", () => {
    const view = render();
    typeInto(pasteField(view), "seo tool\t10\t100\t1%\t4");
    act(() => buttonByText(view.app, "Parse").click());
    expect(view.app.querySelector("[data-wb-import-notice]")?.textContent).not.toBe("");

    act(() => clearButton(view).click());
    act(() => buttonByText(requireDialog(view), COPY.clear).click());
    expect(view.store().state.gscRows).toEqual([]);
    expect(view.store().state.gscRowsSource).toBeNull();
    expect(dialog(view)).toBeNull();
    expect(view.app.querySelector("[data-wb-import-notice]")?.textContent).toBe("");
    expect(document.activeElement).toBe(pasteField(view));
  });
});

describe("ClearGscRowsButton: what the yes covers (codex S6r3)", () => {
  it("refuses to clear rows queued behind the render the operator confirmed in, and asks again", () => {
    const view = withRows();
    act(() => clearButton(view).click());
    const confirm = buttonByText(requireDialog(view), COPY.clear);
    // Focus starts on Cancel when the box opens; put it on the confirm button, as
    // a keyboard user pressing it would, so the assertion below needs a move.
    act(() => confirm.focus());
    expect(document.activeElement).toBe(confirm);
    const queueAnotherTabsRows = (): void => {
      view.store().dispatch({ type: "setGscRows", rows: ROWS_B, source: "user" });
    };
    document.addEventListener("click", queueAnotherTabsRows, { capture: true, once: true });
    act(() => confirm.click());

    expect(view.store().state.gscRows).toBe(ROWS_B);
    expect(view.store().state.gscRowsSource).toBe("user");
    const again = requireDialog(view);
    expect(document.activeElement).toBe(buttonByText(again, COPY.cancel));
  });

  it("clears rows that had already rendered when confirm was pressed: they were on screen", () => {
    const view = withRows();
    act(() => clearButton(view).click());
    view.dispatch({ type: "setGscRows", rows: ROWS_B, source: "user" });
    act(() => buttonByText(requireDialog(view), COPY.clear).click());
    expect(view.store().state.gscRows).toEqual([]);
    expect(dialog(view)).toBeNull();
  });

  it("closes the box when the rows are gone while it is open, and does not reopen it later", () => {
    const view = withRows();
    act(() => clearButton(view).click());
    view.dispatch({ type: "setGscRows", rows: [], source: "user" });
    expect(dialog(view)).toBeNull();
    expect(document.activeElement).toBe(pasteField(view));
    view.dispatch({ type: "setGscRows", rows: ROWS_B, source: "user" });
    expect(dialog(view)).toBeNull();
  });

  it("drops the last result when the rows are gone while the box is open, as a confirmed clear does", () => {
    const view = render();
    typeInto(pasteField(view), "seo tool\t10\t100\t1%\t4");
    act(() => buttonByText(view.app, "Parse").click());
    expect(view.app.querySelector("[data-wb-import-notice]")?.textContent).not.toBe("");
    act(() => clearButton(view).click());
    view.dispatch({ type: "setGscRows", rows: [], source: "user" });
    expect(dialog(view)).toBeNull();
    expect(view.app.querySelector("[data-wb-import-notice]")?.textContent).toBe("");
  });
});
