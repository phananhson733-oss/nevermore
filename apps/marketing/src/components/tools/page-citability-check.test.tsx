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

async function run(url: string, question: string): Promise<void> {
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
  const button = [...(container?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent === copy("actions.run"),
  );
  if (button === undefined) throw new Error("no run button rendered");
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
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
      expect(text()).not.toContain(copy("summary.title"));
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
