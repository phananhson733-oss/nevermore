/** @vitest-environment jsdom */

/**
 * The week page's contract, rendered against a store stuck at one state (the
 * `useAddArtifact.test.tsx` pattern) so every assertion reads settled DOM for a
 * known input. The clock is faked (`Date` only) and read through the real
 * `useNowStamp`, so the seven-day window and the report stamp are fixed.
 *
 * What is pinned here and nowhere else:
 * - ICU argument order (Q4b): en and zh order `{fixed} {added}` / `{hits}
 *   {total}` differently, so each sentence is asserted whole, with values that
 *   cannot be swapped unnoticed (2 vs 1, 14 vs 40).
 * - Unknown is an em dash, never 0 (Q10): the knowledge-base and answer-gap
 *   counts render their own "unknown" sentence.
 * - The text that reaches the basket carries exactly one provenance
 *   declaration (Q23) and none of the forbidden claims (Q16 / Q17), checked with
 *   the builder test's own blacklist.
 * - An empty project cannot save a report (W18).
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  honestyViolations,
  provenanceDeclarationCount,
} from "@/lib/workbench/mock/builders/week-honesty-fixtures";
import {
  initialProjectState,
  type ProjectSeed,
} from "@/lib/workbench/store/reducer";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import type {
  PublicWorkbenchAction,
  WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import { WorkbenchContext } from "@/lib/workbench/store/WorkbenchProvider";
import type {
  Artifact,
  AuditReport,
  Finding,
  GscRow,
  VisResult,
  WorkbenchProjectState,
} from "@/lib/workbench/types";
import { ARTIFACT_ACTION_LABEL_KEYS } from "../../ui/ArtifactActions.tsx";
import { UNKNOWN_TEXT } from "../../ui/stat-format.ts";
import { WeekView } from "./WeekView.tsx";

/**
 * What the report row was handed on each render. The real component still
 * renders (the save tests click its buttons); the wrapper only records, so
 * "the same prepared object across re-renders" is observed directly instead
 * of through `save()`, whose outcome against a store that never commits is
 * not this view's contract.
 */
const recorded = vi.hoisted(() => ({
  prepared: [] as unknown[],
  labels: [] as unknown[],
}));

vi.mock("../../ui/ArtifactActions.tsx", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../ui/ArtifactActions.tsx")>();
  return {
    ...actual,
    ArtifactActions: (
      props: Parameters<typeof actual.ArtifactActions>[0],
    ) => {
      recorded.prepared = [...recorded.prepared, props.prepared];
      recorded.labels = [...recorded.labels, props.labels];
      return <actual.ArtifactActions {...props} />;
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Locale = "en" | "zh-CN";

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = {
  url: "https://example.test",
  brand: "Example",
  market: "US",
};
const NOW = new Date(2026, 8, 13, 10, 30, 0);
const STAMP = "2026-09-13 10:30";
const POPULATED = populatedProjectState(SEED);
const HAN = /\p{Script=Han}/u;

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("fixture is missing a value");
  return value;
}

function finding(t: string, sev: Finding["sev"]): Finding {
  return { ...must(POPULATED.lastAudit?.findings[0]), id: t, t, sev };
}

function report(
  at: string,
  score: number,
  findings: readonly Finding[],
): AuditReport {
  return { ...must(POPULATED.lastAudit), at, score, findings };
}

function hits(count: number, total: number): readonly VisResult[] {
  const base = must(POPULATED.lastVis?.results[0]);
  return Array.from({ length: total }, (_, i) => ({
    ...base,
    p: `prompt ${i}`,
    hit: i < count,
  }));
}

function gsc(query: string, position: number): GscRow {
  return { query, clicks: 3, impressions: 90, ctr: 0.03, position };
}

function artifact(
  id: string,
  at: string,
  overrides: Partial<Artifact> = {},
): Artifact {
  return { ...must(POPULATED.artifacts[0]), id, at, ...overrides };
}

const BLANK: WorkbenchProjectState = initialProjectState(SEED);

const FULL: WorkbenchProjectState = {
  ...BLANK,
  lastAudit: report("2026-09-12 10:00", 56, [
    finding("kept", "mid"),
    finding("new", "high"),
  ]),
  audit: report("2026-09-12 10:00", 56, [
    finding("kept", "mid"),
    finding("new", "high"),
  ]),
  auditHistory: [
    report("2026-09-05 10:00", 49, [
      finding("kept", "mid"),
      finding("gone-1", "low"),
      finding("gone-2", "high"),
    ]),
  ],
  lastVis: { at: "2026-09-12 11:00", results: hits(14, 40) },
  visResults: hits(14, 40),
  // Same 40 prompts as `lastVis`: a run over another set is not compared (codex S7a #1).
  visHistory: [{ at: "2026-09-05 11:00", results: hits(12, 40) }],
  gscRows: [
    gsc("thirty", 30),
    gsc("eleven", 11),
    gsc("mid", 14.2),
    gsc("far", 45),
  ],
  gscRowsSource: "sample",
  artifacts: [
    artifact("a1", "2026-09-11 14:00", {
      module: "keywordLibrary",
      title: "词库导出",
    }),
    artifact("old", "2026-08-01 10:00", { title: "旧产物" }),
  ],
  demo: true,
};

let dispatch = vi.fn<(action: PublicWorkbenchAction) => void>();
let cleanup: (() => void) | null = null;
let rerender: ((state: WorkbenchProjectState) => void) | null = null;

function context(
  state: WorkbenchProjectState,
  ready: boolean,
): WorkbenchContextValue {
  return {
    projectId: PROJECT_ID,
    state,
    dispatch,
    ready,
    storageMode: "ok",
    keywordRows: [],
    keywordRowCount: null,
    forgetProject: () => {},
  };
}

function render(
  state: WorkbenchProjectState,
  options: { locale?: Locale; ready?: boolean } = {},
): HTMLElement {
  const locale = options.locale ?? "en";
  const ready = options.ready ?? true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const tree = (current: WorkbenchProjectState) => (
    <NextIntlClientProvider
      locale={locale}
      messages={getMessages(locale)}
      timeZone="UTC"
    >
      <WorkbenchContext.Provider value={context(current, ready)}>
        <WeekView />
      </WorkbenchContext.Provider>
    </NextIntlClientProvider>
  );
  act(() => root.render(tree(state)));
  rerender = (next) => act(() => root.render(tree(next)));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

function one(scope: ParentNode, selector: string): Element {
  return must(scope.querySelector(selector));
}

function text(scope: ParentNode, selector: string): string {
  return one(scope, selector).textContent ?? "";
}

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  return must(found);
}

function savedArtifact(): Artifact {
  const calls = dispatch.mock.calls.map(([action]) => action);
  expect(calls).toHaveLength(1);
  const [action] = calls;
  if (action?.type !== "addArtifact")
    throw new Error(`expected addArtifact, got ${action?.type}`);
  return action.artifact;
}

/** The body under the md stamp (`${notice}\n\n${body}`). */
function bodyOf(content: string): string {
  return content.slice(content.indexOf("\n\n") + 2);
}

const en = getMessages("en").workbench;
const zh = getMessages("zh-CN").workbench;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  dispatch = vi.fn<(action: PublicWorkbenchAction) => void>();
  recorded.prepared = [];
  recorded.labels = [];
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  rerender = null;
  vi.useRealTimers();
});

describe("WeekView before the store is hydrated", () => {
  it("renders a skeleton, not dashes and not cards", () => {
    const scope = render(FULL, { ready: false });
    expect(scope.querySelector("[data-wb-skeleton]")).not.toBeNull();
    expect(scope.querySelector("[data-wb-week-card]")).toBeNull();
    expect(scope.textContent).not.toContain(UNKNOWN_TEXT);
    expect(scope.textContent).not.toMatch(/\d/u);
  });
});

describe("WeekView for an empty project", () => {
  it("shows the empty state instead of a row of zeros", () => {
    const scope = render(BLANK);
    expect(text(scope, "[data-wb-week-empty]")).toBe(
      `${en.week.empty.title}${en.week.empty.detail}`,
    );
    expect(scope.querySelector("[data-wb-week-card]")).toBeNull();
    expect(scope.querySelector("[data-wb-week-summary]")).toBeNull();
    expect(scope.querySelector("[data-wb-week-feed]")).toBeNull();
  });

  it("cannot save or hand over a report, and says so", () => {
    const scope = render(BLANK);
    const actions = [
      ...one(scope, "[data-wb-week-report]").querySelectorAll("button"),
    ];
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((b) => b.disabled)).toBe(true);
    expect(text(scope, "[data-wb-report-disabled]")).toBe(
      en.week.report.disabled,
    );
    act(() => button(scope, en.week.report.save).click());
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("WeekView with a week of results", () => {
  it("titles the range from six days before today to today (en)", () => {
    const scope = render(FULL);
    expect(text(scope, "[data-wb-page-title]")).toBe(en.nav.items.week);
    expect(scope.textContent).toContain("2026-09-07 to 2026-09-13");
  });

  it("titles the range from six days before today to today (zh)", () => {
    const scope = render(FULL, { locale: "zh-CN" });
    expect(scope.textContent).toContain("2026-09-07 至 2026-09-13");
  });

  it("shows the latest health score against the last archived report, sentence by sentence (en)", () => {
    const scope = render(FULL);
    const card = one(scope, "[data-wb-week-card='health']");
    expect(
      card.textContent?.startsWith(`56+7${en.week.cards.health.label}`),
    ).toBe(true);
    expect(text(card, "[data-wb-foot='diff']")).toBe(
      "2 no longer reported, 1 newly reported",
    );
    expect(text(card, "[data-wb-foot='since']")).toBe(
      "vs. the previous run (2026-09-05 10:00)",
    );
    expect(one(card, "a").getAttribute("href")).toBe(`/p/${PROJECT_ID}/audit`);
  });

  it("orders the health footnote the zh way", () => {
    const scope = render(FULL, { locale: "zh-CN" });
    const card = one(scope, "[data-wb-week-card='health']");
    expect(text(card, "[data-wb-foot='diff']")).toBe(
      "2 条不再出现，1 条新出现",
    );
    expect(text(card, "[data-wb-foot='since']")).toBe(
      "较上次（2026-09-05 10:00）",
    );
  });

  it("shows the mention rate from the completed run, with the delta in points (en)", () => {
    const scope = render(FULL);
    const card = one(scope, "[data-wb-week-card='mention']");
    expect(
      card.textContent?.startsWith(`35%+5pt${en.week.cards.mention.label}`),
    ).toBe(true);
    expect(text(card, "[data-wb-foot='share']")).toBe(
      "Mentioned in 14 of 40 answers",
    );
    expect(text(card, "[data-wb-foot='since']")).toBe(
      "vs. the previous run (2026-09-05 11:00)",
    );
    expect(one(card, "a").getAttribute("href")).toBe(
      `/p/${PROJECT_ID}/visibility`,
    );
  });

  it("orders the mention footnote the zh way", () => {
    const scope = render(FULL, { locale: "zh-CN" });
    expect(
      text(scope, "[data-wb-week-card='mention'] [data-wb-foot='share']"),
    ).toBe("40 次问答里有 14 次提到你");
  });

  it("counts borderline queries and lists them without any rank movement (Q17)", () => {
    const scope = render(FULL);
    const card = one(scope, "[data-wb-week-card='borderline']");
    expect(
      card.textContent?.startsWith(`3${en.week.cards.borderline.label}`),
    ).toBe(true);
    expect(one(card, "a").getAttribute("href")).toBe(
      `/p/${PROJECT_ID}/keywords`,
    );
    const panel = one(scope, "[data-wb-week-borderline]");
    const rows = [...panel.querySelectorAll("[data-wb-borderline]")].map(
      (row) => row.textContent,
    );
    expect(rows).toEqual(["eleven11", "mid14.2", "thirty30"]);
    // A signed number not preceded by a digit: a band such as "11-30" is not a move.
    expect(panel.textContent).not.toMatch(/→|->|(?<!\d)[+\-−]\s*\d/u);
  });

  it("says a borderline list is unknown, not empty, when no row has a position", () => {
    const scope = render({
      ...FULL,
      gscRows: [{ ...gsc("x", 1), position: null }],
    });
    expect(
      text(scope, "[data-wb-week-card='borderline']").startsWith(UNKNOWN_TEXT),
    ).toBe(true);
    expect(
      text(scope, "[data-wb-week-borderline] [data-wb-borderline-unknown]"),
    ).toBe(UNKNOWN_TEXT);
    expect(one(scope, "[data-wb-week-borderline]").textContent).not.toContain(
      en.week.borderlineList.empty,
    );
  });

  it("prints the unknown summary counts as dashes, never as zero", () => {
    const scope = render(FULL);
    expect(text(scope, "[data-wb-summary='kbGaps']")).toBe(
      `Knowledge base entries still without a statement: ${UNKNOWN_TEXT}`,
    );
    expect(text(scope, "[data-wb-summary='artifacts']")).toBe(
      "1 artifact added in the last 7 days",
    );
    expect(text(scope, "[data-wb-summary='answerGaps']")).toBe(
      "26 prompts where at least one platform did not mention you",
    );
  });

  it("prints a known zero as zero and an unknown answer gap as a dash", () => {
    const kb = { at: "2026-09-10 16:00", entries: [] };
    const scope = render({ ...FULL, kb, lastVis: null, visHistory: [] });
    expect(text(scope, "[data-wb-summary='kbGaps']")).toBe(
      "0 knowledge base entries still without a statement",
    );
    expect(text(scope, "[data-wb-summary='answerGaps']")).toBe(
      `Prompts where at least one platform did not mention you: ${UNKNOWN_TEXT}`,
    );
  });

  it("lists this week's events newest first, each linking to its page", () => {
    const scope = render(FULL);
    const rows = [
      ...one(scope, "[data-wb-week-feed]").querySelectorAll("[data-wb-event]"),
    ];
    expect(rows.map((row) => row.querySelector("time")?.textContent)).toEqual([
      "2026-09-12 11:00",
      "2026-09-12 10:00",
      "2026-09-11 14:00",
    ]);
    expect(
      rows.map((row) => row.querySelector("a")?.getAttribute("href")),
    ).toEqual([
      `/p/${PROJECT_ID}/visibility`,
      `/p/${PROJECT_ID}/audit`,
      `/p/${PROJECT_ID}/artifacts`,
    ]);
    expect(rows[2]?.textContent).toContain("词库导出");
    expect(scope.textContent).not.toContain("旧产物");
  });

  it("points each next step at the page that does it", () => {
    const scope = render(FULL);
    const steps = [
      ...one(scope, "[data-wb-week-next]").querySelectorAll("[data-wb-step]"),
    ];
    expect(steps.map((step) => step.getAttribute("data-wb-step"))).toEqual([
      "fixHigh",
      "answerGaps",
      "borderline",
    ]);
    expect(
      steps.map((step) => step.querySelector("a")?.getAttribute("href")),
    ).toEqual([
      `/p/${PROJECT_ID}/audit`,
      `/p/${PROJECT_ID}/answers`,
      `/p/${PROJECT_ID}/keywords`,
    ]);
    expect(steps[0]?.textContent).toContain("1 high-severity issue");
  });

  it("marks framework copy and keeps it English in en (Q30)", () => {
    const scope = render(FULL);
    const frames = [...scope.querySelectorAll("[data-wb-frame]")];
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(
      frames
        .map((frame) => frame.textContent ?? "")
        .join("")
        .trim(),
    ).not.toBe("");
    for (const frame of frames) {
      expect(frame.textContent ?? "", frame.outerHTML).not.toMatch(HAN);
      expect(frame.textContent ?? "").not.toContain("workbench.");
    }
  });

  it("renders no inline style", () => {
    const scope = render(FULL);
    expect(scope.querySelector("[style]")).toBeNull();
  });
});

describe("WeekView weekly report", () => {
  it("saves one report with exactly one provenance declaration and no forbidden claim (en)", () => {
    const scope = render(FULL);
    act(() => button(scope, en.week.report.save).click());
    const saved = savedArtifact();
    expect(saved).toMatchObject({
      module: "week",
      type: "md",
      engine: "both",
      title: "Example weekly report",
      filename: "weekly.md",
      at: STAMP,
    });
    expect(provenanceDeclarationCount(saved.content)).toBe(1);
    expect(
      saved.content.startsWith(en.provenance.artifact.replace("{at}", STAMP)),
    ).toBe(true);
    expect(honestyViolations(bodyOf(saved.content))).toEqual([]);
    expect(
      bodyOf(saved.content).startsWith(
        "# Example 周报（2026-09-07 至 2026-09-13）",
      ),
    ).toBe(true);
    expect(saved.content).toContain("\n## 检查结果变化\n");
  });

  it("saves one report with exactly one provenance declaration (zh)", () => {
    const scope = render(FULL, { locale: "zh-CN" });
    act(() => button(scope, zh.week.report.save).click());
    const saved = savedArtifact();
    expect(saved.title).toBe("Example 周报");
    expect(provenanceDeclarationCount(saved.content)).toBe(1);
    expect(
      saved.content.startsWith(zh.provenance.artifact.replace("{at}", STAMP)),
    ).toBe(true);
    expect(honestyViolations(bodyOf(saved.content))).toEqual([]);
  });

  it("hands the actions one prepared report across re-renders with equal content", () => {
    render(FULL);
    must(rerender)({ ...FULL, artifacts: [...FULL.artifacts] });
    must(rerender)(structuredClone(FULL));
    expect(recorded.prepared.length).toBeGreaterThanOrEqual(3);
    expect(new Set(recorded.prepared).size).toBe(1);
  });

  it("prepares a new report once what it says changes", () => {
    render(FULL);
    const before = recorded.prepared.at(-1);
    must(rerender)({
      ...FULL,
      lastAudit: report("2026-09-12 10:00", 60, []),
    });
    expect(before).toBeDefined();
    expect(recorded.prepared.at(-1)).not.toBe(before);
  });

  it("takes the shared labels from the key table and lays the report's own two over them", () => {
    render(FULL);
    const labels = recorded.labels.at(-1) as Record<string, string>;
    expect(Object.keys(labels).sort()).toEqual(
      Object.keys(ARTIFACT_ACTION_LABEL_KEYS).sort(),
    );
    expect(labels.save).toBe(en.week.report.save);
    expect(labels.exportFile).toBe(en.week.report.export);
    expect(labels.copy).toBe(en.artifactActions.copy);
  });
});
