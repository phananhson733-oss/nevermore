/** @vitest-environment jsdom */

/**
 * Who a profile run belongs to, and when it writes (plan Task 9 Steps 3 and 6;
 * Q14; design §6.4 run tokens).
 *
 * - A run never clears the stored profile: the old one stays until the new one
 *   is written, once, at the end (jsx:1180 cleared it at the start, so a run
 *   abandoned half-way lost the old profile for good).
 * - A run belongs to the project and the click that started it. Switching
 *   project or leaving the page drops it; a second click in the same tick
 *   replaces it. Either way exactly one run can ever write.
 * - The switches reach the document and the page: turning a source off leaves
 *   its section out of what is generated AND rendered — tested from the switch
 *   down, never with a hand-written document.
 * - The stamp is the time the run finished, read in the timer callback.
 */

import { act } from "react";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicWorkbenchAction } from "@/lib/workbench/store/WorkbenchProvider";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import type { GscRow, GscRowsSource, ProfileDoc, WorkbenchProjectState } from "@/lib/workbench/types";
import {
  BLANK_PROFILE,
  OTHER_PROJECT_ID,
  PROFILE_SEED,
  type RenderedProfile,
  button,
  must,
  renderProfile,
} from "./profile-view-test-harness.tsx";
import { PROFILE_STEP_MS, profileRunSteps } from "./useProfileRun.ts";

const en = getMessages("en").workbench;
const NOW = new Date(2026, 8, 13, 10, 29, 59);
const ROWS: readonly GscRow[] = [
  { query: "example pricing", clicks: 30, impressions: 400, ctr: 7.5, position: 3 },
  { query: "seo checklist", clicks: 12, impressions: 900, ctr: 1.3, position: 18 },
];
const WITH_ROWS: WorkbenchProjectState = { ...BLANK_PROFILE, gscRows: ROWS, gscRowsSource: "user" };
const POPULATED = populatedProjectState(PROFILE_SEED);

let rendered: RenderedProfile | null = null;

function show(state: WorkbenchProjectState, options: Parameters<typeof renderProfile>[1] = {}): HTMLElement {
  rendered = renderProfile(state, options);
  return rendered.container;
}

function writes(): readonly (ProfileDoc | null)[] {
  return must(rendered)
    .actions()
    .filter((action): action is Extract<PublicWorkbenchAction, { type: "setProfileDoc" }> => action.type === "setProfileDoc")
    .map((action) => action.doc);
}

function toggle(scope: ParentNode, label: string): void {
  const found = must([...scope.querySelectorAll("label")].find((l) => l.textContent === label));
  act(() => must(scope.querySelector<HTMLInputElement>(`[id="${found.htmlFor}"]`)).click());
}

function tick(count = 1): void {
  act(() => {
    vi.advanceTimersByTime(PROFILE_STEP_MS * count);
  });
}

function steps(scope: ParentNode): readonly (readonly [string | null, string | null])[] {
  return [...scope.querySelectorAll("[data-wb-step]")].map((step) => [step.textContent, step.getAttribute("data-wb-step")]);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.useRealTimers();
});

describe("profileRunSteps", () => {
  it("lists the enabled sources, then assembly, whatever their positions", () => {
    expect(profileRunSteps({ crawl: true, gsc: true, third: true })).toEqual(["crawl", "gsc", "third", "compose"]);
    expect(profileRunSteps({ crawl: true, gsc: false, third: true })).toEqual(["crawl", "third", "compose"]);
    expect(profileRunSteps({ crawl: false, gsc: false, third: false })).toEqual(["compose"]);
  });
});

describe("a profile run", () => {
  it("steps through the enabled sources only, one per tick", () => {
    const scope = show(WITH_ROWS);
    toggle(scope, en.profile.sources.gsc);
    act(() => button(scope, en.profile.run.button).click());
    const s = en.profile.run.steps;
    expect(steps(scope)).toEqual([[s.crawl, "now"], [s.third, "pending"], [s.compose, "pending"]]);
    tick();
    expect(steps(scope)).toEqual([[s.crawl, "done"], [s.third, "now"], [s.compose, "pending"]]);
    expect(button(scope, en.profile.run.busy).disabled).toBe(true);
  });

  it("keeps the previous profile on screen and in the store until it writes the new one, once (Q14)", () => {
    const scope = show(POPULATED, { stateful: true });
    act(() => button(scope, en.profile.run.rerun).click());
    tick(2);
    expect(writes()).toEqual([]);
    expect(scope.textContent).toContain("Site profile · 2026-09-11 15:00");
    tick(2);
    expect(writes()).toHaveLength(1);
    expect(scope.textContent).toContain("Site profile · 2026-09-13 10:30");
    expect(steps(scope)).toEqual([]);
    expect(button(scope, en.profile.run.rerun).disabled).toBe(false);
  });

  it("stamps the time the run finished, not the time it started", () => {
    const scope = show(WITH_ROWS);
    act(() => button(scope, en.profile.run.button).click());
    tick(4);
    expect(must(writes()[0]).at).toBe("2026-09-13 10:30");
  });

  it("writes once when clicked twice in the same tick", () => {
    const scope = show(WITH_ROWS, { stateful: true });
    const run = button(scope, en.profile.run.button);
    act(() => {
      run.click();
      run.click();
    });
    tick(8);
    expect(writes()).toHaveLength(1);
  });

  it("writes nothing and stops once the project changes mid-run", () => {
    const scope = show(WITH_ROWS);
    act(() => button(scope, en.profile.run.button).click());
    tick();
    must(rendered).rerender({ projectId: OTHER_PROJECT_ID });
    expect(steps(scope)).toEqual([]);
    tick(8);
    expect(writes()).toEqual([]);
  });

  it("writes nothing once the page is left mid-run", () => {
    const scope = show(WITH_ROWS);
    act(() => button(scope, en.profile.run.button).click());
    tick();
    const left = must(rendered);
    left.unmount();
    rendered = null;
    tick(8);
    expect(left.actions().filter((action) => action.type === "setProfileDoc")).toEqual([]);
  });
});

describe("from the source switches to the page (Step 6)", () => {
  const METRICS: Readonly<Record<string, readonly string[]>> = {
    crawl: ["pages", "indexable"],
    third: ["traffic", "dr", "refdomains"],
    gsc: [],
  };

  it.each(["crawl", "gsc", "third"] as const)("turning %s off leaves its section out of the profile", (source) => {
    const scope = show(WITH_ROWS, { stateful: true });
    toggle(scope, en.profile.sources[source]);
    act(() => button(scope, en.profile.run.button).click());
    tick(4);
    const doc = must(writes()[0]);
    expect(doc[source]).toBeNull();
    const sections = [...scope.querySelectorAll("[data-wb-profile-section]")].map((s) => s.getAttribute("data-wb-profile-section"));
    expect(sections).not.toContain(source);
    for (const other of (["crawl", "gsc", "third"] as const).filter((id) => id !== source)) {
      expect(sections, other).toContain(other);
    }
    const metrics = [...scope.querySelectorAll("[data-wb-metric]")].map((m) => m.getAttribute("data-wb-metric"));
    for (const metric of must(METRICS[source])) expect(metrics).not.toContain(metric);
  });

  it.each<readonly [GscRowsSource, boolean]>([
    ["sample", true],
    ["user", false],
  ])("generating from %s rows labels the GSC section as sample: %s", (source, labelled) => {
    const scope = show({ ...WITH_ROWS, gscRowsSource: source }, { stateful: true });
    act(() => button(scope, en.profile.run.button).click());
    tick(4);
    expect(must(writes()[0]).gscSource).toBe(source);
    const gsc = must(scope.querySelector('[data-wb-profile-section="gsc"]')).textContent ?? "";
    expect(gsc.includes(en.shell.sampleData)).toBe(labelled);
  });
});
