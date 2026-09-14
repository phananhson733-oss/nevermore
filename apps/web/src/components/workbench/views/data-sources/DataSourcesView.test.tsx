/** @vitest-environment jsdom */

/**
 * The data-sources page as a whole (T10 Steps 2, 6): the seams between its
 * parts, which each part's own test cannot see.
 *
 * - Q6. After "load sample site" and then an import of the operator's own rows,
 *   `state.demo` is still true while the rows are the operator's. Nothing on this
 *   page may still say "sample" — not the page head (no unconditional chip,
 *   codex #4), not the import block, not the table. Before that import, exactly
 *   one sample marker, on the table.
 * - Q10. Before storage is read the import area is a skeleton; the real
 *   connections do not wait for it.
 * - Q26 / Q30. The root is the padded `.wb-reset` two-pane container; every
 *   region carries `data-wb-frame`, the frames hold text, and in en that text
 *   has no Chinese and no raw `workbench.` key path.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_LEVEL, DEMO_SEEDS } from "@/lib/workbench/mock/demo-constants";
import { makeDemoSite } from "@/lib/workbench/mock/demo";
import { testDeps } from "@/lib/workbench/mock/demo-test-fixtures";
import { demoFields } from "@/lib/workbench/store/demo-fields";
import { initialProjectState } from "@/lib/workbench/store/reducer";
import { WorkbenchContext, type WorkbenchContextValue } from "@/lib/workbench/store/WorkbenchProvider";
import {
  buttonByText,
  DS_MESSAGES,
  DS_PROJECT_ID,
  DS_SEED,
  HAN,
  mountPlain,
  mountWithStore,
  settle,
  snapshot,
  sourceSlot,
  sourcesOk,
  typeInto,
  type DsLocale,
  type MountedStore,
} from "./data-sources-test-harness.tsx";
import { DataSourcesView } from "./DataSourcesView.tsx";

const NAV = DS_MESSAGES.en.workbench.nav.items;

let cleanup: (() => void) | null = null;

beforeEach(() => {
  // No "sample" in the server's own sentence: this file asserts the page says
  // nothing about sample data, and the limitation is rendered verbatim.
  const sources = [
    sourceSlot("gsc", "available", { latestSnapshot: snapshot({ limitation: "Capped by the provider." }) }),
    sourceSlot("ga4", "connected"),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(sourcesOk(sources))),
  );
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function renderView(locale: DsLocale = "en"): Promise<MountedStore> {
  const view = mountWithStore(<DataSourcesView projectId={DS_PROJECT_ID} />, locale);
  cleanup = view.unmount;
  await settle();
  return view;
}

function loadSample(view: MountedStore): void {
  const payload = makeDemoSite(view.store().state.profile, DEMO_LEVEL, [...DEMO_SEEDS], testDeps());
  view.dispatch({ type: "loadDemo", payload, expected: demoFields(view.store().state) });
}

function importOwnRows(view: MountedStore, parseLabel: string): void {
  const field = view.app.querySelector("textarea");
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("no paste field");
  typeInto(field, "my own query\t12\t340\t3.5%\t18");
  act(() => buttonByText(view.app, parseLabel).click());
}

describe("DataSourcesView: before the store is read", () => {
  it("shows the real connections and a skeleton for the import area", async () => {
    const notReady: WorkbenchContextValue = {
      projectId: DS_PROJECT_ID,
      state: initialProjectState(DS_SEED),
      dispatch: () => {},
      ready: false,
      storageMode: "ok",
      keywordRows: [],
      keywordRowCount: null,
      forgetProject: () => {},
    };
    const mounted = mountPlain(
      <WorkbenchContext.Provider value={notReady}>
        <DataSourcesView projectId={DS_PROJECT_ID} />
      </WorkbenchContext.Provider>,
    );
    cleanup = mounted.unmount;
    await settle();
    const scope = mounted.container;
    expect(scope.querySelector('[data-wb-skeleton][aria-busy="true"]')).not.toBeNull();
    expect(scope.querySelector("[data-wb-gsc-import]")).toBeNull();
    expect(scope.querySelector("[data-wb-gsc-table]")).toBeNull();
    expect(scope.querySelector('[data-wb-real-connections] [data-wb-source="gsc"]')).not.toBeNull();
  });
});

describe("DataSourcesView: page frame", () => {
  it("is the padded two-pane root with one page title and no inline style", async () => {
    const view = await renderView();
    const rootElement = view.app.firstElementChild;
    expect(rootElement?.classList.contains("wb-reset")).toBe(true);
    expect(rootElement?.classList.contains("max-w-[1600px]")).toBe(true);
    const titles = view.app.querySelectorAll("h1");
    expect(titles).toHaveLength(1);
    expect(titles[0]?.textContent).toBe(NAV.dataSources);
    expect(view.root.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("links to the legacy sources page from the head and from the real section", async () => {
    const view = await renderView();
    expect(view.app.querySelector('[data-wb-legacy-link="sources"]')).not.toBeNull();
    const manage = view.app.querySelector("[data-wb-real-connections] a");
    expect(manage?.getAttribute("href")).toBe(`/p/${DS_PROJECT_ID}/sources`);
  });

  it("marks framework copy in every region and keeps it English in en (Q30)", async () => {
    const view = await renderView();
    loadSample(view);
    importOwnRows(view, "Parse");
    for (const region of ["[data-wb-real-connections]", "[data-wb-gsc-table]"]) {
      expect(view.app.querySelectorAll(`${region} [data-wb-frame]`).length, region).toBeGreaterThanOrEqual(1);
    }
    expect(view.app.querySelector("[data-wb-gsc-import]")?.hasAttribute("data-wb-frame")).toBe(true);
    const frames = [...view.app.querySelectorAll("[data-wb-frame]")];
    expect(frames.map((frame) => frame.textContent ?? "").join("").trim()).not.toBe("");
    for (const frame of frames) {
      expect(frame.textContent ?? "", frame.outerHTML).not.toMatch(HAN);
      expect(frame.textContent ?? "").not.toContain("workbench.");
    }
  });
});

describe("DataSourcesView: sample labels follow the rows, not the mode (Q6)", () => {
  it("shows no sample label on a blank project", async () => {
    const view = await renderView();
    expect(view.app.textContent?.toLowerCase()).not.toContain("sample");
  });

  it.each([
    ["en", "Parse", "sample"],
    ["zh-CN", "解析", "示例"],
  ] as const)("labels sample rows once and drops every label after an own import, demo still on (%s)", async (locale, parseLabel, word) => {
    const view = await renderView(locale);
    loadSample(view);
    expect(view.store().state.gscRowsSource).toBe("sample");
    const marks = view.app.querySelectorAll("[data-wb-gsc-sample]");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.closest("[data-wb-gsc-table]")).not.toBeNull();
    expect(view.app.querySelector("[data-wb-page-title]")?.parentElement?.textContent?.toLowerCase()).not.toContain(word);

    importOwnRows(view, parseLabel);
    expect(view.store().state.demo).toBe(true);
    expect(view.store().state.gscRowsSource).toBe("user");
    expect(view.app.querySelectorAll("[data-wb-gsc-sample]")).toHaveLength(0);
    expect(view.app.textContent?.toLowerCase()).not.toContain(word);
  });
});
