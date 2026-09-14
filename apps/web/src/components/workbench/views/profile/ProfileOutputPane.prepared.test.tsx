/** @vitest-environment jsdom */

/**
 * The profile actions never hand over text prepared for another tab or another
 * snapshot (codex S7b #3), through the `hooks/usePreparedArtifact.ts` the
 * week report shares; the store-cannot-save case is pinned in
 * `WeekReport.test.tsx`. Every render's `prepared` is recorded,
 * so the render between a tab switch and the effect that prepares the new text
 * is seen directly, not through a click racing it.
 *
 * Found by mutation: with the key check removed from `usePreparedArtifact`,
 * every other profile suite stayed green.
 */

import { act } from "react";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import { PROFILE_SEED, type RenderedProfile, must, renderProfile } from "./profile-view-test-harness.tsx";

const recorded = vi.hoisted(() => ({ prepared: [] as unknown[] }));

vi.mock("../../ui/ArtifactActions.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/ArtifactActions.tsx")>();
  return {
    ...actual,
    ArtifactActions: (props: Parameters<typeof actual.ArtifactActions>[0]) => {
      recorded.prepared = [...recorded.prepared, props.prepared];
      return <actual.ArtifactActions {...props} />;
    },
  };
});

const en = getMessages("en").workbench;
const POPULATED = populatedProjectState(PROFILE_SEED);
let rendered: RenderedProfile | null = null;

function contentOf(prepared: unknown): string {
  return (prepared as { readonly content: string }).content;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 13, 10, 30, 0));
  recorded.prepared = [];
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.useRealTimers();
});

describe("the profile actions", () => {
  it("hand over no text prepared for the tab that was showing before", () => {
    rendered = renderProfile(POPULATED);
    const before = must(recorded.prepared.at(-1));
    expect(contentOf(before)).toContain("\n# Example 产品档案\n");
    const seen = recorded.prepared.length;
    const jsonTab = must(
      [...rendered.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (tab) => tab.textContent === en.profile.tabs.json,
      ),
    );
    act(() => jsonTab.click());
    const after = recorded.prepared.slice(seen);
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toContain(before);
    expect(after.every((prepared) => !contentOf(prepared).includes("# Example 产品档案"))).toBe(true);
  });

  it("keep handing one prepared text while what it says stays the same", () => {
    rendered = renderProfile(POPULATED);
    rendered.rerender({ state: { ...POPULATED, artifacts: [] } });
    rendered.rerender({ state: structuredClone(POPULATED) });
    expect(recorded.prepared.length).toBeGreaterThanOrEqual(3);
    expect(new Set(recorded.prepared).size).toBe(1);
  });
});
