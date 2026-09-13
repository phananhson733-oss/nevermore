/** @vitest-environment jsdom */

/**
 * The weekly report's provenance declaration follows the source of the GSC rows
 * it counts (Q36). Its only GSC-derived lines are the borderline count and the
 * unknown-rank aside beside it, printed only when `summary.borderline` is
 * known, so a project whose rows all lack a position shows no GSC data and
 * carries the sample sentence, as a project with no rows does.
 *
 * Each declaration is pinned as the whole shipped sentence, written out in both
 * locales: an expectation built from the catalogue or from `stampArtifact` would
 * pass for a hook that stamped the wrong key. What reaches the actions is read
 * from every render's `prepared`, as `WeekReport.test.tsx` does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GscRowsSource, WorkbenchProjectState } from "@/lib/workbench/types";
import {
  BLANK_WEEK,
  type RenderedWeek,
  type WeekLocale,
  gsc,
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
const STAMP = "2026-09-13 10:30";

/** `workbench.provenance.*` as shipped, with the stamp filled in. */
const DECLARATION: Readonly<Record<WeekLocale, Readonly<Record<"sample" | "user" | "unknown", string>>>> = {
  en: {
    sample: `Sample data: generated locally for demonstration, not measured. Generated ${STAMP}`,
    user: `Includes GSC data you imported; the rest was generated locally for demonstration, not measured. Generated ${STAMP}`,
    unknown: `Includes GSC data of unknown source; the rest was generated locally for demonstration, not measured. Generated ${STAMP}`,
  },
  "zh-CN": {
    sample: `示例数据：本地生成的演示结果，不是真实测量；生成于 ${STAMP}`,
    user: `含你导入的 GSC 数据；其余为本地生成的演示结果，不是真实测量；生成于 ${STAMP}`,
    unknown: `含来源未知的 GSC 数据；其余为本地生成的演示结果，不是真实测量；生成于 ${STAMP}`,
  },
};

const AUDITED: WorkbenchProjectState = { ...BLANK_WEEK, lastAudit: report("2026-09-12 10:00", 80, []) };

/** One row inside 11-30 and one outside it, from `source`. */
function withRows(source: GscRowsSource | null): WorkbenchProjectState {
  return { ...AUDITED, gscRows: [gsc("eleven", 11), gsc("far", 45)], gscRowsSource: source };
}

let rendered: RenderedWeek | null = null;

function contentOf(prepared: unknown): string {
  return (prepared as { readonly content: string }).content;
}

/** An md artifact's declaration is its first line; the body follows a blank line. */
function declarationOf(prepared: unknown): string {
  return must(contentOf(prepared).split("\n")[0]);
}

function bodyOf(prepared: unknown): string {
  const content = contentOf(prepared);
  return content.slice(content.indexOf("\n\n") + 2);
}

function declarationShown(state: WorkbenchProjectState, locale: WeekLocale): string {
  rendered = renderWeek(state, { locale });
  return declarationOf(must(recorded.prepared.at(-1)));
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

describe.each(["en", "zh-CN"] as const)("the weekly report's declaration (%s)", (locale) => {
  const line = DECLARATION[locale];

  it("is the sample sentence with no GSC rows", () => {
    expect(declarationShown(AUDITED, locale)).toBe(line.sample);
  });

  it("is the sample sentence over the sample's rows", () => {
    expect(declarationShown(withRows("sample"), locale)).toBe(line.sample);
  });

  it("names the operator's own rows over imported ones", () => {
    expect(declarationShown(withRows("user"), locale)).toBe(line.user);
  });

  it("says the source is unknown over rows with none recorded", () => {
    expect(declarationShown(withRows(null), locale)).toBe(line.unknown);
  });

  it("is the sample sentence over imported rows none of which has a position, since the report then shows no GSC data", () => {
    const state: WorkbenchProjectState = { ...AUDITED, gscRows: [gsc("unranked", null)], gscRowsSource: "user" };
    expect(declarationShown(state, locale)).toBe(line.sample);
  });
});

describe("the weekly report row", () => {
  it("prepares the report again when only the rows' source changes, so the declaration follows it", () => {
    rendered = renderWeek(withRows("sample"));
    const before = must(recorded.prepared.at(-1));
    expect(declarationOf(before)).toBe(DECLARATION.en.sample);
    const seen = recorded.prepared.length;
    rendered.rerender(withRows("user"));
    const after = recorded.prepared.slice(seen);
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toContain(before);
    expect(after.map((prepared) => declarationOf(prepared))).toEqual(after.map(() => DECLARATION.en.user));
    // The text under the declaration is unchanged: the source is the one thing
    // that moved, so only the key's `gscData` can have told the two apart.
    expect(bodyOf(must(after.at(-1)))).toBe(bodyOf(before));
  });
});
