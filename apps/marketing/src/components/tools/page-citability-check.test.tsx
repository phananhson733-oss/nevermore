// @vitest-environment jsdom
// @input  -- reports built by the real rule set, and one report with a field missing
// @output -- proof a question made of common words is not reported as no question,
//            and that a report missing a field the page reads never renders
// @pos    -- the seam between the citability rules and the only client surface that shows them

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../i18n/messages/en.json";
import zhMessages from "../../i18n/messages/zh.json";
import type { CitabilityInput } from "../../lib/geo-tools/citability-contract.ts";
import { buildCitabilityReport } from "../../lib/geo-tools/citability-rules.ts";
import { measureCitabilityRender } from "../../lib/geo-tools/citability-render.ts";
import { PageCitabilityCheck } from "./page-citability-check.tsx";
import { TOOL_HANDOFF_KEY, TOOL_HANDOFF_TTL_MS, writeToolHandoff } from "../../lib/tools/tool-handoff.ts";
import { GEO_GAP_HANDOFF_KEY, writeGeoGapHandoff } from "../../lib/geo-tools/gap-handoff.ts";

const PAGE = `<!doctype html>
<html lang="en"><head><title>Issue trackers</title>
<link rel="canonical" href="https://citability.test/guide" /></head>
<body>
  <h1>Which issue tracker is best for a small agency</h1>
  <p>The best choice for teams of 5 to 20 people is Linear, because it is the
  fastest to file into. This paragraph exists to carry more than four hundred
  characters of visible copy so the server-rendering row has something real to
  measure rather than reporting a shell. It repeats the subject, states a
  conclusion, and gives a condition a reader can check themselves before they
  decide anything at all about the tools named here.</p>
  <table><tr><td>Linear</td><td>fast</td></tr><tr><td>Jira</td><td>slow</td></tr></table>
</body></html>`;

function input(targetQuestion: string | null): CitabilityInput {
  return {
    url: "https://citability.test/guide",
    finalUrl: "https://citability.test/guide",
    rawHtml: PAGE,
    bodyComplete: true,
    robots: { status: "absent", httpStatus: 404 },
    llmsTxt: { status: "absent", httpStatus: 404 },
    targetQuestion,
  };
}

/**
 * The bytes the endpoint would send, built by the rules the endpoint runs.
 *
 * Hand-written fixtures are how a page and its own report drift apart: the
 * measured key this suite is about is chosen inside `leadAnswerCheck`, and a
 * literal fixture would keep asserting whatever was pasted here.
 */
function report(targetQuestion: string | null): unknown {
  return buildCitabilityReport(input(targetQuestion), "2026-08-29T10:00:00.000Z");
}

function copy(path: string): string {
  let node: unknown = enMessages.tools.pageCitability;
  for (const part of path.split(".")) {
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") throw new Error(`no message at ${path}`);
  return node;
}

/** The longest run of literal words in a message, so a needle is never empty. */
function literal(path: string): string {
  const longest = copy(path)
    .split(/\{[^}]*\}/u)
    .map((part) => part.trim())
    .sort((a, b) => b.length - a.length)[0];
  if (longest === undefined || longest.length < 8) {
    throw new Error(`no usable literal in ${path}`);
  }
  return longest;
}

const originalFetch = globalThis.fetch;
let root: Root | null = null;
let container: HTMLElement | null = null;
let intlErrors: string[] = [];

function text(): string {
  return container?.textContent ?? "";
}

function answerWith(data: unknown): void {
  globalThis.fetch = vi.fn(async () =>
    Response.json({ data }),
  ) as unknown as typeof fetch;
}

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <NextIntlClientProvider
        locale="en"
        messages={{ tools: { pageCitability: enMessages.tools.pageCitability } }}
        onError={(error) => {
          intlErrors.push(error.message);
        }}
        timeZone="UTC"
      >
        <PageCitabilityCheck locale="en" />
      </NextIntlClientProvider>,
    );
  });
}

async function fill(url: string, question: string): Promise<void> {
  const fields = [...(container?.querySelectorAll("input") ?? [])];
  const setValue = (field: HTMLInputElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  };
  await act(async () => {
    if (fields[0]) setValue(fields[0], url);
    if (fields[1]) setValue(fields[1], question);
  });
}

async function run(url: string, question: string): Promise<void> {
  await fill(url, question);
  const button = [...(container?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent === copy("actions.run") || element.textContent === copy("actions.again"),
  );
  if (button === undefined) throw new Error("no run button rendered");
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

function viewButton(view: "input" | "result"): HTMLButtonElement {
  const button = container?.querySelector(`[data-testid="citability-view-${view}"]`);
  expect(button, `the ${view} view has a native button`).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
}

async function switchView(view: "input" | "result"): Promise<void> {
  await act(async () => { viewButton(view).click(); });
}

function metricValue(metric: "passed" | "failed" | "fetch-error" | "ratio"): string {
  const card = container?.querySelector(`[data-testid="citability-metric-${metric}"]`);
  expect(card, `the ${metric} summary card is rendered`).not.toBeNull();
  const value = card?.querySelector("dd");
  expect(value, `the ${metric} card exposes its measured value`).not.toBeNull();
  return value?.textContent ?? "";
}

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/tools/page-citability-check");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  intlErrors = [];
});

describe("one-time Content Draft handoff", () => {
  const payload = (query = "Which issue tracker is best for agencies?") => ({
    source: "content-draft" as const, destination: "page-citability-check" as const,
    scope: "query_page" as const, property: null, query,
    page: "https://citability.test/published", evidenceId: "a".repeat(64), marketCode: "US", languageCode: "en",
  });
  it("consumes the actual shared draft payload, prefills only URL/question and never auto-submits", async () => {
    expect(writeToolHandoff(sessionStorage, Date.now(), payload())).toBe(true);
    answerWith(report(payload().query));
    await mount();
    expect((container?.querySelector("#citability-url") as HTMLInputElement).value).toBe(payload().page);
    expect((container?.querySelector("#citability-question") as HTMLInputElement).value).toBe(payload().query);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const button = [...(container?.querySelectorAll("button") ?? [])].find((element) => element.textContent === copy("actions.run"));
    await act(async () => { button?.click(); });
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith("/api/tools/page-citability-check", expect.objectContaining({ body: JSON.stringify({ url: payload().page, question: payload().query }) }));
    expect(text()).toContain(copy("summary.title"));
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
  });
  it.each(["missing", "expired", "malformed"])("leaves the form empty for %s handoff and reads no alternate key", async (kind) => {
    if (kind === "expired") writeToolHandoff(sessionStorage, Date.now() - TOOL_HANDOFF_TTL_MS - 1, payload());
    if (kind === "malformed") sessionStorage.setItem(TOOL_HANDOFF_KEY, "{bad json");
    sessionStorage.setItem("unrelated-profile", "do not read");
    const reads = vi.spyOn(Storage.prototype, "getItem");
    answerWith(report(null));
    await mount();
    expect(reads.mock.calls.every(([key]) => key === TOOL_HANDOFF_KEY)).toBe(true);
    expect((container?.querySelector("#citability-url") as HTMLInputElement).value).toBe("");
    expect((container?.querySelector("#citability-question") as HTMLInputElement).value).toBe("");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(intlErrors).toEqual([]);
  });
  it("preserves a 512-character incoming question without truncation and waits for explicit run", async () => {
    const query = "q".repeat(512);
    expect(writeToolHandoff(sessionStorage, Date.now(), payload(query))).toBe(true);
    answerWith(report("short question"));
    await mount();
    expect((container?.querySelector("#citability-question") as HTMLInputElement).value).toBe(query);
    const button = [...(container?.querySelectorAll("button") ?? [])].find((element) => element.textContent === copy("actions.run"));
    expect(button?.disabled).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await act(async () => { button?.click(); });
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith("/api/tools/page-citability-check", expect.objectContaining({ body: JSON.stringify({ url: payload().page, question: query }) }));
    expect(intlErrors).toEqual([]);
  });
  it("disables an oversized 513-character form value until the visitor edits it", async () => {
    answerWith(report(null));
    await mount();
    await run(payload().page, "q".repeat(513));
    expect((container?.querySelector("#citability-question") as HTMLInputElement).value).toHaveLength(513);
    expect(container?.querySelector('[data-testid="citability-question-too-long"]')?.textContent).toContain("513");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await run(payload().page, "edited question");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
});

describe("explicit GEO gap handoff protocol", () => {
  const gap = { destination: "page-citability-check" as const, runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kbId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", snapshotId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", questionId: "question-1", gapId: "gap-question-1", pageUrl: "https://citability.test/gap", questionText: "GEO frozen question" };
  it("prefills exactly the B-gap URL/question on the explicit marker without auto-run", async () => {
    expect(writeGeoGapHandoff(sessionStorage, gap)).toBe(true);
    history.replaceState(null, "", "/tools/page-citability-check?handoff=geo-gap");
    const reads = vi.spyOn(Storage.prototype, "getItem");
    answerWith(report(gap.questionText));
    await mount();
    expect(reads.mock.calls).toEqual([[GEO_GAP_HANDOFF_KEY]]);
    expect((container?.querySelector("#citability-url") as HTMLInputElement).value).toBe(gap.pageUrl);
    expect((container?.querySelector("#citability-question") as HTMLInputElement).value).toBe(gap.questionText);
    expect(text()).toContain(copy("handoff.geoGap"));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const button = [...(container?.querySelectorAll("button") ?? [])].find((element) => element.textContent === copy("actions.run"));
    await act(async () => { button?.click(); });
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith("/api/tools/page-citability-check", expect.objectContaining({ body: JSON.stringify({ url: gap.pageUrl, question: gap.questionText }) }));
  });
  it.each(["missing", "malformed", "expired"])("does not fall back to an older draft when the selected gap is %s", async (kind) => {
    writeToolHandoff(sessionStorage, Date.now(), { source: "content-draft", destination: "page-citability-check", scope: "query_page", property: null, query: "stale draft", page: "https://citability.test/older", evidenceId: "a".repeat(64), marketCode: "US", languageCode: "en" });
    if (kind === "malformed") sessionStorage.setItem(GEO_GAP_HANDOFF_KEY, "{bad");
    if (kind === "expired") writeGeoGapHandoff(sessionStorage, gap, Date.now() - 21 * 60_000);
    history.replaceState(null, "", "/tools/page-citability-check?handoff=geo-gap");
    const reads = vi.spyOn(Storage.prototype, "getItem");
    answerWith(report(null));
    await mount();
    expect(reads.mock.calls).toEqual([[GEO_GAP_HANDOFF_KEY]]);
    expect((container?.querySelector("#citability-url") as HTMLInputElement).value).toBe("");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(["unknown", "geo-gap&handoff=unknown"])("reads no protocol for an ambiguous or unknown marker %s", async (marker) => {
    writeGeoGapHandoff(sessionStorage, gap);
    history.replaceState(null, "", `/tools/page-citability-check?handoff=${marker}`);
    const reads = vi.spyOn(Storage.prototype, "getItem");
    answerWith(report(null));
    await mount();
    expect(reads).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect((container?.querySelector("#citability-url") as HTMLInputElement).value).toBe("");
  });
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  document.body.replaceChildren();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("a target question the term extractor cannot use", () => {
  // "best", "which", "is" and "for" are all stop words, so the extractor
  // returns nothing. The rule reported that as `notAsked` - "No target
  // question was given" - to a visitor whose question is in the box above the
  // sentence.
  it("does not tell a visitor who asked a question that they asked none", async () => {
    answerWith(report("which is best?"));
    await mount();
    await run("https://citability.test/guide", "which is best?");

    expect(text()).toContain("which is best?");
    expect(text()).not.toContain(copy("details.leadAnswer.notAsked"));
    expect(text()).toContain(literal("details.leadAnswer.noComparableTerms"));
    expect(intlErrors).toEqual([]);
  });

  it("prints the question and says no term could be taken from it", async () => {
    answerWith(report("which is best?"));
    await mount();
    await run("https://citability.test/guide", "which is best?");

    expect(text()).toContain(literal("summary.question"));
    expect(text()).toContain(copy("summary.questionNoTerms"));
    expect(text()).not.toContain(literal("summary.questionTerms"));
    expect(intlErrors).toEqual([]);
  });

  // The other side of the split: a question with content words still names the
  // words it compared, and still says nothing about a question not being given.
  it("names the terms it compared when the question has content words", async () => {
    answerWith(report("best issue tracker for small agencies"));
    await mount();
    await run(
      "https://citability.test/guide",
      "best issue tracker for small agencies",
    );

    expect(text()).toContain(literal("summary.questionTerms"));
    expect(text()).toContain("tracker");
    expect(text()).not.toContain(copy("summary.questionNoTerms"));
    expect(text()).not.toContain(copy("details.leadAnswer.notAsked"));
    expect(intlErrors).toEqual([]);
  });

  // And with no question at all the original sentence is still the right one.
  it("still reports a genuinely absent question as not asked", async () => {
    answerWith(report(null));
    await mount();
    await run("https://citability.test/guide", "");

    expect(text()).toContain(copy("details.leadAnswer.notAsked"));
    expect(text()).not.toContain(literal("summary.question"));
    expect(intlErrors).toEqual([]);
  });
});

describe("a report shaped differently from the one this page reads", () => {
  // The guard exists for a rolling deploy serving an older shape to a tab that
  // already has the new bundle. It was checking five fields and the component
  // reads seven; the two it skipped are exactly the two with no fallback.
  it.each(["url", "textChars", "render", "rootCauses"])(
    "refuses a report with no %s instead of rendering it",
    async (field) => {
      const { [field]: _dropped, ...rest } = report("which crm is best") as Record<
        string,
        unknown
      >;
      answerWith(rest);
      await mount();
      await run("https://citability.test/guide", "which crm is best");

      expect(text()).toContain(copy("errors.internal_error"));
      expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBeNull();
      expect(viewButton("result").disabled).toBe(true);
      expect(text()).not.toContain(copy("limitsTitle"));
      expect(intlErrors).toEqual([]);
    },
  );

  it("renders the report when every field it reads is present", async () => {
    answerWith(report("which crm is best"));
    await mount();
    await run("https://citability.test/guide", "which crm is best");

    expect(text()).toContain(copy("summary.title"));
    expect(text()).not.toContain(copy("errors.internal_error"));
    expect(intlErrors).toEqual([]);
  });

  it.each(["missing", "non-numeric", "negative"])("rejects a %s failed count instead of inventing a summary metric", async (kind) => {
    const data = buildCitabilityReport(input(null), "2026-08-31T10:00:00.000Z");
    const { failed: _omitted, ...summary } = data.summary;
    answerWith({ ...data, summary: kind === "missing" ? summary : { ...summary, failed: kind === "negative" ? -1 : "unknown" } });
    await mount();
    await run(data.url, "");

    expect(container?.querySelector('[role="alert"]')?.textContent ?? "").toContain(copy("errors.internal_error"));
    expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBeNull();
    expect(container?.querySelector('[data-testid="citability-metric-failed"]')).toBeNull();
    expect(intlErrors).toEqual([]);
  });

  it.each([0.5, Number.MAX_SAFE_INTEGER + 1])("rejects an unsafe failed count of %s", async (failed) => {
    const data = buildCitabilityReport(input(null), "2026-08-31T10:00:00.000Z");
    answerWith({ ...data, summary: { ...data.summary, failed } });
    await mount();
    await run(data.url, "");

    expect(container?.querySelector('[role="alert"]')?.textContent ?? "").toContain(copy("errors.internal_error"));
    expect(viewButton("result").disabled).toBe(true);
    expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBeNull();
    expect(container?.querySelector('[data-testid="citability-metric-failed"]')).toBeNull();
    expect(intlErrors).toEqual([]);
  });

  it("rejects a negative measured ratio instead of displaying it as evidence", async () => {
    const source = input(null);
    const render = measureCitabilityRender({ url: source.finalUrl, rawHtml: source.rawHtml, bodyComplete: true }, PAGE);
    const data = buildCitabilityReport({ ...source, render }, "2026-08-31T10:00:00.000Z");
    answerWith({ ...data, render: { ...data.render, rawToRenderedRatio: -0.1 } });
    await mount();
    await run(data.url, "");

    expect(container?.querySelector('[role="alert"]')?.textContent ?? "").toContain(copy("errors.internal_error"));
    expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBeNull();
    expect(container?.querySelector('[data-testid="citability-metric-ratio"]')).toBeNull();
    expect(intlErrors).toEqual([]);
  });
});

describe("rendered evidence and root causes", () => {
  it("shows ClaudeBot as training advisory with ten counted rows", async () => {
    const source = input(null);
    answerWith(buildCitabilityReport({ ...source, robots: { status: "ok", text: "User-agent: ClaudeBot\nDisallow: /\n" } }, "2026-08-31T10:00:00.000Z"));
    await mount();
    await run(source.url, "");
    const row = container?.querySelector('[id="citability-rule-robots.claudebot"]');
    expect(row?.textContent).toContain("ClaudeBot (training)");
    expect(row?.textContent).toContain(copy("weights.advisory"));
    expect(row?.textContent).toContain("only if you intend");
    expect(text()).toContain("14 rows checked. 10 of them count");
    expect(intlErrors).toEqual([]);
  });
  it.each([enMessages, zhMessages])("states Claude training and unmeasured retrieval controls in each locale", (messages) => {
    const copy = messages.tools.pageCitability;
    expect(copy.rules.robots.claudebot).toMatch(/training|训练/u);
    expect(copy.summary.advisoryNote).toContain("ClaudeBot");
    expect(copy.faq.items[1]?.a).toContain("ClaudeBot");
    expect(copy.faq.items[1]?.a).toContain("Claude-SearchBot");
    expect(copy.limits.advisoryRows).toContain("Claude-SearchBot");
    expect(copy.limits.advisoryRows).toContain("Claude-User");
  });
  it("copies the same localized failure reason shown in the rule row", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("navigator", Object.create(navigator, { clipboard: { value: { writeText } } }));
    try {
      answerWith(report(null));
      await mount();
      await run("https://citability.test/guide", "");
      const button = [...(container?.querySelectorAll("button") ?? [])].find((element) => element.textContent === copy("actions.copy"));
      await act(async () => { button?.click(); });
      expect(writeText).toHaveBeenCalledOnce();
      expect(String(writeText.mock.calls[0]?.[0])).not.toContain("not_configured");
      expect(String(writeText.mock.calls[0]?.[0])).toContain(copy("render.reasons.not_configured"));
    } finally { vi.unstubAllGlobals(); }
  });
  it("shows both actual captures and shared-root rule links without dropping any check", async () => {
    const source = input(null);
    const rawHtml = '<body>raw<script src="/app.js"></script></body>';
    const render = measureCitabilityRender({ url: source.finalUrl, rawHtml, bodyComplete: true }, `<body>${"hydrated ".repeat(200)}</body>`, { now: () => new Date("2026-08-31T10:00:00.000Z") });
    answerWith(buildCitabilityReport({ ...source, rawHtml, render }, "2026-08-31T10:00:00.000Z"));
    await mount();
    await run(source.url, "");
    expect(container?.querySelector('[data-testid="citability-render-raw"]')?.textContent).toBe("raw");
    expect(container?.querySelector('[data-testid="citability-render-rendered"]')?.textContent).toContain("hydrated");
    expect(container?.querySelector('[data-testid="citability-root-causes"]')?.querySelector('a[href="#citability-rule-ssr"]')).not.toBeNull();
    expect(container?.querySelectorAll('[id^="citability-rule-"]')).toHaveLength(14);
    expect(intlErrors).toEqual([]);
  });
  it("shows unavailability without rendering a made-up capture or ratio", async () => {
    answerWith(report(null));
    await mount();
    await run("https://citability.test/guide", "");
    expect(container?.querySelector('[data-testid="citability-render-status"]')?.getAttribute("data-status")).toBe("unavailable");
    expect(container?.querySelector('[data-testid="citability-render-rendered"]')).toBeNull();
    expect(container?.querySelector('[data-testid="citability-render-ratio"]')).toBeNull();
    expect(intlErrors).toEqual([]);
  });
});

describe("Artifact input and result views", () => {
  it("starts on input with result disabled and no empty report", async () => {
    answerWith(report(null));
    await mount();

    expect(viewButton("input").getAttribute("aria-pressed")).toBe("true");
    expect(viewButton("result").getAttribute("aria-pressed")).toBe("false");
    expect(viewButton("result").disabled).toBe(true);
    expect(container?.querySelector('section[aria-labelledby="citability-form"]')).not.toBeNull();
    expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(intlErrors).toEqual([]);
  });

  it.each(["", "   "])("focuses the shared URL input without a request when native submission receives %j", async (url) => {
    answerWith(report(null));
    await mount();
    await fill(url, "question to preserve");
    const form = container?.querySelector("form");
    const urlInput = container?.querySelector("#citability-url") as HTMLInputElement;
    const questionInput = container?.querySelector("#citability-question") as HTMLInputElement;
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect(urlInput.getAttribute("data-slot")).toBe("input");
    questionInput.focus();

    await act(async () => { form?.requestSubmit(); });

    expect(document.activeElement).toBe(urlInput);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(questionInput.value).toBe("question to preserve");
    expect(viewButton("input").getAttribute("aria-pressed")).toBe("true");
    expect(viewButton("result").disabled).toBe(true);
    expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBeNull();
    expect(intlErrors).toEqual([]);
  });

  it("opens result on success and preserves the input on a request-free return", async () => {
    const url = "https://citability.test/guide";
    const question = "best issue tracker for small agencies";
    answerWith(report(question));
    await mount();
    await run(url, question);

    expect(viewButton("result").disabled).toBe(false);
    expect(viewButton("result").getAttribute("aria-pressed")).toBe("true");
    expect(viewButton("input").getAttribute("aria-pressed")).toBe("false");
    expect(container?.querySelector('section[aria-labelledby="citability-form"]')).toBeNull();
    expect(container?.querySelector('section[aria-labelledby="citability-result"]')).not.toBeNull();
    expect(document.activeElement?.id).toBe("citability-result");

    await switchView("input");
    expect(viewButton("input").getAttribute("aria-pressed")).toBe("true");
    expect((container?.querySelector("#citability-url") as HTMLInputElement).value).toBe(url);
    expect((container?.querySelector("#citability-question") as HTMLInputElement).value).toBe(question);
    expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(intlErrors).toEqual([]);
  });

  it("keeps the report and copied identity frozen when an unsubmitted draft changes", async () => {
    const question = "best issue tracker for small agencies";
    const source = input(question);
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("navigator", Object.create(navigator, { clipboard: { value: { writeText } } }));
    try {
      answerWith(buildCitabilityReport(source, "2026-08-31T10:00:00.000Z"));
      await mount();
      await run(source.url, question);
      await switchView("input");
      await fill("https://citability.test/unsubmitted", "unsubmitted pricing question");
      await switchView("result");

      expect(text()).toContain(source.finalUrl);
      expect(text()).toContain(question);
      expect(text()).not.toContain("https://citability.test/unsubmitted");
      expect(text()).not.toContain("unsubmitted pricing question");
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const button = [...(container?.querySelectorAll("button") ?? [])].find((element) => element.textContent === copy("actions.copy"));
      expect(button).toBeDefined();
      await act(async () => { button?.click(); });
      const copied = String(writeText.mock.calls[0]?.[0]);
      expect(copied).toContain(source.finalUrl);
      expect(copied).toContain(question);
      expect(copied).not.toContain("unsubmitted");
      expect(writeText).toHaveBeenCalledOnce();
      expect(intlErrors).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });

  it("shows a clipboard failure without replacing the frozen report", async () => {
    const source = input("best issue tracker for small agencies");
    const data = buildCitabilityReport(source, "2026-08-31T10:00:00.000Z");
    const writeText = vi.fn(async (_text: string) => { throw new DOMException("Clipboard permission denied", "NotAllowedError"); });
    vi.stubGlobal("navigator", Object.create(navigator, { clipboard: { value: { writeText } } }));
    try {
      answerWith(data);
      await mount();
      await run(source.url, source.targetQuestion ?? "");
      const result = container?.querySelector('section[aria-labelledby="citability-result"]');
      const button = [...(result?.querySelectorAll("button") ?? [])].find((element) => element.textContent === copy("actions.copy"));
      expect(button).toBeDefined();

      await act(async () => { button?.click(); });

      expect(button?.textContent).toBe(copy("actions.copyFailed"));
      expect(button?.disabled).toBe(false);
      expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBe(result);
      expect(viewButton("result").getAttribute("aria-pressed")).toBe("true");
      expect(result?.textContent).toContain(data.finalUrl);
      expect(result?.textContent).toContain(data.targetQuestion);
      expect(metricValue("passed")).toBe(String(data.summary.passed));
      expect(result?.querySelectorAll('[id^="citability-rule-"]')).toHaveLength(14);
      expect(writeText).toHaveBeenCalledOnce();
      expect(String(writeText.mock.calls[0]?.[0])).toContain(data.finalUrl);
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      expect(intlErrors).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });

  it("invalidates the previous report and disables repeat submission while a new run is pending", async () => {
    answerWith(report(null));
    await mount();
    await run("https://citability.test/guide", "");
    await switchView("input");

    let finish: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    globalThis.fetch = vi.fn(() => pending) as typeof fetch;
    await run("https://citability.test/new-page", "new page question");
    const button = [...(container?.querySelectorAll("button") ?? [])].find((element) => element.textContent === copy("actions.running"));
    expect(button?.disabled).toBe(true);
    expect(viewButton("result").disabled).toBe(true);
    expect(viewButton("input").getAttribute("aria-pressed")).toBe("true");
    expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBeNull();
    expect(container?.querySelector('[data-testid="citability-metric-passed"]')).toBeNull();
    await act(async () => { button?.click(); });
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    const source = { ...input("new page question"), url: "https://citability.test/new-page", finalUrl: "https://citability.test/new-page" };
    await act(async () => { finish(Response.json({ data: buildCitabilityReport(source, "2026-08-31T11:00:00.000Z") })); });
    expect(viewButton("result").getAttribute("aria-pressed")).toBe("true");
    expect(text()).toContain(source.finalUrl);
    expect(intlErrors).toEqual([]);
  });

  it("uses native form submission and accepts only one request while a run is pending", async () => {
    const source = input("best issue tracker for small agencies");
    let finish: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    globalThis.fetch = vi.fn(() => pending) as typeof fetch;
    await mount();
    await fill(source.url, source.targetQuestion ?? "");
    const form = container?.querySelector("form");
    const urlInput = container?.querySelector("#citability-url") as HTMLInputElement;
    const questionInput = container?.querySelector("#citability-question") as HTMLInputElement;
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect(urlInput.form).toBe(form);
    expect(questionInput.form).toBe(form);
    expect(form?.querySelector('button[type="submit"]')).not.toBeNull();

    // requestSubmit exercises the native submit path used by an Enter key.
    // jsdom does not perform a browser's implicit submission for key events.
    await act(async () => { form?.requestSubmit(); form?.requestSubmit(); });
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith("/api/tools/page-citability-check", expect.objectContaining({ body: JSON.stringify({ url: source.url, question: source.targetQuestion }) }));
    expect(urlInput.disabled).toBe(true);
    expect(questionInput.disabled).toBe(true);
    expect(viewButton("result").disabled).toBe(true);
    await act(async () => { form?.requestSubmit(); });
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    await act(async () => { finish(Response.json({ data: buildCitabilityReport(source, "2026-08-31T11:00:00.000Z") })); });
    expect(viewButton("result").getAttribute("aria-pressed")).toBe("true");
    expect(intlErrors).toEqual([]);
  });

  it.each(["http", "network", "shape"])("keeps an actionable input and no zero report after a %s failure", async (kind) => {
    if (kind === "http") {
      globalThis.fetch = vi.fn(async () => Response.json({ error: { code: "fetch_failed" } }, { status: 502 })) as typeof fetch;
    } else if (kind === "network") {
      globalThis.fetch = vi.fn(async () => { throw new TypeError("offline"); }) as typeof fetch;
    } else {
      const { render: _omitted, ...invalid } = buildCitabilityReport(input(null), "2026-08-31T10:00:00.000Z");
      answerWith(invalid);
    }
    await mount();
    await run("https://citability.test/guide", "question to retry");

    expect(viewButton("input").getAttribute("aria-pressed")).toBe("true");
    expect(viewButton("result").disabled).toBe(true);
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(copy(kind === "http" ? "errors.fetch_failed" : kind === "network" ? "errors.network" : "errors.internal_error"));
    expect((container?.querySelector("#citability-question") as HTMLInputElement).value).toBe("question to retry");
    expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBeNull();
    expect(container?.querySelector('[data-testid="citability-metric-passed"]')).toBeNull();
    expect(intlErrors).toEqual([]);
  });

  it("does not restore the previous report when a replacement run fails", async () => {
    answerWith(report(null));
    await mount();
    await run("https://citability.test/guide", "");
    await switchView("input");
    globalThis.fetch = vi.fn(async () => Response.json({ error: { code: "fetch_failed" } }, { status: 502 })) as typeof fetch;
    await run("https://citability.test/new-page", "new page question");

    expect(viewButton("input").getAttribute("aria-pressed")).toBe("true");
    expect(viewButton("result").disabled).toBe(true);
    expect(container?.querySelector('section[aria-labelledby="citability-result"]')).toBeNull();
    expect(container?.querySelectorAll('[id^="citability-rule-"]')).toHaveLength(0);
    expect((container?.querySelector("#citability-url") as HTMLInputElement).value).toBe("https://citability.test/new-page");
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(copy("errors.fetch_failed"));
    expect(intlErrors).toEqual([]);
  });

  it("does not consume another handoff when only the view changes", async () => {
    const payload = { source: "content-draft" as const, destination: "page-citability-check" as const, scope: "query_page" as const, property: null, query: "original frozen question", page: "https://citability.test/guide", evidenceId: "a".repeat(64), marketCode: "US", languageCode: "en" };
    expect(writeToolHandoff(sessionStorage, Date.now(), payload)).toBe(true);
    answerWith(report(payload.query));
    await mount();
    await run(payload.page, payload.query);
    expect(writeToolHandoff(sessionStorage, Date.now(), { ...payload, query: "later handoff" })).toBe(true);
    const laterHandoff = sessionStorage.getItem(TOOL_HANDOFF_KEY);

    await switchView("input");
    expect((container?.querySelector("#citability-question") as HTMLInputElement).value).toBe(payload.query);
    await switchView("result");
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBe(laterHandoff);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(intlErrors).toEqual([]);
  });
});

describe("existing Marketing visual language", () => {
  it("uses the shared website input and button primitives with neutral view selection", async () => {
    answerWith(report(null));
    await mount();
    for (const id of ["citability-url", "citability-question"]) {
      const field = container?.querySelector(`#${id}`);
      expect(field?.getAttribute("data-slot")).toBe("input");
      expect(field?.classList.contains("font-mono")).toBe(false);
    }
    expect(container?.querySelector('button[type="submit"]')?.getAttribute("data-slot")).toBe("button");
    expect(viewButton("input").classList.contains("bg-brand-accent")).toBe(false);
    expect(viewButton("input").classList.contains("text-brand-on-accent")).toBe(false);
  });

  it("reserves mono for data and small labels, not stage titles or evidence prose", async () => {
    answerWith(report(null));
    await mount();
    await run("https://citability.test/guide", "");
    for (const stage of container?.querySelectorAll('[data-testid^="citability-stage-"]') ?? []) {
      expect(stage.querySelector("h3")?.classList.contains("font-mono")).toBe(false);
      expect(stage.querySelector("h3")?.classList.contains("text-text-dark-primary")).toBe(true);
    }
    for (const row of container?.querySelectorAll('[id^="citability-rule-"]') ?? []) {
      expect(row.querySelector("p")?.classList.contains("font-mono")).toBe(false);
      expect(row.querySelector("p")?.classList.contains("text-[13px]")).toBe(true);
    }
    expect(container?.querySelector('[data-testid="citability-metric-passed"] dd')?.classList.contains("font-mono")).toBe(true);
  });
});

describe("Artifact report presentation from measured evidence", () => {
  it.each(["available", "unreachable"])("takes all count cards and the denominator from the actual %s report", async (kind) => {
    const source: CitabilityInput = kind === "available" ? input(null) : { ...input(null), robots: { status: "unreachable", httpStatus: 503 } };
    const data = buildCitabilityReport(source, "2026-08-31T10:00:00.000Z");
    answerWith(data);
    await mount();
    await run(source.url, "");

    expect(metricValue("passed")).toBe(String(data.summary.passed));
    expect(metricValue("failed")).toBe(String(data.summary.failed));
    expect(metricValue("fetch-error")).toBe(String(data.summary.fetchError));
    expect(data.summary.counted).toBe(data.summary.passed + data.summary.failed);
    expect(text()).toContain(copy("summary.counted").replace("{passed}", String(data.summary.passed)).replace("{counted}", String(data.summary.counted)));
    expect(text()).toContain("14 rows checked. 10 of them count");
    expect(intlErrors).toEqual([]);
  });

  it.each(["unavailable", "partial"])("renders a %s ratio as unknown, never as numeric zero", async (kind) => {
    const source = input(null);
    const data = kind === "unavailable"
      ? buildCitabilityReport(source, "2026-08-31T10:00:00.000Z")
      : buildCitabilityReport({ ...source, render: measureCitabilityRender({ url: source.finalUrl, rawHtml: source.rawHtml, bodyComplete: true }, PAGE, { renderedComplete: false }) }, "2026-08-31T10:00:00.000Z");
    expect(data.render.rawToRenderedRatio).toBeNull();
    answerWith(data);
    await mount();
    await run(source.url, "");

    expect(metricValue("ratio")).toMatch(/unknown/i);
    expect(metricValue("ratio")).not.toMatch(/^0(?:\.0+)?$/u);
    expect(container?.querySelector('[data-testid="citability-render-status"]')?.getAttribute("data-status")).toBe(kind);
    expect(intlErrors).toEqual([]);
  });

  it.each([0, 0.06])("renders a genuinely measured ratio of %s as a decimal", async (ratio) => {
    const source = input(null);
    const rawHtml = `<body>${"x".repeat(ratio * 100)}<script src="/app.js"></script></body>`;
    const render = measureCitabilityRender({ url: source.finalUrl, rawHtml, bodyComplete: true }, `<body>${"x".repeat(100)}</body>`, { now: () => new Date("2026-08-31T10:00:00.000Z") });
    expect(render.rawToRenderedRatio).toBe(ratio);
    answerWith(buildCitabilityReport({ ...source, rawHtml, render }, "2026-08-31T10:00:00.000Z"));
    await mount();
    await run(source.url, "");

    expect(Number(metricValue("ratio"))).toBe(ratio);
    expect(metricValue("ratio")).not.toContain("%");
    expect(intlErrors).toEqual([]);
  });

  it("keeps every rule in its stage with state, evidence, heuristic/advisory marks and supplied fixes", async () => {
    const data = buildCitabilityReport(input(null), "2026-08-31T10:00:00.000Z");
    answerWith(data);
    await mount();
    await run(data.url, "");

    expect(container?.querySelectorAll('[id^="citability-rule-"]')).toHaveLength(14);
    for (const section of ["readable", "extractable"] as const) {
      const stage = container?.querySelector(`[data-testid="citability-stage-${section}"]`);
      expect(stage).not.toBeNull();
      const checks = data.checks.filter((check) => check.section === section);
      expect(stage?.querySelectorAll('[id^="citability-rule-"]')).toHaveLength(checks.length);
      for (const check of checks) {
        const row = stage?.querySelector(`[id="citability-rule-${check.ruleId}"]`);
        expect(row?.textContent).toContain(copy(`states.${check.state}`));
        expect(row?.textContent).toContain(copy(`rules.${check.ruleId}`));
        expect(row?.textContent).toContain(literal(`details.${check.measured.key}`));
        if (check.kind === "heuristic") {
          expect(row?.textContent).toContain(copy("kinds.heuristic"));
          expect(row?.textContent).toContain(copy("kinds.heuristicNote"));
        }
        if (check.weight === "advisory") expect(row?.textContent).toContain(copy("weights.advisory"));
        if (check.fix) {
          expect(row?.textContent).toContain(`${copy("fixLabel")}:`);
          expect(row?.textContent).toContain(literal(`fixes.${check.fix.key}`));
        } else {
          expect(row?.textContent).not.toContain(`${copy("fixLabel")}:`);
        }
      }
    }
    expect(intlErrors).toEqual([]);
  });

  it("places actual root causes before the stages and keeps closed detailed evidence after both", async () => {
    const source = input(null);
    const rawHtml = '<body>raw<script src="/app.js"></script></body>';
    const render = measureCitabilityRender({ url: source.finalUrl, rawHtml, bodyComplete: true }, `<body>${"hydrated ".repeat(200)}</body>`, { now: () => new Date("2026-08-31T10:00:00.000Z") });
    const data = buildCitabilityReport({ ...source, rawHtml, render }, "2026-08-31T10:00:00.000Z");
    answerWith(data);
    await mount();
    await run(source.url, "");

    const causes = container?.querySelector('[data-testid="citability-root-causes"]');
    const readable = container?.querySelector('[data-testid="citability-stage-readable"]');
    const extractable = container?.querySelector('[data-testid="citability-stage-extractable"]');
    const evidence = container?.querySelector('[data-testid="citability-evidence"]');
    expect(evidence).toBeInstanceOf(HTMLDetailsElement);
    expect((evidence as HTMLDetailsElement).open).toBe(false);
    expect(readable).not.toBeNull();
    expect(extractable).not.toBeNull();
    expect((causes?.compareDocumentPosition(readable as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((readable?.compareDocumentPosition(extractable as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((extractable?.compareDocumentPosition(evidence as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const cause of data.rootCauses) {
      expect(causes?.textContent).toContain(copy(`causes.basis.${cause.basis}`));
      for (const id of cause.checkIds) expect(causes?.querySelector(`a[href="#citability-rule-${id}"]`)).not.toBeNull();
    }
    expect(evidence?.querySelector('[data-testid="citability-render-raw"]')?.textContent).toBe("raw");
    expect(evidence?.querySelector('[data-testid="citability-render-rendered"]')?.textContent).toContain("hydrated");
    expect(evidence?.textContent).toContain(copy("render.methods.html_projection"));
    expect(intlErrors).toEqual([]);
  });
});
