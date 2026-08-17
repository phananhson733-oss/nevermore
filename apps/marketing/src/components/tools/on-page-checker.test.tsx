// @vitest-environment jsdom
// @input  -- a visitor filling in one page and its target queries
// @output -- proof the request carries them and the answer is rendered as measured
// @pos    -- the seam between the frozen keyword contract and what a person sees

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildKeywordEvidence,
  normalizeTargetQueries,
  type SeoAuditTargetPageExtract,
} from "@sf/public-tools";

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

const { OnPageChecker } = await import("./on-page-checker");

const extract: SeoAuditTargetPageExtract = {
  url: "https://acme.test/pricing",
  title: "Acme pricing and plans",
  metaDescription: "Compare Acme pricing.",
  h1: ["Pricing"],
  subHeadings: ["What each plan includes"],
  openingText: "Every Acme plan includes the pricing calculator.",
  staticBodyWords: 900,
  truncatedLists: false,
};

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
  for (const query of queries) {
    await type(field(host, "onpage-query"), query);
    await act(async () => {
      buttonWith(host, "Add").click();
    });
  }
  await act(async () => {
    buttonWith(host, "Check this page").click();
  });
}

describe("On-Page checker request", () => {
  it("sends the page, the queries and the page role", async () => {
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

    await type(field(host, "onpage-url"), "acme.test/pricing");
    await act(async () => {
      buttonWith(host, "Check this page").click();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Add at least one target query.");
  });

  it.each([
    ["nothing typed", "", "Type a query before adding it."],
    ["a query already in the list", "pricing", "That query is already in the list."],
  ])("refuses %s", async (_name, second, message) => {
    const host = await render();
    await type(field(host, "onpage-query"), "pricing");
    await act(async () => {
      buttonWith(host, "Add").click();
    });
    await type(field(host, "onpage-query"), second);
    await act(async () => {
      buttonWith(host, "Add").click();
    });

    expect(host.textContent).toContain(message);
    // The one query that was accepted is still the only one.
    expect(
      host.querySelectorAll("ul li button").length,
    ).toBe(1);
    const notice = host.querySelector("#onpage-query-notice");
    expect(notice?.textContent).toContain(message);
    expect(field(host, "onpage-query").getAttribute("aria-invalid")).toBe("true");
  });

  it("refuses a sixth query in the browser as well as on the wire", async () => {
    const host = await render();
    for (const query of ["a", "b", "c", "d", "e"]) {
      await type(field(host, "onpage-query"), query);
      await act(async () => {
        buttonWith(host, "Add").click();
      });
    }
    await type(field(host, "onpage-query"), "f");
    await act(async () => {
      buttonWith(host, "Add").click();
    });

    expect(host.textContent).toContain("Up to 5 queries.");
  });
});

describe("On-Page checker result", () => {
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
    expect(text.toLowerCase()).not.toContain("overall score");
    expect(text.toLowerCase()).not.toContain("your score");
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
    await act(async () => {
      buttonWith(host, "Add").click();
    });
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
      "# On-page keyword check",
    );
    expect((fallback as HTMLTextAreaElement).readOnly).toBe(true);
  });

  /**
   * The visitor's own Clear owns what this tool wrote, and nothing else. The
   * Agent-intent prefix is shared with confirmed-run, profile-refresh and
   * profile-search intents, which a visitor clearing a list of checks did not
   * ask to cancel.
   */
  it("clears its own history without cancelling an unrelated Agent intent", async () => {
    sessionStorage.setItem(
      "gengrowth:agent-intent:seo:v3",
      JSON.stringify({ purpose: "profile_refresh", url: "other.test" }),
    );
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);
    expect(localStorage.getItem("gengrowth:onpage-history:v1")).not.toBeNull();

    await act(async () => {
      buttonWith(host, "Clear").click();
    });

    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBeNull();
    expect(sessionStorage.getItem("gengrowth:agent-intent:seo:v3")).not.toBeNull();
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

  it("says that market and language are not part of the check", async () => {
    const host = await render();

    expect(host.textContent).toContain(
      "Market and language are not part of this check",
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
