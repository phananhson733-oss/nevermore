/** @vitest-environment jsdom */

/**
 * A profile run over data that changed while it ran (T9 review #1).
 *
 * The run reads the GSC rows, their provenance, the last audit and the stored
 * document when it starts, and writes steps later. Loading or clearing the
 * sample in between must not leave a document describing data the project no
 * longer holds: the real reducer refuses the write, the store keeps what the
 * sample action left, and the page says the result was not saved — the whole
 * sentence, checked in both locales. A run over data that held still says
 * nothing, and the next run withdraws the notice.
 */

import { act } from "react";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDemoSite } from "@/lib/workbench/mock/demo";
import { DEMO_LEVEL, DEMO_SEEDS } from "@/lib/workbench/mock/demo-constants";
import { demoFields } from "@/lib/workbench/store/demo-fields";
import type { PublicWorkbenchAction } from "@/lib/workbench/store/WorkbenchProvider";
import { loadDemoOver } from "@/lib/workbench/store/test-fixtures";
import type { DemoPayload, ProfileDoc, WorkbenchProjectState } from "@/lib/workbench/types";
import {
  BLANK_PROFILE,
  type ProfileLocale,
  type RenderedProfile,
  must,
  renderProfile,
} from "./profile-view-test-harness.tsx";
import { PROFILE_STEP_MS } from "./useProfileRun.ts";

const NOW = new Date(2026, 8, 13, 10, 29, 59);
const MESSAGES = { en: getMessages("en").workbench, "zh-CN": getMessages("zh-CN").workbench } as const;

function samplePayload(state: WorkbenchProjectState): DemoPayload {
  return makeDemoSite(state.profile, DEMO_LEVEL, [...DEMO_SEEDS], {
    now: NOW,
    provenanceLine: (at) => `generated ${at}`,
  });
}

const SAMPLE = loadDemoOver(BLANK_PROFILE, samplePayload(BLANK_PROFILE));
const OWN_ROWS: WorkbenchProjectState = {
  ...BLANK_PROFILE,
  gscRows: [{ query: "example pricing", clicks: 30, impressions: 400, ctr: 7.5, position: 3 }],
  gscRowsSource: "user",
};

let rendered: RenderedProfile | null = null;

function show(state: WorkbenchProjectState, locale: ProfileLocale): HTMLElement {
  rendered = renderProfile(state, { stateful: true, locale });
  return rendered.container;
}

function runButton(scope: ParentNode, locale: ProfileLocale): HTMLButtonElement {
  const { run } = MESSAGES[locale].profile;
  return must(
    [...scope.querySelectorAll("button")].find((b) => b.textContent === run.button || b.textContent === run.rerun),
  );
}

function tick(count = 1): void {
  act(() => {
    vi.advanceTimersByTime(PROFILE_STEP_MS * count);
  });
}

function written(): readonly (ProfileDoc | null)[] {
  return must(rendered)
    .actions()
    .filter((action): action is Extract<PublicWorkbenchAction, { type: "setProfileDoc" }> => action.type === "setProfileDoc")
    .map((action) => action.doc);
}

function alerts(scope: ParentNode): readonly (string | null)[] {
  return [...scope.querySelectorAll('[role="alert"]')].map((node) => node.textContent);
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

describe("a profile run over data that changed while it ran", () => {
  it("writes nothing over a sample cleared mid-run, and says so in full (en)", () => {
    const scope = show(SAMPLE, "en");
    act(() => runButton(scope, "en").click());
    tick();
    const store = must(rendered);
    store.dispatch({ type: "clearDemo", expected: demoFields(store.state()) });
    tick(8);
    expect(written()).toHaveLength(1);
    expect(store.state().profileDoc).toBeNull();
    expect(alerts(scope)).toEqual([MESSAGES.en.profile.run.stale]);
  });

  it("keeps the sample's document over a sample loaded mid-run, and says so in full (zh-CN)", () => {
    const scope = show(OWN_ROWS, "zh-CN");
    act(() => runButton(scope, "zh-CN").click());
    tick();
    const store = must(rendered);
    const payload = samplePayload(store.state());
    store.dispatch({ type: "loadDemo", payload, expected: demoFields(store.state()) });
    tick(8);
    expect(written()).toHaveLength(1);
    expect(store.state().profileDoc).toBe(payload.profileDoc);
    expect(store.state().profileDoc).not.toBe(written()[0]);
    expect(alerts(scope)).toEqual([MESSAGES["zh-CN"].profile.run.stale]);
  });

  it("writes, and says nothing, when the data held still", () => {
    const scope = show(SAMPLE, "en");
    act(() => runButton(scope, "en").click());
    tick(8);
    expect(written()).toHaveLength(1);
    expect(must(rendered).state().profileDoc).toBe(written()[0]);
    expect(alerts(scope)).toEqual([]);
  });

  it("withdraws the notice when the next run starts", () => {
    const scope = show(SAMPLE, "en");
    act(() => runButton(scope, "en").click());
    tick();
    const store = must(rendered);
    store.dispatch({ type: "clearDemo", expected: demoFields(store.state()) });
    tick(8);
    expect(alerts(scope)).toHaveLength(1);
    act(() => runButton(scope, "en").click());
    expect(alerts(scope)).toEqual([]);
  });
});
