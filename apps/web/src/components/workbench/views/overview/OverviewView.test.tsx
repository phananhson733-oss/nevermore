/** @vitest-environment jsdom */

/**
 * The overview renders four numbers, and every one of them has a way to lie.
 * These tests pin the four states each card can be in (skeleton, never run,
 * run, sample) against the real store, so a count read from a different
 * producer than the sidebar's, a zero printed for "unknown", or a sample label
 * read from `state.demo` fails here rather than on a customer's screen.
 *
 * The real `WorkbenchProvider` is used everywhere except the skeleton case:
 * `ready === false` is a property of a render pass, not of settled DOM, so that
 * one case renders against a context value whose `ready` is fixed.
 *
 * Whole sentences are asserted as literals for the two swap-prone messages
 * (Step 5b): en and zh order `{hits}` / `{total}` differently, so the catalogue
 * test cannot see a swap, and building the expectation from the catalogue
 * would reproduce whatever order the component passed.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_LEVEL, DEMO_SEEDS } from "@/lib/workbench/mock/demo-constants";
import { makeDemoSite } from "@/lib/workbench/mock/demo";
import { testDeps } from "@/lib/workbench/mock/demo-test-fixtures";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import type { ProjectSeed } from "@/lib/workbench/store/reducer";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import {
  WorkbenchContext,
  WorkbenchProvider,
  type PublicWorkbenchAction,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import type { Artifact, AuditReport, Finding, GscRow, VisResult } from "@/lib/workbench/types";
import { OverviewView } from "./OverviewView.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type Locale = "en" | "zh-CN";
const MESSAGES = { en: getMessages("en"), "zh-CN": getMessages("zh-CN") } as const;
const EN = MESSAGES.en.workbench.overview;
const PID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = { url: "https://example.test", brand: "Example", market: "US" };
const HAN = /\p{Script=Han}/u;

interface Holder {
  current: WorkbenchContextValue | null;
}

function Probe({ holder }: { readonly holder: Holder }) {
  holder.current = useWorkbench();
  return null;
}

let cleanup: (() => void) | null = null;

interface Mounted {
  readonly scope: HTMLElement;
  readonly store: () => WorkbenchContextValue;
  readonly dispatch: (action: PublicWorkbenchAction) => void;
}

function mount(locale: Locale = "en", seed: ProjectSeed = SEED): Mounted {
  const holder: Holder = { current: null };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="UTC">
        <WorkbenchProvider projectId={PID} seed={seed}>
          <Probe holder={holder} />
          <OverviewView projectId={PID} />
        </WorkbenchProvider>
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  const store = (): WorkbenchContextValue => {
    if (holder.current === null) throw new Error("provider never rendered");
    return holder.current;
  };
  return {
    scope: container,
    store,
    dispatch: (action) => act(() => store().dispatch(action)),
  };
}

function mountWithContext(value: WorkbenchContextValue): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={MESSAGES.en} timeZone="UTC">
        <WorkbenchContext.Provider value={value}>
          <OverviewView projectId={PID} />
        </WorkbenchContext.Provider>
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

/** A metric card found by its label: the value span and the footnote, as rendered text. */
function card(scope: HTMLElement, label: string): { readonly value: string; readonly foot: string } {
  const labelNode = [...scope.querySelectorAll("p")].find((p) => p.textContent === label);
  const shell = labelNode?.parentElement;
  if (!shell) throw new Error(`no card labelled ${label}`);
  return {
    value: shell.firstElementChild?.firstElementChild?.textContent ?? "",
    foot: shell.lastElementChild?.textContent ?? "",
  };
}

function finding(id: string, sev: Finding["sev"]): Finding {
  return { id, cat: "tech", t: id, sev, eng: "seo", found: "", expect: "", fix: "", w: 1, page: "/" };
}

const REPORT: AuditReport = {
  at: "2026-09-13 10:00",
  score: 61,
  findings: [finding("f1", "high"), finding("f2", "mid")],
  crawl: { pages: 1, indexable: 1, blocked: 0, orphan: 0, lcp: "1.0", schema: 0, llmReadable: 0 },
  pageRows: [],
};

/** 3 hits of 7 answers: distinguishable, and "more mentions than answers" if swapped. */
const RESULTS: readonly VisResult[] = [
  ["what is geo", "ChatGPT", true],
  ["what is geo", "Perplexity", false],
  ["geo vs seo", "ChatGPT", true],
  ["geo vs seo", "Perplexity", false],
  ["best geo tool", "ChatGPT", true],
  ["best geo tool", "Perplexity", false],
  ["geo checklist", "ChatGPT", false],
].map(([p, platform, hit]) => ({
  p: String(p), platform: String(platform), hit: hit === true, rank: hit === true ? 1 : null,
  brands: [], domains: [], real: false as const,
}));

const GSC_ROWS: readonly GscRow[] = [
  { query: "example geo audit", clicks: 5, impressions: 120, ctr: 0.04, position: 14.2 },
];

const ARTIFACT: Artifact = {
  id: "a1", at: "2026-09-13 12:00", module: "audit", type: "md", engine: "seo", title: "Fix list", content: "x",
};

function runEverything(view: Mounted): void {
  view.dispatch({ type: "auditComplete", report: REPORT });
  view.dispatch({ type: "visComplete", results: RESULTS, at: "2026-09-13 11:00" });
  view.dispatch({ type: "setSeeds", seeds: "geo audit" });
  view.dispatch({ type: "setGscRows", rows: GSC_ROWS, source: "user" });
  view.dispatch({ type: "setBuilt", built: true });
  view.dispatch({ type: "addArtifact", artifact: ARTIFACT });
}

function loadSample(view: Mounted): void {
  const payload = makeDemoSite(view.store().state.profile, DEMO_LEVEL, [...DEMO_SEEDS], testDeps());
  view.dispatch({ type: "loadDemo", payload });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("OverviewView: skeleton before the store has read storage (Q10)", () => {
  it("renders the title and placeholders, and no value, dash, empty state or step", () => {
    const scope = mountWithContext({
      projectId: PID,
      state: populatedProjectState(SEED),
      dispatch: vi.fn(),
      ready: false,
      storageMode: "ok",
      keywordRows: [],
      keywordRowCount: 7,
      forgetProject: vi.fn(),
    });

    expect(scope.querySelector("h1[data-wb-page-title]")?.textContent).toBe(
      MESSAGES.en.workbench.nav.items.overview,
    );
    expect(scope.querySelector('[aria-busy="true"]')).not.toBeNull();
    // The fixture's audit score is 56, it has one artifact and a count of 7:
    // none of those may leak out of a skeleton, and neither may "—".
    expect(scope.textContent).not.toMatch(/\d/);
    expect(scope.textContent).not.toContain("—");
    expect(scope.textContent).not.toContain(EN.empty.title);
    expect(scope.textContent).not.toContain(EN.loadDemo.button);
    expect(scope.querySelector("[data-wb-next-step]")).toBeNull();
    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});

describe("OverviewView: hydrated, nothing run", () => {
  it("prints unknown as a dash and a real zero as 0", () => {
    const { scope } = mount();

    expect(card(scope, EN.cards.health.label)).toEqual({ value: "—", foot: EN.cards.unknown });
    expect(card(scope, EN.cards.mention.label)).toEqual({ value: "—", foot: EN.cards.unknown });
    expect(card(scope, EN.cards.keywords.label)).toEqual({ value: "—", foot: EN.cards.unknown });
    // No artifact is a measured fact about this browser, not an unknown.
    expect(card(scope, EN.cards.artifacts.label)).toEqual({ value: "0", foot: EN.cards.artifacts.foot });
  });

  it("shows the empty state with the sample loader, and no step list", () => {
    const { scope } = mount();

    expect(scope.textContent).toContain(EN.empty.title);
    expect(scope.textContent).toContain(EN.empty.detail);
    const button = [...scope.querySelectorAll("button")].find((b) => b.textContent === EN.loadDemo.button);
    expect(button).toBeDefined();
    expect(scope.querySelector("[data-wb-next-step]")).toBeNull();
  });

  it("points at the data sources page while no GSC row is imported", () => {
    const { scope } = mount();

    expect(scope.textContent).toContain(EN.noGsc.title);
    const cta = [...scope.querySelectorAll("a")].find((a) => a.textContent === EN.noGsc.cta);
    expect(cta?.getAttribute("href")).toBe(`/p/${PID}/data-sources`);
  });

  it("carries no inline style", () => {
    const { scope } = mount();
    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});

describe("OverviewView: after runs", () => {
  it("reads every card from the store's own producers", () => {
    const view = mount();
    runEverything(view);
    const { scope } = view;
    const { keywordRowCount, keywordRows } = view.store();
    const fromGsc = keywordRows.filter((row) => row.source === "gsc").length;

    expect(keywordRowCount).not.toBeNull();
    expect(fromGsc).toBe(1);
    expect(card(scope, EN.cards.health.label)).toEqual({ value: "61", foot: "2 issues to fix" });
    expect(card(scope, EN.cards.mention.label)).toEqual({ value: "43%", foot: "Mentioned in 3 of 7 answers" });
    const keywords = card(scope, EN.cards.keywords.label);
    // The sidebar's number (R15): the provider's count, not one recomputed here.
    expect(keywords.value).toBe(String(keywordRowCount));
    expect(keywords.foot).toContain("1 row from GSC");
    expect(card(scope, EN.cards.artifacts.label)).toEqual({ value: "1", foot: EN.cards.artifacts.foot });
  });

  it("lists the next steps as links to their pages and drops the empty state", () => {
    const view = mount();
    runEverything(view);
    const { scope } = view;

    expect(scope.textContent).not.toContain(EN.empty.title);
    const steps = [...scope.querySelectorAll("[data-wb-next-step]")];
    expect(steps.map((step) => step.getAttribute("data-wb-next-step"))).toEqual([
      "fixHigh",
      "answerGaps",
      "borderline",
    ]);
    const [fixHigh, answerGaps, borderline] = steps;
    expect(fixHigh?.textContent).toContain("Start with 1 high-severity issue");
    expect(fixHigh?.querySelector("a")?.getAttribute("href")).toBe(`/p/${PID}/audit`);
    expect(answerGaps?.textContent).toContain("Write answer pages for 4 gaps");
    expect(answerGaps?.querySelector("a")?.getAttribute("href")).toBe(`/p/${PID}/answers`);
    expect(borderline?.textContent).toContain("Work on 1 query sitting at positions 11-30");
    expect(borderline?.querySelector("a")?.getAttribute("href")).toBe(`/p/${PID}/keywords`);
    expect(scope.textContent).not.toContain(EN.noGsc.title);
    expect(scope.querySelectorAll("[style]")).toHaveLength(0);
  });
});

describe("OverviewView: sample site (Q6)", () => {
  it("labels the GSC footnote as sample data after loading the sample", () => {
    const view = mount();
    loadSample(view);

    const foot = card(view.scope, EN.cards.keywords.label).foot;
    expect(foot).toContain(EN.gscFoot.sample);
    expect(foot).not.toContain(EN.gscFoot.user);
    for (const label of [EN.cards.health.label, EN.cards.mention.label, EN.cards.keywords.label]) {
      expect(card(view.scope, label).value).not.toBe("—");
    }
    expect(view.scope.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("follows the rows, not the demo flag: user rows over a loaded sample are not labelled sample", () => {
    const view = mount();
    loadSample(view);
    view.dispatch({ type: "setGscRows", rows: GSC_ROWS, source: "user" });

    // The demo flag stays up (the topbar still offers "clear sample"), which is
    // exactly why the footnote must not read it.
    expect(view.store().state.demo).toBe(true);
    const foot = card(view.scope, EN.cards.keywords.label).foot;
    expect(foot).toContain(EN.gscFoot.user);
    expect(foot).not.toContain(EN.gscFoot.sample);
  });
});

describe("OverviewView: ICU argument order at the consumer (Step 5b)", () => {
  const seed: ProjectSeed = { url: "https://www.alpha-site.example/pricing", brand: "Bravo", market: "CH" };
  const cases = [
    {
      locale: "en",
      subtitle: "alpha-site.example (Bravo) · Target market CH",
      mentionFoot: "Mentioned in 3 of 7 answers",
    },
    {
      locale: "zh-CN",
      subtitle: "alpha-site.example（Bravo）· 目标市场 CH",
      mentionFoot: "7 次问答里有 3 次提到你",
    },
  ] as const;

  it.each(cases)("$locale renders the whole subtitle and mention footnote", ({ locale, subtitle, mentionFoot }) => {
    const view = mount(locale, seed);
    view.dispatch({ type: "visComplete", results: RESULTS, at: "2026-09-13 11:00" });
    const labels = MESSAGES[locale].workbench.overview.cards;

    const head = view.scope.querySelector("h1[data-wb-page-title]")?.closest(".mb-8");
    expect(head?.querySelector("p")?.textContent).toBe(subtitle);
    expect(card(view.scope, labels.mention.label).foot).toBe(mentionFoot);
  });
});

describe("OverviewView: frame and root (Q26 / Q30)", () => {
  it("is a padded, reset root of its own", () => {
    const { scope } = mount();
    const root = scope.querySelector(":scope > .wb-reset");
    expect(root).not.toBeNull();
    for (const token of ["mx-auto", "max-w-5xl", "p-6", "md:p-10"]) {
      expect(root?.classList.contains(token), token).toBe(true);
    }
  });

  it.each(["nothing run", "sample"] as const)(
    "en frame copy (%s) is non-empty and carries no Chinese and no key path",
    (state) => {
      const view = mount("en");
      if (state === "sample") loadSample(view);
      const frames = [...view.scope.querySelectorAll("[data-wb-frame]")];

      // Positive first: zero frames would make the two negatives below vacuous.
      expect(frames.length).toBeGreaterThanOrEqual(3);
      const text = frames.map((frame) => frame.textContent ?? "").join("\n");
      expect(text.trim()).not.toBe("");
      expect(text).not.toMatch(HAN);
      expect(text).not.toContain("workbench.");
    },
  );
});
