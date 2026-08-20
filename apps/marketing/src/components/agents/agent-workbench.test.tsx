// @vitest-environment jsdom
// @input  -- real four-stage AgentWorkbench effects with mocked session/API/dialog boundaries
// @output -- Profile confirmation, purpose-safe resume, Agent isolation, and auth-race proof
// @pos    -- browser-lifecycle guard for the account-gated SEO/Tech Agent workbench

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_AUDIT_RECORD_CATEGORIES } from "../../lib/agents/audit-contract";
import { storeOnPageDraft } from "../../lib/on-page-checker/storage";
import {
  AGENT_PROFILE_REFRESH_FIELD_PATHS,
  type AgentProfileRefreshData,
  type AgentProfileRefreshFieldPath,
} from "../../lib/agents/profile-refresh-contract";
import {
  pendingAgentIntentKey,
  readPendingAgentIntent,
  storeAgentProfileRefreshIntent,
  storeConfirmedAgentRunIntent,
  storePageFocusedAgentIntent,
  storePendingAgentIntent,
} from "./agent-intent";
import {
  confirmAgentProfile,
  createAgentProfileDraft,
  updateAgentProfile,
} from "./agent-profile";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("../auth/sign-in-dialog", () => ({
  SignInDialog: ({
    open,
    onOpenChange,
  }: {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid="sign-in-dialog" data-open={String(open)}>
      <button
        type="button"
        data-testid="close-sign-in-dialog"
        onClick={() => onOpenChange(false)}
      />
    </div>
  ),
}));

vi.mock("./agent-results", () => ({
  AgentResults: ({
    agent,
    data,
    profile,
  }: {
    readonly agent: string;
    readonly data: { readonly run: { readonly agent: string } };
    readonly profile: {
      readonly agent: string;
      readonly targetUrl: string;
      readonly reviewState: string;
      readonly country: string;
    };
  }) => (
    <div
      data-testid="agent-results"
      data-agent={agent}
      data-run-agent={data.run.agent}
      data-profile-agent={profile.agent}
      data-profile-url={profile.targetUrl}
      data-profile-state={profile.reviewState}
      data-profile-country={profile.country}
    />
  ),
}));

const { AgentWorkbench } = await import("./agent-workbench");

type AgentKind = "seo" | "tech";

function successEnvelope(agent: AgentKind, targetUrl = "astrologywiki.com") {
  return {
    data: {
      run: {
        agent,
        mode: "authenticated_agent",
        persistence: "none",
        source: {
          tool: "seo_audit",
          schemaVersion: "seo_audit.sitewide.v18",
          completedAt: "2026-08-13T00:00:00.000Z",
          cache: { status: "miss", capturedAt: null },
        },
      },
      result: {
        targetUrl,
        siteOrigin: "https://astrologywiki.com",
        scannedAt: "2026-08-13T00:00:00.000Z",
        targetInspected: true,
        inspectedTargetUrl: "https://acme.test/",
        targetPageExtract: null,
        coverage: {
          availability: "available",
          pagesInspected: 1,
          linksObserved: 0,
          sitemapUrlsObserved: 0,
          urlsSkipped: 0,
          urlsBlocked: 0,
          urlsDisallowed: 0,
          urlsErrored: 0,
          stopReason: null,
        },
        siteResources: {
          robotsFetched: true,
          robotsGroupsObserved: 1,
          sitemapReferencesObserved: 0,
          sitemapFetched: false,
        },
        records: Object.entries(AGENT_AUDIT_RECORD_CATEGORIES).map(
          ([id, category]) => ({
            id,
            category,
            state: "not_observed" as const,
            unit: "pages" as const,
            population: "every_collected_page" as const,
            targetTested: null,
            tested: 1,
            affected: 0,
            observations: [],
            limitation: null,
          }),
        ),
      },
    },
  } as const;
}

const PROFILE_REFRESH_LIST_FIELDS = new Set<AgentProfileRefreshFieldPath>([
  "coreFeatures",
  "categories",
  "trustSignals",
  "icpInterests",
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
]);

function profileRefreshEnvelope(
  agent: AgentKind,
  {
    submittedUrl = "example.com",
    marketCode = "US",
    languageTag = "en-US",
    outputLocale = "en",
    productName = "Live Example Product",
    cacheStatus = "fresh",
  }: {
    readonly submittedUrl?: string;
    readonly marketCode?: string;
    readonly languageTag?: string;
    readonly outputLocale?: string;
    readonly productName?: string;
    readonly cacheStatus?: "hit" | "fresh" | "refreshed";
  } = {},
): { readonly data: AgentProfileRefreshData } {
  const normalizedUrl = submittedUrl.startsWith("http")
    ? new URL(submittedUrl).toString()
    : new URL(`https://${submittedUrl}`).toString();
  const targetHost = new URL(normalizedUrl).hostname.toLowerCase();
  const sourceUrls = [
    `https://${targetHost}/`,
    `https://${targetHost}/about`,
    `https://${targetHost}/product`,
  ];
  const fields = AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path) =>
    path === "productName"
      ? {
          path,
          state: "available" as const,
          value: productName,
          derivation: "inferred" as const,
          confidence: "medium" as const,
          source: "public_page" as const,
          limitation: null,
          evidenceUrls: [sourceUrls[0] as string],
        }
      : {
          path,
          state: "unavailable" as const,
          value: null,
          derivation: "missing" as const,
          confidence: "unknown" as const,
          source: "not_available" as const,
          limitation: PROFILE_REFRESH_LIST_FIELDS.has(path)
            ? "No supported list was observed."
            : "No supported value was observed.",
          evidenceUrls: [] as const,
        },
  );
  return {
    data: {
      schemaVersion: "agent_profile_refresh.v1",
      agent,
      request: {
        submittedUrl,
        normalizedUrl,
        targetHost,
        marketCode,
        languageTag,
        outputLocale,
      },
      availability: "partial",
      observedAt: "2026-08-13T10:00:00.000Z",
      cache: {
        status: cacheStatus,
        capturedAt: "2026-08-13T10:00:00.000Z",
      },
      diagnostics: {
        resolvedOrigin: `https://${targetHost}`,
        pagesFetched: 3,
        productPagesFetched: 1,
        stopReason: null,
        contextSufficient: true,
        sourceUrls,
        fieldsAvailable: 1,
        fieldsMissing: 21,
      },
      fields,
    },
  };
}

function profileSearchEnvelope(
  agent: AgentKind,
  {
    targetHost = "example.com",
    marketCode = "US",
    availability = "available",
  }: {
    readonly targetHost?: string;
    readonly marketCode?: string;
    readonly availability?: "available" | "source_unavailable";
  } = {},
) {
  return {
    data: {
      schemaVersion: "agent_profile_search.v1",
      agent,
      targetHost,
      availability,
      method: "competitors_domain",
      market: {
        code: marketCode,
        locationCode: 2840,
        languageCode: "en",
      },
      observedAt:
        availability === "available" ? "2026-08-13T10:01:00.000Z" : null,
      rows:
        availability === "available"
          ? [
              {
                kind: "organic_search_overlap",
                domain: "competitor.example",
                intersections: 12,
                averagePosition: 8.5,
                summedPosition: 102,
                organicEstimatedTrafficVolume: 850,
              },
            ]
          : [],
    },
  } as const;
}

let root: Root | null = null;

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  });
}

function renderStrict(agent: AgentKind, locale = "en"): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <StrictMode>
        <AgentWorkbench agent={agent} locale={locale} />
      </StrictMode>,
    );
  });
}

function rerenderStrict(agent: AgentKind): void {
  act(() => {
    root?.render(
      <StrictMode>
        <AgentWorkbench agent={agent} locale="en" />
      </StrictMode>,
    );
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setValue) throw new Error("HTMLInputElement.value setter unavailable");
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setProfileUrl(agent: AgentKind, value: string): void {
  setInputValue(
    document.querySelector(`#${agent}-profile-target-url`) as HTMLInputElement,
    value,
  );
}

function setRunContext(
  country = "US",
  locale = "en-US",
  targetQuery?: string,
): void {
  setInputValue(
    document.querySelector(
      '[data-profile-refresh-field="market"]',
    ) as HTMLInputElement,
    country,
  );
  setInputValue(
    document.querySelector(
      '[data-profile-refresh-field="language"]',
    ) as HTMLInputElement,
    locale,
  );
  if (targetQuery !== undefined) {
    act(() => {
      (
        document.querySelector(
          '[data-profile-action="review"]',
        ) as HTMLButtonElement
      ).click();
    });
    setInputValue(
      document.querySelector(
        'input[aria-label="fields.targetQuery"]',
      ) as HTMLInputElement,
      targetQuery,
    );
  }
}

/** The value rendered under one Profile fact, addressed by its own label. */
function factValue(label: string): string {
  for (const term of document.querySelectorAll("dt")) {
    if ((term.textContent ?? "").trim() !== label) continue;
    return (term.nextElementSibling?.textContent ?? "").trim();
  }
  throw new Error(`no fact labelled ${label}`);
}

function confirmProfile(): void {
  act(() => {
    (
      document.querySelector(
        '[data-profile-action="confirm"]',
      ) as HTMLButtonElement
    ).click();
  });
}

function discoverSearchCandidates(): void {
  act(() => {
    (
      document.querySelector(
        "[data-profile-search] button",
      ) as HTMLButtonElement
    ).click();
  });
}

function runProfileDiagnosis(): void {
  act(() => {
    (
      document.querySelector(
        '[data-profile-refresh-action="run"]',
      ) as HTMLButtonElement
    ).click();
  });
}

function postCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}

beforeEach(() => {
  sessionStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
  document.body.replaceChildren();
});

describe("AgentWorkbench Profile gate and purpose-safe lifecycle", () => {
  it("starts one profile search after an explicit diagnosis succeeds and never starts either operation before the click", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        if (path === "/api/agents/seo/profile-refresh") {
          return Response.json(profileRefreshEnvelope("seo"));
        }
        if (path === "/api/agents/seo/profile-search") {
          expect(init?.body).toBe(
            JSON.stringify({
              url: "example.com",
              marketCode: "US",
              languageTag: "en-US",
              targetQuery: "growth evidence",
              productProfileSearchSeeds: ["Live Example Product"],
            }),
          );
          return Response.json(profileSearchEnvelope("seo"));
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext("US", "en-US", "growth evidence");
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalled();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/seo/profile-refresh",
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/seo/profile-search",
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/seo/audit",
      ),
    ).toHaveLength(0);
    expect(
      document.querySelector('[data-profile-search-results="available"]'),
    ).not.toBeNull();
  });

  it("keeps a completed profile diagnosis usable when automatic search discovery fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return Response.json({ signedIn: true });
      }
      if (path === "/api/agents/tech/profile-refresh") {
        return Response.json(profileRefreshEnvelope("tech"));
      }
      if (path === "/api/agents/tech/profile-search") {
        return Response.json(
          { error: { code: "provider_unavailable" } },
          { status: 503 },
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("Live Example Product");
    expect(
      document.querySelector('[data-profile-refresh-status="partial"]'),
    ).not.toBeNull();
    expect(
      document.querySelector(
        '[data-profile-search-error="provider_unavailable"]',
      ),
    ).not.toBeNull();
  });

  it("reuses matching automatic search evidence across repeated diagnoses but explicit search still refreshes it", async () => {
    let searchRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return Response.json({ signedIn: true });
      }
      if (path === "/api/agents/seo/profile-refresh") {
        return Response.json(profileRefreshEnvelope("seo"));
      }
      if (path === "/api/agents/seo/profile-search") {
        searchRequests += 1;
        return Response.json(profileSearchEnvelope("seo"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(searchRequests).toBe(1);

    discoverSearchCandidates();
    await flushAsyncWork();
    expect(searchRequests).toBe(2);
  });

  it("runs a new automatic search when the refreshed Product Profile seed changes", async () => {
    let profileRequests = 0;
    let searchRequests = 0;
    const searchBodies: unknown[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        if (path === "/api/agents/seo/profile-refresh") {
          profileRequests += 1;
          return Response.json(
            profileRefreshEnvelope("seo", {
              productName:
                profileRequests === 1 ? "First Live Product" : "Second Live Product",
            }),
          );
        }
        if (path === "/api/agents/seo/profile-search") {
          searchRequests += 1;
          searchBodies.push(JSON.parse(String(init?.body)));
          return Response.json(profileSearchEnvelope("seo"));
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(searchRequests).toBe(2);
    expect(searchBodies).toEqual([
      expect.objectContaining({
        productProfileSearchSeeds: ["First Live Product"],
      }),
      expect.objectContaining({
        productProfileSearchSeeds: ["Second Live Product"],
      }),
    ]);
  });

  it("reuses automatic search evidence across cosmetic Product Profile seed changes", async () => {
    let profileRequests = 0;
    let searchRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return Response.json({ signedIn: true });
      }
      if (path === "/api/agents/seo/profile-refresh") {
        profileRequests += 1;
        return Response.json(
          profileRefreshEnvelope("seo", {
            productName:
              profileRequests === 1 ? "GenGrowth   AI" : " gengrowth ai ",
          }),
        );
      }
      if (path === "/api/agents/seo/profile-search") {
        searchRequests += 1;
        return Response.json(profileSearchEnvelope("seo"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(searchRequests).toBe(1);
  });

  it("sends no hostname or placeholder seeds for an unrefreshed generic profile", async () => {
    let requestBody: unknown = null;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe("/api/agents/tech/profile-search");
        requestBody = JSON.parse(String(init?.body));
        return Response.json(profileSearchEnvelope("tech"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "gengrowth.ai");
    setRunContext();
    discoverSearchCandidates();
    await flushAsyncWork();

    expect(requestBody).toEqual({
      url: "gengrowth.ai",
      marketCode: "US",
      languageTag: "en-US",
      targetQuery: "",
      productProfileSearchSeeds: [],
    });
  });

  it("does not automatically request CN search evidence without an explicit target query", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return Response.json({ signedIn: true });
      }
      if (path === "/api/agents/seo/profile-refresh") {
        return Response.json(
          profileRefreshEnvelope("seo", {
            marketCode: "CN",
            languageTag: "zh-CN",
          }),
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext("CN", "zh-CN");
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/seo/profile-search",
      ),
    ).toHaveLength(0);
    expect(
      document.querySelector('[data-profile-refresh-status="partial"]'),
    ).not.toBeNull();
  });

  it("does not diagnose while editing and sends the exact profile request only from the explicit action", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        if (path === "/api/agents/seo/profile-refresh") {
          expect(init?.body).toBe(
            JSON.stringify({
              url: "example.com",
              marketCode: "US",
              languageTag: "en-US",
              outputLocale: "en",
              mode: "prefer_cache",
            }),
          );
          return Response.json(profileRefreshEnvelope("seo"));
        }
        if (path === "/api/agents/seo/profile-search") {
          return Response.json(profileSearchEnvelope("seo"));
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext("US", "en-US");
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalled();
    runProfileDiagnosis();
    expect(
      document
        .querySelector("[data-profile-refresh-control]")
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/seo/audit",
      ),
    ).toHaveLength(0);
    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("Live Example Product");
    expect(
      document.querySelector('[data-profile-refresh-status="partial"]'),
    ).not.toBeNull();
  });

  it("uses explicit refresh mode after a completed cached diagnosis", async () => {
    const requestBodies: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        if (path === "/api/agents/tech/profile-search") {
          return Response.json(profileSearchEnvelope("tech"));
        }
        expect(path).toBe("/api/agents/tech/profile-refresh");
        requestBodies.push(String(init?.body));
        return Response.json(
          profileRefreshEnvelope("tech", {
            cacheStatus: requestBodies.length === 1 ? "hit" : "refreshed",
          }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(requestBodies.map((body) => JSON.parse(body).mode)).toEqual([
      "prefer_cache",
      "refresh",
    ]);
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/tech/audit",
      ),
    ).toHaveLength(0);
  });

  it("keeps the last completed diagnosis when an explicit live refresh fails", async () => {
    let profileRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/session") {
        return Response.json({ signedIn: true });
      }
      profileRequests += 1;
      return profileRequests === 1
        ? Response.json(
            profileRefreshEnvelope("seo", { cacheStatus: "hit" }),
          )
        : Response.json(
            { error: { code: "profile_source_unavailable" } },
            { status: 503 },
          );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(
      document.querySelector(
        '[data-profile-refresh-status="error"]',
      )?.textContent,
    ).toContain("refresh.errors.profile_source_unavailable");
    expect(
      document.querySelector('[data-profile-refresh-action="run"]')
        ?.textContent,
    ).toBe("refresh.actions.refresh");
  });

  it("opens sign-in without posting and resumes only the pending profile diagnosis after focus", async () => {
    let signedIn = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return Response.json({ signedIn });
      }
      if (path === "/api/agents/seo/profile-refresh") {
        return Response.json(profileRefreshEnvelope("seo"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(0);
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("true");

    signedIn = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/seo/profile-refresh",
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/seo/audit",
      ),
    ).toHaveLength(0);
    expect(
      document.querySelector('[data-profile-refresh-status="partial"]'),
    ).not.toBeNull();
  });

  it("resumes a stored profile diagnosis exactly once after a signed-in reload without running audit", async () => {
    const pendingProfile = updateAgentProfile(
      createAgentProfileDraft("tech", "example.com"),
      { country: "US", locale: "en-US" },
    );
    expect(
      storeAgentProfileRefreshIntent(
        sessionStorage,
        pendingProfile,
        "prefer_cache",
      ),
    ).not.toBeNull();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return Response.json({ signedIn: true });
      }
      if (path === "/api/agents/tech/profile-refresh") {
        return Response.json(profileRefreshEnvelope("tech"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    await flushAsyncWork();

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/tech/profile-refresh",
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/tech/audit",
      ),
    ).toHaveLength(0);
    expect(
      document.querySelector('[data-profile-refresh-status="partial"]'),
    ).not.toBeNull();
    expect(readPendingAgentIntent(sessionStorage, "tech")).toBeNull();
  });

  it("fails visibly without posting when a signed-out profile diagnosis cannot store its handoff", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const fetchMock = vi.fn(async () => Response.json({ signedIn: false }));
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(0);
    expect(
      document.querySelector(
        '[data-profile-refresh-status="error"]',
      )?.textContent,
    ).toContain("refresh.errors.intent_unavailable");
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
  });

  it("cancels a signed-out profile refresh handoff when its market identity changes", async () => {
    let signedIn = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return Response.json({ signedIn });
      }
      if (path === "/api/agents/seo/profile-refresh") {
        return Response.json(profileRefreshEnvelope("seo"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();
    expect(readPendingAgentIntent(sessionStorage, "seo")?.purpose).toBe(
      "refresh_profile",
    );

    setInputValue(
      document.querySelector(
        '[data-profile-refresh-field="market"]',
      ) as HTMLInputElement,
      "CA",
    );
    signedIn = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();

    expect(readPendingAgentIntent(sessionStorage, "seo")).toBeNull();
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/seo/profile-refresh",
      ),
    ).toHaveLength(0);
  });

  it("preserves a non-identity user edit made before a signed-out profile refresh resumes", async () => {
    let signedIn = false;
    let profileSearchBody: unknown = null;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/auth/session") {
          return Response.json({ signedIn });
        }
        if (path === "/api/agents/tech/profile-refresh") {
          return Response.json(profileRefreshEnvelope("tech"));
        }
        if (path === "/api/agents/tech/profile-search") {
          profileSearchBody = JSON.parse(String(init?.body));
          return Response.json(profileSearchEnvelope("tech"));
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();

    act(() => {
      (
        document.querySelector(
          '[data-profile-action="review"]',
        ) as HTMLButtonElement
      ).click();
    });
    setInputValue(
      document.querySelector(
        'input[aria-label="fields.primaryCta"]',
      ) as HTMLInputElement,
      "Start now",
    );
    setInputValue(
      document.querySelector(
        'input[aria-label="fields.targetQuery"]',
      ) as HTMLInputElement,
      "merged search context",
    );
    signedIn = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();

    expect(
      (
        document.querySelector(
          'input[aria-label="fields.primaryCta"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("Start now");
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/tech/profile-refresh",
      ),
    ).toHaveLength(1);
    expect(profileSearchBody).toMatchObject({
      url: "example.com",
      marketCode: "US",
      languageTag: "en-US",
      targetQuery: "merged search context",
      productProfileSearchSeeds: ["Live Example Product"],
    });
  });

  it("shows auth-unavailable feedback without a profile diagnosis POST", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: { code: "auth_unavailable" } }, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(0);
    expect(
      document.querySelector(
        '[data-profile-refresh-status="error"]',
      )?.textContent,
    ).toContain("refresh.errors.auth_unavailable");
  });

  it("fails closed on a structurally valid response for the wrong Agent", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/auth/session"
        ? Response.json({ signedIn: true })
        : Response.json(profileRefreshEnvelope("tech")),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(
      document.querySelector(
        '[data-profile-refresh-status="error"]',
      )?.textContent,
    ).toContain("refresh.errors.profile_response_invalid");
    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).not.toContain("Live Example Product");
  });

  it("accepts a strict live response when the submitted URL contains a www host", async () => {
    const submittedUrl = "https://www.example.com/pricing";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/auth/session"
        ? Response.json({ signedIn: true })
        : Response.json(
            profileRefreshEnvelope("seo", {
              submittedUrl,
              productName: "WWW Example Product",
            }),
          ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", submittedUrl);
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("WWW Example Product");
    expect(
      document.querySelector('[data-profile-refresh-status="partial"]'),
    ).not.toBeNull();
  });

  it("times out a profile diagnosis independently from search and aborts its request", async () => {
    vi.useFakeTimers();
    let profileSignal: AbortSignal | null = null;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/auth/session") {
          return Promise.resolve(Response.json({ signedIn: true }));
        }
        profileSignal = init?.signal ?? null;
        return new Promise<Response>(() => undefined);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110_000);
    });

    expect(profileSignal).not.toBeNull();
    expect((profileSignal as unknown as AbortSignal).aborted).toBe(true);
    expect(
      document.querySelector(
        '[data-profile-refresh-status="error"]',
      )?.textContent,
    ).toContain("refresh.errors.profile_timeout");
    expect(
      document
        .querySelector("[data-profile-refresh-control]")
        ?.getAttribute("aria-busy"),
    ).not.toBe("true");
  });

  it("bounds a profile diagnosis when the auth preflight ignores abort", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110_000);
    });

    expect(
      document.querySelector(
        '[data-profile-refresh-status="error"]',
      )?.textContent,
    ).toContain("refresh.errors.profile_timeout");
    expect(postCalls(fetchMock)).toHaveLength(0);
  });

  it("aborts and ignores a stale profile response after the diagnosis identity changes", async () => {
    let resolveProfile!: (response: Response) => void;
    let profileSignal: AbortSignal | null = null;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/auth/session") {
          return Promise.resolve(Response.json({ signedIn: true }));
        }
        profileSignal = init?.signal ?? null;
        return new Promise<Response>((resolve) => {
          resolveProfile = resolve;
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    setInputValue(
      document.querySelector(
        '[data-profile-refresh-field="market"]',
      ) as HTMLInputElement,
      "CA",
    );

    expect(profileSignal).not.toBeNull();
    expect((profileSignal as unknown as AbortSignal).aborted).toBe(true);
    await act(async () => {
      resolveProfile(Response.json(profileRefreshEnvelope("seo")));
      await Promise.resolve();
    });

    expect(
      document.querySelector('[data-profile-refresh-status="partial"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).not.toContain("Live Example Product");
  });

  it("starts at most one profile diagnosis for rapid repeated clicks", async () => {
    let resolveProfile!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      String(input) === "/api/auth/session"
        ? Promise.resolve(Response.json({ signedIn: true }))
        : new Promise<Response>((resolve) => {
            resolveProfile = resolve;
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    act(() => {
      const action = document.querySelector(
        '[data-profile-refresh-action="run"]',
      ) as HTMLButtonElement;
      action.click();
      action.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/auth/session",
      ),
    ).toHaveLength(1);
    expect(postCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      resolveProfile(Response.json(profileRefreshEnvelope("seo")));
      await Promise.resolve();
    });
  });

  it("locks the separate audit confirmation while profile diagnosis is pending", async () => {
    let resolveProfile!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return Promise.resolve(Response.json({ signedIn: true }));
      }
      if (path === "/api/agents/seo/profile-refresh") {
        return new Promise<Response>((resolve) => {
          resolveProfile = resolve;
        });
      }
      if (path === "/api/agents/seo/audit") {
        return Promise.resolve(Response.json(successEnvelope("seo")));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext();
    const confirm = document.querySelector(
      '[data-profile-action="confirm"]',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);

    runProfileDiagnosis();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(confirm.disabled).toBe(true);
    act(() => confirm.click());
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/seo/audit",
      ),
    ).toHaveLength(0);

    await act(async () => {
      resolveProfile(
        Response.json(
          profileRefreshEnvelope("seo", {
            submittedUrl: "astrologywiki.com",
          }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(confirm.disabled).toBe(false);
  });

  it("keeps completed profile diagnostics when a non-identity profile field is edited", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/auth/session"
        ? Response.json({ signedIn: true })
        : Response.json(profileRefreshEnvelope("seo")),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext();
    runProfileDiagnosis();
    await flushAsyncWork();
    expect(
      document.querySelector('[data-profile-refresh-status="partial"]'),
    ).not.toBeNull();

    act(() => {
      (
        document.querySelector(
          '[data-profile-action="review"]',
        ) as HTMLButtonElement
      ).click();
    });
    setInputValue(
      document.querySelector(
        'input[aria-label="fields.primaryCta"]',
      ) as HTMLInputElement,
      "Start now",
    );

    expect(
      document.querySelector('[data-profile-refresh-status="partial"]'),
    ).not.toBeNull();
  });

  it("does not diagnose an invalid language tag", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "example.com");
    setRunContext("US", "not_a_locale");

    expect(
      (
        document.querySelector(
          '[data-profile-refresh-action="run"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    runProfileDiagnosis();
    await flushAsyncWork();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("canonicalizes a valid target language tag in the diagnosis request", async () => {
    let requestBody: unknown = null;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        requestBody = JSON.parse(String(init?.body));
        return Response.json(
          profileRefreshEnvelope("seo", { languageTag: "en-US" }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "example.com");
    setRunContext("US", "en-us");
    runProfileDiagnosis();
    await flushAsyncWork();

    expect(requestBody).toMatchObject({ languageTag: "en-US" });
    expect(
      document.querySelector('[data-profile-refresh-status="partial"]'),
    ).not.toBeNull();
  });

  it("requests bounded search evidence from the independent Agent endpoint", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe("/api/agents/seo/profile-search");
        expect(init?.body).toBe(
          JSON.stringify({
            url: "astrologywiki.com",
            marketCode: "CN",
            languageTag: "zh-CN",
            targetQuery: "免费星盘计算",
            productProfileSearchSeeds: [
              "AstrologyWiki",
              "Astrology tool",
              "Self-discovery platform",
              "A free birth-chart and self-exploration web app combining astrology with modern psychology.",
              "Free natal chart calculator",
            ],
          }),
        );
        return Response.json({
          data: {
            schemaVersion: "agent_profile_search.v1",
            agent: "seo",
            targetHost: "astrologywiki.com",
            availability: "source_unavailable",
            method: "target_query_serp",
            market: { code: "CN", locationCode: 2156, languageCode: "zh" },
            observedAt: null,
            rows: [],
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext("CN", "zh-CN", "免费星盘计算");
    discoverSearchCandidates();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(1);
    expect(
      document.querySelector(
        '[data-profile-search-results="source_unavailable"]',
      )?.textContent,
    ).toContain("search.sourceUnavailable");
  });

  it("stops a profile search that never settles after the client timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext();
    discoverSearchCandidates();

    const searchButton = document.querySelector(
      "[data-profile-search] button",
    ) as HTMLButtonElement;
    expect(searchButton.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });

    expect(searchButton.getAttribute("aria-busy")).toBe("false");
    expect(searchButton.disabled).toBe(false);
    expect(
      document.querySelector(
        '[data-profile-search-error="search_timeout"]',
      ),
    ).not.toBeNull();
    expect(document.querySelector("[data-profile-search-results]")).toBeNull();
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
    expect(postCalls(fetchMock)).toHaveLength(1);
  });

  it("opens sign-in and gives visible feedback when search evidence requires auth", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: "auth_required" } },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "astrologywiki.com");
    setRunContext();
    discoverSearchCandidates();
    await flushAsyncWork();

    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("true");
    expect(
      document.querySelector(
        '[data-profile-search-error="auth_required"]',
      )?.textContent,
    ).toContain("search.errors.authRequired");
  });

  it("resumes only profile search after its sign-in handoff, never a stored audit intent", async () => {
    let signedIn = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return Response.json({ signedIn });
      }
      if (path === "/api/agents/tech/profile-search") {
        if (!signedIn) {
          return Response.json(
            { error: { code: "auth_required" } },
            { status: 401 },
          );
        }
        return Response.json({
          data: {
            schemaVersion: "agent_profile_search.v1",
            agent: "tech",
            targetHost: "astrologywiki.com",
            availability: "source_unavailable",
            method: "competitors_domain",
            market: { code: "US", locationCode: 2840, languageCode: "en" },
            observedAt: null,
            rows: [],
          },
        });
      }
      if (path === "/api/agents/tech/audit") {
        return Response.json(successEnvelope("tech"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "astrologywiki.com");
    setRunContext();
    const staleAuditProfile = confirmAgentProfile(
      updateAgentProfile(createAgentProfileDraft("tech", "astrologywiki.com"), {
        country: "US",
        locale: "en-US",
      }),
    );
    storeConfirmedAgentRunIntent(sessionStorage, staleAuditProfile);
    discoverSearchCandidates();
    await flushAsyncWork();

    signedIn = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/tech/profile-search",
      ),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/agents/tech/audit",
      ),
    ).toHaveLength(0);
    expect(
      document.querySelector(
        '[data-profile-search-results="source_unavailable"]',
      ),
    ).not.toBeNull();
  });

  it.each([
    {
      identity: "URL path",
      initialContext: () => setRunContext(),
      changeIdentity: () =>
        setProfileUrl("tech", "https://astrologywiki.com/pricing"),
    },
    {
      identity: "host",
      initialContext: () => setRunContext(),
      changeIdentity: () => setProfileUrl("tech", "example.com"),
    },
    {
      identity: "market",
      initialContext: () => setRunContext(),
      changeIdentity: () =>
        setInputValue(
          document.querySelector(
            '[data-profile-refresh-field="market"]',
          ) as HTMLInputElement,
          "CA",
        ),
    },
    {
      identity: "language",
      initialContext: () => setRunContext(),
      changeIdentity: () =>
        setInputValue(
          document.querySelector(
            '[data-profile-refresh-field="language"]',
          ) as HTMLInputElement,
          "fr-CA",
        ),
    },
    {
      identity: "CN target query",
      initialContext: () => setRunContext("CN", "zh-CN", "free birth chart"),
      changeIdentity: () =>
        setInputValue(
          document.querySelector(
            'input[aria-label="fields.targetQuery"]',
          ) as HTMLInputElement,
          "免费星盘计算",
        ),
    },
  ])(
    "cancels an auth-required profile-search resume when its $identity changes",
    async ({ initialContext, changeIdentity }) => {
      let signedIn = false;
      const profileSearchBodies: unknown[] = [];
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = String(input);
          if (path === "/api/agents/tech/profile-search") {
            profileSearchBodies.push(JSON.parse(String(init?.body)));
            if (!signedIn) {
              return Response.json(
                { error: { code: "auth_required" } },
                { status: 401 },
              );
            }
            return Response.json(
              profileSearchEnvelope("tech", {
                targetHost: "astrologywiki.com",
              }),
            );
          }
          throw new Error(`Unexpected request: ${path}`);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      renderStrict("tech");
      setProfileUrl("tech", "astrologywiki.com");
      initialContext();
      discoverSearchCandidates();
      await flushAsyncWork();

      expect(profileSearchBodies).toHaveLength(1);
      expect(
        document
          .querySelector('[data-testid="sign-in-dialog"]')
          ?.getAttribute("data-open"),
      ).toBe("true");

      changeIdentity();
      expect(
        document
          .querySelector('[data-testid="sign-in-dialog"]')
          ?.getAttribute("data-open"),
      ).toBe("false");

      signedIn = true;
      act(() => window.dispatchEvent(new Event("focus")));
      await flushAsyncWork();

      expect(profileSearchBodies).toHaveLength(1);
      expect(document.querySelector("[data-profile-search-results]")).toBeNull();
    },
  );

  it("uses the route locale for the initial Profile draft", () => {
    renderStrict("tech", "zh");

    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("未知网站");
    expect(
      document.querySelector('[data-profile-card="icp"]'),
    ).toBeNull();
    act(() => {
      (
        document.querySelector(
          'button[data-profile-action="review"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      (document.querySelector('[aria-label="fields.primaryIcp"]') as HTMLInputElement)
        .value,
    ).toBe("未知——请确认主要受众。");
    // The card heading now says the outcome is unconfirmed, so the draft's
    // language is asserted on the field itself.
    expect(
      (
        document.querySelector(
          '[aria-label="fields.firstOutcome"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("确认首个技术可靠性目标。");
  });

  it("consumes a homepage preparation intent into Stage 01 without probing or posting", async () => {
    storePendingAgentIntent(
      sessionStorage,
      "seo",
      "astrologywiki.com/chart",
      "prepare_profile",
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();

    expect(
      (document.querySelector("#seo-profile-target-url") as HTMLInputElement)
        .value,
    ).toBe("astrologywiki.com/chart");
    expect(document.body.textContent).toContain("AstrologyWiki");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
  });

  it("resumes a page-focused launch with every field the checker handed over", async () => {
    storePageFocusedAgentIntent(sessionStorage, "astrologywiki.com/chart");
    storeOnPageDraft(sessionStorage, {
      url: "astrologywiki.com/chart",
      targetQueries: ["natal chart", "birth chart"],
      country: "GB",
      locale: "en-GB",
      pageType: "guide",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();

    // Reading only the URL out of the intent is what dropped the queries, the
    // market, the language and the page role on the way over.
    expect(
      (document.querySelector("#seo-profile-target-url") as HTMLInputElement)
        .value,
    ).toBe("astrologywiki.com/chart");
    // The market and language came across too, read off the fields themselves.
    // Asserting they appear "somewhere in the page text" passed with the whole
    // draft ignored, which is the assertion doing nothing.
    expect(
      (
        document.querySelector("#seo-profile-market") as HTMLInputElement
      ).value,
    ).toBe("GB");
    expect(
      (
        document.querySelector("#seo-profile-language") as HTMLInputElement
      ).value,
    ).toBe("en-GB");
    /*
      And the gate in front of the run is open.

      Readiness reads `fieldProvenance`, not the value, and the handoff used to
      spread market and language onto the draft without touching it — so both
      fields sat filled and correct while the confirm button stayed disabled
      under a message naming those exact two fields. The only way out was to
      retype a value that was already right. Every assertion above passed
      throughout, because they all stop at the restored input.

      Scoped deliberately: this says the confirmation control is enabled and no
      readiness message is shown, which is the symptom a visitor hit. It does
      not click confirm, so it is not evidence that the confirmed handoff is
      accepted downstream — `isConfirmedAgentProfile` has its own tests.
    */
    const confirm = document.querySelector(
      'button[data-profile-action="confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    expect(confirm?.disabled).toBe(false);
    expect(document.querySelector("#seo-profile-readiness")).toBeNull();

    // Restored, never started: the visitor asked about a page, not for a crawl.
    expect(fetchMock).not.toHaveBeenCalled();
    // Both slots consumed, so neither can prefill someone else's form later.
    expect(sessionStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
    expect(sessionStorage.getItem("gengrowth:onpage-draft:v1")).toBeNull();
  });

  /**
   * The handoff exists so the Agent asks the checker's question. Restoring the
   * fields and then not sending them is the whole feature missing, and the only
   * assertions that existed stopped at the restored fields.
   */
  it("carries the handed-over queries and page role into the request", async () => {
    storePageFocusedAgentIntent(sessionStorage, "astrologywiki.com/chart");
    storeOnPageDraft(sessionStorage, {
      url: "astrologywiki.com/chart",
      targetQueries: ["natal chart", "birth chart"],
      country: "GB",
      locale: "en-GB",
      pageType: "guide",
    });
    const bodies: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        bodies.push(String(init?.body));
        return Response.json(
          successEnvelope("seo", "astrologywiki.com/chart"),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();
    setRunContext();
    confirmProfile();
    await flushAsyncWork();

    expect(bodies).toHaveLength(1);
    expect(JSON.parse(String(bodies[0]))).toEqual({
      url: "astrologywiki.com/chart",
      // Order is the visitor's, and the wire treats it as significant.
      targetQueries: ["natal chart", "birth chart"],
      pageRole: "guide",
    });
  });

  /**
   * The rest of what the checker handed over, each of which could be reverted
   * without any existing assertion noticing: the page-only scope, the first query
   * as the Profile's own label, and the page role.
   */
  it("maps the handoff into the Profile it will run under", async () => {
    storePageFocusedAgentIntent(sessionStorage, "astrologywiki.com/chart");
    storeOnPageDraft(sessionStorage, {
      url: "astrologywiki.com/chart",
      targetQueries: ["natal chart", "birth chart"],
      country: "GB",
      locale: "en-GB",
      pageType: "guide",
    });
    vi.stubGlobal("fetch", vi.fn());

    renderStrict("seo");
    await flushAsyncWork();

    const facts = document.body.textContent ?? "";
    // The visitor asked about one page, so the run is scoped to that page.
    expect(facts).toContain("options.auditScope.page-only");
    expect(facts).toContain("options.pageType.guide");
    /**
     * The first query labels the Profile. Read off that fact's own value: the
     * queries appear elsewhere on the page, so "somewhere in the body" passed
     * even with the mapping removed.
     */
    expect(factValue("fields.targetQuery")).toBe("natal chart");
  });

  /**
   * The page role is measured once it travels, so changing it changes what was
   * asked and a captured report no longer answers it.
   */
  it("discards a captured page-focused report when the page role changes", async () => {
    storePageFocusedAgentIntent(sessionStorage, "astrologywiki.com/chart");
    storeOnPageDraft(sessionStorage, {
      url: "astrologywiki.com/chart",
      targetQueries: ["natal chart"],
      country: "GB",
      locale: "en-GB",
      pageType: "guide",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        return Response.json(successEnvelope("seo", "astrologywiki.com/chart"));
      }),
    );

    renderStrict("seo");
    await flushAsyncWork();
    setRunContext();
    confirmProfile();
    await flushAsyncWork();
    expect(
      document.querySelector('[data-testid="agent-results"]'),
    ).not.toBeNull();

    // The page-role selector lives behind the Review disclosure.
    const review = [...document.querySelectorAll("button")].find((candidate) =>
      (candidate.textContent ?? "").includes("actions.review"),
    );
    expect(review).not.toBeUndefined();
    act(() => {
      review?.click();
    });
    const pageType = document.querySelector(
      '[aria-label="fields.pageType"]',
    ) as HTMLSelectElement | null;
    expect(pageType).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      pageType?.constructor.prototype ?? window.HTMLSelectElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(pageType, "product");
      pageType?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushAsyncWork();

    expect(document.querySelector('[data-testid="agent-results"]')).toBeNull();
  });

  it("keeps a page-focused launch out of an ordinary Agent request", async () => {
    // No handoff: the request body must be byte-for-byte what it was before the
    // keyword layer existed.
    const bodies: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        bodies.push(String(init?.body));
        return Response.json({ error: { code: "scan_failed" } }, { status: 502 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext();
    confirmProfile();
    await flushAsyncWork();

    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(JSON.parse(body)).toEqual({ url: "astrologywiki.com" });
    }
  });

  it("runs once only after a signed-in visitor confirms the exact Profile", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(input).toBe("/api/agents/seo/audit");
        expect(init?.body).toBe(
          JSON.stringify({ url: "astrologywiki.com/birth-chart" }),
        );
        return Response.json(
          successEnvelope("seo", "astrologywiki.com/birth-chart"),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com/birth-chart");
    setRunContext();
    expect(fetchMock).not.toHaveBeenCalled();
    confirmProfile();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(1);
    expect(
      document.querySelector('[data-testid="agent-results"]'),
    ).toMatchObject({
      dataset: expect.objectContaining({
        agent: "seo",
        runAgent: "seo",
        profileAgent: "seo",
        profileUrl: "astrologywiki.com/birth-chart",
        profileState: "confirmed",
      }),
    });
  });

  it("stores a confirmed Profile and opens sign-in without an audit POST", async () => {
    const fetchMock = vi.fn(async () => Response.json({ signedIn: false }));
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "astrologywiki.com");
    setRunContext();
    confirmProfile();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(0);
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("true");
    expect(readPendingAgentIntent(sessionStorage, "tech")).toMatchObject({
      purpose: "run_confirmed_profile",
      agent: "tech",
      url: "astrologywiki.com",
      confirmedProfile: {
        agent: "tech",
        targetUrl: "astrologywiki.com",
        reviewState: "confirmed",
      },
    });
  });

  it("resumes a confirmed StrictMode intent exactly once", async () => {
    const profile = confirmAgentProfile(
      updateAgentProfile(createAgentProfileDraft("seo", "astrologywiki.com"), {
        country: "US",
        locale: "en-US",
      }),
    );
    storeConfirmedAgentRunIntent(sessionStorage, profile);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        expect(init?.body).toBe(JSON.stringify({ url: "astrologywiki.com" }));
        return Response.json(successEnvelope("seo"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(1);
    expect(sessionStorage.getItem(pendingAgentIntentKey("seo"))).toBeNull();
    expect(document.querySelector('[data-testid="agent-results"]')).not.toBeNull();
  });

  it("never probes, prefills, or consumes the other Agent's intent", async () => {
    storePendingAgentIntent(
      sessionStorage,
      "seo",
      "seo-only.example",
      "prepare_profile",
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (document.querySelector("#tech-profile-target-url") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(readPendingAgentIntent(sessionStorage, "seo")?.url).toBe(
      "seo-only.example",
    );
  });

  it("runs signed-in even when sessionStorage access is unavailable", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) =>
        String(input) === "/api/auth/session"
          ? Response.json({ signedIn: true })
          : Response.json(successEnvelope("seo", "astrologywiki.com")),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext();
    confirmProfile();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("fails closed when a signed-out auth handoff cannot be stored", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const fetchMock = vi.fn(async () => Response.json({ signedIn: false }));
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext();
    confirmProfile();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "errors.intent_unavailable",
    );
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
  });

  it("does not post when authentication status is unavailable", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: "auth_unavailable" } },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("tech");
    setProfileUrl("tech", "astrologywiki.com");
    setRunContext();
    confirmProfile();
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "errors.auth_unavailable",
    );
  });

  it.each([
    ["invalid_url", 400, "true"],
    ["rate_limited", 429, "false"],
    ["scan_failed", 502, "false"],
  ] as const)(
    "marks the URL invalid for %s only when the URL caused the failure",
    async (errorCode, status, expectedAriaInvalid) => {
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL) =>
          String(input) === "/api/auth/session"
            ? Response.json({ signedIn: true })
            : Response.json({ error: { code: errorCode } }, { status }),
      );
      vi.stubGlobal("fetch", fetchMock);

      renderStrict("seo");
      setProfileUrl("seo", "astrologywiki.com");
      setRunContext();
      confirmProfile();
      await flushAsyncWork();

      const input = document.querySelector(
        "#seo-profile-target-url",
      ) as HTMLInputElement;
      expect(input.getAttribute("aria-invalid")).toBe(expectedAriaInvalid);
      expect(input.getAttribute("aria-describedby")).toContain(
        "seo-agent-error",
      );
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
    },
  );

  it("rechecks a confirmed dialog intent on focus and runs once after sign-in", async () => {
    let signedIn = false;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn });
        }
        return Response.json(successEnvelope("seo"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext();
    confirmProfile();
    await flushAsyncWork();
    expect(postCalls(fetchMock)).toHaveLength(0);

    signedIn = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();
    act(() => window.dispatchEvent(new Event("focus")));
    await flushAsyncWork();

    expect(postCalls(fetchMock)).toHaveLength(1);
    expect(document.querySelector('[data-testid="agent-results"]')).not.toBeNull();
  });

  it("allows only one session probe and POST for rapid double confirmation", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) =>
        String(input) === "/api/auth/session"
          ? Response.json({ signedIn: true })
          : Response.json(successEnvelope("seo")),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext();
    act(() => {
      const confirm = document.querySelector(
        '[data-profile-action="confirm"]',
      ) as HTMLButtonElement;
      confirm.click();
      confirm.click();
    });
    await flushAsyncWork();

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/auth/session"),
      ),
    ).toHaveLength(1);
    expect(postCalls(fetchMock)).toHaveLength(1);
  });

  it("resets Profile, result, error, and dialog when the Agent identity changes", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) =>
        String(input) === "/api/auth/session"
          ? Response.json({ signedIn: true })
          : Response.json(successEnvelope("seo")),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext();
    confirmProfile();
    await flushAsyncWork();
    expect(document.querySelector('[data-testid="agent-results"]')).not.toBeNull();

    rerenderStrict("tech");
    await flushAsyncWork();

    expect(
      (document.querySelector("#tech-profile-target-url") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(document.querySelector('[data-testid="agent-results"]')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(
      document
        .querySelector('[data-testid="sign-in-dialog"]')
        ?.getAttribute("data-open"),
    ).toBe("false");
    expect(document.querySelector("[data-profile-search-results]")).toBeNull();
  });

  it("keeps a captured report while the visitor edits context the audit never reads", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        return Response.json(successEnvelope("seo", "astrologywiki.com"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext();
    confirmProfile();
    await flushAsyncWork();
    expect(
      document.querySelector('[data-testid="agent-results"]'),
    ).not.toBeNull();

    act(() => {
      (
        document.querySelector(
          'button[data-profile-action="review"]',
        ) as HTMLButtonElement
      ).click();
    });
    setInputValue(
      document.querySelector(
        '[aria-label="fields.productName"]',
      ) as HTMLInputElement,
      "Renamed product",
    );
    await flushAsyncWork();

    expect(
      document.querySelector('[data-testid="agent-results"]'),
    ).not.toBeNull();
    expect(postCalls(fetchMock)).toHaveLength(1);
  });

  it("keeps a captured report labelled with the context it actually ran under", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        return Response.json(successEnvelope("seo", "astrologywiki.com"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext("US", "en-US");
    confirmProfile();
    await flushAsyncWork();

    const reportCountry = () =>
      document
        .querySelector('[data-testid="agent-results"]')
        ?.getAttribute("data-profile-country");
    expect(reportCountry()).toBe("US");

    // Editing the market after the fact must not relabel a captured report
    // with a context that run never used.
    setRunContext("GB", "en-GB");
    await flushAsyncWork();

    expect(
      document.querySelector('[data-testid="agent-results"]'),
    ).not.toBeNull();
    expect(reportCountry()).toBe("US");
  });

  it("drops a captured report once the audited URL changes", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        if (String(input) === "/api/auth/session") {
          return Response.json({ signedIn: true });
        }
        return Response.json(successEnvelope("seo", "astrologywiki.com"));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderStrict("seo");
    setProfileUrl("seo", "astrologywiki.com");
    setRunContext();
    confirmProfile();
    await flushAsyncWork();
    expect(
      document.querySelector('[data-testid="agent-results"]'),
    ).not.toBeNull();

    setProfileUrl("seo", "example.com");
    await flushAsyncWork();

    expect(document.querySelector('[data-testid="agent-results"]')).toBeNull();
  });
});
