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

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, unknown>) =>
      values === undefined
        ? key
        : `${key}:${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(",")}`;
    return translate;
  },
}));

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

function evidenceFor(raw: readonly string[]) {
  const normalized = normalizeTargetQueries(raw);
  if (!normalized.ok) throw new Error(normalized.reason);
  return buildKeywordEvidence(extract, normalized.queries, "product", true);
}

function auditResponse(queries: readonly string[]): Response {
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
      buttonWith(host, "actions.addQuery").click();
    });
  }
  await act(async () => {
    buttonWith(host, "actions.run").click();
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
    expect(url).toBe("/api/agents/seo/audit");
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
      buttonWith(host, "actions.run").click();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("errors.urlRequired");

    await type(field(host, "onpage-url"), "acme.test/pricing");
    await act(async () => {
      buttonWith(host, "actions.run").click();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("errors.queryRequired");
  });

  it("refuses a sixth query in the browser as well as on the wire", async () => {
    const host = await render();
    for (const query of ["a", "b", "c", "d", "e"]) {
      await type(field(host, "onpage-query"), query);
      await act(async () => {
        buttonWith(host, "actions.addQuery").click();
      });
    }
    await type(field(host, "onpage-query"), "f");
    await act(async () => {
      buttonWith(host, "actions.addQuery").click();
    });

    expect(host.textContent).toContain("errors.queryLimit");
  });
});

describe("On-Page checker result", () => {
  it("renders coverage, density and every limitation", async () => {
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    // Covered in the title, and said so rather than scored.
    expect(host.textContent).toContain("slotStates.covered");
    expect(host.textContent).toContain("focus.summary:");
    expect(host.textContent).toContain("focus.notAScore");
    expect(host.textContent).toContain("density.value:");
    expect(host.textContent).toContain(
      "limitations.density_basis_captured_text_only",
    );
    // No score anywhere: this surface publishes counts.
    expect(host.textContent).not.toContain("score");
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

    expect(host.textContent).toContain("slotStates.not_applicable");
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

    expect(host.textContent).toContain("unavailable.target_page_not_captured");
    expect(host.textContent).toContain("unavailable.notZero");
  });
});

describe("On-Page checker local state", () => {
  it("remembers a finished check and nothing else", async () => {
    globalThis.fetch = vi.fn(async () =>
      auditResponse(["pricing"]),
    ) as unknown as typeof fetch;

    const host = await render();
    expect(host.textContent).toContain("history.empty");

    await fillAndRun(host);

    const stored = localStorage.getItem("gengrowth:onpage-history:v1");
    expect(stored).not.toBeNull();
    expect(JSON.parse(String(stored))).toHaveLength(1);
    expect(host.textContent).toContain("history.localOnly");
  });

  it("does not remember a run that failed", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: { code: "scan_failed" } }, { status: 502 }),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    expect(host.textContent).toContain("errors.scan_failed");
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

    expect(host.textContent).toContain("unavailable.target_page_not_captured");
    expect(localStorage.getItem("gengrowth:onpage-history:v1")).toBeNull();
  });

  it("keeps what was typed when sign-in interrupts, without running", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: { code: "auth_required" } }, { status: 401 }),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host, ["pricing"]);

    expect(host.textContent).toContain("errors.auth_required");
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

  it("shows a retry time only when the server gave a usable one", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        { error: { code: "target_busy" } },
        { status: 429, headers: { "retry-after": "45" } },
      ),
    ) as unknown as typeof fetch;

    const host = await render();
    await fillAndRun(host);

    expect(host.textContent).toContain("errors.retryAfter:seconds=45");
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

    expect(host.textContent).toContain("errors.target_busy");
    expect(host.textContent).not.toContain("errors.retryAfter");
  });
});
