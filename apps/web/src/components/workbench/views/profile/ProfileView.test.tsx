/** @vitest-environment jsdom */

/**
 * The profile page as a whole (plan Task 9 Steps 4-6), against a store stuck
 * at one state. How a run owns its write lives in `ProfileView.run.test.tsx`;
 * how one snapshot renders, in `ProfileDocTab.test.tsx`.
 *
 * Pinned here:
 * - Skeleton before hydration, empty state after it with nothing generated
 *   (Q10); the root is its own padded `.wb-reset` (Q26).
 * - The output pane's title carries the snapshot's stamp, and the GSC label is
 *   the SNAPSHOT's source, not the current rows' (Q6): the populated fixture
 *   deliberately disagrees on the two.
 * - The three tabs show their builders' text, and the actions stamp and save
 *   exactly that text once (Q23), with the shared labels.
 */

import { act } from "react";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicWorkbenchAction } from "@/lib/workbench/store/WorkbenchProvider";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import type { Artifact, WorkbenchProjectState } from "@/lib/workbench/types";
import {
  BLANK_PROFILE,
  HAN,
  PROFILE_PROJECT_ID,
  PROFILE_SEED,
  type RenderedProfile,
  button,
  must,
  renderProfile,
} from "./profile-view-test-harness.tsx";

const en = getMessages("en").workbench;
const NOW = new Date(2026, 8, 13, 10, 30, 0);
const STAMP = "2026-09-13 10:30";
// Its snapshot says `gscSource: "sample"` while its current rows are "user".
const POPULATED: WorkbenchProjectState = populatedProjectState(PROFILE_SEED);
const PROVENANCE_HEAD = en.provenance.artifact.slice(0, en.provenance.artifact.indexOf("{at}"));

let rendered: RenderedProfile | null = null;

function show(state: WorkbenchProjectState, options: Parameters<typeof renderProfile>[1] = {}): HTMLElement {
  rendered = renderProfile(state, options);
  return rendered.container;
}

function saved(): readonly Artifact[] {
  return must(rendered)
    .actions()
    .filter((action): action is Extract<PublicWorkbenchAction, { type: "addArtifact" }> => action.type === "addArtifact")
    .map((action) => action.artifact);
}

function tab(scope: ParentNode, label: string): HTMLButtonElement {
  return must([...scope.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === label));
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

describe("ProfileView page", () => {
  it("renders a skeleton, not an empty profile, before the store is ready", () => {
    const scope = show(BLANK_PROFILE, { ready: false });
    expect(scope.querySelector("[data-wb-skeleton]")).not.toBeNull();
    expect(scope.querySelector("[data-wb-pane-head]")).toBeNull();
    expect(scope.textContent).not.toContain(en.profile.empty.title);
  });

  it("is its own padded .wb-reset root (Q26)", () => {
    const root = must(show(BLANK_PROFILE).firstElementChild);
    for (const name of ["wb-reset", "max-w-[1600px]", "p-6"]) expect(root.classList.contains(name), name).toBe(true);
  });

  it("titles the page and says the signals are generated locally", () => {
    const scope = show(BLANK_PROFILE);
    expect(scope.querySelector("h1")?.textContent).toBe(en.nav.items.profile);
    expect(scope.textContent).toContain(en.profile.subtitle);
    const legacy = [...scope.querySelectorAll("[data-wb-legacy-link]")].map((a) => a.getAttribute("data-wb-legacy-link"));
    expect(legacy).toEqual(["context", "setup-sources"]);
  });

  it("shows the empty state and no actions before a profile exists", () => {
    const scope = show(BLANK_PROFILE);
    expect(scope.textContent).toContain(en.profile.empty.title);
    expect([...scope.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(en.artifactActions.copy);
  });

  it("titles the output with the snapshot's stamp and shows its sections", () => {
    const scope = show(POPULATED);
    expect(scope.textContent).toContain("Site profile · 2026-09-11 15:00");
    expect(scope.querySelector('[data-wb-profile-section="crawl"]')).not.toBeNull();
  });
});

describe("ProfileView GSC label (Q6)", () => {
  const gscText = (scope: ParentNode): string =>
    must(scope.querySelector('[data-wb-profile-section="gsc"]')).textContent ?? "";

  it("keeps a sample snapshot labelled after the current rows became the user's", () => {
    expect(POPULATED.gscRowsSource).toBe("user");
    expect(gscText(show(POPULATED))).toContain(en.shell.sampleData);
  });

  it("does not label a user snapshot because the current rows are the sample's", () => {
    const doc = must(POPULATED.profileDoc);
    const state = { ...POPULATED, gscRowsSource: "sample" as const, profileDoc: { ...doc, gscSource: "user" as const } };
    expect(gscText(show(state))).not.toContain(en.shell.sampleData);
  });
});

describe("ProfileView tabs", () => {
  it("names the tablist", () => {
    expect(show(POPULATED).querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe(en.profile.tabs.label);
  });

  it("shows the profile JSON and the AI context block as their builders write them", () => {
    const scope = show(POPULATED);
    act(() => tab(scope, en.profile.tabs.json).click());
    const json = JSON.parse(must(scope.querySelector("pre")).textContent ?? "") as { brand: string };
    expect(json.brand).toBe("Example");
    act(() => tab(scope, en.profile.tabs.ctx).click());
    expect(must(scope.querySelector("pre")).textContent?.startsWith("# 产品背景\n")).toBe(true);
    expect(scope.querySelector("[data-wb-profile-section]")).toBeNull();
  });
});

describe("ProfileView actions", () => {
  it("saves the profile document once, stamped once, under the shared labels", () => {
    const scope = show(POPULATED);
    for (const label of [en.artifactActions.copy, en.artifactActions.copyForAi, en.artifactActions.exportFile]) {
      expect(button(scope, label).disabled, label).toBe(false);
    }
    act(() => button(scope, en.artifactActions.save).click());
    expect(saved()).toHaveLength(1);
    const [artifact] = saved();
    expect(artifact).toMatchObject({
      module: "profile",
      type: "md",
      engine: "both",
      title: "Example site profile",
      filename: "product-profile.md",
      at: STAMP,
    });
    const content = must(artifact).content;
    expect(content.startsWith(en.provenance.artifact.replace("{at}", STAMP))).toBe(true);
    expect(content.split(PROVENANCE_HEAD)).toHaveLength(2);
    expect(content).toContain("\n# Example 产品档案\n");
  });

  it("saves the AI context block as a prompt carrying the snapshot's sample flag", () => {
    const scope = show(POPULATED);
    act(() => tab(scope, en.profile.tabs.ctx).click());
    act(() => button(scope, en.artifactActions.save).click());
    const artifact = must(saved()[0]);
    expect(artifact).toMatchObject({ module: "profile", type: "prompt", title: "Example context block" });
    expect(Object.hasOwn(artifact, "filename")).toBe(false);
    expect(artifact.content).toContain('"sampleData": true');
  });
});

describe("ProfileView frame", () => {
  it("marks framework copy and keeps it English in en (Q30)", () => {
    const frames = [...show(POPULATED).querySelectorAll("[data-wb-frame]")];
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames.map((frame) => frame.textContent ?? "").join("").trim()).not.toBe("");
    for (const frame of frames) {
      expect(frame.textContent ?? "", frame.outerHTML).not.toMatch(HAN);
      expect(frame.textContent ?? "").not.toContain("workbench.");
    }
  });

  it("renders no inline style", () => {
    expect(show(POPULATED).querySelector("[style]")).toBeNull();
  });

  it("uses the project id from the store for its links", () => {
    const link = [...show(BLANK_PROFILE).querySelectorAll("a")].find((a) => a.textContent === en.profile.legacyCta);
    expect(must(link).getAttribute("href")).toBe(`/p/${PROFILE_PROJECT_ID}/context`);
  });
});
