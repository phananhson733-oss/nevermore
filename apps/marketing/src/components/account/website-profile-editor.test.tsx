// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

import en from "../../i18n/messages/en.json";
import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  emptyMarketingWebsiteProfile,
  profileSha256,
  type MarketingWebsiteProfileV1,
  type WebsiteDetails,
} from "../../lib/account-websites/contracts.ts";
import {
  AGENT_PROFILE_REFRESH_FIELD_PATHS,
  type AgentProfileRefreshData,
  type AgentProfileRefreshField,
} from "../../lib/agents/profile-refresh-contract.ts";
import type { AgentProfileSearchData } from "../../lib/agents/profile-search-contract.ts";

vi.mock("../ui/button.tsx", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<"button"> & {
    variant?: string;
    size?: string;
  }) => <button {...props} />,
}));
vi.mock("../ui/card.tsx", () => ({
  Card: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  CardContent: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  CardHeader: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  CardTitle: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  CardDescription: ({ children, ...props }: React.ComponentProps<"div">) => (
    <p {...props}>{children}</p>
  ),
}));
vi.mock("../ui/input.tsx", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("../ui/textarea.tsx", () => ({
  Textarea: (props: React.ComponentProps<"textarea">) => (
    <textarea {...props} />
  ),
}));
vi.mock("../ui/label.tsx", () => ({
  Label: (props: React.ComponentProps<"label">) => <label {...props} />,
}));

const { WebsiteProfileEditor } = await import("./website-profile-editor.tsx");

const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const SNAPSHOT_ID = "a53f4ddb-7cd6-42da-af53-88cc68b41987";
const NOW = "2026-08-28T00:00:00.000Z";

const EDITOR = {
  loading: "Loading profile…",
  signedOut: "Sign in to edit this profile.",
  unavailable: "Profile unavailable.",
  notFound: "Website not found.",
  productSection: "Product",
  icpSection: "ICP",
  marketSection: "Market and language",
  competitorSection: "Competitors",
  competitors: {
    description:
      "Review search suggestions before saving a competitor relationship. Suggestions do not change the confirmed profile.",
    systemSuggestion: "Search suggestion · review required",
    savedClassification: "Saved classification",
    draftClassification: "Draft classification · not saved",
    empty: "No saved relationship or search suggestion yet.",
    editSaved: "Edit saved classifications",
    manualHelp:
      "Only saved classifications are reused by other tools. Add or adjust them here, or classify a search candidate above.",
  },
  sourcesSection: "Sources and versions",
  listAdd: "Add item",
  listRemove: "Remove",
  saveDraft: "Save draft",
  retrySave: "Retry save",
  listIncomplete: "Finish or remove empty list items before saving.",
  rescan: "Re-scan website",
  generating: "Scanning…",
  generationFailed: "Refresh failed.",
  saveState: {
    unsaved: "Unsaved",
    saving: "Saving…",
    saved: "Saved",
    failed: "Save failed",
    conflicted: "Conflict",
  },
  conflict: {
    title: "Resolve conflict",
    body: "Choose local or server values, then save against the latest version.",
    local: "Local",
    server: "Server",
    keepLocal: "Keep local",
    useServer: "Use server",
    save: "Save merged draft",
  },
  confirm: {
    title: "Confirm profile",
    missing: "Complete required fields before confirming.",
    changes: "{count} changes from the current confirmed version",
    action: "Confirm profile",
    confirming: "Confirming…",
    version: "Confirmed v{revision}",
    failed: "Confirmation failed.",
    edit: "Edit profile",
    body: "The confirmed version is ready to use.",
  },
  draftVersion: "Draft v{version}",
  noSources: "No source URLs yet.",
};

const MESSAGES = {
  account: {
    websites: {
      fields: {
        productName: "Product name",
        oneLinePositioning: "One-line positioning",
        valueProposition: "Value proposition",
        coreFeatures: "Core features",
        categories: "Categories",
        businessModel: "Business model",
        primaryCta: "Primary CTA",
        trustSignals: "Trust signals",
        primaryIcp: "Primary ICP",
        buyer: "Buyer",
        user: "User",
        triggerPain: "Trigger pain",
        icpInterests: "ICP interests",
        icpPain: "ICP pain",
        icpBehavior: "ICP behavior",
        icpPositioning: "ICP positioning",
        jtbd: "Job to be done",
        useCases: "Use cases",
        outcomes: "Desired outcomes",
        barriers: "Barriers",
        qualificationSignals: "Qualification signals",
        disqualifiers: "Disqualifiers",
        directCompetitors: "Direct competitors",
        indirectAlternatives: "Indirect alternatives",
        excludedAlternatives: "Excluded alternatives",
        firstOutcome: "First outcome",
        country: "Primary market",
        locale: "Primary language",
      },
      refresh: {
        title: "Review refresh",
        available: "A complete refresh is ready.",
        partial: "A partial refresh is ready.",
        no_data: "No reusable fields were found.",
        current: "Current",
        proposed: "Proposed",
        evidence: "Sources",
        applyAll: "Apply all proposals",
        applyField: "Apply",
        dismiss: "Dismiss",
        noChanges: "No field changes were proposed.",
      },
      editor: EDITOR,
    },
  },
  agents: {
    workbench: {
      profile: en.agents.workbench.profile,
    },
  },
};
const PROFILE_SEARCH = en.agents.workbench.profile.search;

function profile(
  overrides: Partial<MarketingWebsiteProfileV1> = {},
): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "Example",
    oneLinePositioning: "Focused positioning",
    valueProposition: "Old value",
    coreFeatures: ["Feature A", "Feature B"],
    primaryIcp: "Growth teams",
    country: "US",
    locale: "en-US",
    fieldProvenance: [
      {
        path: "/productName",
        derivation: "declared",
        confidence: "high",
        source: "user_edit",
        limitation: null,
        observedAt: null,
        evidenceUrls: [],
      },
    ],
    ...overrides,
  };
}

async function details(
  draftProfile: MarketingWebsiteProfileV1,
  options: {
    readonly draftVersion?: number;
    readonly snapshotProfile?: MarketingWebsiteProfileV1 | null;
    readonly snapshotRevision?: number;
  } = {},
): Promise<WebsiteDetails> {
  const draftVersion = options.draftVersion ?? 2;
  const snapshotProfile =
    options.snapshotProfile === undefined
      ? draftProfile
      : options.snapshotProfile;
  const draftHash = await profileSha256(draftProfile);
  const snapshotHash =
    snapshotProfile === null ? null : await profileSha256(snapshotProfile);
  const state =
    snapshotHash === null
      ? "draft"
      : snapshotHash === draftHash
        ? "confirmed"
        : "unconfirmed_changes";
  const revision = options.snapshotRevision ?? 1;
  return {
    websiteId: WEBSITE_ID,
    origin: "https://example.com",
    submittedUrl: "https://example.com/",
    host: "example.com",
    canonicalSiteKey: "example.com",
    displayName: "Example",
    isPrimary: true,
    profileState: state,
    confirmedSnapshotId: snapshotProfile === null ? null : SNAPSHOT_ID,
    confirmedSnapshotRevision: snapshotProfile === null ? null : revision,
    confirmedAt: snapshotProfile === null ? null : NOW,
    createdAt: NOW,
    updatedAt: NOW,
    draft: {
      draftVersion,
      updatedAt: NOW,
      profileHash: draftHash,
      profile: draftProfile,
    },
    currentConfirmedSnapshot:
      snapshotProfile === null
        ? null
        : {
            schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
            websiteId: WEBSITE_ID,
            snapshotId: SNAPSHOT_ID,
            snapshotRevision: revision,
            profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
            profileHash: snapshotHash as string,
            confirmedAt: NOW,
            profile: snapshotProfile,
          },
  };
}

function refresh(): AgentProfileRefreshData {
  const available = {
    productName: {
      value: "Crawler suggestion",
      confidence: "medium" as const,
    },
    valueProposition: {
      value: "Fresh evidenced value",
      confidence: "high" as const,
    },
  };
  const fields = AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path) => {
    if (path === "productName" || path === "valueProposition") {
      return {
        path,
        state: "available",
        value: available[path].value,
        derivation: "inferred",
        confidence: available[path].confidence,
        source: "public_page",
        limitation: null,
        evidenceUrls: ["https://example.com/"],
      } as AgentProfileRefreshField;
    }
    return {
      path,
      state: "unavailable",
      value: null,
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      limitation: "Not found in the bounded public pages.",
      evidenceUrls: [],
    } as AgentProfileRefreshField;
  });
  return {
    schemaVersion: "agent_profile_refresh.v1",
    agent: "seo",
    request: {
      submittedUrl: "https://example.com/",
      normalizedUrl: "https://example.com/",
      targetHost: "example.com",
      marketCode: "US",
      languageTag: "en-US",
      outputLocale: "en",
    },
    availability: "partial",
    observedAt: NOW,
    cache: { status: "fresh", capturedAt: NOW },
    diagnostics: {
      resolvedOrigin: "https://example.com",
      pagesFetched: 1,
      productPagesFetched: 1,
      stopReason: null,
      contextSufficient: false,
      sourceUrls: ["https://example.com/"],
      fieldsAvailable: 2,
      fieldsMissing: fields.length - 2,
    },
    fields,
  };
}

function refreshWithPositioningProposal(): AgentProfileRefreshData {
  const baseline = refresh();
  const fields = baseline.fields.map((field) =>
    field.path === "oneLinePositioning"
      ? ({
          path: field.path,
          state: "available",
          value: "Crawler positioning",
          derivation: "inferred",
          confidence: "medium",
          source: "public_page",
          limitation: null,
          evidenceUrls: ["https://example.com/"],
        } satisfies AgentProfileRefreshField)
      : field,
  );
  return {
    ...baseline,
    diagnostics: {
      ...baseline.diagnostics,
      fieldsAvailable: baseline.diagnostics.fieldsAvailable + 1,
      fieldsMissing: baseline.diagnostics.fieldsMissing - 1,
    },
    fields,
  };
}

function noDataRefresh(): AgentProfileRefreshData {
  const baseline = refresh();
  const fields = AGENT_PROFILE_REFRESH_FIELD_PATHS.map(
    (path) =>
      ({
        path,
        state: "unavailable",
        value: null,
        derivation: "missing",
        confidence: "unknown",
        source: "not_available",
        limitation: "Not found in the bounded public pages.",
        evidenceUrls: [],
      }) as AgentProfileRefreshField,
  );
  return {
    ...baseline,
    availability: "no_data",
    diagnostics: {
      ...baseline.diagnostics,
      fieldsAvailable: 0,
      fieldsMissing: fields.length,
    },
    fields,
  };
}

function availableProfileSearch(): AgentProfileSearchData {
  return {
    schemaVersion: "agent_profile_search.v1",
    agent: "seo",
    targetHost: "example.com",
    availability: "available",
    method: "competitors_domain",
    market: { code: "US", locationCode: 2840, languageCode: "en" },
    observedAt: NOW,
    rows: [
      {
        kind: "organic_search_overlap",
        domain: "rival.example",
        intersections: 9,
        averagePosition: 4.5,
        summedPosition: 40.5,
        organicEstimatedTrafficVolume: 321,
      },
    ],
  };
}

function unavailableProfileSearch(
  availability: "no_data" | "market_unsupported" | "source_unavailable",
): AgentProfileSearchData {
  if (availability === "market_unsupported") {
    return {
      schemaVersion: "agent_profile_search.v1",
      agent: "seo",
      targetHost: "example.com",
      availability,
      method: null,
      market: { code: "US", locationCode: null, languageCode: null },
      observedAt: null,
      rows: [],
    };
  }
  if (availability === "source_unavailable") {
    return {
      schemaVersion: "agent_profile_search.v1",
      agent: "seo",
      targetHost: "example.com",
      availability,
      method: "competitors_domain",
      market: { code: "US", locationCode: 2840, languageCode: "en" },
      observedAt: null,
      rows: [],
    };
  }
  return {
    schemaVersion: "agent_profile_search.v1",
    agent: "seo",
    targetHost: "example.com",
    availability,
    method: "competitors_domain",
    market: { code: "US", locationCode: 2840, languageCode: "en" },
    observedAt: NOW,
    rows: [],
  };
}

function answer(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function change(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("WebsiteProfileEditor", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function mount(
    autoGenerate = false,
    websiteId = WEBSITE_ID,
  ): Promise<void> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <WebsiteProfileEditor
            websiteId={websiteId}
            autoGenerate={autoGenerate}
          />
        </NextIntlClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!host.textContent?.includes(EDITOR.loading)) return;
      await settle();
    }
    throw new Error("editor still loading");
  }

  async function settle(): Promise<void> {
    await act(async () => {
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(0);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      for (let index = 0; index < 12; index += 1) {
        await Promise.resolve();
      }
    });
  }

  async function waitForSaveState(value: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (host.querySelector(`[data-save-state="${value}"]`) !== null) return;
      await settle();
    }
    throw new Error(`save state ${value} did not render`);
  }

  async function waitForConfirmation(): Promise<void> {
    await vi.waitFor(async () => {
      await settle();
      expect(host.textContent).not.toContain(EDITOR.confirm.confirming);
    });
  }

  function field(label: string): HTMLInputElement | HTMLTextAreaElement {
    const labelNode = [...host.querySelectorAll("label")].find(
      (node) => node.textContent?.trim() === label,
    );
    const id = labelNode?.getAttribute("for");
    const node = id ? document.getElementById(id) : null;
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
      throw new Error("field missing");
    }
    return node;
  }

  function button(label: string): HTMLButtonElement {
    const node = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!(node instanceof HTMLButtonElement)) throw new Error("button missing");
    return node;
  }

  function listValues(fieldName: string): readonly string[] {
    return [
      ...host.querySelectorAll<HTMLInputElement>(
        `[data-list-field="${fieldName}"] input`,
      ),
    ].map((input) => input.value);
  }

  function competitorAction(
    classification: "direct" | "indirect" | "excluded",
  ): HTMLButtonElement {
    const node = host.querySelector<HTMLButtonElement>(
      `[data-profile-competitor-candidate="rival.example"] [data-profile-competitor-action="${classification}"]`,
    );
    if (node === null) throw new Error("competitor action missing");
    return node;
  }

  function competitorSummary(
    classification: "direct" | "indirect" | "excluded",
    source: "system" | "saved" | "draft",
  ): readonly string[] {
    return [
      ...host.querySelectorAll(
        `[data-competitor-summary="${classification}"] [data-competitor-source="${source}"]`,
      ),
    ].map((node) => node.textContent ?? "");
  }

  function profileSearchCalls(fetchMock: MockInstance<typeof fetch>) {
    return fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/api/agents/seo/profile-search"),
    );
  }

  function profileSearchBody(fetchMock: MockInstance<typeof fetch>, index = 0): {
    readonly url: string;
    readonly marketCode: string;
    readonly languageTag: string;
    readonly targetQuery: string;
    readonly productProfileSearchSeeds: readonly string[];
  } {
    const searchCall = profileSearchCalls(fetchMock)[index];
    if (searchCall === undefined) throw new Error("profile-search call missing");
    return JSON.parse(String(searchCall[1]?.body)) as {
      readonly url: string;
      readonly marketCode: string;
      readonly languageTag: string;
      readonly targetQuery: string;
      readonly productProfileSearchSeeds: readonly string[];
    };
  }

  function refreshFieldAction(fieldName: string): HTMLButtonElement {
    const node = host.querySelector<HTMLButtonElement>(
      `[data-refresh-field="${fieldName}"] button`,
    );
    if (node === null) throw new Error(`refresh field ${fieldName} missing`);
    return node;
  }

  async function editListField(
    fieldName: string,
    value: string,
    index = 0,
  ): Promise<void> {
    const fieldset = host.querySelector<HTMLElement>(
      `[data-list-field="${fieldName}"]`,
    );
    if (fieldset === null) throw new Error(`list field ${fieldName} missing`);
    let inputs = fieldset.querySelectorAll<HTMLInputElement>("input");
    if (inputs[index] === undefined) {
      const add = [...fieldset.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) => candidate.getAttribute("aria-label")?.startsWith(EDITOR.listAdd + " "),
      );
      if (add === undefined) throw new Error(`add ${fieldName} missing`);
      await act(async () => add.click());
      inputs = fieldset.querySelectorAll<HTMLInputElement>("input");
    }
    const input = inputs[index];
    if (input === undefined) throw new Error(`list item ${fieldName} missing`);
    await act(async () => change(input, value));
  }

  async function addBlankListItem(fieldName: string): Promise<void> {
    const fieldset = host.querySelector<HTMLElement>(
      `[data-list-field="${fieldName}"]`,
    );
    if (fieldset === null) throw new Error(`list field ${fieldName} missing`);
    const add = [...fieldset.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.getAttribute("aria-label")?.startsWith(EDITOR.listAdd + " "),
    );
    if (add === undefined) throw new Error(`add ${fieldName} missing`);
    await act(async () => add.click());
  }

  function expectNoCompetitorDraftWrite(
    fetchMock: MockInstance<typeof fetch>,
    expected: {
      readonly direct?: readonly string[];
      readonly indirect?: readonly string[];
      readonly excluded?: readonly string[];
    } = {},
  ): void {
    expect(listValues("directCompetitors")).toEqual(expected.direct ?? []);
    expect(listValues("indirectAlternatives")).toEqual(
      expected.indirect ?? [],
    );
    expect(listValues("excludedAlternatives")).toEqual(
      expected.excluded ?? [],
    );
    expect(host.querySelector('[data-save-state="saved"]')).not.toBeNull();
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          init?.method === "PATCH" ||
          String(input).endsWith("/confirm"),
      ),
    ).toHaveLength(0);
  }

  it("renders four sections and list fields as separate editable items", async () => {
    const initial = await details(profile());
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { website: initial } }),
    );
    await mount();
    await settle();

    expect(host.textContent).toContain(EDITOR.productSection);
    expect(host.textContent).toContain(EDITOR.icpSection);
    expect(host.textContent).toContain(EDITOR.marketSection);
    expect(host.textContent).toContain(EDITOR.sourcesSection);
    const featureInputs = host.querySelectorAll(
      '[data-list-field="coreFeatures"] input',
    );
    expect(featureInputs).toHaveLength(2);
    expect([...featureInputs].map((node) => (node as HTMLInputElement).value)).toEqual([
      "Feature A",
      "Feature B",
    ]);
    const cleanNavigation = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanNavigation);
    expect(cleanNavigation.defaultPrevented).toBe(false);
  });

  it("discovers reviewable competitors without changing the website draft", async () => {
    const initialProfile = profile({
      directCompetitors: ["manual-direct.example"],
      indirectAlternatives: ["manual-indirect.example"],
      excludedAlternatives: ["manual-excluded.example"],
    });
    const initial = {
      ...(await details(initialProfile)),
      submittedUrl: "https://example.com/pricing",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? answer(200, { data: availableProfileSearch() })
          : answer(200, { data: { website: initial } }),
    );
    await mount();
    await settle();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();

    const searchCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/agents/seo/profile-search"),
    );
    expect(searchCall).toBeDefined();
    expect(JSON.parse(String(searchCall?.[1]?.body))).toEqual({
      url: initial.submittedUrl,
      marketCode: "US",
      languageTag: "en-US",
      targetQuery: "",
      productProfileSearchSeeds: ["Example"],
    });
    expect(host.textContent).toContain("rival.example");
    expect(host.textContent).toContain(
      PROFILE_SEARCH.review.suggestedDirect,
    );
    expect(host.textContent).toContain(PROFILE_SEARCH.review.providerEvidence);
    expect(host.textContent).toContain(PROFILE_SEARCH.intersectionsLabel);
    expect(host.textContent).toContain("9");
    expect(host.textContent).toContain("4.5");
    expect(host.textContent).toContain("321");
    expect(
      host.querySelector(
        '[data-profile-competitor-candidate="rival.example"]',
      ),
    ).not.toBeNull();
    expect(
      host.querySelector(
        '[data-profile-competitor-classification-source="system"]',
      ),
    ).not.toBeNull();
    expect(
      [
        ...host.querySelectorAll<HTMLButtonElement>(
          "[data-profile-competitor-action]",
        ),
      ].every((action) => !action.disabled),
    ).toBe(true);
    expectNoCompetitorDraftWrite(fetchMock, {
      direct: initialProfile.directCompetitors,
      indirect: initialProfile.indirectAlternatives,
      excluded: initialProfile.excludedAlternatives,
    });
  });

  it("groups search suggestions separately from saved competitors and retains free-text alternatives", async () => {
    const initialProfile = profile({
      directCompetitors: ["manual-direct.example"],
      indirectAlternatives: ["manual-indirect.example", "Paper journal and counselling"],
      excludedAlternatives: ["rival.example", "Social media groups"],
    });
    const initial = await details(initialProfile);
    const search = availableProfileSearch();
    const candidates = {
      ...search,
      rows: [
        ...search.rows,
        {
          kind: "organic_search_overlap",
          domain: "system-direct.example",
          intersections: 10,
          averagePosition: 3,
          summedPosition: 30,
          organicEstimatedTrafficVolume: 400,
        },
        {
          kind: "organic_search_overlap",
          domain: "system-indirect.example",
          intersections: 1,
          averagePosition: 8,
          summedPosition: 8,
          organicEstimatedTrafficVolume: 20,
        },
      ],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/api/agents/seo/profile-search")
        ? answer(200, { data: candidates })
        : answer(200, { data: { website: initial } }),
    );
    await mount();
    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();

    expect(competitorSummary("direct", "system")).toEqual([
      expect.stringContaining("system-direct.example"),
    ]);
    expect(competitorSummary("indirect", "system")).toEqual([
      expect.stringContaining("system-indirect.example"),
    ]);
    expect(competitorSummary("excluded", "system")).toEqual([]);
    expect(competitorSummary("direct", "saved")).toEqual([
      expect.stringContaining("manual-direct.example"),
    ]);
    expect(competitorSummary("indirect", "saved")).toEqual(expect.arrayContaining([
      expect.stringContaining("manual-indirect.example"),
      expect.stringContaining("Paper journal and counselling"),
    ]));
    expect(competitorSummary("excluded", "saved")).toEqual(expect.arrayContaining([
      expect.stringContaining("rival.example"),
      expect.stringContaining("Social media groups"),
    ]));
    expect(host.querySelector('[data-website-competitors] [data-profile-competitor-candidate="rival.example"]')).not.toBeNull();
    expectNoCompetitorDraftWrite(fetchMock, {
      direct: initialProfile.directCompetitors,
      indirect: initialProfile.indirectAlternatives,
      excluded: initialProfile.excludedAlternatives,
    });
  });

  it.each(["no_data", "error"] as const)(
    "clears stale system summaries after discovery returns %s while preserving saved relationships",
    async (nextResult) => {
      const initialProfile = profile({ indirectAlternatives: ["Paper journal"] });
      const initial = await details(initialProfile);
      let searches = 0;
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        if (!String(input).endsWith("/api/agents/seo/profile-search")) {
          return answer(200, { data: { website: initial } });
        }
        searches += 1;
        if (searches === 1) return answer(200, { data: availableProfileSearch() });
        return nextResult === "no_data"
          ? answer(200, { data: unavailableProfileSearch("no_data") })
          : answer(503, { error: { code: "auth_unavailable" } });
      });
      await mount();
      await act(async () => button(PROFILE_SEARCH.action).click());
      await settle();
      expect(competitorSummary("direct", "system")).toEqual([
        expect.stringContaining("rival.example"),
      ]);

      await act(async () => button(PROFILE_SEARCH.action).click());
      await settle();

      expect(host.querySelector('[data-competitor-source="system"]')).toBeNull();
      expect(competitorSummary("indirect", "saved")).toEqual([
        expect.stringContaining("Paper journal"),
      ]);
      expectNoCompetitorDraftWrite(fetchMock, { indirect: initialProfile.indirectAlternatives });
    },
  );

  it("persists only an explicit competitor classification through the existing draft save", async () => {
    vi.useFakeTimers();
    const initialProfile = profile();
    const initial = await details(initialProfile, { snapshotRevision: 1 });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/agents/seo/profile-search")) {
          return answer(200, { data: availableProfileSearch() });
        }
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as {
            intent: string;
            baseVersion: number;
            profile: MarketingWebsiteProfileV1;
          };
          return answer(200, {
            data: {
              website: await details(body.profile, {
                draftVersion: 3,
                snapshotProfile: initialProfile,
                snapshotRevision: 1,
              }),
            },
          });
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();
    await act(async () => competitorAction("direct").click());

    expect(listValues("directCompetitors")).toEqual(["rival.example"]);
    expect(listValues("indirectAlternatives")).toEqual([]);
    expect(listValues("excludedAlternatives")).toEqual([]);
    expect(host.querySelector('[data-save-state="unsaved"]')).not.toBeNull();

    expect(competitorSummary("direct", "saved")).toEqual([]);
    expect(competitorSummary("direct", "draft").join(" ")).toContain(
      EDITOR.competitors.draftClassification,
    );

    await act(async () => vi.advanceTimersByTimeAsync(900));
    await waitForSaveState("saved");

    expect(competitorSummary("direct", "draft")).toEqual([]);
    expect(competitorSummary("direct", "saved").join(" ")).toContain("rival.example");

    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);
    const savedBody = JSON.parse(String(patchCalls[0]?.[1]?.body)) as {
      intent: string;
      baseVersion: number;
      profile: MarketingWebsiteProfileV1;
    };
    expect(savedBody).toMatchObject({
      intent: "save_profile",
      baseVersion: 2,
      profile: {
        directCompetitors: ["rival.example"],
        indirectAlternatives: [],
        excludedAlternatives: [],
      },
    });
    expect(savedBody.profile.fieldProvenance).toEqual(
      expect.arrayContaining([
        {
          path: "/directCompetitors",
          derivation: "declared",
          confidence: "high",
          source: "user_edit",
          limitation: null,
          observedAt: null,
          evidenceUrls: [],
        },
      ]),
    );
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/confirm"),
      ),
    ).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/agents/seo/profile-search"),
      ),
    ).toHaveLength(1);
    expect(
      host.querySelector(
        '[data-profile-competitor-candidate="rival.example"]',
      ),
    ).not.toBeNull();
    expect(
      host.querySelector(
        '[data-profile-competitor-classification-source="manual"]',
      ),
    ).not.toBeNull();
    expect(listValues("directCompetitors")).toEqual(["rival.example"]);
    expect(
      host.querySelector('[data-confirm-change="directCompetitors"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("Confirmed v1");
  });

  it("keeps unchanged competitor classifications saved while an unrelated field is dirty", async () => {
    vi.useFakeTimers();
    const initial = await details(profile({ directCompetitors: ["saved.example"] }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { website: initial } }),
    );
    await mount();
    await act(async () => change(field("Product name"), "Unsaved product edit"));

    expect(host.querySelector('[data-save-state="unsaved"]')).not.toBeNull();
    expect(competitorSummary("direct", "saved").join(" ")).toContain("saved.example");
    expect(competitorSummary("direct", "draft")).toEqual([]);
  });

  it("does not label a competitor classification saved when autosave fails", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/api/agents/seo/profile-search")) {
        return answer(200, { data: availableProfileSearch() });
      }
      if (init?.method === "PATCH") return answer(503, { error: { code: "unavailable" } });
      return answer(200, { data: { website: initial } });
    });
    await mount();
    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();
    await act(async () => competitorAction("direct").click());
    await act(async () => vi.advanceTimersByTimeAsync(900));
    await waitForSaveState("failed");

    expect(competitorSummary("direct", "saved")).toEqual([]);
    expect(competitorSummary("direct", "draft").join(" ")).toContain("rival.example");
    expect(competitorSummary("direct", "draft").join(" ")).toContain(
      EDITOR.competitors.draftClassification,
    );
  });

  it("moves one candidate between groups while preserving unrelated manual domains", async () => {
    vi.useFakeTimers();
    const initialProfile = profile({
      directCompetitors: [
        "direct-before.example",
        "rival.example",
        "direct-after.example",
      ],
      indirectAlternatives: [
        "indirect-before.example",
        "indirect-after.example",
      ],
      excludedAlternatives: ["excluded.example"],
    });
    const initial = await details(initialProfile);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        if (String(input).endsWith("/api/agents/seo/profile-search")) {
          return answer(200, { data: availableProfileSearch() });
        }
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as {
            profile: MarketingWebsiteProfileV1;
          };
          return answer(200, {
            data: {
              website: await details(body.profile, {
                draftVersion: 3,
                snapshotProfile: initialProfile,
              }),
            },
          });
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();
    await act(async () => competitorAction("indirect").click());

    expect(listValues("directCompetitors")).toEqual([
      "direct-before.example",
      "direct-after.example",
    ]);
    expect(listValues("indirectAlternatives")).toEqual([
      "indirect-before.example",
      "indirect-after.example",
      "rival.example",
    ]);
    expect(listValues("excludedAlternatives")).toEqual([
      "excluded.example",
    ]);
    expect(
      host.querySelector(
        '[data-profile-competitor-classification="indirect"][data-profile-competitor-classification-source="manual"]',
      ),
    ).not.toBeNull();
    expect(competitorSummary("indirect", "draft")).toContainEqual(expect.stringContaining("rival.example"));
    expect(competitorSummary("direct", "draft").join()).not.toContain("rival.example");

    await act(async () => competitorAction("excluded").click());

    expect(listValues("directCompetitors")).toEqual([
      "direct-before.example",
      "direct-after.example",
    ]);
    expect(listValues("indirectAlternatives")).toEqual([
      "indirect-before.example",
      "indirect-after.example",
    ]);
    expect(listValues("excludedAlternatives")).toEqual([
      "excluded.example",
      "rival.example",
    ]);
    expect(
      host.querySelector(
        '[data-profile-competitor-classification="excluded"][data-profile-competitor-classification-source="manual"]',
      ),
    ).not.toBeNull();
    expect(competitorSummary("excluded", "draft")).toContainEqual(expect.stringContaining("rival.example"));
    expect(competitorSummary("indirect", "draft").join()).not.toContain("rival.example");

    await act(async () => vi.advanceTimersByTimeAsync(900));
    await waitForSaveState("saved");

    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);
    expect(JSON.parse(String(patchCalls[0]?.[1]?.body))).toMatchObject({
      intent: "save_profile",
      baseVersion: 2,
      profile: {
        directCompetitors: [
          "direct-before.example",
          "direct-after.example",
        ],
        indirectAlternatives: [
          "indirect-before.example",
          "indirect-after.example",
        ],
        excludedAlternatives: ["excluded.example", "rival.example"],
      },
    });
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/confirm"),
      ),
    ).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/agents/seo/profile-search"),
      ),
    ).toHaveLength(1);
    expect(host.textContent).toContain("Confirmed v1");
    expect(host.querySelector('[data-confirm-change="directCompetitors"]')).not.toBeNull();
    expect(host.querySelector('[data-confirm-change="excludedAlternatives"]')).not.toBeNull();
  });

  it("keeps an exact selected relationship idempotent without a new draft save", async () => {
    vi.useFakeTimers();
    const initialProfile = profile({
      directCompetitors: [
        "direct-before.example",
        "rival.example",
        "direct-after.example",
      ],
      indirectAlternatives: ["indirect.example"],
      excludedAlternatives: ["excluded.example"],
      fieldProvenance: [
        ...profile().fieldProvenance,
        {
          path: "/directCompetitors",
          derivation: "observed",
          confidence: "medium",
          source: "public_page",
          limitation: "Existing relationship source must remain unchanged.",
          observedAt: NOW,
          evidenceUrls: ["https://example.com/evidence"],
        },
      ],
    });
    const initial = await details(initialProfile);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? answer(200, { data: availableProfileSearch() })
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();
    expect(competitorAction("direct").disabled).toBe(false);
    await act(async () => competitorAction("direct").click());
    await act(async () => vi.advanceTimersByTimeAsync(900));
    await settle();

    expect(listValues("directCompetitors")).toEqual(
      initialProfile.directCompetitors,
    );
    expect(listValues("indirectAlternatives")).toEqual(
      initialProfile.indirectAlternatives,
    );
    expect(listValues("excludedAlternatives")).toEqual(
      initialProfile.excludedAlternatives,
    );
    expect(host.querySelector('[data-save-state="saved"]')).not.toBeNull();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/confirm"),
      ),
    ).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/agents/seo/profile-search"),
      ),
    ).toHaveLength(1);
  });

  it.each([
    ["productName", "Product name", "Changed product"],
    ["categories", null, "Changed category"],
    ["oneLinePositioning", "One-line positioning", "Changed positioning"],
    ["coreFeatures", null, "Changed feature"],
    ["country", "Primary market", "CA"],
    ["locale", "Primary language", "fr-CA"],
  ] as const)(
    "proactively clears a settled competitor result after a %s identity edit",
    async (fieldName, scalarLabel, changedValue) => {
      const initialProfile = profile();
      const initial = await details(initialProfile);
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input) =>
          String(input).endsWith("/api/agents/seo/profile-search")
            ? answer(200, { data: availableProfileSearch() })
            : answer(200, { data: { website: initial } }),
      );
      await mount();

      await act(async () => button(PROFILE_SEARCH.action).click());
      await settle();
      expect(
        host.querySelector(
          '[data-profile-competitor-candidate="rival.example"]',
        ),
      ).not.toBeNull();
      const staleAction = competitorAction("direct");

      if (scalarLabel !== null) {
        await act(async () => change(field(scalarLabel), changedValue));
      } else {
        await editListField(fieldName, changedValue);
      }
      await settle();

      expect(
        host.querySelector(
          '[data-profile-competitor-candidate="rival.example"]',
        ),
      ).toBeNull();
      await act(async () => staleAction.click());
      expect(listValues("directCompetitors")).toEqual([]);
      expect(listValues("indirectAlternatives")).toEqual([]);
      expect(listValues("excludedAlternatives")).toEqual([]);
      expect(profileSearchCalls(fetchMock)).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).endsWith("/confirm"),
        ),
      ).toHaveLength(0);
    },
  );

  it("keeps settled candidates after a relationship-list edit", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? answer(200, { data: availableProfileSearch() })
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();
    await editListField("directCompetitors", "manual.example");
    await settle();

    expect(listValues("directCompetitors")).toEqual(["manual.example"]);
    expect(
      host.querySelector(
        '[data-profile-competitor-candidate="rival.example"]',
      ),
    ).not.toBeNull();
    expect(profileSearchCalls(fetchMock)).toHaveLength(1);
  });

  it("discovers with identity fields while an unrelated list has a blank row", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? answer(200, { data: availableProfileSearch() })
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await addBlankListItem("trustSignals");
    await settle();

    expect(listValues("trustSignals")).toEqual([""]);
    expect(button(PROFILE_SEARCH.action).disabled).toBe(false);
    expect(profileSearchCalls(fetchMock)).toHaveLength(0);

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();

    expect(profileSearchCalls(fetchMock)).toHaveLength(1);
    expect(profileSearchBody(fetchMock)).toEqual({
      url: initial.submittedUrl,
      marketCode: "US",
      languageTag: "en-US",
      targetQuery: "",
      productProfileSearchSeeds: ["Example"],
    });
    expect(
      host.querySelector(
        '[data-profile-competitor-candidate="rival.example"]',
      ),
    ).not.toBeNull();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/confirm"),
      ),
    ).toHaveLength(0);
  });

  it("keeps a settled result and enabled discovery through a blank relationship row", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? answer(200, { data: availableProfileSearch() })
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();
    await addBlankListItem("directCompetitors");
    await settle();

    expect(listValues("directCompetitors")).toEqual([""]);
    expect(
      host.querySelector(
        '[data-profile-competitor-candidate="rival.example"]',
      ),
    ).not.toBeNull();
    expect(button(PROFILE_SEARCH.action).disabled).toBe(false);
    expect(profileSearchCalls(fetchMock)).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
  });

  it.each([
    {
      fieldName: "trustSignals",
      classification: "direct",
      direct: ["rival.example"],
      indirect: [],
    },
    {
      fieldName: "directCompetitors",
      classification: "indirect",
      direct: [""],
      indirect: ["rival.example"],
    },
  ] as const)(
    "classifies through a transient blank $fieldName row without persisting it",
    async ({ fieldName, classification, direct, indirect }) => {
      vi.useFakeTimers();
      const initial = await details(profile());
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input) =>
          String(input).endsWith("/api/agents/seo/profile-search")
            ? answer(200, { data: availableProfileSearch() })
            : answer(200, { data: { website: initial } }),
      );
      await mount();

      await act(async () => button(PROFILE_SEARCH.action).click());
      await settle();
      await addBlankListItem(fieldName);
      await settle();

      expect(
        host.querySelector(
          '[data-profile-competitor-candidate="rival.example"]',
        ),
      ).not.toBeNull();
      await act(async () => competitorAction(classification).click());

      expect(listValues(fieldName)).toContain("");
      expect(listValues("directCompetitors")).toEqual(direct);
      expect(listValues("indirectAlternatives")).toEqual(indirect);
      expect(listValues("excludedAlternatives")).toEqual([]);
      expect(
        host.querySelector(
          `[data-profile-competitor-classification="${classification}"][data-profile-competitor-classification-source="manual"]`,
        ),
      ).not.toBeNull();
      expect(
        host.querySelector(
          '[data-profile-competitor-candidate="rival.example"]',
        ),
      ).not.toBeNull();
      expect(host.querySelector('[data-save-state="unsaved"]')).not.toBeNull();
      expect(button(EDITOR.saveDraft).disabled).toBe(true);

      await act(async () => vi.advanceTimersByTimeAsync(900));
      await settle();

      expect(profileSearchCalls(fetchMock)).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
      ).toHaveLength(0);
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).endsWith("/confirm"),
        ),
      ).toHaveLength(0);
    },
  );

  it("clears a settled search error after its request identity changes", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? answer(503, { error: { code: "auth_unavailable" } })
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();
    expect(
      host.querySelector('[data-profile-search-error="auth_unavailable"]'),
    ).not.toBeNull();

    await act(async () => change(field("Primary market"), "CA"));
    await settle();

    expect(host.querySelector("[data-profile-search-error]")).toBeNull();
    expect(profileSearchCalls(fetchMock)).toHaveLength(1);
  });

  it("ignores a late competitor response after an identity edit and returns idle", async () => {
    const initial = await details(profile());
    let resolveSearch!: (response: Response) => void;
    const searchResponse = new Promise<Response>((resolve) => {
      resolveSearch = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? searchResponse
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    expect(button(PROFILE_SEARCH.loadingAction).disabled).toBe(true);
    await act(async () => change(field("Product name"), "Changed seed"));
    resolveSearch(answer(200, { data: availableProfileSearch() }));
    await settle();

    expect(button(PROFILE_SEARCH.action).disabled).toBe(false);
    expect(
      host.querySelector(
        '[data-profile-competitor-candidate="rival.example"]',
      ),
    ).toBeNull();
    expect(listValues("directCompetitors")).toEqual([]);
    expect(listValues("indirectAlternatives")).toEqual([]);
    expect(listValues("excludedAlternatives")).toEqual([]);
    expect(profileSearchCalls(fetchMock)).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
  });

  it("aborts an in-flight search and returns idle when its identity becomes stale", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        if (String(input).endsWith("/api/agents/seo/profile-search")) {
          return new Promise<Response>(() => {});
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    const searchCall = profileSearchCalls(fetchMock)[0];
    const signal = searchCall?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    expect(button(PROFILE_SEARCH.loadingAction).disabled).toBe(true);

    await act(async () => change(field("Product name"), "New identity"));
    await settle();

    expect(signal?.aborted).toBe(true);
    expect(button(PROFILE_SEARCH.action).disabled).toBe(false);
    expect(profileSearchCalls(fetchMock)).toHaveLength(1);
    expect(
      host.querySelector("[data-profile-competitor-candidate]"),
    ).toBeNull();
    expect(listValues("directCompetitors")).toEqual([]);
    expect(listValues("indirectAlternatives")).toEqual([]);
    expect(listValues("excludedAlternatives")).toEqual([]);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/confirm"),
      ),
    ).toHaveLength(0);
  });

  it.each([
    ["no_data", "no_data"],
    ["market_unsupported", "market_unsupported"],
    ["source_unavailable", "source_unavailable"],
  ] as const)(
    "renders the %s search availability without changing the website draft",
    async (_label, availability) => {
      const initialProfile = profile();
      const initial = await details(initialProfile);
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input) =>
          String(input).endsWith("/api/agents/seo/profile-search")
            ? answer(200, { data: unavailableProfileSearch(availability) })
            : answer(200, { data: { website: initial } }),
      );
      await mount();

      await act(async () => button(PROFILE_SEARCH.action).click());
      await settle();

      expect(
        host.querySelector(
          `[data-profile-search-results="${availability}"]`,
        ),
      ).not.toBeNull();
      expectNoCompetitorDraftWrite(fetchMock);
    },
  );

  it.each([
    [401, "auth_required"],
    [503, "auth_unavailable"],
  ] as const)(
    "surfaces the stable %s profile-search error without changing the website draft",
    async (status, code) => {
      const initialProfile = profile();
      const initial = await details(initialProfile);
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input) =>
          String(input).endsWith("/api/agents/seo/profile-search")
            ? answer(status, { error: { code } })
            : answer(200, { data: { website: initial } }),
      );
      await mount();

      await act(async () => button(PROFILE_SEARCH.action).click());
      await settle();

      expect(
        host.querySelector(`[data-profile-search-error="${code}"]`),
      ).not.toBeNull();
      expectNoCompetitorDraftWrite(fetchMock);
    },
  );

  it("maps a malformed successful profile-search response to an invalid-response error", async () => {
    const initialProfile = profile();
    const initial = await details(initialProfile);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? answer(200, { data: { schemaVersion: "agent_profile_search.v0" } })
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();

    expect(
      host.querySelector(
        '[data-profile-search-error="audit_response_invalid"]',
      ),
    ).not.toBeNull();
    expectNoCompetitorDraftWrite(fetchMock);
  });

  it("cancels a profile-search body whose declared length exceeds the client bound", async () => {
    const initialProfile = profile();
    const initial = await details(initialProfile);
    const cancelBody = vi.fn();
    const oversizedResponse = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":'));
        },
        cancel: cancelBody,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(256 * 1_024 + 1),
        },
      },
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? oversizedResponse
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();

    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(
      host.querySelector(
        '[data-profile-search-error="audit_response_invalid"]',
      ),
    ).not.toBeNull();
    expectNoCompetitorDraftWrite(fetchMock);
  });

  it("cancels a chunked profile-search body when streamed bytes exceed the client bound", async () => {
    const initialProfile = profile();
    const initial = await details(initialProfile);
    const cancelBody = vi.fn();
    const oversizedResponse = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(200 * 1_024));
          controller.enqueue(new Uint8Array(100 * 1_024));
        },
        cancel: cancelBody,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? oversizedResponse
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();

    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(
      host.querySelector(
        '[data-profile-search-error="audit_response_invalid"]',
      ),
    ).not.toBeNull();
    expectNoCompetitorDraftWrite(fetchMock);
  });

  it("maps an unrecognized server profile-search code to unknown without exposing it", async () => {
    const initialProfile = profile();
    const initial = await details(initialProfile);
    const rawCode = "provider_customer_internal_state";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/api/agents/seo/profile-search")
          ? answer(503, { error: { code: rawCode } })
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await settle();

    expect(
      host.querySelector('[data-profile-search-error="unknown"]'),
    ).not.toBeNull();
    expect(
      host.querySelector(`[data-profile-search-error="${rawCode}"]`),
    ).toBeNull();
    expect(host.textContent).toContain(PROFILE_SEARCH.errors.requestFailed);
    expectNoCompetitorDraftWrite(fetchMock);
  });

  it("times out profile-search after 35 seconds without changing the website draft", async () => {
    vi.useFakeTimers();
    const initialProfile = profile();
    const initial = await details(initialProfile);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        if (String(input).endsWith("/api/agents/seo/profile-search")) {
          return new Promise<Response>(() => {});
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    await act(async () => vi.advanceTimersByTimeAsync(35_000));
    await settle();

    expect(
      host.querySelector('[data-profile-search-error="search_timeout"]'),
    ).not.toBeNull();
    expectNoCompetitorDraftWrite(fetchMock);
  });

  it("aborts an in-flight competitor search when the editor closes", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        if (String(input).endsWith("/api/agents/seo/profile-search")) {
          return new Promise<Response>(() => {});
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount();

    await act(async () => button(PROFILE_SEARCH.action).click());
    const searchCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/agents/seo/profile-search"),
    );
    expect(searchCall?.[1]?.signal?.aborted).toBe(false);

    await act(async () => root.render(<div />));
    expect(searchCall?.[1]?.signal?.aborted).toBe(true);
  });

  it("disables competitor discovery when the website profile cannot form a valid request", async () => {
    const initial = await details(profile({ country: "", locale: "" }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { website: initial } }),
    );
    await mount();

    expect(button(PROFILE_SEARCH.action).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the detail response belongs to a different website", async () => {
    const initial = await details(profile(), { snapshotProfile: null });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, {
        data: {
          website: {
            ...initial,
            websiteId: "b4f53f12-8090-4c5f-8ddb-7d9587758d7a",
          },
        },
      }),
    );
    await mount();
    await settle();

    expect(host.textContent).toContain(EDITOR.unavailable);
    expect(host.textContent).not.toContain(EDITOR.productSection);
  });

  it("debounces autosave and becomes saved only after a valid 200 response", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    let resolvePatch!: (response: Response) => void;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        if (init?.method !== "PATCH") {
          return answer(200, { data: { website: initial } });
        }
        return patchResponse;
      },
    );
    await mount();
    await settle();

    await act(async () => {
      change(field("Product name"), "Edited product");
    });
    expect(host.textContent).toContain(EDITOR.saveState.unsaved);
    await act(async () => vi.advanceTimersByTime(899));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(host.textContent).toContain(EDITOR.saveState.saving);

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    );
    const body = JSON.parse(String(patchCall?.[1]?.body)) as {
      profile: MarketingWebsiteProfileV1;
    };
    resolvePatch(
      answer(200, {
        data: {
          website: await details(body.profile, {
            draftVersion: 3,
            snapshotProfile: profile(),
          }),
        },
      }),
    );
    await waitForSaveState("saved");

    expect(host.textContent).toContain(EDITOR.saveState.saved);
    expect(body.profile.productName).toBe("Edited product");
    expect(
      body.profile.fieldProvenance.find(
        (entry) => entry.path === "/productName",
      )?.source,
    ).toBe("user_edit");
  });

  it("keeps a newly added blank list row unsaved until the user types", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { website: initial } }),
    );
    await mount();

    const featureField = host.querySelector('[data-list-field="coreFeatures"]');
    const add = [...(featureField?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.getAttribute("aria-label")?.startsWith(EDITOR.listAdd + " "),
    );
    if (!(add instanceof HTMLButtonElement)) throw new Error("add item missing");
    await act(async () => add.click());

    expect(featureField?.querySelectorAll("input")).toHaveLength(3);
    expect(
      featureField?.querySelectorAll<HTMLInputElement>("input").item(2).value,
    ).toBe("");
    await act(async () => vi.advanceTimersByTime(900));
    await settle();

    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(host.textContent).toContain(EDITOR.saveState.unsaved);
    expect(host.textContent).toContain(EDITOR.listIncomplete);
    expect(button(EDITOR.saveDraft).disabled).toBe(true);
  });

  it("preserves local input on failed save and warns before navigation", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(
        answer(503, {
          error: { code: "account_websites_unavailable" },
        }),
      );
    await mount();
    await settle();

    await act(async () => {
      change(field("Value proposition"), "Local unsaved value");
    });
    await act(async () => vi.advanceTimersByTime(900));
    await waitForSaveState("failed");

    expect(field("Value proposition").value).toBe("Local unsaved value");
    expect(host.textContent).toContain(EDITOR.saveState.failed);
    expect(host.textContent).toContain(EDITOR.retrySave);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps local values and shows field comparison on a 409", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    const server = await details(profile({ productName: "Server value" }), {
      draftVersion: 3,
      snapshotProfile: profile(),
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(
        answer(409, {
          error: {
            code: "profile_conflict",
            details: { website: server },
          },
        }),
      );
    await mount();
    await settle();

    await act(async () => {
      change(field("Product name"), "Local value");
    });
    await act(async () => vi.advanceTimersByTime(900));
    await waitForSaveState("conflicted");

    expect(field("Product name").value).toBe("Local value");
    expect(host.textContent).toContain(EDITOR.conflict.title);
    expect(host.textContent).toContain("Local value");
    expect(host.textContent).toContain("Server value");
    expect(host.textContent).toContain(EDITOR.saveState.conflicted);
    expect(button(EDITOR.saveDraft).disabled).toBe(true);
    const conflictNavigation = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(conflictNavigation);
    expect(conflictNavigation.defaultPrevented).toBe(true);
  });

  it("waits for the last manual refresh proposal before discovering competitors once", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);
        if (url.endsWith("/profile-refresh")) {
          return answer(200, { data: refreshWithPositioningProposal() });
        }
        if (url.endsWith("/api/agents/seo/profile-search")) {
          return answer(200, { data: availableProfileSearch() });
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount();
    await settle();

    await act(async () => button(EDITOR.rescan).click());
    await settle();

    expect(host.textContent).toContain("Fresh evidenced value");
    expect(host.textContent).toContain("Crawler positioning");
    expect(profileSearchCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(
      false,
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST" &&
      String(init.body).includes("baseVersion"))).toBe(false);

    await act(async () => refreshFieldAction("valueProposition").click());
    expect(field("Value proposition").value).toBe("Fresh evidenced value");
    expect(field("One-line positioning").value).toBe("Focused positioning");
    expect(host.textContent).toContain("Crawler positioning");
    expect(profileSearchCalls(fetchMock)).toHaveLength(0);

    await act(async () => refreshFieldAction("oneLinePositioning").click());
    await settle();

    expect(field("One-line positioning").value).toBe("Crawler positioning");
    expect(profileSearchCalls(fetchMock)).toHaveLength(1);
    expect(profileSearchBody(fetchMock)).toEqual({
      url: initial.submittedUrl,
      marketCode: "US",
      languageTag: "en-US",
      targetQuery: "",
      productProfileSearchSeeds: ["Example", "Crawler positioning"],
    });
    expect(host.textContent).toContain("rival.example");
    expect(host.textContent).toContain(EDITOR.saveState.unsaved);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(
      false,
    );
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/confirm")),
    ).toBe(false);
  });

  it("keeps pending discovery non-interactive after accepting all refresh proposals", async () => {
    const initial = await details(profile());
    let resolveSearch!: (response: Response) => void;
    const searchResponse = new Promise<Response>((resolve) => {
      resolveSearch = resolve;
    });
    let pendingActionState:
      | { readonly disabled: boolean; readonly text: string }
      | null = null;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);
        if (url.endsWith("/profile-refresh")) {
          return answer(200, { data: refresh() });
        }
        if (url.endsWith("/api/agents/seo/profile-search")) {
          const action = host.querySelector<HTMLButtonElement>(
            "[data-profile-search] button",
          );
          if (action === null) throw new Error("profile search action missing");
          pendingActionState = {
            disabled: action.disabled,
            text: action.textContent?.trim() ?? "",
          };
          action.click();
          return searchResponse;
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount();

    await act(async () => button(EDITOR.rescan).click());
    await settle();
    expect(profileSearchCalls(fetchMock)).toHaveLength(0);

    await act(async () => button("Apply all proposals").click());
    await settle();

    expect(pendingActionState).toEqual({
      disabled: true,
      text: PROFILE_SEARCH.loadingAction,
    });
    expect(button(PROFILE_SEARCH.loadingAction).disabled).toBe(true);
    expect(profileSearchCalls(fetchMock)).toHaveLength(1);
    expect(profileSearchCalls(fetchMock)[0]?.[1]?.signal?.aborted).toBe(false);

    resolveSearch(answer(200, { data: availableProfileSearch() }));
    await settle();

    expect(profileSearchCalls(fetchMock)).toHaveLength(1);
    expect(
      host.querySelector(
        '[data-profile-competitor-candidate="rival.example"]',
      ),
    ).not.toBeNull();
  });

  it("does not discover competitors when manual refresh proposals are dismissed", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/profile-refresh")
          ? answer(200, { data: refreshWithPositioningProposal() })
          : answer(200, { data: { website: initial } }),
    );
    await mount();

    await act(async () => button(EDITOR.rescan).click());
    await settle();
    expect(profileSearchCalls(fetchMock)).toHaveLength(0);

    await act(async () => button("Dismiss").click());
    await settle();

    expect(host.textContent).not.toContain("Crawler positioning");
    expect(profileSearchCalls(fetchMock)).toHaveLength(0);
  });

  it("honors Add + Generate with a foreground prefer-cache refresh", async () => {
    vi.useFakeTimers();
    const template = await details(profile());
    const submittedUrl =
      "https://www.example.com/pricing?utm_source=account";
    const initial: WebsiteDetails = {
      ...template,
      submittedUrl,
      profileState: "not_generated",
      confirmedSnapshotId: null,
      confirmedSnapshotRevision: null,
      confirmedAt: null,
      draft: null,
      currentConfirmedSnapshot: null,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);
        if (url.endsWith("/profile-refresh")) {
          const refreshed = refresh();
          return answer(200, {
            data: {
              ...refreshed,
              request: {
                ...refreshed.request,
                submittedUrl,
                normalizedUrl: submittedUrl,
                targetHost: "www.example.com",
              },
            },
          });
        }
        if (url.endsWith("/api/agents/seo/profile-search")) {
          return answer(200, { data: availableProfileSearch() });
        }
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as {
            profile: MarketingWebsiteProfileV1;
          };
          const saved = await details(body.profile, {
            draftVersion: 1,
            snapshotProfile: null,
          });
          return answer(200, {
            data: {
              website: {
                ...saved,
                submittedUrl,
              },
            },
          });
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount(true);
    await settle();
    await settle();
    await act(async () => vi.advanceTimersByTime(900));
    await settle();
    await settle();

    const calls = fetchMock.mock.calls;
    const refreshIndex = calls.findIndex(([input]) =>
      String(input).endsWith("/profile-refresh"),
    );
    const searchIndex = calls.findIndex(([input]) =>
      String(input).endsWith("/api/agents/seo/profile-search"),
    );
    const saveIndex = calls.findIndex(([, init]) => init?.method === "PATCH");
    expect(refreshIndex).toBeGreaterThanOrEqual(0);
    expect(searchIndex).toBeGreaterThan(refreshIndex);
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    const refreshBody = JSON.parse(String(calls[refreshIndex]?.[1]?.body)) as {
      mode: string;
      url: string;
    };
    expect(refreshBody.mode).toBe("prefer_cache");
    expect(refreshBody.url).toBe(submittedUrl);
    expect(profileSearchCalls(fetchMock)).toHaveLength(1);
    expect(profileSearchBody(fetchMock)).toEqual({
      url: submittedUrl,
      marketCode: "US",
      languageTag: "en-US",
      targetQuery: "",
      productProfileSearchSeeds: ["Crawler suggestion"],
    });
    expect(host.textContent).toContain("rival.example");
    expect(field("Value proposition").value).toBe("Fresh evidenced value");
    const savedBody = JSON.parse(String(calls[saveIndex]?.[1]?.body)) as {
      profile: MarketingWebsiteProfileV1;
    };
    expect(savedBody.profile.productName).toBe("Crawler suggestion");
    expect(savedBody.profile.directCompetitors).toEqual([]);
    expect(savedBody.profile.indirectAlternatives).toEqual([]);
    expect(savedBody.profile.excludedAlternatives).toEqual([]);
    expect(
      fetchMock.mock.calls.some(
        ([input]) => String(input).endsWith("/confirm"),
      ),
    ).toBe(false);
  });

  it.each([
    {
      label: "source-unavailable result",
      searchResponse: () =>
        answer(200, { data: unavailableProfileSearch("source_unavailable") }),
      selector: '[data-profile-search-results="source_unavailable"]',
    },
    {
      label: "request failure",
      searchResponse: () =>
        answer(503, { error: { code: "auth_unavailable" } }),
      selector: '[data-profile-search-error="auth_unavailable"]',
    },
  ])(
    "keeps and autosaves an accepted first-generation profile after a $label",
    async ({ searchResponse, selector }) => {
      vi.useFakeTimers();
      const template = await details(profile());
      const initial: WebsiteDetails = {
        ...template,
        profileState: "not_generated",
        confirmedSnapshotId: null,
        confirmedSnapshotRevision: null,
        confirmedAt: null,
        draft: null,
        currentConfirmedSnapshot: null,
      };
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input, init) => {
          const url = String(input);
          if (url.endsWith("/profile-refresh")) {
            return answer(200, { data: refresh() });
          }
          if (url.endsWith("/api/agents/seo/profile-search")) {
            return searchResponse();
          }
          if (init?.method === "PATCH") {
            const body = JSON.parse(String(init.body)) as {
              profile: MarketingWebsiteProfileV1;
            };
            return answer(200, {
              data: {
                website: await details(body.profile, {
                  draftVersion: 1,
                  snapshotProfile: null,
                }),
              },
            });
          }
          return answer(200, { data: { website: initial } });
        },
      );
      await mount(true);
      await settle();
      await settle();

      expect(field("Product name").value).toBe("Crawler suggestion");
      expect(host.querySelector(selector)).not.toBeNull();
      expect(profileSearchCalls(fetchMock)).toHaveLength(1);

      await act(async () => vi.advanceTimersByTimeAsync(900));
      await waitForSaveState("saved");

      const patchCalls = fetchMock.mock.calls.filter(
        ([, init]) => init?.method === "PATCH",
      );
      expect(patchCalls).toHaveLength(1);
      const savedBody = JSON.parse(String(patchCalls[0]?.[1]?.body)) as {
        profile: MarketingWebsiteProfileV1;
      };
      expect(savedBody.profile.productName).toBe("Crawler suggestion");
      expect(savedBody.profile.directCompetitors).toEqual([]);
      expect(savedBody.profile.indirectAlternatives).toEqual([]);
      expect(savedBody.profile.excludedAlternatives).toEqual([]);
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).endsWith("/confirm"),
        ),
      ).toBe(false);
    },
  );

  it("does not discover competitors after a failed first-generation refresh", async () => {
    const template = await details(profile());
    const initial: WebsiteDetails = {
      ...template,
      profileState: "not_generated",
      confirmedSnapshotId: null,
      confirmedSnapshotRevision: null,
      confirmedAt: null,
      draft: null,
      currentConfirmedSnapshot: null,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        String(input).endsWith("/profile-refresh")
          ? answer(503, { error: { code: "profile_refresh_unavailable" } })
          : answer(200, { data: { website: initial } }),
    );

    await mount(true);
    await settle();
    await settle();

    expect(host.textContent).toContain(EDITOR.generationFailed);
    expect(profileSearchCalls(fetchMock)).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
  });

  it("does not discover competitors from ordinary typing and autosave", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as {
            profile: MarketingWebsiteProfileV1;
          };
          return answer(200, {
            data: {
              website: await details(body.profile, { draftVersion: 3 }),
            },
          });
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount();

    await act(async () => change(field("Product name"), "Typed product"));
    await act(async () => vi.advanceTimersByTimeAsync(900));
    await waitForSaveState("saved");

    expect(field("Product name").value).toBe("Typed product");
    expect(profileSearchCalls(fetchMock)).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(1);
  });

  it("rebases a late refresh on edits made while scanning", async () => {
    const initial = await details(profile());
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") return refreshResponse;
      return answer(200, { data: { website: initial } });
    });
    await mount();
    await settle();

    await act(async () => button(EDITOR.rescan).click());
    await act(async () => {
      change(field("Value proposition"), "Typed while scanning");
    });
    resolveRefresh(answer(200, { data: refresh() }));
    await settle();

    expect(field("Value proposition").value).toBe("Typed while scanning");
    expect(host.textContent).not.toContain("Fresh evidenced value");
  });

  it("lists missing required fields and disables confirmation", async () => {
    const incomplete = profile({ valueProposition: "" });
    const initial = await details(incomplete, { snapshotProfile: null });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { website: initial } }),
    );
    await mount();
    await settle();

    expect(host.textContent).toContain(EDITOR.confirm.missing);
    expect(host.textContent).toContain("Value proposition");
    expect(button(EDITOR.confirm.action).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a no-data first generation distinct and does not create an empty draft", async () => {
    vi.useFakeTimers();
    const template = await details(profile());
    const initial: WebsiteDetails = {
      ...template,
      profileState: "not_generated",
      confirmedSnapshotId: null,
      confirmedSnapshotRevision: null,
      confirmedAt: null,
      draft: null,
      currentConfirmedSnapshot: null,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(answer(200, { data: noDataRefresh() }));
    await mount(true);
    await settle();
    await settle();
    await act(async () => vi.advanceTimersByTime(900));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("No reusable fields were found.");
    expect(profileSearchCalls(fetchMock)).toHaveLength(0);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(false);
  });

  it("aborts a foreground refresh when the editor closes", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        if (init?.method === "POST") {
          return new Promise<Response>(() => {});
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount();
    await settle();

    await act(async () => button(EDITOR.rescan).click());
    const refreshCall = fetchMock.mock.calls.find(
      ([input]) => String(input).endsWith("/profile-refresh"),
    );
    const signal = refreshCall?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      root.render(<div />);
    });
    expect(signal?.aborted).toBe(true);
  });

  it("previews and confirms an unchanged saved profile without changing revision", async () => {
    const initial = await details(profile(), { snapshotRevision: 1 });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }));
    await mount();
    await settle();

    expect(host.textContent).toContain(
      "0 changes from the current confirmed version",
    );
    await act(async () => button(EDITOR.confirm.action).click());
    await waitForConfirmation();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/account/websites/" + WEBSITE_ID + "/confirm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseVersion: 2 }),
      },
    );
    expect(host.textContent).toContain("Confirmed v1");
  });

  it("collapses only after successful confirmation and reopens the same profile without another request", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      answer(200, { data: { website: initial } }),
    );
    await mount();

    expect(field("Product name").value).toBe("Example");
    expect(host.querySelector('[data-website-profile-collapsed="true"]')).toBeNull();

    await act(async () => button(EDITOR.confirm.action).click());
    await waitForConfirmation();

    const summary = host.querySelector('[data-website-profile-collapsed="true"]');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain("Confirmed v1");
    expect(document.activeElement).toBe(summary);
    expect(() => field("Product name")).toThrow("field missing");
    const requestCount = fetchMock.mock.calls.length;

    await act(async () => button(EDITOR.confirm.edit).click());
    await settle();

    expect(host.querySelector('[data-website-profile-collapsed="true"]')).toBeNull();
    expect(field("Product name").value).toBe("Example");
    expect(document.activeElement).toBe(field("Product name"));
    expect(listValues("coreFeatures")).toEqual(["Feature A", "Feature B"]);
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
  });

  it("preserves edits made while confirmation is pending and does not collapse or mark them saved", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    let resolveConfirm!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/confirm")
        ? new Promise<Response>((resolve) => { resolveConfirm = resolve; })
        : answer(200, { data: { website: initial } }),
    );
    await mount();
    await act(async () => button(EDITOR.confirm.action).click());
    await act(async () => change(field("Product name"), "Newer local name"));
    await act(async () => vi.advanceTimersByTimeAsync(1_800));

    expect(button(EDITOR.confirm.confirming).disabled).toBe(true);
    expect(field("Product name").value).toBe("Newer local name");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);

    await act(async () => resolveConfirm(answer(200, { data: { website: initial } })));
    await waitForConfirmation();

    expect(field("Product name").value).toBe("Newer local name");
    expect(host.querySelector('[data-website-profile-collapsed="true"]')).toBeNull();
    expect(host.querySelector('[data-save-state="saved"]')).toBeNull();
    expect(host.querySelector('[data-save-state="unsaved"]')).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });

  it.each(["missing snapshot", "different profile", "wrong website"] as const)(
    "keeps the editor open when confirmation returns a %s",
    async (invalidResponse) => {
      const initial = await details(profile());
      let returned = invalidResponse === "missing snapshot"
        ? await details(profile(), { snapshotProfile: null })
        : await details(profile({ productName: "Other profile" }));
      if (invalidResponse === "wrong website") {
        returned = {
          ...initial,
          currentConfirmedSnapshot: {
            ...initial.currentConfirmedSnapshot!,
            websiteId: "b4f53f12-8090-4c5f-8ddb-7d9587758d7a",
          },
        };
      }
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
        .mockResolvedValueOnce(answer(200, { data: { website: returned } }));
      await mount();

      await act(async () => button(EDITOR.confirm.action).click());
      await waitForConfirmation();

      expect(host.querySelector('[data-website-profile-collapsed="true"]')).toBeNull();
      expect(field("Product name").value).toBe("Example");
      expect(host.querySelector('[data-confirm-error="true"]')).not.toBeNull();
    },
  );

  it("keeps the editor open and preserves local fields when confirmation conflicts", async () => {
    const initial = await details(profile());
    const server = await details(profile({ productName: "New server name" }), {
      draftVersion: 3,
      snapshotProfile: profile(),
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(answer(409, {
        error: { code: "profile_conflict", details: { website: server } },
      }));
    await mount();

    await act(async () => button(EDITOR.confirm.action).click());
    await waitForConfirmation();

    expect(host.querySelector('[data-website-profile-collapsed="true"]')).toBeNull();
    expect(field("Product name").value).toBe("Example");
    expect(host.querySelector('[data-save-state="conflicted"]')).not.toBeNull();
    expect(host.textContent).toContain("New server name");
  });

  it("ignores a late confirmation response after switching to another website", async () => {
    const initial = await details(profile());
    const nextWebsiteId = "b4f53f12-8090-4c5f-8ddb-7d9587758d7a";
    const nextDetails = await details(profile({ productName: "Next website" }));
    const next: WebsiteDetails = {
      ...nextDetails,
      websiteId: nextWebsiteId,
      currentConfirmedSnapshot: {
        ...nextDetails.currentConfirmedSnapshot!,
        websiteId: nextWebsiteId,
      },
    };
    let resolveConfirm!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/confirm")) {
        return new Promise<Response>((resolve) => { resolveConfirm = resolve; });
      }
      return answer(200, { data: { website: String(input).includes(nextWebsiteId) ? next : initial } });
    });
    await mount();
    await act(async () => button(EDITOR.confirm.action).click());

    await mount(false, nextWebsiteId);
    expect(field("Product name").value).toBe("Next website");
    await act(async () => resolveConfirm(answer(200, { data: { website: initial } })));
    await settle();

    expect(field("Product name").value).toBe("Next website");
    expect(host.querySelector('[data-website-profile-collapsed="true"]')).toBeNull();
    expect(button(EDITOR.confirm.action).disabled).toBe(false);
  });

  it("preserves local content and presents a conflict if another tab saves after confirmation", async () => {
    const captured = profile();
    const initial = await details(captured, { snapshotRevision: 1 });
    const returned = await details(profile({ productName: "Other tab draft" }), {
      draftVersion: 3,
      snapshotProfile: captured,
      snapshotRevision: 2,
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(answer(200, { data: { website: returned } }));
    await mount();
    await act(async () => button(EDITOR.confirm.action).click());
    await waitForConfirmation();

    expect(field("Product name").value).toBe(captured.productName);
    expect(host.querySelector('[data-website-profile-collapsed="true"]')).toBeNull();
    expect(host.querySelector('[data-save-state="conflicted"]')).not.toBeNull();
    expect(host.querySelector('[data-conflict-field="productName"]')?.textContent)
      .toContain("Other tab draft");
    expect(host.textContent).toContain("Confirmed v2");
  });

  it("surfaces confirmation failures instead of turning the button into a no-op", async () => {
    const initial = await details(profile());
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(
        answer(503, {
          error: { code: "account_websites_unavailable" },
        }),
      );
    await mount();
    await settle();

    await act(async () => button(EDITOR.confirm.action).click());
    await waitForConfirmation();

    expect(host.textContent).toContain(EDITOR.confirm.failed);
    expect(host.querySelector('[data-confirm-error="true"]')).not.toBeNull();
    expect(host.querySelector('[data-website-profile-collapsed="true"]')).toBeNull();
    expect(field("Product name").value).toBe("Example");

    await act(async () => {
      change(field("Product name"), "Corrected after failure");
    });
    expect(host.querySelector('[data-confirm-error="true"]')).toBeNull();
  });

  it("previews the exact fields changed from the confirmed snapshot", async () => {
    const confirmed = profile();
    const draft = profile({ productName: "New product name" });
    const initial = await details(draft, {
      snapshotProfile: confirmed,
      snapshotRevision: 1,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { website: initial } }),
    );
    await mount();
    await settle();

    expect(
      host.querySelector('[data-confirm-change="productName"]')?.textContent,
    ).toContain("Product name");
    expect(host.querySelectorAll("[data-confirm-change]")).toHaveLength(1);
  });
});
