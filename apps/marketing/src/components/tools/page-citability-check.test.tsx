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
import type { CitabilityInput } from "../../lib/geo-tools/citability-contract.ts";
import { buildCitabilityReport } from "../../lib/geo-tools/citability-rules.ts";
import { PageCitabilityCheck } from "./page-citability-check.tsx";

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
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  intlErrors = [];
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
  it.each(["url", "textChars"])(
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
