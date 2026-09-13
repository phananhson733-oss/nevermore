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

  it("keeps handing the one report while the content stays the same", () => {
    rendered = renderWeek(A);
    rendered.rerender({ ...A, artifacts: [] });
    rendered.rerender(structuredClone(A));
    expect(recorded.prepared.length).toBeGreaterThanOrEqual(3);
    expect(new Set(recorded.prepared).size).toBe(1);
  });
});
