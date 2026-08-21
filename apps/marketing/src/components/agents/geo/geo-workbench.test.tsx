// @vitest-environment jsdom
// @input  -- the confirm-first workbench driven through its own inputs
// @output -- proof nothing is inferred, defaulted, or billed without confirmation
// @pos    -- component test for the GEO Agent's pre-payment workflow

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../i18n/messages/en.json";
import {
  confirmGeoContext,
  type GeoContextSnapshotV1,
} from "../../../lib/agents/geo-context";
import {
  buildGeoCoreQuerySet,
  confirmGeoQuerySet,
} from "../../../lib/agents/geo-questions";
import type { GeoQuerySetV1 } from "../../../lib/agents/geo-query-contract";
import type { GeoReportDataV3 } from "../../../lib/agents/geo-report-contract";
import { deriveGeoRunCoverage } from "../../../lib/agents/geo-report-derive";
import {
  assembleQuestion,
  observeToSample,
} from "../../../lib/agents/geo-sampling";
import { GEO_REPORT_SESSION_KEY } from "../../../lib/agents/geo-session-state";

/**
 * The sign-in dialog reaches marketing UI through the `@/` alias, which the
 * unit project cannot resolve for a marketing importer. Stubbed for the same
 * reason the sibling Agent workbench test stubs it: this file is about what
 * happens BEFORE the dialog opens.
 */
vi.mock("../../auth/sign-in-dialog", () => ({
  SignInDialog: ({ open }: { readonly open: boolean }) => (
    <div data-testid="sign-in-dialog" data-open={String(open)} />
  ),
}));

const { GeoWorkbench } = await import("./geo-workbench");

function setValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("GeoWorkbench", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ signedIn: false }), { status: 200 }),
        ),
      ),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    // A report left behind by one test would restore into the next one's first
    // render and skip the form the next test is about.
    sessionStorage.clear();
  });

  function render(): void {
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={{ agents: en.agents }}
        >
          <GeoWorkbench locale="en" />
        </NextIntlClientProvider>,
      );
    });
  }

  function field(id: string): HTMLInputElement {
    return host.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  async function fillContext(market = "US"): Promise<void> {
    await act(async () => {
      setValue(field("geo-url"), "https://acme.test/");
      setValue(field("geo-product"), "Acme Analytics");
      setValue(field("geo-category"), "seo");
      setValue(field("geo-buyer"), "ceo");
      setValue(field("geo-rivals"), "semrush");
      setValue(host.querySelector<HTMLSelectElement>("#geo-market")!, market);
    });
  }

  /**
   * Let the confirmation settle.
   *
   * Confirming the context hashes it with `crypto.subtle`, which is genuinely
   * asynchronous, so a microtask flush is not enough to reach the next stage.
   */
  async function flush(ticks = 6): Promise<void> {
    for (let tick = 0; tick < ticks; tick += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  function button(label: string): HTMLButtonElement | undefined {
    return [...host.querySelectorAll("button")].find((element) =>
      element.textContent?.includes(label),
    );
  }

  async function confirmContext(market = "US"): Promise<void> {
    render();
    await fillContext(market);
    await act(async () => {
      button("Review the facts")!.click();
    });
    await act(async () => {
      for (const checkbox of host.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      )) {
        checkbox.click();
      }
    });
    await act(async () => {
      button("Confirm and generate the questions")!.click();
    });
    await flush();
  }

  it("offers no preselected market and no EU or UK option", () => {
    render();
    const select = host.querySelector<HTMLSelectElement>("#geo-market")!;

    // A default market would sell an uncalibrated run as a calibrated one.
    expect(select.value).toBe("");
    const codes = [...select.options].map((option) => option.value);
    expect(codes).not.toContain("EU");
    expect(codes).not.toContain("UK");
    expect(codes).toContain("GB");
  });

  it("keeps the review step out of reach until every fact is entered", () => {
    render();

    expect(button("Review the facts")!.disabled).toBe(true);
  });

  it("proposes brand names without confirming any of them", async () => {
    render();
    await fillContext();
    await act(async () => {
      button("Review the facts")!.click();
    });

    const checkboxes = [
      ...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    expect(checkboxes.length).toBeGreaterThan(1);
    // Every proposal arrives unticked, including the category confirmation.
    expect(checkboxes.every((checkbox) => !checkbox.checked)).toBe(true);
    expect(button("Confirm and generate the questions")!.disabled).toBe(true);
    expect(host.textContent).toContain("inferred from the hostname");
  });

  it("says the confirmed facts were not server-verified", async () => {
    render();
    await fillContext();
    await act(async () => {
      button("Review the facts")!.click();
    });

    expect(host.textContent).toContain(
      "Nothing here has been verified against your site by a server",
    );
  });

  it("shows the exact eighteen-call plan before the run button", async () => {
    await confirmContext();

    expect(host.textContent).toContain("18 provider calls");
    expect(host.textContent).toContain(
      "5 retrieval probes × 3 samples = 15 calls",
    );
    expect(host.textContent).toContain(
      "3 natural-demand questions × 1 sample = 3 calls",
    );
    expect(button("Run 18 provider calls")).toBeDefined();
  });

  it("says what each wording was not calibrated against, before the run button", async () => {
    // The registry has recorded these codes since it was written and nothing
    // read them. The alternatives probe substitutes the visitor's competitor
    // into a sentence measured with "semrush", and it is the only retrieval
    // probe with no currency cue to fall back on — a fact the visitor was
    // paying eighteen calls without ever being shown.
    await confirmContext();

    // Scoped to the row it belongs to. `brand_comparison` carries the same code,
    // so a page-wide substring match passes with the alternatives probe's own
    // record removed — which is exactly the assertion this test replaces.
    const rowFor = (value: string): string => {
      const input = [
        ...host.querySelectorAll<HTMLInputElement>('input[id^="geo-q-"]'),
      ].find((entry) => entry.value === value);
      return input?.closest("li")?.textContent ?? "";
    };
    const alternatives = rowFor("Best alternatives to semrush for seo");
    expect(alternatives).not.toBe("");
    expect(alternatives).toContain(
      "Calibration substituted a name the model almost certainly knows",
    );
    expect(alternatives).toContain("only calibrated on software categories");
    expect(alternatives).toContain("Calibrated on few samples");

    // And the probe that substitutes no name does not claim that gap.
    const topTools = rowFor("What are the top seo tools right now?");
    expect(topTools).not.toBe("");
    expect(topTools).not.toContain(
      "Calibration substituted a name the model almost certainly knows",
    );
  });

  it("refuses a category that is only a kind of product", async () => {
    render();
    await act(async () => {
      setValue(field("geo-url"), "acme.test");
      setValue(field("geo-product"), "Acme Analytics");
      setValue(field("geo-category"), "tools");
      setValue(field("geo-buyer"), "ceo");
      setValue(host.querySelector<HTMLSelectElement>("#geo-market")!, "US");
    });
    await act(async () => {
      button("Review the facts")!.click();
    });
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[id^="geo-alias-"]')!.click();
      host.querySelector<HTMLInputElement>("#geo-category-confirm")!.click();
    });
    await act(async () => {
      button("Confirm and generate the questions")!.click();
    });
    await flush();

    // Refused at the confirm step rather than discovered in a report built from
    // "What are the top tools right now?".
    expect(host.textContent).toContain("are kinds of product, not categories");
    expect(host.querySelectorAll('input[id^="geo-q-"]')).toHaveLength(0);
  });

  it("marks the question that already contains the customer's own brand", async () => {
    await confirmContext();

    expect(host.textContent).toContain("Contains your brand");
    expect(host.textContent).toContain("Measured wording");
  });

  it("renders the calibrated retrieval strings verbatim", async () => {
    await confirmContext();
    const values = [
      ...host.querySelectorAll<HTMLInputElement>('input[id^="geo-q-"]'),
    ].map((input) => input.value);

    expect(values).toContain("What are the top seo tools right now?");
    expect(values).toContain("Best alternatives to semrush for seo");
  });

  it("demotes an edited retrieval probe out of measured status", async () => {
    await confirmContext();
    const input = host.querySelector<HTMLInputElement>(
      "#geo-q-core-category_discovery",
    )!;

    await act(async () => {
      setValue(input, "Which seo tools do enterprise teams trust?");
    });
    await flush();

    expect(host.textContent).toContain("Edited · not measured");
  });

  /*
   * A refused edit keeps the visitor's text.
   *
   * The input is controlled by the query set, so putting the last accepted set
   * back on a refusal types the old question straight back into the box —
   * emptying the field becomes impossible, one character at a time. This is
   * what an earlier version of this fix did.
   */
  it("lets a question be cleared, even though empty text is refused", async () => {
    await confirmContext();
    const input = host.querySelector<HTMLInputElement>(
      "#geo-q-core-category_discovery",
    )!;

    await act(async () => {
      setValue(input, "");
    });
    await flush();

    const after = host.querySelector<HTMLInputElement>(
      "#geo-q-core-category_discovery",
    )!;
    expect(after.value).toBe("");
  });

  it("blocks the run and says why while a question is unpayable", async () => {
    await confirmContext();
    const input = host.querySelector<HTMLInputElement>(
      "#geo-q-core-category_discovery",
    )!;

    await act(async () => {
      setValue(input, "");
    });
    await flush();

    // The set on screen carries the empty text under the old sample plan, so
    // the plan panel would otherwise offer to buy three samples of a question
    // with no words in it. The server refuses such a set before billing; the
    // page says so rather than silently correcting the text.
    const run = button("Run 18 provider calls");
    expect(run?.disabled).toBe(true);
    // The reason covers both ways a question stops being payable — emptied and
    // too long — because one refusal code carries both.
    expect(host.textContent).toContain("A question is empty, or longer than");
  });

  it("re-enables the run once the question is payable again", async () => {
    await confirmContext();
    const input = host.querySelector<HTMLInputElement>(
      "#geo-q-core-category_discovery",
    )!;

    await act(async () => {
      setValue(input, "");
    });
    await flush();
    await act(async () => {
      setValue(
        host.querySelector<HTMLInputElement>("#geo-q-core-category_discovery")!,
        "Which seo tools do enterprise teams trust?",
      );
    });
    await flush();

    expect(button("Run 16 provider calls")?.disabled).toBe(false);
  });

  it("warns before charging when the market is outside the calibration", async () => {
    await confirmContext("DE");

    expect(host.textContent).toContain("calibrated with US market settings");
    expect(host.textContent).toContain("DE");
  });

  it("does not warn about calibration for the calibrated market", async () => {
    await confirmContext("US");

    expect(host.textContent).not.toContain(
      "has not been independently calibrated",
    );
  });

  it("opens the sign-in dialog instead of billing a signed-out visitor", async () => {
    await confirmContext();
    const runFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    runFetch.mockClear();

    await act(async () => {
      button("Run 18 provider calls")!.click();
    });
    await flush();

    const calls = runFetch.mock.calls.map((call) => String(call[0]));
    expect(calls).toContain("/api/auth/session");
    expect(calls).not.toContain("/api/agents/geo/run");
  });

  it("moves the visitor to the reason when a run is refused", async () => {
    // Regression: the banner renders at the top of the workbench, the run
    // button sits at the bottom of the eight-question list, and a refusal sends
    // the visitor back to that list. Before this the banner appeared hundreds of
    // pixels above the viewport, so a refused run — including one that had
    // already been billed — was indistinguishable from a button that did
    // nothing. Found by /qa on 2026-08-18.
    const scrollIntoView = vi.fn();
    // jsdom implements no scrolling at all, so this is defined rather than spied.
    (
      Element.prototype as unknown as { scrollIntoView: unknown }
    ).scrollIntoView = scrollIntoView;

    await confirmContext();
    const runFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    runFetch.mockImplementation(async (input: unknown) =>
      String(input) === "/api/auth/session"
        ? new Response(JSON.stringify({ signedIn: true }), { status: 200 })
        : new Response(
            JSON.stringify({ error: { code: "geo_client_outdated" } }),
            { status: 409 },
          ),
    );

    await act(async () => {
      button("Run 18 provider calls")!.click();
    });
    await flush();

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(en.agents.geo.errors.geo_client_outdated);
    expect(scrollIntoView).toHaveBeenCalled();
    // Focus lands on the container that holds the banner, not on whatever the
    // question list left focused.
    expect(document.activeElement).toBe(alert?.parentElement);
  });
  /**
   * A finished run, stored the way the workbench stores it.
   *
   * Built through the real context and query-set builders so the hashes the
   * restore guard compares are the hashes those builders actually produce; a
   * hand-written payload would pass a guard that only checks shapes and fail
   * the one that checks identity.
   */
  async function storeFinishedRun(savedAt: string): Promise<{
    readonly context: GeoContextSnapshotV1;
    readonly querySet: GeoQuerySetV1;
    readonly report: GeoReportDataV3;
  }> {
    const confirmed = await confirmGeoContext(
      {
        targetUrl: "https://acme.test/",
        productName: "Acme Analytics",
        brandAliases: [
          {
            alias: "Acme Analytics",
            source: "profile_product_name",
            confirmed: true,
          },
        ],
        category: "seo",
        categoryConfirmed: true,
        buyer: "ceo",
        user: "",
        jtbd: "",
        useCases: [],
        outcomes: [],
        barriers: [],
        directCompetitors: [],
        indirectAlternatives: [],
        marketCode: "US",
        targetQueryLanguage: "en",
        sourceProfileVersion: "geo-context.local.v1",
        sourceSummary: [
          { field: "category", source: "user_edit", limitationCode: null },
        ],
      },
      () => new Date("2026-08-19T09:00:00.000Z"),
    );
    if (!confirmed.ok) throw new Error("fixture context");
    const built = await buildGeoCoreQuerySet(
      confirmed.snapshot,
      () => new Date("2026-08-19T09:00:00.000Z"),
    );
    if (!built.ok) throw new Error("fixture query set");
    const querySet = await confirmGeoQuerySet(
      built.querySet,
      () => new Date("2026-08-19T09:00:00.000Z"),
    );
    const questions = querySet.queries.map((unit, index) =>
      assembleQuestion(
        unit,
        Array.from({ length: unit.samplesPlanned }, (_ignored, sample) =>
          observeToSample(
            {
              queryIndex: index,
              sampleIndex: sample + 1,
              sampleId: `${unit.queryId}-s${sample + 1}`,
            },
            unit,
            {
              observedAt: "2026-08-19T09:05:00.000Z",
              webSearchPerformed: true,
              answerText: "A general answer.",
              citations: [
                {
                  url: "https://rival.test/guide",
                  title: null,
                  annotationText: null,
                  providerOutputItemIndex: 1,
                  sectionIndex: 0,
                  annotationOrdinal: 0,
                  startIndex: null,
                  endIndex: null,
                  spanBasis: "provider_message_section_text",
                },
              ],
              citationsComplete: true,
              costUsd: 0.04,
              model: "gpt-5-2025-08-07",
            },
            {
              targetHost: confirmed.snapshot.targetHost,
              brandAliases: confirmed.snapshot.brandAliases,
              aliasScope: "supported",
            },
          ),
        ),
      ),
    );
    const report = {
      run: {
        agent: "geo",
        mode: "authenticated_agent",
        persistence: "report_contents_not_persisted",
        schemaVersion: "agent_geo_report.v3",
        runId: "run-restored",
        sampledAt: "2026-08-19T09:05:00.000Z",
        targetHost: confirmed.snapshot.targetHost,
        contextHash: confirmed.snapshot.contextHash,
        querySetContentHash: querySet.querySetContentHash,
        reportContentHash: `sha256:${"c".repeat(64)}`,
        provenance: {
          collector: "dataforseo",
          upstream: "openai",
          surface: "dataforseo_chat_gpt_llm_responses_api",
          searchModeRequested: "web_search_permitted",
          modelRequested: "gpt-5-2025-08-07",
          modelObserved: ["gpt-5-2025-08-07"],
          maxOutputTokensRequested: 4_096,
          webSearchCountryIsoCodeRequested: "US",
          calibrationMarket: "US",
          triggerCalibrationScope: "calibrated_market",
          queryLanguageTag: "en",
          retrievalSamplesPerProbe: 3,
          naturalDemandSamplesPerQuery: 1,
          knownCostUsdMicros: 1,
          costComplete: true,
          unknownCostSamples: 0,
        },
      },
      coverage: deriveGeoRunCoverage(questions),
      questions,
      limitations: [],
    } as GeoReportDataV3;

    sessionStorage.setItem(
      GEO_REPORT_SESSION_KEY,
      JSON.stringify({
        schemaVersion: "geo_report_session.v1",
        savedAt,
        context: confirmed.snapshot,
        querySet,
        report,
      }),
    );
    return { context: confirmed.snapshot, querySet, report };
  }

  it("puts a finished report back after a language switch, without paying again", async () => {
    // The switcher calls router.push, which remounts this route. Everything the
    // visitor paid for lives in component state, so without restoration the
    // eighteen provider calls are simply gone and running again is the obvious
    // next move.
    await storeFinishedRun(new Date().toISOString());
    render();
    await flush();

    // Assert the restore happened first: "no fetch" is satisfied by a page that
    // simply rendered the empty form, so on its own it proves nothing.
    expect(host.textContent).toContain("What this run found");
    expect(host.textContent).toContain("Copy report for AI");
    expect(host.querySelector("pre")?.textContent ?? "").toContain(
      "# GEO detection report",
    );
    // And then that it cost nothing: no run, and no session probe either.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps the query set identity across the navigation", async () => {
    const stored = await storeFinishedRun(new Date().toISOString());
    render();
    await flush();

    // The brief refuses a query set whose questions disagree with the report's,
    // so a rendered preview is itself proof the pairing survived the trip. The
    // earlier version of this test asserted only that a button existed, which
    // says nothing about which query set produced it.
    const preview = host.querySelector("pre")?.textContent ?? "";
    expect(preview).toContain("# GEO detection report");
    for (const question of stored.querySet.queries) {
      expect(preview).toContain(JSON.stringify(question.text).slice(1, -1));
    }
    expect(preview).toContain(
      `"plannedProviderCalls": ${stored.querySet.queries.reduce(
        (total, query) => total + query.samplesPlanned,
        0,
      )}`,
    );
  });

  it("leaves the review step usable after a restore", async () => {
    // Restoring the report but not the fields behind it left Back pointing at a
    // review screen with no category to confirm and no alias to tick, whose
    // Confirm button could never enable — a dead end two clicks from a working
    // report. Found by cross-model review, 2026-08-19.
    const stored = await storeFinishedRun(new Date().toISOString());
    render();
    await flush();

    await act(async () => {
      button("Back")!.click();
    });
    await act(async () => {
      button("Back")!.click();
    });

    const confirm = button("Confirm and generate the questions");
    expect(confirm).toBeTruthy();
    expect(confirm!.disabled).toBe(false);
    expect(host.textContent).toContain(stored.context.category);
  });

  it("shows the form again rather than presenting an expired report as current", async () => {
    await storeFinishedRun(
      new Date(Date.now() - 16 * 60 * 1_000).toISOString(),
    );
    render();
    await flush();

    expect(host.textContent).not.toContain("Copy report for AI");
    expect(field("geo-url")).not.toBeNull();
    expect(sessionStorage.getItem(GEO_REPORT_SESSION_KEY)).toBeNull();
  });

  it("forgets the stored report when the visitor starts over", async () => {
    await storeFinishedRun(new Date().toISOString());
    render();
    await flush();

    await act(async () => {
      button("Back")!.click();
    });

    expect(sessionStorage.getItem(GEO_REPORT_SESSION_KEY)).toBeNull();
  });
});
