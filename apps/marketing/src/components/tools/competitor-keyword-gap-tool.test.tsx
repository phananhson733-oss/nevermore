// @vitest-environment jsdom
// @input  -- authenticated session status, a valid competitor-gap form, and v3 success bodies
// @output -- proof signed-out visitors see sign-in without a billable tool POST and off-contract bodies never render
// @pos    -- interaction contract for the Marketing competitor keyword gap tool

import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
  type CompetitorKeywordGapEnvelope,
} from "@sf/public-tools/competitor-keyword-gap";

type ToolProps = {
  readonly locale: string;
  readonly properties: readonly string[] | null;
  readonly markets: readonly string[];
  readonly marketLanguages: Readonly<Record<string, readonly string[]>>;
};

const { signInDialogMock, trackMarketingEventMock } = vi.hoisted(() => ({
  signInDialogMock: vi.fn(({ open }: { readonly open: boolean }) =>
    open ? <div data-testid="sign-in-dialog">sign in</div> : null,
  ),
  trackMarketingEventMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = (
      key: string,
      values?: Readonly<Record<string, unknown>>,
    ) => {
      if (key === "competitors.count") return `${String(values?.count ?? 0)}/5`;
      if (key === "running.elapsed") {
        return `running.elapsed:${String(values?.seconds ?? 0)}`;
      }
      return key;
    };
    translate.has = () => true;
    return translate;
  },
}));

vi.mock("../auth/sign-in-dialog", () => ({
  SignInDialog: signInDialogMock,
}));

vi.mock("../layout/google-analytics", () => ({
  trackMarketingEvent: trackMarketingEventMock,
}));

let Tool: ComponentType<ToolProps>;
try {
  const modulePath = "./competitor-keyword-gap-tool.tsx";
  ({ CompetitorKeywordGapTool: Tool } = await import(
    /* @vite-ignore */ modulePath
  ));
} catch {
  const MissingTool: ComponentType<ToolProps> = () => (
    <button type="button">actions.run</button>
  );
  Tool = MissingTool;
}

const originalFetch = globalThis.fetch;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const scrollIntoViewMock = vi.fn();
let root: Root | null = null;

const ENVELOPE: CompetitorKeywordGapEnvelope = {
  run: {
    tool: "competitor_keyword_gap",
    schemaVersion: "competitor_keyword_gap.v3",
    mode: "public_preview",
    scope: "site",
    persistence: "none",
    completedAt: "2026-08-24T12:00:00.000Z",
    status: "complete",
  },
  result: {
    capturedAt: "2026-08-24T12:00:00.000Z",
    siteDomain: "example.com",
    competitorDomains: ["rival.example"],
    marketCode: "US",
    languageCode: "en",
    sampleRule: {
      maxCompetitorRank: 20,
      perCompetitorLimit: 300,
      serpSnapshotRequested: true,
    },
    requestedCompetitors: 1,
    completedCompetitors: 1,
    unavailableCompetitors: 0,
    competitors: [
      {
        domain: "rival.example",
        status: "complete",
        returnedRows: 0,
        totalCount: 0,
        truncated: false,
        failureCode: null,
      },
    ],
    rows: [],
    resultTruncated: false,
    overlayStatus: "not_requested",
    gscQueryTruncated: false,
    gscQueryPageTruncated: false,
    gscQueryRowCount: null,
    gscQueryPageRowCount: null,
  },
};

const ACTIONABLE_ENVELOPE: CompetitorKeywordGapEnvelope = {
  ...ENVELOPE,
  result: {
    ...ENVELOPE.result,
    overlayStatus: "available",
    gscQueryRowCount: 1,
    gscQueryPageRowCount: 1,
    rows: [
      {
        keyword: "approval workflow software",
        competitorRanks: { "rival.example": 4 },
        competitorPages: {
          "rival.example": {
            url: "https://rival.example/approvals",
            title: "Approval workflow software",
            etv: 812.4,
          },
        },
        competitorCount: 1,
        bestCompetitorRank: 4,
        ownState: "not_observed_in_provider_rankings",
        searchVolume: { availability: "available", value: 2_900 },
        cpc: { availability: "available", value: 4.2 },
        keywordDifficulty: { availability: "available", value: 31 },
        providerIntent: "commercial",
        coreKeyword: "approval workflow",
        searchVolumeTrend: { monthly: 4, quarterly: -2, yearly: 11 },
        serpSnapshot: {
          itemTypes: ["organic", "ai_overview"],
          updatedAt: "2026-05-14T18:17:21.000Z",
        },
        preScreen: {
          band: "stretch",
          basis: "dfs_estimate",
          reason: "kd_mid_rank_top20",
        },
        gsc: {
          queryStatus: "observed_weak",
          evidenceBasis: "query",
          queryImpressions: 318,
          queryPosition: 34,
          pageStatus: "observed_sufficient",
          pageUrl: "https://example.com/product",
          pageImpressions: 300,
          pagePosition: 34.2,
          queryPageCoverage: 0.94,
          nextStep: "optimize_existing",
        },
      },
    ],
  },
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  signInDialogMock.mockClear();
  trackMarketingEventMock.mockReset();
  scrollIntoViewMock.mockReset();
  sessionStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoViewMock,
    writable: true,
  });
  globalThis.fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({ signedIn: false }),
    ) as unknown as typeof fetch;
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  globalThis.fetch = originalFetch;
  if (originalScrollIntoView === undefined) {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  } else {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  }
  vi.restoreAllMocks();
});

async function renderTool(
  properties: readonly string[] = ["sc-domain:example.com"],
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <Tool
        locale="en"
        properties={properties}
        markets={["US"]}
        marketLanguages={{ US: ["en", "es"] }}
      />,
    );
  });
  return host;
}

async function click(button: HTMLElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function change(
  field: HTMLInputElement | HTMLSelectElement | null,
  value: string,
): Promise<void> {
  if (
    !(field instanceof HTMLInputElement) &&
    !(field instanceof HTMLSelectElement)
  ) {
    expect(
      field,
      "expected the requested form control to render",
    ).not.toBeNull();
    return;
  }
  const prototype =
    field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function pressEnter(field: HTMLInputElement): Promise<void> {
  await act(async () => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function buttonWith(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`no button containing ${text}`);
  return button as HTMLButtonElement;
}

async function renderToolWithMarkets(
  markets: readonly string[],
  marketLanguages: Readonly<Record<string, readonly string[]>>,
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <Tool
        locale="en"
        properties={["sc-domain:example.com"]}
        markets={markets}
        marketLanguages={marketLanguages}
      />,
    );
  });
  return host;
}

/**
 * Put competitors in the field. That is the whole interaction.
 *
 * There is no chip, no add button and no commit: the field holds what was
 * typed until the visitor runs. Appending rather than replacing so a test can
 * build a list the way a person does, one piece at a time into one box.
 */
async function addCompetitor(
  host: HTMLElement,
  value: string,
): Promise<void> {
  const input = host.querySelector(
    'input[name="competitorDomain"]',
  ) as HTMLInputElement;
  const next = input.value === "" ? value : `${input.value}, ${value}`;
  await change(input, next);
}


describe("CompetitorKeywordGapTool", () => {
  it("opens sign-in for a signed-out visitor without posting the tool request", async () => {
    const host = await renderTool();

    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");

    await click(buttonWith(host, "actions.run"));

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/session", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "/api/tools/competitor-keyword-gap",
      expect.anything(),
    );
  });

  it("leaves the whole list in the field, exactly as it was typed", async () => {
    // The field IS the list. Every earlier shape moved text out of it -- a
    // separator, a blur or an enter emptied the box under the cursor and put
    // the pieces somewhere the visitor then had to read separately.
    const host = await renderTool();
    const input = host.querySelector(
      'input[name="competitorDomain"]',
    ) as HTMLInputElement;

    await change(input, "one.example, two.example，three.example,");

    expect(input.value).toBe("one.example, two.example，three.example,");
    expect(host.querySelector("[data-competitor-chip]")).toBeNull();
    // The trailing separator is someone about to type a fourth, not a fourth.
    expect(host.textContent).toContain("3/5");
  });

  it("normalizes every piece of one comma-separated line into the request", async () => {
    // Five competitors, one interaction, no commit step anywhere in it.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(Response.json({ data: ENVELOPE }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();

    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await change(
      host.querySelector(
        'input[name="competitorDomain"]',
      ) as HTMLInputElement,
      " https://WWW.Rival.Example/ ，second.example, http://Third.Example ",
    );
    await click(buttonWith(host, "actions.run"));

    const posted = fetchMock.mock.calls[1]?.[1] as { readonly body: string };
    expect(JSON.parse(posted.body)).toMatchObject({
      competitorDomains: ["rival.example", "second.example", "third.example"],
    });
  });

  it("keeps the field intact when the run is refused", async () => {
    // A refusal names one piece; all five have to still be on screen for that
    // to be actionable. Clearing or rewriting the box here would hand back a
    // reason with nothing to apply it to.
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    const input = host.querySelector(
      'input[name="competitorDomain"]',
    ) as HTMLInputElement;
    const typed = "one.example, not a domain, three.example";

    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await change(input, typed);
    await click(buttonWith(host, "actions.run"));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorInvalid",
    );
    expect(input.value).toBe(typed);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to run on a bad piece rather than dropping it silently", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();

    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await change(
      host.querySelector(
        'input[name="competitorDomain"]',
      ) as HTMLInputElement,
      "rival.example, not a domain",
    );
    await click(buttonWith(host, "actions.run"));

    expect(host.textContent).toContain("validation.competitorInvalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers the languages the market is served in, and moves with the market", async () => {
    // The list used to be five, flat, whatever the market was: `sv` for the
    // United States was resolved back to `en` server-side without a word, and
    // `es`, which it does serve, was not offered at all.
    const host = await renderToolWithMarkets(["US", "DE"], {
      US: ["en", "es"],
      DE: ["de"],
    });
    const market = host.querySelector(
      'select[name="marketCode"]',
    ) as HTMLSelectElement;
    const language = host.querySelector(
      'select[name="languageCode"]',
    ) as HTMLSelectElement;
    const options = (): readonly string[] =>
      [...language.querySelectorAll("option")].map((option) => option.value);

    expect(options()).toEqual(["en", "es"]);
    expect(language.value).toBe("en");

    await change(language, "es");
    expect(language.value).toBe("es");

    await change(market, "DE");
    // `es` is not served there, so it cannot stay selected.
    expect(options()).toEqual(["de"]);
    expect(language.value).toBe("de");
  });

  it("seeds the editable site domain from domain and URL-prefix properties without clearing it on deselect", async () => {
    const host = await renderTool([
      "sc-domain:acme.com",
      "https://www.prefix.example/reports/",
    ]);
    const property = host.querySelector(
      'select[name="property"]',
    ) as HTMLSelectElement;
    const site = host.querySelector(
      'input[name="siteDomain"]',
    ) as HTMLInputElement;

    // Seeded on arrival, because the first property is now the one selected:
    // the overlay is on by default, and the site it implies has to be there
    // with it or the form opens asking for something it already knows.
    expect(property.value).toBe("sc-domain:acme.com");
    expect(site.value).toBe("acme.com");

    await change(property, "sc-domain:acme.com");
    expect(site.value).toBe("acme.com");

    await change(property, "https://www.prefix.example/reports/");
    expect(site.value).toBe("prefix.example");

    await change(property, "");
    expect(site.value).toBe("prefix.example");

    await change(site, "edited.example");
    expect(site.value).toBe("edited.example");
  });

  it("turns browser autofill off for the two non-auth domain inputs", async () => {
    const host = await renderTool();

    expect(
      (host.querySelector('input[name="siteDomain"]') as HTMLInputElement)
        .autocomplete,
    ).toBe("off");
    expect(
      (host.querySelector('input[name="competitorDomain"]') as HTMLInputElement)
        .autocomplete,
    ).toBe("off");
  });

  it("rejects invalid, duplicate, self, and sixth competitors inline", async () => {
    const host = await renderTool();
    const site = host.querySelector(
      'input[name="siteDomain"]',
    ) as HTMLInputElement;
    const competitor = host.querySelector(
      'input[name="competitorDomain"]',
    ) as HTMLInputElement;

    expect(site.getAttribute("aria-describedby")).toBeNull();
    expect(site.getAttribute("aria-invalid")).toBeNull();
    // The hint is a permanent description of this field, so "not invalid" is
    // the hint id rather than nothing.
    expect(competitor.getAttribute("aria-describedby")).toBe(
      "competitor-gap-competitor-hint",
    );
    expect(competitor.getAttribute("aria-invalid")).toBeNull();

    await change(site, "not a domain");
    await click(buttonWith(host, "actions.run"));
    expect(site.getAttribute("aria-describedby")).toBe(
      "competitor-gap-validation",
    );
    expect(site.getAttribute("aria-invalid")).toBe("true");
    // The hint is a permanent description of this field, so "not invalid" is
    // the hint id rather than nothing.
    expect(competitor.getAttribute("aria-describedby")).toBe(
      "competitor-gap-competitor-hint",
    );
    expect(competitor.getAttribute("aria-invalid")).toBeNull();

    await change(site, "https://www.example.com/");
    await click(buttonWith(host, "actions.run"));
    expect(site.getAttribute("aria-describedby")).toBeNull();
    expect(site.getAttribute("aria-invalid")).toBeNull();
    expect(competitor.getAttribute("aria-describedby")).toBe(
      "competitor-gap-validation",
    );
    expect(competitor.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorsRequired",
    );

    // Each of these is judged when the run is asked for, not as it is typed:
    // a field being filled is half-written most of the time, and flagging it
    // mid-word is noise rather than help.
    await change(competitor, "not a domain");
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorInvalid",
    );
    expect(site.getAttribute("aria-describedby")).toBeNull();
    expect(site.getAttribute("aria-invalid")).toBeNull();
    expect(competitor.getAttribute("aria-describedby")).toBe(
      "competitor-gap-validation",
    );
    expect(competitor.getAttribute("aria-invalid")).toBe("true");

    await change(competitor, "example.com");
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorSelf",
    );
    expect(competitor.getAttribute("aria-invalid")).toBe("true");

    await change(competitor, "one.example, www.ONE.example");
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorDuplicate",
    );
    expect(competitor.getAttribute("aria-invalid")).toBe("true");

    await change(
      competitor,
      "one.example, two.example, three.example, four.example, five.example",
    );
    expect(host.textContent).toContain("5/5");

    await change(
      competitor,
      "one.example, two.example, three.example, four.example, five.example, six.example",
    );
    // The counter counts what was typed; the limit is a refusal, not a silent
    // truncation, so it says six and then declines to run.
    expect(host.textContent).toContain("6/5");
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.competitorLimit",
    );
    expect(competitor.getAttribute("aria-invalid")).toBe("true");
  });

  it("sends the exact normalized signed-in request, including an optional property, then renders done", async () => {
    const requestAnimationFrameMock = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(Response.json({ data: ENVELOPE }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();

    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "https://www.Example.com/",
    );
    await addCompetitor(host, "HTTPS://WWW.RIVAL.EXAMPLE/");
    await change(
      host.querySelector('select[name="property"]') as HTMLSelectElement,
      "sc-domain:example.com",
    );
    await click(buttonWith(host, "actions.run"));

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/session", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/tools/competitor-keyword-gap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: expect.any(AbortSignal),
        body: JSON.stringify({
          property: "sc-domain:example.com",
          siteDomain: "example.com",
          competitorDomains: ["rival.example"],
          marketCode: "US",
          languageCode: "en",
          acceptSchemaVersion: COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
        }),
      },
    );
    expect(trackMarketingEventMock).toHaveBeenNthCalledWith(1, "tool_start", {
      tool_name: "competitor_keyword_gap",
    });
    expect(trackMarketingEventMock).toHaveBeenNthCalledWith(
      2,
      "tool_complete",
      { tool_name: "competitor_keyword_gap" },
    );
    expect(host.querySelector('[data-run-status="complete"]')).not.toBeNull();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({ block: "start" });
    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
    const form = host.querySelector("[data-competitor-gap-form]");
    const results = host.querySelector("[data-competitor-gap-results]");
    const shell = host.querySelector("#competitor-keyword-gap-tool");
    expect(form).not.toBeNull();
    expect(results).not.toBeNull();
    expect(form?.parentElement).toBe(results?.parentElement);
    expect(form?.contains(results)).toBe(false);
    expect(form?.className).toContain("bg-brand-panel");
    expect(results?.classList.contains("scroll-mt-24")).toBe(true);
    expect(shell?.className).not.toContain("bg-brand-panel");

    await change(
      host.querySelector('select[name="property"]') as HTMLSelectElement,
      "",
    );
    expect(
      (host.querySelector('select[name="property"]') as HTMLSelectElement)
        .value,
    ).toBe("");
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(
        <Tool
          locale="en"
          properties={["sc-domain:example.com"]}
          markets={["US"]}
          marketLanguages={{ US: ["en", "es"] }}
        />,
      );
    });
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    fetchMock
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(Response.json({ data: ENVELOPE }));
    await click(buttonWith(host, "actions.run"));

    const deselectedRequest = fetchMock.mock.calls[3]?.[1] as
      | RequestInit
      | undefined;
    expect(deselectedRequest).toBeDefined();
    const deselectedBody = JSON.parse(
      String(deselectedRequest?.body),
    ) as Record<string, unknown>;
    expect(Object.hasOwn(deselectedBody, "property")).toBe(false);
    expect(deselectedBody).toEqual({
      siteDomain: "example.com",
      competitorDomains: ["rival.example"],
      marketCode: "US",
      languageCode: "en",
      acceptSchemaVersion: COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
    });
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    expect(scrollIntoViewMock.mock.calls).toEqual([
      [{ block: "start" }],
      [{ block: "start" }],
    ]);
    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
  });

  it("keeps result actions bound to the property used by that completed run", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(Response.json({ data: ACTIONABLE_ENVELOPE }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool([
      "sc-domain:example.com",
      "sc-domain:other.example",
    ]);
    const property = host.querySelector(
      'select[name="property"]',
    ) as HTMLSelectElement;

    await change(property, "sc-domain:example.com");
    await addCompetitor(host, "rival.example");
    await click(buttonWith(host, "actions.run"));

    expect(
      host.querySelector('[data-row-action="open-checker"]'),
    ).not.toBeNull();

    await change(property, "sc-domain:other.example");
    const checker = host.querySelector(
      '[data-row-action="open-checker"]',
    ) as HTMLAnchorElement;
    expect(checker).not.toBeNull();
    checker.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await click(checker);

    const stored = JSON.parse(
      String(sessionStorage.getItem("gengrowth.tool-handoff.v1")),
    ) as { readonly property: string };
    expect(stored.property).toBe("sc-domain:example.com");
  });

  it("keeps old results for local validation errors but clears them before rerun authentication", async () => {
    const rerunAuth = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(Response.json({ data: ENVELOPE }))
      .mockImplementationOnce(() => rerunAuth.promise);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    const site = host.querySelector(
      'input[name="siteDomain"]',
    ) as HTMLInputElement;

    await change(site, "example.com");
    await addCompetitor(host, "rival.example");
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector("[data-competitor-gap-results]")).not.toBeNull();

    await change(site, "not a domain");
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "validation.siteInvalid",
    );
    expect(host.querySelector("[data-competitor-gap-results]")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await change(site, "example.com");
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector("[data-competitor-gap-results]")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    rerunAuth.resolve(Response.json({ signedIn: false }));
    await flushPromises();

    expect(host.querySelector("[data-competitor-gap-results]")).toBeNull();
    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/tools/competitor-keyword-gap",
      ),
    ).toHaveLength(1);
  });

  it("keeps the form busy with an elapsed live status while the tool request runs", async () => {
    let resolveTool!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveTool = resolve;
          }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");

    await click(buttonWith(host, "actions.run"));

    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "running.elapsed:0",
    );
    expect(host.querySelector('[role="progressbar"]')).toBeNull();

    await act(async () => {
      resolveTool(Response.json({ data: ENVELOPE }));
      await Promise.resolve();
    });
  });

  it("locks synchronously so a double click creates one auth read and one tool request", async () => {
    const auth = deferred<Response>();
    const fetchMock = vi.fn((input: string | URL | Request) =>
      String(input) === "/api/auth/session"
        ? auth.promise
        : Promise.resolve(Response.json({ data: ENVELOPE })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");
    const run = buttonWith(host, "actions.run");

    await act(async () => {
      run.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      run.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(run.disabled).toBe(true);

    auth.resolve(Response.json({ signedIn: true }));
    await flushPromises();

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/tools/competitor-keyword-gap",
      ),
    ).toHaveLength(1);
  });

  it("aborts a pending auth read on unmount without issuing a late tool request", async () => {
    const auth = deferred<Response>();
    const fetchMock = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) => auth.promise,
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");
    await click(buttonWith(host, "actions.run"));
    const authSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)
      ?.signal;

    await act(async () => {
      root?.unmount();
      root = null;
    });

    expect(authSignal?.aborted).toBe(true);
    auth.resolve(Response.json({ signedIn: true }));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(trackMarketingEventMock).not.toHaveBeenCalled();
  });

  it("aborts a pending tool request on unmount without late result, error, or completion analytics", async () => {
    const tool = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockImplementationOnce(() => tool.promise);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");
    await click(buttonWith(host, "actions.run"));
    const toolSignal = (fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)
      ?.signal;

    await act(async () => {
      root?.unmount();
      root = null;
    });

    expect(toolSignal?.aborted).toBe(true);
    tool.resolve(Response.json({ data: ENVELOPE }));
    await flushPromises();
    expect(host.querySelector("[data-run-status]")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(trackMarketingEventMock).toHaveBeenCalledTimes(1);
    expect(trackMarketingEventMock).not.toHaveBeenCalledWith(
      "tool_complete",
      expect.anything(),
    );
  });

  it.each([
    "malformed-gsc",
    "unknown-pre-screen-band",
    "non-string-competitor-page-url",
    "missing-sample-rule",
  ] as const)(
    "rejects a %s success body before rendering or completing analytics",
    async (kind) => {
      const actionableRow = ACTIONABLE_ENVELOPE.result.rows[0]!;
      const { pageStatus: _pageStatus, ...incompleteGsc } = actionableRow.gsc;
      const { sampleRule: _sampleRule, ...resultWithoutRule } =
        ACTIONABLE_ENVELOPE.result;
      const withRows = (rows: readonly unknown[]) => ({
        ...ACTIONABLE_ENVELOPE,
        result: { ...ACTIONABLE_ENVELOPE.result, rows },
      });
      const bodies: Record<typeof kind, unknown> = {
        "malformed-gsc": withRows([{ ...actionableRow, gsc: incompleteGsc }]),
        "unknown-pre-screen-band": withRows([
          {
            ...actionableRow,
            preScreen: { ...actionableRow.preScreen, band: "winnable" },
          },
        ]),
        "non-string-competitor-page-url": withRows([
          {
            ...actionableRow,
            competitorPages: {
              "rival.example": {
                ...actionableRow.competitorPages["rival.example"],
                url: 42,
              },
            },
          },
        ]),
        "missing-sample-rule": {
          ...ACTIONABLE_ENVELOPE,
          result: resultWithoutRule,
        },
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ signedIn: true }))
        .mockResolvedValueOnce(Response.json({ data: bodies[kind] }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const host = await renderTool();

      await change(
        host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
        "example.com",
      );
      await addCompetitor(host, "rival.example");
      await click(buttonWith(host, "actions.run"));

      expect(host.querySelector("[data-competitor-gap-results]")).toBeNull();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "errors.unknown",
      );
      expect(trackMarketingEventMock).not.toHaveBeenCalledWith(
        "tool_complete",
        expect.anything(),
      );
    },
  );

  it.each(["competitor_keyword_gap.v2", "competitor_keyword_gap.v99"] as const)(
    "renders the stale-client message, not unknown, for a mismatched %s success body",
    async (schemaVersion) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ signedIn: true }))
        .mockResolvedValueOnce(
          Response.json({
            data: {
              ...ACTIONABLE_ENVELOPE,
              run: { ...ACTIONABLE_ENVELOPE.run, schemaVersion },
            },
          }),
        );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const host = await renderTool();

      await change(
        host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
        "example.com",
      );
      await addCompetitor(host, "rival.example");
      await click(buttonWith(host, "actions.run"));

      expect(host.querySelector("[data-competitor-gap-results]")).toBeNull();
      const alert = host.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("errors.client_out_of_date");
      expect(alert?.textContent).not.toContain("errors.unknown");
      expect(trackMarketingEventMock).not.toHaveBeenCalledWith(
        "tool_complete",
        expect.anything(),
      );
    },
  );

  it("renders the stale-client message for a 409 client_out_of_date refusal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "client_out_of_date" } },
          { status: 409 },
        ),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();

    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");
    await click(buttonWith(host, "actions.run"));

    expect(host.querySelector("[data-competitor-gap-results]")).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "errors.client_out_of_date",
    );
    expect(trackMarketingEventMock).not.toHaveBeenCalledWith(
      "tool_complete",
      expect.anything(),
    );
  });

  it("reports auth unavailability without posting and uses the known-error allow-list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const host = await renderTool();
    await change(
      host.querySelector('input[name="siteDomain"]') as HTMLInputElement,
      "example.com",
    );
    await addCompetitor(host, "rival.example");
    await click(buttonWith(host, "actions.run"));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "errors.auth_unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock
      .mockResolvedValueOnce(Response.json({ signedIn: true }))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "brand_new_private_error" } },
          { status: 502 },
        ),
      );
    await click(buttonWith(host, "actions.run"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "errors.unknown",
    );
  });
});
