// @vitest-environment jsdom
// @input  -- a visitor filling one page, its queries, and audit responses
// @output -- proof requests, focused redirect recovery, and measured answers stay truthful
// @pos    -- the seam between the frozen keyword contract and what a person sees

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildKeywordEvidence,
  normalizeTargetQueries,
  type SeoAuditTargetPageExtract,
} from "@sf/public-tools";
import {
  TOOL_HANDOFF_KEY,
  writeToolHandoff,
} from "../../lib/tools/tool-handoff.ts";

/**
 * The mock resolves against the real English catalogue.
 *
 * A mock that echoed the key made every render assertion here an assertion
 * about the mock: `not.toContain("score")` passed because no key contains the
 * word, not because the page publishes no score, and a key that did not exist
 * looked identical to one that did. Resolving the real messages means these
 * tests read the sentences that actually ship — and a missing key renders as its
 * dotted path, exactly as next-intl does in production.
 */
vi.mock("next-intl", async () => {
  const catalogue = (
    await import("../../i18n/messages/en.json", { with: { type: "json" } })
  ).default as unknown as Record<string, unknown>;

  return {
    useTranslations: (namespace: string) => {
      const translate = (key: string, values?: Record<string, unknown>) => {
        const path = `${namespace}.${key}`;
        const raw = path
          .split(".")
          .reduce<unknown>(
            (node, part) =>
              typeof node === "object" && node !== null
                ? (node as Record<string, unknown>)[part]
                : undefined,
            catalogue,
          );
        if (typeof raw !== "string") return path;
        if (values === undefined) return raw;
        return raw.replaceAll(
          /\{(\w+)\}/g,
          (_match: string, name: string) => String(values[name] ?? `{${name}}`),
        );
      };
      return translate;
    },
  };
});

import {
  SERP_LANGUAGES,
  SERP_LOCATIONS,
} from "../../lib/tools/serp-markets.ts";

const { OnPageChecker } = await import("./on-page-checker");

const extract: SeoAuditTargetPageExtract = {
  url: "https://acme.test/pricing",
  title: "Acme pricing and plans",
  metaDescription: "Compare Acme pricing.",
  h1: ["Pricing"],
  subHeadings: ["What each plan includes"],
  openingText: "Every Acme plan includes the pricing calculator.",
  staticBodyWords: 900,
  staticBodyUnits: null,
  termFrequencies: null,
  truncatedLists: false,
  headingLevels: null,
  wordsUnderEachH3: null,
  response: {
    status: 200,
    finalStatus: 200,
    redirectHops: 0,
    responseMs: 42,
    contentType: "text/html; charset=utf-8",
    canonicalTarget: null,
    robotsIndexable: true,
    robotsDirectives: [],
    sitemapMember: true,
    jsonLdTypes: [],
    jsonLdErrorCount: 0,
    internalOutlinks: 0,
    internalOutlinksWithoutAnchorText: 0,
  },
  declared: null,
};

/** Narrowed once: the result union does not carry `queries` until it is ok. */
function normalizedQueries(raw: readonly string[]) {
  const normalized = normalizeTargetQueries(raw);
  if (!normalized.ok) throw new Error(normalized.reason);
  return normalized.queries;
}

function evidenceFor(
  raw: readonly string[],
  pageRole: "homepage" | "product" | "tool" | "guide" = "product",
) {
  const normalized = normalizeTargetQueries(raw);
  if (!normalized.ok) throw new Error(normalized.reason);
  return buildKeywordEvidence(extract, normalized.queries, pageRole, true);
}

function auditResponse(
  queries: readonly string[],
  cache: "hit" | "miss" = "miss",
): Response {
  return Response.json(
    {
      data: {
        run: { source: { cache: { status: cache } } },
        result: {
          targetUrl: extract.url,
          scannedAt: "2026-08-17T12:00:00.000Z",
          targetInspected: true,
          inspectedTargetUrl: extract.url,
          coverage: {
            pagesInspected: 12,
            urlsSkipped: 0,
            urlsBlocked: 0,
            urlsErrored: 0,
          },
          targetPageExtract: extract,
          keywordEvidence: evidenceFor(queries),
        },
      },
    },
    { status: 200 },
  );
}

/**
 * The answer to a run that named no query.
 *
 * The API omits the keyword region entirely rather than sending it back
 * unavailable, and carries `siteResources` so the score can be built — which is
 * the point: everything except the keyword category still grades.
 */
function urlOnlyResponse(): Response {
  return Response.json(
    {
      data: {
        run: { source: { cache: { status: "miss" } } },
        result: {
          targetUrl: extract.url,
          scannedAt: "2026-08-17T12:00:00.000Z",
          targetInspected: true,
          inspectedTargetUrl: extract.url,
          coverage: {
            availability: "available",
            pagesInspected: 12,
            urlsSkipped: 0,
            urlsBlocked: 0,
            urlsErrored: 0,
          },
          targetPageExtract: extract,
          siteResources: {
            robotsFetched: true,
            robotsGroupsObserved: 3,
            sitemapReferencesObserved: 1,
            sitemapFetched: true,
            sitemapUrls: [],
            sitemapUrlsComplete: true,
          },
          records: [],
        },
      },
    },
    { status: 200 },
  );
}

/** The same answer, computed for a page the visitor declared as a guide. */
function guideResponse(queries: readonly string[]): Response {
  return Response.json(
    {
      data: {
        run: { source: { cache: { status: "miss" } } },
        result: {
          targetUrl: extract.url,
          scannedAt: "2026-08-17T12:00:00.000Z",
          targetInspected: true,
          inspectedTargetUrl: extract.url,
          coverage: {
            availability: "available",
            pagesInspected: 12,
            urlsSkipped: 0,
            urlsBlocked: 0,
            urlsErrored: 0,
          },
          targetPageExtract: extract,
          keywordEvidence: evidenceFor(queries, "guide"),
        },
      },
    },
    { status: 200 },
  );
}

let root: Root | null = null;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function render(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<OnPageChecker locale="en" />);
  });
  return host;
}

function field(host: HTMLElement, id: string): HTMLInputElement {
  const element = host.querySelector(`#${id}`);
  if (!element) throw new Error(`no field ${id}`);
  return element as HTMLInputElement;
}

/**
 * Set a controlled input the way React notices.
 *
 * Assigning `value` directly does not reach React's own value tracker, so the
 * component keeps the old state and the run never has its inputs.
 */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function select(
  host: HTMLElement,
  id: string,
  value: string,
): Promise<void> {
  const element = host.querySelector(`#${id}`) as HTMLSelectElement | null;
  if (!element) throw new Error(`no select ${id}`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function buttonWith(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((candidate) =>
    (candidate.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`no button for ${text}`);
  return found as HTMLButtonElement;
}

async function fillAndRun(
  host: HTMLElement,
  queries: readonly string[] = ["pricing"],
): Promise<void> {
  await type(field(host, "onpage-url"), "acme.test/pricing");
  await type(field(host, "onpage-query"), queries.join(", "));
  await act(async () => {
    buttonWith(host, "Check this page").click();
  });
}

describe("On-Page checker request", () => {
  it("sends the page, the queries, the role and the market to look up", async () => {
    const fetchMock = vi.fn(async () => auditResponse(["pricing", "plans"]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host, ["pricing", "plans"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/tools/on-page-seo-check");
    expect(JSON.parse(String(init.body))).toEqual({
      url: "acme.test/pricing",
      targetQueries: ["pricing", "plans"],
      pageRole: "homepage",
      // Read by the results-page lookup and by nothing else. They used to stop
      // at the form, which is why the copy beside them had to apologise.
      market: "US",
      language: "en",
    });
  });

  it("does not run until the visitor asks, and not without both inputs", async () => {
    const fetchMock = vi.fn(async () => auditResponse(["pricing"]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const host = await render();
    // Mounting alone must not spend four minutes of someone's crawl budget.
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      buttonWith(host, "Check this page").click();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Add the page URL you want checked.");

    // The URL is the only required input. A run with no query skips the one
    // category that reads it and publishes no overall score, which is a
    // choice — not a reason to refuse to run.
    await type(field(host, "onpage-url"), "acme.test/pricing");
    await act(async () => {
      buttonWith(host, "Check this page").click();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown[])[1] &&
        ((fetchMock.mock.calls[0] as unknown[])[1] as { body: string }).body),
    ) as Record<string, unknown>;
    // Omitted, not sent empty: the request normaliser rejects an empty list
    // outright, so `[]` would have failed the whole request as invalid.
    expect("targetQueries" in body).toBe(false);
  });

  it("submits exactly the queries the comma-separated line spells out", async () => {
    const fetchMock = vi.fn(async () =>
      auditResponse(["astrology", "birth chart"]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const host = await render();
    await type(field(host, "onpage-url"), "acme.test/pricing");
    await type(field(host, "onpage-query"), " astrology ,  birth chart ");
    await act(async () => {
      buttonWith(host, "Check this page").click();
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      readonly targetQueries: readonly string[];
    };
    // The separator is a parser the visitor cannot watch run, so what it
    // produced has to be what the request carries.
    expect(body.targetQueries).toEqual(["astrology", "birth chart"]);
  });

  it("shows the parsed list, because a separator can be read wrong", async () => {
    const host = await render();
    await type(field(host, "onpage-query"), "占星，星盘");

    // The full-width comma is what this audience's keyboard produces. Taking
    // the pair as one query reported it absent from a page covering both.
    const parsed = [
      ...(host.querySelector("#onpage-query-parsed")?.children ?? []),
    ].map((node) => node.textContent);
    expect(parsed).toEqual(["占星", "星盘"]);
  });

  it("names what it dropped past the cap rather than dropping it quietly", async () => {
    const host = await render();
    await type(field(host, "onpage-query"), "a, b, c, d, e, f, g");

    expect(host.textContent).toContain(
      "Up to 5 queries; the 2 past that were not submitted.",
    );
    expect(
      host.querySelector("#onpage-query-parsed")?.children,
    ).toHaveLength(5);
  });

  it("says a repeat was folded instead of asking the same thing twice", async () => {
    const host = await render();
    await type(field(host, "onpage-query"), "pricing, Pricing");

    expect(host.textContent).toContain("Folded 1 repeat(s)");
    expect(
      host.querySelector("#onpage-query-parsed")?.children,
    ).toHaveLength(1);
  });

  it("offers markets and languages the paid lookup already accepts", async () => {
    const host = await render();
    const market = host.querySelector("#onpage-country") as HTMLSelectElement;
    const language = host.querySelector("#onpage-language") as HTMLSelectElement;

    // Both were free-text boxes. The lookup is billed per call and its provider
    // rejects an unknown code only after billing, so a typo bought an error.
    expect(market.tagName).toBe("SELECT");
    expect(language.tagName).toBe("SELECT");
    expect(market.value).toBe("US");
    expect(language.value).toBe("en");

    const offered = [...market.options].map((option) => option.value);
    expect(offered).toEqual(Object.keys(SERP_LOCATIONS));
    for (const option of language.options) {
      expect(SERP_LANGUAGES.has(option.value), option.value).toBe(true);
    }
  });
});

describe("On-Page checker redirected targets", () => {
  it("explains the redirect and offers the validated destination without following it", async () => {
    const target = "https://www.acme.test/home";
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: "target_redirected" } },
        { status: 422, headers: { Location: target } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const host = await render();
    await type(field(host, "onpage-url"), "https://acme.test/old");
    await type(field(host, "onpage-query"), "pricing, plans");
    await select(host, "onpage-country", "GB");
    await select(host, "onpage-language", "en");
    await select(host, "onpage-role", "guide");
    await act(async () => {
      buttonWith(host, "Check this page").click();
    });

    expect(host.textContent).toContain(
      "This URL resolves to a different page. The submitted page was not scored.",
    );
    expect(host.textContent).not.toContain("The audit could not be completed.");
    expect(host.textContent).toContain("Resolved destination");
    const link = host.querySelector<HTMLAnchorElement>(`a[href="${target}"]`);
    expect(link?.textContent).toBe(target);
    expect(link?.target).toBe("_blank");
    expect(link?.rel.split(/\s+/).sort()).toEqual(["noopener", "noreferrer"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      buttonWith(host, "Use destination URL").click();
    });

    expect(field(host, "onpage-url").value).toBe(target);
    expect(document.activeElement).toBe(field(host, "onpage-url"));
    expect(field(host, "onpage-query").value).toBe("pricing, plans");
    expect(field(host, "onpage-country").value).toBe("GB");
    expect(field(host, "onpage-language").value).toBe("en");
    expect(field(host, "onpage-role").value).toBe("guide");
    expect(host.textContent).toContain(
      "Nothing yet. Add a page URL to run; a target query is optional.",
    );
    expect(host.textContent).not.toContain(
      "This URL resolves to a different page.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the specific redirect error but hides an unsafe Location", async () => {
    const unsafe = "https://evil.test/steal";
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: "target_redirected" } },
        { status: 422, headers: { Location: unsafe } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    expect(host.textContent).toContain(
      "This URL resolves to a different page. The submitted page was not scored.",
    );
    expect(host.textContent).not.toContain("The audit could not be completed.");
    expect(host.textContent).not.toContain(unsafe);
    expect(host.querySelector(`a[href="${unsafe}"]`)).toBeNull();
    expect([...host.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Use destination URL"),
    )).toBe(false);
    expect(field(host, "onpage-url").value).toBe("acme.test/pricing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never reads Location as a redirect target for an ordinary failure", async () => {
    const target = "https://www.acme.test/home";
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: "scan_failed" } },
        { status: 502, headers: { Location: target } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    expect(host.textContent).toContain(
      "The public site could not be audited from this environment.",
    );
    expect(host.textContent).not.toContain(target);
    expect(host.querySelector(`a[href="${target}"]`)).toBeNull();
    expect([...host.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Use destination URL"),
    )).toBe(false);
    expect(field(host, "onpage-url").value).toBe("acme.test/pricing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("On-Page checker result", () => {
  it("refuses to downgrade a rejected query into a query-free run", async () => {
    // The visitor typed a keyword. Every rule threw it out, `queries` came
    // back empty, and submitting anyway ran URL-only and reported that no
    // target query was submitted — which is not what they did.
    const fetchMock = vi.fn(async () => urlOnlyResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const host = await render();
    await type(field(host, "onpage-url"), "acme.test/pricing");
    await type(field(host, "onpage-query"), "x".repeat(200));
    await act(async () => {
      buttonWith(host, "Check this page").click();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("None of those queries could be submitted");
  });

  it("says the crawl never reached the page instead of calling it a clean run", async () => {
    // With no query there is no keyword region to carry the reason, so a page
    // the crawl never collected used to arrive looking like a successful
    // URL-only check: no notice, a "Page read" line, and a history row.
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        {
          data: {
            run: { source: { cache: { status: "miss" } } },
            result: {
              targetUrl: extract.url,
              scannedAt: "2026-08-17T12:00:00.000Z",
              targetInspected: false,
              coverage: { availability: "available", pagesInspected: 12 },
              targetPageExtract: null,
              records: [],
            },
          },
        },
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const host = await render();
    await type(field(host, "onpage-url"), "acme.test/pricing");
    await act(async () => {
      buttonWith(host, "Check this page").click();
    });
    const text = host.textContent ?? "";

    expect(text).toContain("did not collect this page as a readable HTML");
    expect(text).toContain("This is not a score of zero");
    // Never "Page read" about a page that was not.
    expect(text).not.toContain("Page read:");
    // And not remembered: the list is checks that produced something.
    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBeNull();
  });

  it("renders a query-free run instead of failing it", async () => {
    // A response with no keyword region used to be read as the API
    // contradicting itself and became a `scan_failed` screen. It is now what a
    // URL-only run looks like, and every category except keyword still grades.
    globalThis.fetch = vi.fn(
      async () => urlOnlyResponse(),
    ) as unknown as typeof fetch;

    const host = await render();
    await type(field(host, "onpage-url"), "acme.test/pricing");
    await act(async () => {
      buttonWith(host, "Check this page").click();
    });
    const text = host.textContent ?? "";

    expect(text).not.toContain("could not be completed");
    // The absence is said in the visitor's words, and it is a different
    // sentence from a query that was named and could not be compared.
    expect(text).toContain("No target query was submitted");
    expect(text).not.toContain("No keyword evidence was measured");
    // Rendered, not merely computed: the score card is the surface a reader
    // sees, and an engine that returns null while a card prints a number is
    // the failure this asserts against.
    expect(text).toContain("Not scored");
    // The number itself, not just the absence of an "N/100" shape: a zero in
    // this slot reads as a verdict, and "Not scored" beside it does not undo
    // the digit a reader has already taken in.
    expect(
      host.querySelector("[data-onpage-score]")?.textContent?.trim(),
    ).toBe("—");
    // And why, beside where the number would have been — with the fact that
    // the subtotals below it are complete for the categories that did run.
    expect(
      host.querySelector("[data-onpage-unscored]")?.textContent,
    ).toContain("keyword placement was not tested");
    // The disclaimer qualifies a number; there is none to qualify.
    expect(text).not.toContain("The weights behind the number are ours");
    expect(text).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
    // And the checks it could run are on screen, which is the whole point of
    // letting the run happen at all.
    expect(text.toLowerCase()).toContain("technical");
    // Recorded in the list too. This flow is somebody checking several pages
    // handed over from a briefing; a history that stayed empty through all of
    // them would read as none of them having run.
    const stored = JSON.parse(
      String(localStorage.getItem("gengrowth:onpage-history:v1")),
    ) as readonly { readonly focus: unknown; readonly score: unknown }[];
    expect(stored).toHaveLength(1);
    // With no coverage figure and no score, rather than a zero for either.
    expect(stored[0]?.focus).toBeNull();
    expect(stored[0]?.score).toBeNull();
  });

  it("renders coverage, density and every limitation", async () => {
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    const text = host.textContent ?? "";
    // Covered in the title, and said so rather than scored.
    expect(text).toContain("yes (1)");
    expect(text).toMatch(/Covered \d+ of \d+ checkable places/);
    expect(text).toContain("A count of places, not a score");
    // The density names the unit it counted, not just a percentage.
    expect(text).toMatch(/% of \d+ collected words/);
    /**
     * No score is published anywhere. Asserting the absence of the word "score"
     * cannot express that — the copy has to use the word to deny one — so the
     * rule is about the shapes a score takes.
     */
    expect(text).not.toMatch(/\b\d{1,3}\s*(?:\/|out of)\s*100\b/);
    // Read from the results region, not the whole page: the form's own hint
    // has to use the words to say a URL-only run gets no overall score, and a
    // denial is the opposite of the claim this guards against.
    const results =
      host
        .querySelector('[aria-labelledby="onpage-stage-evidence"]')
        ?.textContent?.toLowerCase() ?? "";
    expect(results).not.toBe("");
    expect(results).not.toContain("overall score");
    expect(results).not.toContain("your score");
  });

  it("shows an absent field as not applicable rather than as a zero", async () => {
    const withoutDescription = { ...extract, metaDescription: null };
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        data: {
          run: { source: { cache: { status: "miss" } } },
          result: {
            targetUrl: extract.url,
            scannedAt: "2026-08-17T12:00:00.000Z",
            targetInspected: true,
            inspectedTargetUrl: extract.url,
            coverage: {},
            targetPageExtract: withoutDescription,
            keywordEvidence: (() => {
              const normalized = normalizeTargetQueries(["pricing"]);
              if (!normalized.ok) throw new Error(normalized.reason);
              return buildKeywordEvidence(
                withoutDescription,
                normalized.queries,
                "homepage",
                true,
              );
            })(),
          },
        },
      }),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    expect(host.textContent).toContain("n/a");
  });

  it("names why an unavailable region is unavailable and that it is not zero", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        data: {
          run: { source: { cache: { status: "miss" } } },
          result: {
            targetUrl: extract.url,
            scannedAt: "2026-08-17T12:00:00.000Z",
            targetInspected: false,
            inspectedTargetUrl: null,
            coverage: {},
            targetPageExtract: null,
            keywordEvidence: (() => {
              const normalized = normalizeTargetQueries(["pricing"]);
              if (!normalized.ok) throw new Error(normalized.reason);
              return buildKeywordEvidence(null, normalized.queries, null, false);
            })(),
          },
        },
      }),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    expect(host.textContent).toContain(
      "did not collect this page as a readable HTML response",
    );
    expect(host.textContent).toContain("This is not a score of zero");
  });
});

describe("On-Page checker local state", () => {
  const handoffNotice =
    "Imported from another tool. This page has not been checked again yet.";

  function stageDailyBriefingHandoff(): void {
    expect(
      writeToolHandoff(sessionStorage, Date.now(), {
        source: "daily-search-briefing",
        destination: "on-page-seo-check",
        scope: "query_page",
        property: "sc-domain:example.com",
        query: "pricing automation",
        page: "https://example.com/pricing",
        evidenceId: "first-observed:pricing-automation",
      }),
    ).toBe(true);
  }

  function stageCompetitorGapHandoff(
    marketCode = "GB",
    languageCode = "zh",
  ): void {
    expect(
      writeToolHandoff(sessionStorage, Date.now(), {
        source: "competitor-keyword-gap",
        destination: "on-page-seo-check",
        scope: "query_page",
        property: "sc-domain:example.com",
        query: "pricing automation",
        page: "https://example.com/pricing",
        evidenceId: "gap:pricing-automation:observed-sufficient",
        marketCode,
        languageCode,
      }),
    ).toBe(true);
  }

  it("imports one gap page/query and its supported market context without running or URL leakage", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    stageCompetitorGapHandoff();
    const beforeUrl = window.location.href;

    const host = await render();

    expect(field(host, "onpage-url").value).toBe("https://example.com/pricing");
    expect(field(host, "onpage-query").value).toBe("pricing automation");
    expect(
      (host.querySelector("#onpage-country") as HTMLSelectElement).value,
    ).toBe("GB");
    expect(
      (host.querySelector("#onpage-language") as HTMLSelectElement).value,
    ).toBe("zh");
    expect(host.textContent).toContain(handoffNotice);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(window.location.href).toBe(beforeUrl);
    expect(window.location.href).not.toContain("pricing automation");
    expect(window.location.href).not.toContain("sc-domain%3Aexample.com");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("consumes a gap handoff and falls back when its shaped market context is unsupported", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    stageCompetitorGapHandoff("ZZ", "zz");

    const host = await render();

    expect(field(host, "onpage-url").value).toBe("https://example.com/pricing");
    expect(field(host, "onpage-query").value).toBe("pricing automation");
    expect(
      (host.querySelector("#onpage-country") as HTMLSelectElement).value,
    ).toBe("US");
    expect(
      (host.querySelector("#onpage-language") as HTMLSelectElement).value,
    ).toBe("en");
    expect(host.textContent).toContain(handoffNotice);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects a crafted property-scoped handoff without filling or running", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const now = Date.now();
    sessionStorage.setItem(
      TOOL_HANDOFF_KEY,
      JSON.stringify({
        source: "daily-search-briefing",
        destination: "on-page-seo-check",
        scope: "property",
        property: "sc-domain:example.com",
        query: null,
        page: null,
        evidenceId: "sitewide-click-decline",
        createdAt: now,
        expiresAt: now + 600_000,
      }),
    );

    const host = await render();

    expect(field(host, "onpage-url").value).toBe("");
    expect(field(host, "onpage-query").value).toBe("");
    expect(host.textContent).not.toContain(handoffNotice);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("prefers the one-time briefing inputs to an older draft without running or clearing history", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const now = Date.now();
    sessionStorage.setItem(
      "gengrowth:onpage-draft:v1",
      JSON.stringify({
        url: "https://old.example/draft",
        targetQueries: ["old query"],
        country: "GB",
        locale: "en",
        pageType: "guide",
        createdAt: now,
        expiresAt: now + 600_000,
      }),
    );
    localStorage.setItem("gengrowth:onpage-history:v1", "[]");
    stageDailyBriefingHandoff();

    const host = await render();

    expect(field(host, "onpage-url").value).toBe("https://example.com/pricing");
    expect(field(host, "onpage-query").value).toBe("pricing automation");
    expect(host.textContent).toContain(handoffNotice);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(sessionStorage.getItem("gengrowth:onpage-draft:v1")).toBeNull();
    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBe("[]");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  function stagePageScopeHandoff(): void {
    expect(
      writeToolHandoff(sessionStorage, Date.now(), {
        source: "daily-search-briefing",
        destination: "on-page-seo-check",
        scope: "page",
        property: "sc-domain:example.com",
        // A page signal carries no query: the queries behind it are
        // anonymized and the briefing will not invent one.
        query: null,
        page: "https://example.com/wiki/vanished",
        evidenceId: "daily:page:page_first_observed",
      }),
    ).toBe(true);
  }

  it("prefers a page-scope handoff to an older draft and leaves the query empty", async () => {
    // The page-scope branch used to be its own `if`, so it set the URL and
    // then fell into the draft branch of the next statement, which put the
    // draft's URL and query back while the banner still said a page had been
    // imported. Every page-scope handoff — the two page lanes and the
    // zero-click checks — reached the tool this way.
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const now = Date.now();
    sessionStorage.setItem(
      "gengrowth:onpage-draft:v1",
      JSON.stringify({
        url: "https://old.example/draft",
        targetQueries: ["old query"],
        country: "GB",
        locale: "en",
        pageType: "guide",
        createdAt: now,
        expiresAt: now + 600_000,
      }),
    );
    sessionStorage.setItem(
      "gengrowth:agent-intent:seo:v3",
      JSON.stringify({
        agent: "seo",
        purpose: "page_focused_launch",
        url: "https://old.example/draft",
        scope: "page",
        createdAt: now,
        expiresAt: now + 600_000,
      }),
    );
    stagePageScopeHandoff();

    const host = await render();

    expect(field(host, "onpage-url").value).toBe(
      "https://example.com/wiki/vanished",
    );
    expect(field(host, "onpage-query").value).toBe("");
    expect(host.textContent).toContain(handoffNotice);
    expect(sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    expect(sessionStorage.getItem("gengrowth:onpage-draft:v1")).toBeNull();
    // The draft and its intent are written together, so leaving the intent
    // behind would let the Agent resurrect the URL this handoff replaced.
    expect(sessionStorage.getItem("gengrowth:agent-intent:seo:v3")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("replaces an older page-focused draft and intent as one pair while preserving history", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const now = Date.now();
    sessionStorage.setItem(
      "gengrowth:onpage-draft:v1",
      JSON.stringify({
        url: "https://old.example/draft",
        targetQueries: ["old query"],
        country: "GB",
        locale: "en",
        pageType: "guide",
        createdAt: now,
        expiresAt: now + 600_000,
      }),
    );
    sessionStorage.setItem(
      "gengrowth:agent-intent:seo:v3",
      JSON.stringify({
        agent: "seo",
        purpose: "page_focused_launch",
        url: "https://old.example/draft",
        scope: "page",
        createdAt: now,
        expiresAt: now + 600_000,
      }),
    );
    localStorage.setItem("gengrowth:onpage-history:v1", "[]");
    stageDailyBriefingHandoff();

    const host = await render();

    expect(field(host, "onpage-url").value).toBe("https://example.com/pricing");
    expect(sessionStorage.getItem("gengrowth:onpage-draft:v1")).toBeNull();
    expect(
      sessionStorage.getItem("gengrowth:agent-intent:seo:v3"),
    ).toBeNull();
    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBe("[]");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(["url", "query"] as const)(
    "clears the briefing notice when the visitor changes the imported %s",
    async (input) => {
      globalThis.fetch = vi.fn() as unknown as typeof fetch;
      stageDailyBriefingHandoff();
      const host = await render();
      expect(host.textContent).toContain(handoffNotice);

      await type(
        field(host, input === "url" ? "onpage-url" : "onpage-query"),
        input === "url" ? "https://example.com/changed" : "changed query",
      );

      expect(host.textContent).not.toContain(handoffNotice);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["market", "onpage-country", "GB"],
    ["language", "onpage-language", "zh"],
    ["page role", "onpage-role", "guide"],
  ] as const)(
    "clears the briefing notice when the visitor changes the imported %s",
    async (_field, id, value) => {
      globalThis.fetch = vi.fn() as unknown as typeof fetch;
      stageDailyBriefingHandoff();
      const host = await render();
      expect(host.textContent).toContain(handoffNotice);

      await select(host, id, value);

      expect(host.textContent).not.toContain(handoffNotice);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it("clears the briefing notice when a check actually starts", async () => {
    let finishRequest!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishRequest = resolve;
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    stageDailyBriefingHandoff();
    const host = await render();
    expect(host.textContent).toContain(handoffNotice);

    await act(async () => {
      buttonWith(host, "Check this page").click();
    });

    expect(host.textContent).not.toContain(handoffNotice);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRequest(
        Response.json(
          { error: { code: "scan_failed" } },
          { status: 502 },
        ),
      );
      await Promise.resolve();
    });
  });

  it("keeps the ordinary form usable when Web Storage methods throw", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const host = await render();

    expect(field(host, "onpage-url").value).toBe("");
    expect(field(host, "onpage-query").value).toBe("");
    expect(host.textContent).not.toContain(handoffNotice);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("remembers a finished check and nothing else", async () => {
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;

    const host = await render();
    expect(host.textContent).toContain("No checks yet.");

    await fillAndRun(host);

    const stored = localStorage.getItem("gengrowth:onpage-history:v1");
    expect(stored).not.toBeNull();
    expect(JSON.parse(String(stored))).toHaveLength(1);
    expect(host.textContent).toContain("Kept in this browser only");
  });

  it("does not remember a run that failed", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: { code: "scan_failed" } }, { status: 502 }),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    // The shared account of this failure, not a second one written here.
    expect(host.textContent).toContain(
      "The public site could not be audited from this environment.",
    );
    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBeNull();
  });

  it("does not remember a run that measured nothing", async () => {
    // A 200 whose region is unavailable is a finished request that measured
    // nothing. Remembering it would put a 0-of-0 row in the list, which reads
    // as a page with no coverage rather than a page that was never read.
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        data: {
          run: { source: { cache: { status: "miss" } } },
          result: {
            targetUrl: extract.url,
            scannedAt: "2026-08-17T12:00:00.000Z",
            targetInspected: false,
            inspectedTargetUrl: null,
            coverage: {},
            targetPageExtract: null,
            keywordEvidence: (() => {
              const normalized = normalizeTargetQueries(["pricing"]);
              if (!normalized.ok) throw new Error(normalized.reason);
              return buildKeywordEvidence(null, normalized.queries, null, false);
            })(),
          },
        },
      }),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    expect(host.textContent).toContain(
      "did not collect this page as a readable HTML response",
    );
    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBeNull();
  });

  it("keeps what was typed when sign-in interrupts, without running", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: { code: "auth_required" } }, { status: 401 }),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host, ["pricing"]);

    expect(host.textContent).toContain("Sign in to run a check.");
    const draft = sessionStorage.getItem("gengrowth:onpage-draft:v1");
    expect(draft).not.toBeNull();
    expect(JSON.parse(String(draft))).toMatchObject({
      url: "acme.test/pricing",
      targetQueries: ["pricing"],
      pageType: "homepage",
    });
    // And the Agent knows to open on that page rather than on the site.
    const intent = sessionStorage.getItem("gengrowth:agent-intent:seo:v3");
    expect(JSON.parse(String(intent))).toMatchObject({
      purpose: "page_focused_launch",
      scope: "page",
    });
  });

  /**
   * The declared page role has to travel and has to change something. Both were
   * true only for the default before: every case here submitted "homepage", so
   * turning the selector into a decoration broke nothing.
   */
  it("sends the page role the visitor chose and answers for that role", async () => {
    const fetchMock = vi.fn(async () => guideResponse(["pricing"]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const host = await render();
    await type(field(host, "onpage-url"), "acme.test/pricing");
    await type(field(host, "onpage-query"), "pricing");
    await select(host, "onpage-role", "guide");
    await act(async () => {
      buttonWith(host, "Check this page").click();
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).pageRole).toBe("guide");
    // And the advice is the guide's, not the homepage's.
    expect(host.textContent).toContain("A guide is found by the question it answers");
    expect(host.textContent).not.toContain("A homepage is judged on whether");
  });

  /**
   * The success CTA is the other half of the bridge. It looked like a plain link
   * and stored nothing, so a visitor who framed a page and then opened the Agent
   * arrived at an empty site-wide form — the same loss the sign-in path was
   * fixed for.
   */
  it("hands the whole frame over when the visitor opens the Agent", async () => {
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;
    const assign = vi.fn();
    vi.stubGlobal("location", { assign } as unknown as Location);

    const host = await render();
    await fillAndRun(host);
    await select(host, "onpage-role", "guide");
    await act(async () => {
      buttonWith(host, "Open the SEO Agent").click();
    });

    expect(JSON.parse(String(sessionStorage.getItem("gengrowth:onpage-draft:v1")))).toMatchObject({
      url: "acme.test/pricing",
      targetQueries: ["pricing"],
      pageType: "guide",
    });
    expect(
      JSON.parse(String(sessionStorage.getItem("gengrowth:agent-intent:seo:v3"))),
    ).toMatchObject({ purpose: "page_focused_launch", scope: "page" });
    expect(assign).toHaveBeenCalledWith("/agents/seo");
  });

  /**
   * The copy for a refused clipboard tells the visitor to select the report and
   * copy it, which needs a report on the page to select.
   */
  it("offers the copy control on a run that could not be scored", async () => {
    /*
      The control moved beside the score, and on a run with no score there is
      no score card to host it — so it disappeared from exactly the runs whose
      report someone would most want a second opinion on. Every fixture here
      produces an unscored run, which is why the move was caught at all.

      The scored branch is not covered here: no fixture in this file carries
      `siteResources`, so `buildOnPageScore` returns null throughout.
    */
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    expect(buttonWith(host, "Copy report for an assistant")).not.toBeNull();
  });

  it("puts the report on the page when the clipboard refuses it", async () => {
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    } as unknown as Navigator);

    const host = await render();
    await fillAndRun(host);
    expect(host.querySelector("textarea")).toBeNull();
    await act(async () => {
      buttonWith(host, "Copy report for an assistant").click();
    });

    expect(host.textContent).toContain("Could not reach the clipboard.");
    const fallback = host.querySelector("textarea");
    expect(fallback).not.toBeNull();
    expect((fallback as HTMLTextAreaElement).value).toContain(
      "# On-page SEO check",
    );
    expect((fallback as HTMLTextAreaElement).readOnly).toBe(true);
  });

  /**
   * "Clear" sits under "Recent checks" and means that list.
   *
   * Two wider readings were both wrong. The sign-out sweep cancels Agent intents
   * this tool never wrote — a diagnosis waiting on a sign-in. And deleting the
   * draft while leaving the intent that was written with it sends the Agent to
   * the right URL with the queries and the page role gone, which reads as a
   * page-focused launch and is not one.
   */
  it("clears the recent checks and leaves every handoff record intact", async () => {
    sessionStorage.setItem(
      "gengrowth:agent-intent:seo:v3",
      JSON.stringify({ purpose: "profile_refresh", url: "other.test" }),
    );
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;
    const assign = vi.fn();
    vi.stubGlobal("location", { assign } as unknown as Location);

    const host = await render();
    await fillAndRun(host);
    // A pending handoff, written by this tool: draft and intent together.
    await act(async () => {
      buttonWith(host, "Open the SEO Agent").click();
    });
    expect(localStorage.getItem("gengrowth:onpage-history:v1")).not.toBeNull();

    await act(async () => {
      buttonWith(host, "Clear").click();
    });

    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBeNull();
    // The pair survives whole, so the Agent still gets the whole question.
    expect(sessionStorage.getItem("gengrowth:onpage-draft:v1")).not.toBeNull();
    expect(
      JSON.parse(String(sessionStorage.getItem("gengrowth:agent-intent:seo:v3"))),
    ).toMatchObject({ purpose: "page_focused_launch" });
  });

  /**
   * The pair is written together and read together; a sweep that takes one and
   * leaves the other is what produced a half-restored launch.
   */
  it("never leaves a page-focused intent without its draft", async () => {
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;
    const assign = vi.fn();
    vi.stubGlobal("location", { assign } as unknown as Location);

    const host = await render();
    await fillAndRun(host);
    await act(async () => {
      buttonWith(host, "Open the SEO Agent").click();
    });
    await act(async () => {
      buttonWith(host, "Clear").click();
    });

    const intent = sessionStorage.getItem("gengrowth:agent-intent:seo:v3");
    const draft = sessionStorage.getItem("gengrowth:onpage-draft:v1");
    const pageFocused =
      intent !== null &&
      (JSON.parse(intent) as { purpose?: string }).purpose ===
        "page_focused_launch";
    expect(pageFocused && draft === null).toBe(false);
  });

  it("says which page was read, when it was collected, and from where", async () => {
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"], "hit"),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    const text = host.textContent ?? "";
    // The audited URL, not the string that was typed.
    expect(text).toContain("https://acme.test/pricing");
    // And that this answer came out of a crawl that was already held, which is
    // the difference between a fresh reading and one up to an hour old.
    expect(text).toContain("which was already held");
    expect(text).not.toContain("Read out of a crawl this check started");
  });

  it("says so when two spellings of one query were measured once", async () => {
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;

    const host = await render();
    /**
     * Two queries the browser accepts as distinct and the wire merges. The
     * client compares lower-cased text; the wire applies NFKC first, so these
     * full-width characters normalize onto the plain ones. Nothing is wrong with
     * either rule — what would be wrong is a query disappearing without a word.
     */
    await fillAndRun(host, ["pricing", "\uFF50\uFF52\uFF49\uFF43\uFF49\uFF4E\uFF47"]);

    expect(host.textContent).toContain("Measured 1 of the 2 queries you submitted");
  });

  it("says what market and language are actually used for", async () => {
    const host = await render();

    expect(host.textContent).toContain(
      "Market and language are used for one thing",
    );
    const market = field(host, "onpage-country");
    expect(market.getAttribute("aria-describedby")).toBe("onpage-market-scope");
  });

  /**
   * The draft survives one sign-in round trip and no more. Left behind, it
   * refills the form with an earlier visitor's URL on every visit inside the TTL.
   */
  it("consumes the resumed draft instead of leaving it to reappear", async () => {
    sessionStorage.setItem(
      "gengrowth:onpage-draft:v1",
      JSON.stringify({
        url: "acme.test/plans",
        targetQueries: ["plans"],
        country: "GB",
        locale: "en",
        pageType: "guide",
        createdAt: Date.now(),
        expiresAt: Date.now() + 600_000,
      }),
    );

    const host = await render();

    expect(field(host, "onpage-url").value).toBe("acme.test/plans");
    expect(field(host, "onpage-country").value).toBe("GB");
    expect(sessionStorage.getItem("gengrowth:onpage-draft:v1")).toBeNull();
  });

  it("shows a retry time only when the server gave a usable one", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        { error: { code: "target_busy" } },
        { status: 429, headers: { "retry-after": "45" } },
      ),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    expect(host.textContent).toContain("Retry in 45 seconds.");
  });

  it("ignores a Retry-After that is not a plain number of seconds", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        { error: { code: "target_busy" } },
        {
          status: 429,
          headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
        },
      ),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    expect(host.textContent).toContain(
      "This site has been crawled several times in the last hour",
    );
    expect(host.textContent).not.toContain("Retry in");
  });
});

/**
 * What the visitor actually gets on screen.
 *
 * The tool shipped reporting keyword placement and nothing else. These hold the
 * rest of the sheet in place, and — because the mock resolves the real English
 * catalogue — a message key that does not exist renders as its dotted path and
 * fails here rather than shipping as literal `tools.onPageChecker.something`.
 */
describe("On-Page checker report depth", () => {
  function richResponse(): Response {
    const rich: SeoAuditTargetPageExtract = {
      ...extract,
      response: {
        ...extract.response,
        canonicalTarget: extract.url,
        jsonLdTypes: ["WebPage", "FAQPage"],
        internalOutlinks: 14,
        internalOutlinksWithoutAnchorText: 1,
      },
      declared: {
        lang: "en",
        openGraph: {
          title: "Acme pricing",
          description: "Compare Acme pricing.",
          image: "https://acme.test/card.png",
        },
        twitterCard: "summary_large_image",
        viewport: "width=device-width, initial-scale=1",
        charset: "utf-8",
        faviconDeclared: true,
        hreflang: ["en", "zh-CN"],
        images: {
      total: 5,
      withAlt: 4,
      withEmptyAlt: 0,
      withoutAlt: 1,
      withDimensions: 0,
      lazyLoaded: 0,
      first: null,
      sources: [],
    },
        externalLinks: { total: 3, nofollow: 1, blankWithoutNoopener: 1 },
        htmlBytes: 51_200,
        visibleTextBytes: 15_000,
        scriptBytes: 0,
        interactive: {
          forms: 0,
          inputs: 0,
          buttons: 0,
          selects: 0,
          textareas: 0,
          canvases: 0,
          media: 0,
          iframes: 0,
        },
      },
    };
    return Response.json(
      {
        data: {
          run: { source: { cache: { status: "miss" } } },
          result: {
            targetUrl: rich.url,
            scannedAt: "2026-08-17T12:00:00.000Z",
            targetInspected: true,
            inspectedTargetUrl: rich.url,
            coverage: { availability: "available", pagesInspected: 120 },
            siteResources: {
              robotsFetched: true,
              robotsGroupsObserved: 4,
              sitemapReferencesObserved: 1,
              sitemapFetched: true,
              sitemapUrls: [],
              sitemapUrlsComplete: true,
            },
            records: [
              {
                id: "title_duplicate",
                category: "indexability",
                state: "observed",
                unit: "page",
                population: "every_collected_page",
                targetTested: null,
                tested: 120,
                affected: 0,
                observations: [],
                limitation: null,
              },
            ],
            targetPageExtract: rich,
            keywordEvidence: buildKeywordEvidence(
              rich,
              normalizedQueries(["pricing"]),
              "product",
              true,
            ),
          },
        },
      },
      { status: 200 },
    );
  }

  it("renders a score, its categories, and the checks behind it", async () => {
    globalThis.fetch = vi.fn(
      async () => richResponse(),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host, ["pricing"]);
    const text = host.textContent ?? "";

    // The headline the tool did not have.
    expect(text).toMatch(/Topic focus \d+%/);
    expect(text).toMatch(/passed of \d+ graded/);
    // Every category that carries points is named.
    for (const category of [
      "Meta",
      "Content",
      "Keyword placement",
      "Links",
      "Images",
      "Social & structured data",
      "Technical & crawl",
      "Site context",
    ]) {
      expect(text).toContain(category);
    }
  });

  it("states each check's own conclusion rather than a bare tick", async () => {
    globalThis.fetch = vi.fn(
      async () => richResponse(),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host, ["pricing"]);
    const text = host.textContent ?? "";

    expect(text).toContain("lang=en");
    expect(text).toContain("twitter:card=summary_large_image");
    expect(text).toContain("Self-referencing");
    // Counted, not merely ticked: one image without alt out of five.
    expect(text).toContain("1 of 5 images carry no alt attribute");
    // The unsafe-window finding a single-page tool would also catch. Worded
    // without the 2021-era claim that the opened page gets a window handle:
    // browsers have isolated `target=_blank` by default since then.
    expect(text).toMatch(/1 target=_blank links? carry neither noopener nor noreferrer/);
    // The site-wide finding a single-page tool cannot reach at all.
    expect(text).toContain("this title is unique");
  });

  it("previews the page where its fields get read", async () => {
    globalThis.fetch = vi.fn(
      async () => richResponse(),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host, ["pricing"]);
    const text = host.textContent ?? "";

    expect(text).toContain("GOOGLE RESULT PREVIEW");
    expect(text).toContain("acme.test › pricing");
    expect(text).toContain("SHARE CARD");
    // Listed, never fetched: rendering it would make this page request the
    // audited site on the visitor's behalf.
    expect(text).toContain("https://acme.test/card.png");
    expect(host.querySelector('img[src*="acme.test"]')).toBeNull();
  });

  it("leaves no message key unresolved anywhere in the report", async () => {
    globalThis.fetch = vi.fn(
      async () => richResponse(),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host, ["pricing"]);

    // next-intl renders a missing key as its dotted path and throws nothing, so
    // a whole section can ship as literal `tools.onPageChecker.checks.x.y`.
    const unresolved = (host.textContent ?? "").match(
      /tools\.onPageChecker[\w.]*/g,
    );
    expect(unresolved).toBeNull();
  });
});
