// @vitest-environment jsdom
// @input  -- controlled profile-search observations and visible availability states
// @output -- proof of factual labels, accessible discovery controls, and zero side effects
// @pos    -- compact enrichment block contract for Stage 01 competitor context

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentProfileSearchEnvelope } from "../../lib/agents/profile-search-contract";
import {
  AgentProfileSearch,
  type AgentProfileSearchCopy,
} from "./agent-profile-search";

const COPY = {
  eyebrow: "SEARCH EVIDENCE",
  title: "Discover adjacent search domains",
  description:
    "Use the confirmed market to collect a bounded provider observation.",
  action: "Discover search candidates",
  loadingAction: "Discovering candidates",
  organicBoundary:
    "Organic search overlap — not confirmed business competitors.",
  serpBoundary:
    "Target-query SERP candidates — not confirmed business competitors.",
  noData: "No candidate domains were observed for this run.",
  marketUnsupported: "This market is not supported for this search method.",
  sourceUnavailable: "Search evidence is currently unavailable.",
  requestError: "The discovery request could not be completed.",
  domainLabel: "Domain",
  intersectionsLabel: "Keyword intersections",
  averagePositionLabel: "Average position",
  trafficLabel: "Estimated organic traffic",
  rankLabel: "Observed rank",
  observedAtLabel: "Fetched at",
} satisfies AgentProfileSearchCopy;

const ORGANIC_DATA = {
  schemaVersion: "agent_profile_search.v1",
  agent: "seo",
  targetHost: "acme.com",
  availability: "available",
  method: "competitors_domain",
  market: { code: "US", locationCode: 2840, languageCode: "en" },
  observedAt: "2026-08-13T10:00:00.000Z",
  rows: [
    {
      kind: "organic_search_overlap",
      domain: "rival.com",
      intersections: 12,
      averagePosition: 4.5,
      summedPosition: 54,
      organicEstimatedTrafficVolume: 321,
    },
  ],
} satisfies AgentProfileSearchEnvelope["data"];

const SERP_DATA = {
  schemaVersion: "agent_profile_search.v1",
  agent: "tech",
  targetHost: "acme.cn",
  availability: "available",
  method: "target_query_serp",
  market: { code: "CN", locationCode: 2156, languageCode: "zh" },
  observedAt: "2026-08-13T10:00:00.000Z",
  rows: [{ kind: "target_query_serp", domain: "rival.cn", rank: 2 }],
} satisfies AgentProfileSearchEnvelope["data"];

describe("AgentProfileSearch", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function render(
    overrides: Partial<React.ComponentProps<typeof AgentProfileSearch>> = {},
  ) {
    const props: React.ComponentProps<typeof AgentProfileSearch> = {
      loading: false,
      data: null,
      errorCode: null,
      disabled: false,
      onDiscover: vi.fn(),
      copy: COPY,
      ...overrides,
    };
    act(() => root.render(<AgentProfileSearch {...props} />));
    return props;
  }

  it("delegates discovery without performing its own network request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const props = render();

    act(() => {
      host.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(props.onDiscover).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(host.querySelector("button")?.getAttribute("type")).toBe("button");
  });

  it("renders organic overlap as provider evidence rather than business competitors", () => {
    render({ data: ORGANIC_DATA });

    const results = host.querySelector('[data-profile-search-results="available"]');
    expect(results?.textContent).toContain(COPY.organicBoundary);
    expect(results?.textContent).toContain("rival.com");
    expect(results?.textContent).toContain("12");
    expect(results?.textContent).toContain("4.5");
    expect(results?.textContent).toContain("321");
    expect(results?.textContent).toContain(
      new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(ORGANIC_DATA.observedAt)),
    );
    expect(results?.textContent).not.toMatch(/similarity|cost/i);
  });

  it("localizes provider numbers and the local fetch timestamp", () => {
    const locale = "zh-CN";
    const data = {
      ...ORGANIC_DATA,
      rows: [
        {
          ...ORGANIC_DATA.rows[0],
          intersections: 12_345,
          averagePosition: 4.75,
          organicEstimatedTrafficVolume: 98_765.5,
        },
      ],
    } satisfies AgentProfileSearchEnvelope["data"];

    render({ data, locale });

    const results = host.querySelector(
      '[data-profile-search-results="available"]',
    );
    expect(results?.textContent).toContain(
      new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
        12_345,
      ),
    );
    expect(results?.textContent).toContain(
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(data.observedAt)),
    );
    expect(results?.textContent).not.toContain(data.observedAt);
  });

  it("renders target-query candidates with factual ranks and a distinct boundary", () => {
    render({ data: SERP_DATA });

    const results = host.querySelector('[data-profile-search-results="available"]');
    expect(results?.textContent).toContain(COPY.serpBoundary);
    expect(results?.textContent).toContain("rival.cn");
    expect(results?.textContent).toContain("2");
    expect(results?.textContent).not.toContain(COPY.intersectionsLabel);
  });

  it.each([
    [
      "no_data",
      COPY.noData,
      { ...ORGANIC_DATA, availability: "no_data", rows: [] },
    ],
    [
      "market_unsupported",
      COPY.marketUnsupported,
      {
        ...ORGANIC_DATA,
        availability: "market_unsupported",
        method: null,
        market: { code: "AQ", locationCode: null, languageCode: null },
        observedAt: null,
        rows: [],
      },
    ],
    [
      "source_unavailable",
      COPY.sourceUnavailable,
      {
        ...ORGANIC_DATA,
        availability: "source_unavailable",
        observedAt: null,
        rows: [],
      },
    ],
  ] as const)("makes %s visible without fabricating metrics", (availability, message, data) => {
    render({ data });

    const state = host.querySelector(`[data-profile-search-results="${availability}"]`);
    expect(state?.textContent).toContain(message);
    expect(state?.textContent).not.toMatch(/\b0\b/);
  });

  it("shows request failures and exposes a controlled loading/disabled CTA", () => {
    render({ loading: true, disabled: true, errorCode: "quota_unavailable" });

    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.textContent).toContain(COPY.loadingAction);
    expect(
      host.querySelector('[data-profile-search-error="quota_unavailable"]')
        ?.textContent,
    ).toContain(COPY.requestError);
  });

  it("explains why discovery is disabled", () => {
    render({
      disabled: true,
      disabledReason: "Choose an ISO-2 search market first.",
    });

    const button = host.querySelector<HTMLButtonElement>("button");
    const describedBy = button?.getAttribute("aria-describedby");
    expect(button?.disabled).toBe(true);
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? "")?.textContent).toContain(
      "Choose an ISO-2 search market first.",
    );
  });

  it("keeps long domains inside a compact mobile-safe result row", () => {
    render({
      data: {
        ...SERP_DATA,
        rows: [
          {
            kind: "target_query_serp",
            domain: `${"very-long-subdomain-".repeat(8)}example.com`,
            rank: 1,
          },
        ],
      },
    });

    const block = host.querySelector("[data-profile-search]");
    const domain = host.querySelector("[data-profile-search-domain]");
    expect(block?.className).toContain("overflow-hidden");
    expect(domain?.className).toContain("break-all");
  });
});
