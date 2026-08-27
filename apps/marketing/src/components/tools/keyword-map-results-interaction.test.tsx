// @vitest-environment jsdom
// @input  -- complete SEO/GEO keyword opportunity rows rendered through the real message bundles
// @output -- proof that technical evidence mounts only after an accessible row toggle and unmounts when closed
// @pos    -- interaction guard for the compact keyword result table's progressive evidence disclosure

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  KeywordOpportunityResult,
  KeywordOpportunityRow,
} from "@sf/public-tools/keyword-opportunity/types";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { KeywordMapResults } from "./keyword-map-results.tsx";

let root: Root | null = null;

function completeRow(
  keyword: string,
  lane: "seo" | "geo" = "seo",
): KeywordOpportunityRow {
  return {
    keyword,
    lane,
    discoveryBasis: "site_proposition",
    questionForm: lane === "geo",
    propositionIndex: 0,
    validation: {
      availability: "available",
      volume: 320,
      difficulty: 14,
      providerIntent: "commercial",
      intent: "commercial",
      serpFeatures: [],
    },
    serp: {
      status: "complete",
      failureReason: null,
      observedAt: "2026-08-20T08:00:00.000Z",
      organicResults: [
        {
          position: 2,
          domain: "new.example",
          url: "https://new.example/guide",
          title: "New clinic billing guide",
        },
        {
          position: 5,
          domain: "reddit.com",
          url: "https://reddit.com/r/dentistry/comments/billing",
          title: "Clinic billing discussion",
        },
      ],
      verdict: "winnable_evidence",
      weakestTopTenDomainRank: 8,
      weakestTopTenDomain: "example.com",
      weakestTopTenPosition: 4,
      topTenDomains: ["example.com"],
      topTenDomainRanks: [8],
      pageOneItemTypes: ["ai_overview"],
      isEstimate: false,
    },
    serpIntent: {
      intent: "informational",
      source: "serp_top_ten_interpretation",
      observedAt: "2026-08-20T08:00:00.000Z",
      modelId: "gpt-5.4-mini",
      promptVersion: "keyword_serp_interpretation.v1",
    },
    signals: {
      youngDomain: {
        state: "observed",
        observation: {
          domain: "new.example",
          registrationDate: "2025-07-01T00:00:00.000Z",
          observedAt: "2026-08-20T08:00:00.000Z",
          ageMonths: 13,
        },
      },
      lowOrganicTrafficDomain: {
        state: "observed",
        observation: {
          domain: "tiny.example",
          organicEtv: 420,
          threshold: 5_000,
          marketCode: "US",
          languageCode: "en",
          observedAt: "2026-08-20T08:00:00.000Z",
        },
      },
      communityResult: {
        state: "observed",
        observation: {
          domain: "reddit.com",
          url: "https://reddit.com/r/dentistry/comments/billing",
          position: 5,
          source: "domain_fallback",
        },
      },
    },
    aiOverview: {
      availability: "observed",
      loadedAsync: true,
      answerAssessment: "unavailable",
      reason: "content_unavailable",
      modelId: "gpt-5.4-mini",
      promptVersion: "keyword_serp_interpretation.v1",
    },
    decision: {
      disposition: "eligible",
      basis: "positive_signal_observed",
      positiveSignals: [
        "young_domain",
        "low_organic_traffic_domain",
        "community_result",
      ],
      discounts: [],
    },
    coverage: "possible_existing_page",
    supportingPageUrl:
      lane === "geo"
        ? "https://acme.test/resources/how-to-win?utm_source=fixture#answer"
        : null,
    nextChecks: ["read_page_one_intent", "judge_commercial_fit"],
    clusterId: "cluster-1",
  };
}

function result(rows: readonly KeywordOpportunityRow[]): KeywordOpportunityResult {
  return {
    availability: "available",
    marketCode: "US",
    languageCode: "en",
    context: {
      siteUrl: "https://acme.test",
      pagesFetched: 20,
      productPagesFetched: 3,
      selection: {
        eligibleCandidates: 28,
        excludedCandidates: 8,
        attemptedCandidates: 23,
        truncatedCandidates: 5,
      },
      propositions: [],
      contextSufficient: true,
      stopReason: "completed",
    },
    rows,
    withheld: [],
    clusters: [],
    incomplete: [],
    funnel: {
      generated: 1,
      deduplicated: 1,
      providerReturned: 1,
      volumePositive: 1,
      explicitZero: 0,
      providerNoData: 0,
      alreadyCovered: 0,
      serpSampled: 1,
      winnableEvidence: 1,
      shown: 1,
    },
    unavailableStages: [],
    nextStepSuggestions: [],
  };
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

async function renderResults(
  rows: readonly KeywordOpportunityRow[],
  locale: "en" | "zh" = "en",
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <NextIntlClientProvider
        locale={locale}
        timeZone="UTC"
        messages={locale === "en" ? en : zh}
      >
        <KeywordMapResults result={result(rows)} locale={locale} />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

describe("KeywordMapResults evidence expansion", () => {
  it.each(["en", "zh"] as const)(
    "mounts complete SEO provenance on demand and unmounts it when closed in %s",
    async (locale) => {
      const row = completeRow("expandable seo evidence");
      const host = await renderResults([row], locale);
      const toggle = host.querySelector<HTMLButtonElement>(
        '[data-keyword-toggle="expandable seo evidence"]',
      );

      expect(toggle).not.toBeNull();
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
      expect(toggle?.getAttribute("aria-controls")).toBeTruthy();
      expect(toggle?.className).toContain("min-h-11");
      expect(
        host.querySelector('[data-keyword-detail="expandable seo evidence"]'),
      ).toBeNull();
      expect(host.textContent).not.toContain(
        "https://reddit.com/r/dentistry/comments/billing",
      );

      await click(toggle as HTMLButtonElement);

      const detail = host.querySelector(
        '[data-keyword-detail="expandable seo evidence"]',
      );
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      expect(detail).not.toBeNull();
      expect(detail?.getAttribute("id")).toBe(
        toggle?.getAttribute("aria-controls"),
      );
      for (const evidence of [
        "gpt-5.4-mini",
        "keyword_serp_interpretation.v1",
        "https://reddit.com/r/dentistry/comments/billing",
        "Clinic billing discussion",
        "5,000",
        "2025-07-01T00:00:00.000Z",
        "2026-08-20T08:00:00.000Z",
        locale === "en" ? "AI Overview content unavailable" : "AI Overview 内容不可用",
        locale === "en"
          ? "Decide whether this demand is your buyer"
          : "判断这波需求是不是你的买家",
      ]) {
        expect(detail?.textContent).toContain(evidence);
      }

      await click(toggle as HTMLButtonElement);

      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
      expect(
        host.querySelector('[data-keyword-detail="expandable seo evidence"]'),
      ).toBeNull();
    },
  );

  it("keeps the full GEO supporting URL inside the mounted evidence row", async () => {
    const row = completeRow("expandable geo evidence", "geo");
    const host = await renderResults([row]);

    expect(host.textContent).toContain("acme.test/resources/how-to-win");
    expect(host.textContent).not.toContain(
      "https://acme.test/resources/how-to-win?utm_source=fixture#answer",
    );

    const toggle = host.querySelector<HTMLButtonElement>(
      '[data-keyword-toggle="expandable geo evidence"]',
    );
    expect(toggle).not.toBeNull();
    await click(toggle as HTMLButtonElement);

    expect(
      host.querySelector('[data-keyword-detail="expandable geo evidence"]')
        ?.textContent,
    ).toContain(
      "https://acme.test/resources/how-to-win?utm_source=fixture#answer",
    );
  });
});
