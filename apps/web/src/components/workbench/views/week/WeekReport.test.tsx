/** @vitest-environment jsdom */

/**
 * The weekly report row never hands the actions a report prepared for other
 * content (codex S7b #3). Every render's `prepared` is recorded, so the render
 * between a content change and the effect that prepares the new text is seen
 * directly, not through a click racing it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchProjectState } from "@/lib/workbench/types";
import {
  BLANK_WEEK,
  type RenderedWeek,
  must,
  renderWeek,
  report,
} from "./week-view-test-harness.tsx";

const recorded = vi.hoisted(() => ({ prepared: [] as unknown[] }));
const store = vi.hoisted(() => ({ canSave: true }));

// `canSave: false` stands for the hook answering `null` (a project not yet
// hydrated) while the view stays mounted, which the week harness cannot reach.
vi.mock("../../hooks/useAddArtifact.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/useAddArtifact.ts")>();
  return {
    ...actual,
    useAddArtifact: () => {
      const prepare = actual.useAddArtifact();
      return store.canSave ? prepare : null;
    },
  };
});

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

const NOW = new Date(2026, 8, 13, 10, 30, 0);
const A: WorkbenchProjectState = { ...BLANK_WEEK, lastAudit: report("2026-09-12 10:00", 80, []) };
const B: WorkbenchProjectState = { ...BLANK_WEEK, lastAudit: report("2026-09-12 10:00", 40, []) };

let rendered: RenderedWeek | null = null;

function contentOf(prepared: unknown): string {
  return (prepared as { readonly content: string }).content;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  recorded.prepared = [];
  store.canSave = true;
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.useRealTimers();
});

describe("the weekly report row", () => {
  it("hands the actions no report prepared for the previous content", () => {
    rendered = renderWeek(A);
    const before = must(recorded.prepared.at(-1));
    expect(contentOf(before)).toContain("- 技术健康分：80（");
    const seen = recorded.prepared.length;
    rendered.rerender(B);
    const after = recorded.prepared.slice(seen);
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toContain(before);
    expect(after.every((prepared) => contentOf(prepared).includes("- 技术健康分：40（"))).toBe(true);
  });

  // codex S7r2 #2: with nothing able to prepare a save, the report prepared
  // before kept reaching the row, and stayed there after the effect ran.
  it("hands the actions nothing once the store cannot take a save, content unchanged", () => {
    rendered = renderWeek(A);
    expect(recorded.prepared.length).toBeGreaterThan(0);
    const seen = recorded.prepared.length;
    store.canSave = false;
    rendered.rerender({ ...A });
    rendered.rerender(structuredClone(A));
    expect(recorded.prepared.length - seen).toBe(0);
    const row = rendered.container.querySelector("[data-wb-week-report]");
    expect(row?.querySelector("[data-wb-skeleton]")).not.toBeNull();
    expect(row?.querySelector("button")).toBeNull();
  });

  it("keeps handing the one report while the content stays the same", () => {
    rendered = renderWeek(A);
    rendered.rerender({ ...A, artifacts: [] });
    rendered.rerender(structuredClone(A));
    expect(recorded.prepared.length).toBeGreaterThanOrEqual(3);
    expect(new Set(recorded.prepared).size).toBe(1);
  });
});
