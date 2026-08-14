// @vitest-environment jsdom
// @input  -- source-backed and generic Agent Profile drafts
// @output -- accessible review, edit, URL reset, and local confirmation behavior
// @pos    -- interaction contract for Stage 01 of each marketing Agent

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import type { AgentProfileRefreshData } from "../../lib/agents/profile-refresh-contract";
import {
  acceptAgentProfileRefreshFields,
  applyAgentProfileRefresh,
  createAgentProfileDraft,
  updateAgentProfile,
  type AgentProfileDraft,
} from "./agent-profile";

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Readonly<Record<string, unknown>>) =>
      key === "search.summary.available"
        ? `${key}:${String(values?.count)}`
        : key === "search.review.awaitingClassification"
          ? `${key}:${String(values?.count)}`
        : key.startsWith("search.counts.")
          ? `${key}:${String(values?.count)}`
        : key === "search.missingPrerequisite"
          ? `${key}:${String(values?.fields)}`
          : key === "refresh.diagnostics.stopReasons.max_urls"
            ? `${key}:pages=${String(values?.pages)}`
            : key === "refresh.sources.expand"
              ? `${key}:count=${String(values?.count)}`
              : key === "refresh.proposals.evidence"
                ? `${key}:count=${String(values?.count)}`
              : key === "refresh.proposals.useLabel"
                ? `${key}:field=${String(values?.field)}`
          : key,
}));

const { AgentProfilePanel } = await import("./agent-profile-panel");

let root: Root | null = null;

function renderPanel(
  profile: AgentProfileDraft,
  onChange = vi.fn(),
  onConfirm = vi.fn(),
  profileSearch?: React.ComponentProps<
    typeof AgentProfilePanel
  >["profileSearch"],
  profileRefresh?: React.ComponentProps<
    typeof AgentProfilePanel
  >["profileRefresh"],
  onRefresh = vi.fn(),
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <AgentProfilePanel
        agent={profile.agent}
        profile={profile}
        onChange={onChange}
        onConfirm={onConfirm}
        profileSearch={profileSearch}
        profileRefresh={profileRefresh}
        onRefresh={onRefresh}
      />,
    );
  });
  return { onChange, onConfirm, onRefresh };
}

function setValue(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype =
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("form value setter unavailable");
  act(() => {
    setter.call(control, value);
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const REFRESH_FIELD_SPECS = [
  ["productName", "string"],
  ["oneLinePositioning", "string"],
  ["valueProposition", "string"],
  ["coreFeatures", "list"],
  ["categories", "list"],
  ["businessModel", "string"],
  ["primaryCta", "string"],
  ["trustSignals", "list"],
  ["primaryIcp", "string"],
  ["buyer", "string"],
  ["user", "string"],
  ["triggerPain", "string"],
  ["icpInterests", "list"],
  ["icpPain", "string"],
  ["icpBehavior", "string"],
  ["icpPositioning", "string"],
  ["jtbd", "string"],
  ["useCases", "list"],
  ["outcomes", "list"],
  ["barriers", "list"],
  ["qualificationSignals", "list"],
  ["disqualifiers", "list"],
] as const;

function makeProfileRefreshData({
  availability = "available",
  cacheStatus = "fresh",
  contextSufficient,
  stopReason = "max_urls",
  sourceUrls: requestedSourceUrls,
}: {
  readonly availability?: "available" | "partial" | "no_data";
  readonly cacheStatus?: "hit" | "fresh" | "refreshed";
  readonly contextSufficient?: boolean;
  readonly stopReason?: AgentProfileRefreshData["diagnostics"]["stopReason"];
  readonly sourceUrls?: readonly string[];
} = {}): AgentProfileRefreshData {
  const availableCount =
    availability === "available" ? 22 : availability === "partial" ? 6 : 0;
  const sourceUrls = requestedSourceUrls ?? [
    "https://astrologywiki.com/",
    "https://astrologywiki.com/about",
  ];

  return {
    schemaVersion: "agent_profile_refresh.v1" as const,
    agent: "seo" as const,
    request: {
      submittedUrl: "astrologywiki.com",
      normalizedUrl: "https://astrologywiki.com/",
      targetHost: "astrologywiki.com",
      marketCode: "US",
      languageTag: "en-US",
      outputLocale: "en",
    },
    availability,
    observedAt: "2026-08-13T10:00:00.000Z",
    cache: {
      status: cacheStatus,
      capturedAt: "2026-08-13T10:00:00.000Z",
    },
    diagnostics: {
      resolvedOrigin: "https://astrologywiki.com",
      pagesFetched: 7,
      productPagesFetched: 3,
      stopReason,
      contextSufficient: contextSufficient ?? availableCount > 0,
      sourceUrls,
      fieldsAvailable: availableCount,
      fieldsMissing: 22 - availableCount,
    },
    fields: REFRESH_FIELD_SPECS.map(([path, kind], index) =>
      index < availableCount
        ? {
            path,
            state: "available" as const,
            value:
              kind === "list"
                ? [`Observed ${path}`]
                : `Observed ${path}`,
            derivation: "inferred" as const,
            confidence: "medium" as const,
            source: "public_page" as const,
            limitation: null,
            evidenceUrls: [sourceUrls[index % sourceUrls.length] as string],
          }
        : {
            path,
            state: "unavailable" as const,
            value: null,
            derivation: "missing" as const,
            confidence: "unknown" as const,
            source: "not_available" as const,
            limitation: "Not stated on the bounded public pages.",
            evidenceUrls: [] as const,
          },
    ) as AgentProfileRefreshData["fields"],
  };
}

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AgentProfilePanel", () => {
  it("puts URL, market, language, and an explicit diagnosis action before the four profile stages", () => {
    renderPanel(createAgentProfileDraft("seo", "astrologywiki.com"));

    const control = document.querySelector("[data-profile-refresh-control]");
    const rail = document.querySelector('[data-profile-layout="vertical-rail"]');

    expect(control).not.toBeNull();
    expect(rail).not.toBeNull();
    expect(
      (control?.compareDocumentPosition(rail as Node) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      control?.querySelector('[data-profile-refresh-field="url"]'),
    ).not.toBeNull();
    expect(
      control?.querySelector('[data-profile-refresh-field="market"]'),
    ).not.toBeNull();
    expect(
      control?.querySelector('[data-profile-refresh-field="language"]'),
    ).not.toBeNull();
    expect(
      control?.querySelector('[data-profile-refresh-action="run"]')
        ?.textContent,
    ).toBe("refresh.actions.run");
  });

  it("updates URL, market, and language locally without starting diagnosis", () => {
    const onChange = vi.fn();
    const onRefresh = vi.fn();
    renderPanel(
      createAgentProfileDraft("tech", "astrologywiki.com"),
      onChange,
      undefined,
      undefined,
      undefined,
      onRefresh,
    );

    setValue(
      document.querySelector(
        '[data-profile-refresh-field="url"]',
      ) as HTMLInputElement,
      "https://example.com/product",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agent: "tech",
        host: "example.com",
        targetUrl: "https://example.com/product",
      }),
    );

    setValue(
      document.querySelector(
        '[data-profile-refresh-field="market"]',
      ) as HTMLInputElement,
      "us",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ agent: "tech", country: "US" }),
    );

    setValue(
      document.querySelector(
        '[data-profile-refresh-field="language"]',
      ) as HTMLInputElement,
      "en-US",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ agent: "tech", locale: "en-US" }),
    );
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("offers bounded Agent-specific country and language suggestions while retaining text entry", () => {
    renderPanel(createAgentProfileDraft("tech", "astrologywiki.com"));

    const market = document.querySelector(
      '[data-profile-refresh-field="market"]',
    ) as HTMLInputElement;
    const language = document.querySelector(
      '[data-profile-refresh-field="language"]',
    ) as HTMLInputElement;
    expect(market.type).toBe("text");
    expect(language.type).toBe("text");
    expect(market.getAttribute("list")).toBe("tech-profile-market-options");
    expect(language.getAttribute("list")).toBe(
      "tech-profile-language-options",
    );
    expect(
      Array.from(
        document.querySelectorAll(
          "#tech-profile-market-options option",
        ),
        (option) => option.getAttribute("value"),
      ),
    ).toEqual([
      "US",
      "CN",
      "GB",
      "CA",
      "AU",
      "DE",
      "FR",
      "JP",
      "KR",
      "SG",
      "IN",
      "BR",
    ]);
    expect(
      Array.from(
        document.querySelectorAll(
          "#tech-profile-language-options option",
        ),
        (option) => option.getAttribute("value"),
      ),
    ).toEqual([
      "en-US",
      "zh-CN",
      "en-GB",
      "de-DE",
      "fr-FR",
      "ja-JP",
      "ko-KR",
      "pt-BR",
      "es-ES",
    ]);
  });

  it("does not run diagnosis with an invalid BCP 47 target language", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      { country: "US", locale: "not_a_language" },
    );
    renderPanel(profile, undefined, undefined, undefined, undefined, vi.fn());

    const language = document.querySelector(
      '[data-profile-refresh-field="language"]',
    ) as HTMLInputElement;
    const action = document.querySelector(
      '[data-profile-refresh-action="run"]',
    ) as HTMLButtonElement;
    expect(language.getAttribute("aria-invalid")).toBe("true");
    expect(action.disabled).toBe(true);
  });

  it("runs cached diagnosis only from the explicit top action", () => {
    const onRefresh = vi.fn();
    renderPanel(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
      undefined,
      undefined,
      undefined,
      undefined,
      onRefresh,
    );

    act(() => {
      (
        document.querySelector(
          '[data-profile-refresh-action="run"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledWith("prefer_cache");
  });

  it.each(["available", "partial", "no_data"] as const)(
    "shows truthful %s profile diagnostics from the completed result",
    (availability) => {
      const refresh = makeProfileRefreshData({ availability });
      renderPanel(
        applyAgentProfileRefresh(
          updateAgentProfile(
            createAgentProfileDraft("seo", "astrologywiki.com"),
            { country: "US", locale: "en-US" },
          ),
          refresh,
        ),
        undefined,
        undefined,
        undefined,
        {
          loading: false,
          errorCode: null,
          data: refresh,
        },
        vi.fn(),
      );

      const status = document.querySelector(
        `[data-profile-refresh-status="${availability}"]`,
      );
      expect(status).not.toBeNull();
      expect(status?.textContent).toContain(
        `refresh.availability.${availability}`,
      );
      expect(
        status?.querySelector('[data-profile-refresh-metric="pages"]')
          ?.textContent,
      ).toContain("7");
      expect(
        status?.querySelector(
          '[data-profile-refresh-metric="product-pages"]',
        )?.textContent,
      ).toContain("3");
      expect(
        status?.querySelector('[data-profile-refresh-metric="sources"]')
          ?.textContent,
      ).toContain("2");
      expect(
        status?.querySelector('[data-profile-refresh-count="unavailable"]')
          ?.textContent,
      ).toContain(String(availability === "available" ? 0 : availability === "partial" ? 16 : 22));
      for (const count of ["found", "applied", "retained", "unavailable"]) {
        expect(
          status?.querySelector(`[data-profile-refresh-count="${count}"]`),
        ).not.toBeNull();
      }
      expect(
        status?.querySelector('[data-profile-refresh-metric="missing"]'),
      ).toBeNull();
      expect(
        status?.querySelectorAll("[data-profile-refresh-source]"),
      ).toHaveLength(2);
      expect(
        status?.querySelector("[data-profile-refresh-source]")?.getAttribute(
          "href",
        ),
      ).toBe("https://astrologywiki.com/");
      expect(status?.querySelector("time")?.getAttribute("dateTime")).toBe(
        "2026-08-13T10:00:00.000Z",
      );
    },
  );

  it.each([
    ["partial", "fields.primaryCta", "fields.disqualifiers"],
    ["no_data", "fields.productName", "fields.disqualifiers"],
  ] as const)(
    "names fields that could not be obtained for a %s diagnosis",
    (availability, firstMissing, lastMissing) => {
      renderPanel(
        updateAgentProfile(
          createAgentProfileDraft("seo", "astrologywiki.com"),
          { country: "US", locale: "en-US" },
        ),
        undefined,
        undefined,
        undefined,
        {
          loading: false,
          errorCode: null,
          data: makeProfileRefreshData({ availability }),
        },
        vi.fn(),
      );

      const missing = document.querySelector(
        "[data-profile-refresh-unavailable-fields]",
      );
      expect(missing).not.toBeNull();
      expect(missing?.textContent).toContain("refresh.diagnostics.unavailableFields");
      expect(missing?.textContent).toContain(firstMissing);
      expect(missing?.textContent).toContain(lastMissing);
    },
  );

  it("separates bounded crawl volume from live-profile adoption counts", () => {
    const refresh = makeProfileRefreshData();
    const profile = applyAgentProfileRefresh(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
      refresh,
    );

    renderPanel(profile, undefined, undefined, undefined, {
      loading: false,
      errorCode: null,
      data: refresh,
    });

    const count = (name: string) =>
      document.querySelector(`[data-profile-refresh-count="${name}"]`)
        ?.textContent;
    expect(count("found")).toContain("22");
    expect(count("applied")).toContain("11");
    expect(count("retained")).toContain("11");
    expect(count("unavailable")).toContain("0");
    expect(
      document.querySelector('[data-profile-refresh-metric="pages"]')
        ?.textContent,
    ).toContain("7");
    expect(
      document.querySelector('[data-profile-refresh-metric="sources"]')
        ?.textContent,
    ).toContain("2");
  });

  it("shows retained live differences vertically and accepts one supplied-field suggestion", () => {
    const refresh = makeProfileRefreshData();
    const profile = applyAgentProfileRefresh(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
      refresh,
    );
    const onChange = vi.fn();
    renderPanel(profile, onChange, undefined, undefined, {
      loading: false,
      errorCode: null,
      data: refresh,
    });

    const proposals = document.querySelector(
      "[data-profile-refresh-proposals]",
    );
    const row = proposals?.querySelector(
      '[data-profile-refresh-proposal="productName"]',
    );
    expect(proposals).not.toBeNull();
    expect(proposals?.hasAttribute("aria-live")).toBe(false);
    expect(row?.textContent).toContain("AstrologyWiki");
    expect(row?.textContent).toContain("Observed productName");
    expect(
      row?.querySelector("[data-profile-refresh-proposal-current]"),
    ).not.toBeNull();
    expect(
      row?.querySelector("[data-profile-refresh-proposal-live]"),
    ).not.toBeNull();
    expect(
      row?.querySelector("[data-profile-refresh-proposal-evidence]"),
    ).not.toBeNull();
    expect(
      row?.querySelectorAll("[data-profile-refresh-proposal-evidence-url]"),
    ).toHaveLength(1);

    const action = row?.querySelector(
      '[data-profile-refresh-proposal-action="productName"]',
    ) as HTMLButtonElement;
    expect(action.getAttribute("aria-label")).toBe(
      "refresh.proposals.useLabel:field=fields.productName",
    );
    act(() => action.click());
    const accepted = onChange.mock.lastCall?.[0] as AgentProfileDraft;
    expect(accepted.productName).toBe("Observed productName");
    expect(
      accepted.fieldProvenance.find((entry) => entry.path === "/productName")
        ?.source,
    ).toBe("public_page");
  });

  it("makes every source promised by a live suggestion reachable", () => {
    const sourceUrls = Array.from(
      { length: 4 },
      (_, index) => `https://astrologywiki.com/evidence-${index + 1}`,
    );
    const baseRefresh = makeProfileRefreshData({ sourceUrls });
    const refresh: AgentProfileRefreshData = {
      ...baseRefresh,
      fields: baseRefresh.fields.map((field) =>
        field.path === "productName" && field.state === "available"
          ? { ...field, evidenceUrls: sourceUrls }
          : field,
      ) as AgentProfileRefreshData["fields"],
    };
    const profile = applyAgentProfileRefresh(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
      refresh,
    );

    renderPanel(profile, undefined, undefined, undefined, {
      loading: false,
      errorCode: null,
      data: refresh,
    });

    const row = document.querySelector(
      '[data-profile-refresh-proposal="productName"]',
    );
    const disclosure = row?.querySelector(
      "details[data-profile-refresh-proposal-evidence]",
    ) as HTMLDetailsElement;
    expect(disclosure).not.toBeNull();
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelector("summary")?.textContent).toBe(
      "refresh.proposals.evidence:count=4",
    );
    const links = Array.from(
      disclosure.querySelectorAll<HTMLAnchorElement>(
        "[data-profile-refresh-proposal-evidence-url]",
      ),
    );
    expect(links).toHaveLength(4);
    expect(links.map((link) => link.href)).toEqual(sourceUrls);
  });

  it("applies all eligible live suggestions without replacing a manual edit", () => {
    const refresh = makeProfileRefreshData();
    const profile = applyAgentProfileRefresh(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        {
          country: "US",
          locale: "en-US",
          productName: "Manual product name",
        },
      ),
      refresh,
    );
    const onChange = vi.fn();
    renderPanel(profile, onChange, undefined, undefined, {
      loading: false,
      errorCode: null,
      data: refresh,
    });

    const manualAction = document.querySelector(
      '[data-profile-refresh-proposal-action="productName"]',
    ) as HTMLButtonElement;
    expect(manualAction.disabled).toBe(true);
    expect(manualAction.textContent).toBe(
      "refresh.proposals.manualRetained",
    );

    act(() => {
      (
        document.querySelector(
          '[data-profile-refresh-proposal-action="all"]',
        ) as HTMLButtonElement
      ).click();
    });

    const accepted = onChange.mock.lastCall?.[0] as AgentProfileDraft;
    expect(accepted.productName).toBe("Manual product name");
    expect(accepted.valueProposition).toBe("Observed valueProposition");
    expect(
      accepted.fieldProvenance.find((entry) => entry.path === "/productName")
        ?.source,
    ).toBe("user_edit");
  });

  it("labels field source classes and marks a section mixed when child facts differ", () => {
    const refresh = makeProfileRefreshData();
    const refreshed = applyAgentProfileRefresh(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US", primaryCta: "Manual CTA" },
      ),
      refresh,
    );
    const profile = acceptAgentProfileRefreshFields(refreshed, refresh, [
      "valueProposition",
    ]);
    renderPanel(profile, undefined, undefined, undefined, {
      loading: false,
      errorCode: null,
      data: refresh,
    });

    for (const sourceClass of [
      "supplied",
      "manual",
      "live_public_page",
      "missing",
    ]) {
      const chip = document.querySelector(
        `[data-profile-source-class="${sourceClass}"]`,
      );
      expect(chip, sourceClass).not.toBeNull();
      expect(chip?.textContent).toContain(
        `provenance.sourceClasses.${sourceClass}`,
      );
    }
    expect(
      document
        .querySelector('[data-profile-card="product"]')
        ?.querySelector('[data-profile-section-source="mixed"]'),
    ).not.toBeNull();
  });

  it("shows three of fourteen source URLs before a native collapsed disclosure", () => {
    const sourceUrls = Array.from(
      { length: 14 },
      (_, index) => `https://astrologywiki.com/source-${index + 1}`,
    );
    const refresh = makeProfileRefreshData({ sourceUrls });
    const profile = applyAgentProfileRefresh(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
      refresh,
    );
    renderPanel(profile, undefined, undefined, undefined, {
      loading: false,
      errorCode: null,
      data: refresh,
    });

    expect(
      document.querySelectorAll(
        "[data-profile-refresh-source-preview] [data-profile-refresh-source]",
      ),
    ).toHaveLength(3);
    const details = document.querySelector(
      "details[data-profile-refresh-source-details]",
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(
      details.querySelectorAll("[data-profile-refresh-source]"),
    ).toHaveLength(11);
    expect(details.querySelector("summary")?.textContent).toBe(
      "refresh.sources.expand:count=11",
    );
    expect(
      document.querySelector('[data-profile-refresh-source-total]')
        ?.textContent,
    ).toContain("14");
  });

  it.each([
    ["max_urls", "refresh.diagnostics.stopReasons.max_urls:pages=7"],
    ["max_requests", "refresh.diagnostics.stopReasons.max_requests"],
    ["max_wall_clock", "refresh.diagnostics.stopReasons.max_wall_clock"],
    ["max_total_bytes", "refresh.diagnostics.stopReasons.max_total_bytes"],
    ["aborted", "refresh.diagnostics.stopReasons.aborted"],
  ] as const)(
    "explains the truthful %s crawl stop reason",
    (stopReason, copyKey) => {
      renderPanel(
        updateAgentProfile(
          createAgentProfileDraft("seo", "astrologywiki.com"),
          { country: "US", locale: "en-US" },
        ),
        undefined,
        undefined,
        undefined,
        {
          loading: false,
          errorCode: null,
          data: makeProfileRefreshData({
            availability: "partial",
            stopReason,
          }),
        },
        vi.fn(),
      );

      expect(
        document.querySelector(
          `[data-profile-refresh-stop-reason="${stopReason}"]`,
        )?.textContent,
      ).toBe(copyKey);
    },
  );

  it("states when the bounded public context was insufficient", () => {
    renderPanel(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
      undefined,
      undefined,
      undefined,
      {
        loading: false,
        errorCode: null,
        data: makeProfileRefreshData({
          availability: "partial",
          contextSufficient: false,
          stopReason: null,
        }),
      },
      vi.fn(),
    );

    expect(
      document.querySelector("[data-profile-refresh-limitation]")?.textContent,
    ).toBe("refresh.diagnostics.insufficient");
    expect(
      document.querySelector("[data-profile-refresh-stop-reason]"),
    ).toBeNull();
  });

  it.each(["hit", "refreshed"] as const)(
    "labels a %s result and uses an explicit live-refresh action afterward",
    (cacheStatus) => {
      const onRefresh = vi.fn();
      renderPanel(
        updateAgentProfile(
          createAgentProfileDraft("seo", "astrologywiki.com"),
          { country: "US", locale: "en-US" },
        ),
        undefined,
        undefined,
        undefined,
        {
          loading: false,
          errorCode: null,
          data: makeProfileRefreshData({ cacheStatus }),
        },
        onRefresh,
      );

      expect(
        document.querySelector(
          `[data-profile-refresh-cache="${cacheStatus}"]`,
        )?.textContent,
      ).toContain(`refresh.cache.${cacheStatus}`);

      const action = document.querySelector(
        '[data-profile-refresh-action="run"]',
      ) as HTMLButtonElement;
      expect(action.textContent).toBe("refresh.actions.refresh");
      act(() => action.click());
      expect(onRefresh).toHaveBeenCalledWith("refresh");
    },
  );

  it("announces bounded loading without inventing progress and disables the command bar", () => {
    renderPanel(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
      undefined,
      undefined,
      undefined,
      { loading: true, data: null, errorCode: null },
      vi.fn(),
    );

    const control = document.querySelector("[data-profile-refresh-control]");
    const status = document.querySelector(
      '[data-profile-refresh-status="loading"]',
    );
    expect(control?.getAttribute("aria-busy")).toBe("true");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toContain("refresh.loading");
    expect(status?.textContent).not.toMatch(/\d+%|page 1|1\/\d/i);
    expect(
      document.querySelectorAll(
        "[data-profile-refresh-field]:disabled, [data-profile-refresh-action]:disabled",
      ),
    ).toHaveLength(4);
  });

  it("renders one accessible error announcement for a failed diagnosis", () => {
    renderPanel(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
      undefined,
      undefined,
      undefined,
      {
        loading: false,
        data: null,
        errorCode: "profile_source_unavailable",
      },
      vi.fn(),
    );

    const alerts = document.querySelectorAll(
      '[data-profile-refresh-status="error"][role="alert"]',
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toContain(
      "refresh.errors.profile_source_unavailable",
    );
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it.each([
    ["unknown", "refresh.errors.unknown"],
    ["invalid_url", "refresh.errors.request_failed"],
  ])("maps the %s error to a closed and safe copy key", (errorCode, copyKey) => {
    renderPanel(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
      undefined,
      undefined,
      undefined,
      { loading: false, data: null, errorCode },
      vi.fn(),
    );

    const error = document.querySelector(
      '[data-profile-refresh-status="error"]',
    );
    expect(error?.textContent).toBe(copyKey);
  });

  it("keeps the diagnosis action full-width on mobile and bounded on desktop", () => {
    renderPanel(createAgentProfileDraft("seo", "astrologywiki.com"));

    const control = document.querySelector(
      "[data-profile-refresh-control]",
    ) as HTMLElement;
    const action = document.querySelector(
      "[data-profile-refresh-action]",
    ) as HTMLButtonElement;
    expect(control.className).toContain("grid");
    expect(control.className).toContain("lg:grid-cols-");
    expect(action.className).toContain("w-full");
    expect(action.className).toContain("lg:w-auto");
  });

  it("keeps the English and Chinese diagnosis-control contracts aligned", () => {
    expect(Object.keys(en.agents.workbench.profile.refresh).sort()).toEqual(
      Object.keys(zh.agents.workbench.profile.refresh).sort(),
    );
    expect(
      Object.keys(en.agents.workbench.profile.refresh.fields).sort(),
    ).toEqual(Object.keys(zh.agents.workbench.profile.refresh.fields).sort());
    expect(
      Object.keys(en.agents.workbench.profile.refresh.availability).sort(),
    ).toEqual(
      Object.keys(zh.agents.workbench.profile.refresh.availability).sort(),
    );
    expect(
      Object.keys(en.agents.workbench.profile.refresh.cache).sort(),
    ).toEqual(Object.keys(zh.agents.workbench.profile.refresh.cache).sort());
    expect(
      Object.keys(en.agents.workbench.profile.refresh.errors).sort(),
    ).toEqual(Object.keys(zh.agents.workbench.profile.refresh.errors).sort());
    expect(en.agents.workbench.profile.refresh.loading).toContain(
      "bounded public pages",
    );
    expect(zh.agents.workbench.profile.refresh.loading).toContain(
      "有边界的公开页面",
    );
    expect(en.agents.workbench.profile.refresh.proposals.evidence).toContain(
      "support this suggestion",
    );
    expect(zh.agents.workbench.profile.refresh.proposals.evidence).toContain(
      "支持该建议",
    );
    expect(en.agents.workbench.profile.refresh.sources.total).toContain(
      "crawl source URLs",
    );
    expect(zh.agents.workbench.profile.refresh.sources.total).toContain(
      "抓取来源 URL",
    );
  });

  it("keeps the default stage rail focused on Product Profile, competitors, and run context", () => {
    renderPanel(createAgentProfileDraft("seo", "astrologywiki.com"));

    const rail = document.querySelector(
      '[data-profile-layout="vertical-rail"]',
    );
    expect(rail).not.toBeNull();

    const stages = Array.from(rail?.children ?? []).filter((element) =>
      element.hasAttribute("data-profile-stage"),
    );
    expect(
      stages.map((element) => ({
        stage: element.getAttribute("data-profile-stage"),
        card: element.getAttribute("data-profile-card"),
      })),
    ).toEqual([
      { stage: "01", card: "product" },
      { stage: "02", card: "competitor" },
      { stage: "03", card: "context" },
    ]);
    expect(document.querySelector('[data-profile-card="icp"]')).toBeNull();
  });

  it("keeps ICP context available for explicit review without rendering a dense ICP stage", () => {
    const profile = createAgentProfileDraft("seo", "astrologywiki.com");
    renderPanel(profile);

    expect(document.querySelector('[data-profile-card="icp"]')).toBeNull();

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
    ).toBe(profile.primaryIcp);
  });

  it("shows every supplied Product Information section without Marketing Strategy facts", () => {
    renderPanel(createAgentProfileDraft("seo", "astrologywiki.com"));

    expect(document.querySelectorAll("[data-profile-card]")).toHaveLength(3);
    expect(
      Array.from(
        document.querySelectorAll("[data-product-information-section]"),
      ).map((section) =>
        section.getAttribute("data-product-information-section"),
      ),
    ).toEqual(["overview", "experience", "commercial", "technical"]);
    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("Software as a service (SaaS)");
    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("Users enter a birth date, time, and place");
    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("$41.99 / year");
    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("Swiss Ephemeris");
    expect(document.querySelector('[data-profile-card="icp"]')).toBeNull();
    expect(document.body.textContent).not.toContain("document.boundary");
    expect(document.body.textContent).not.toContain("22–38");
    expect(document.body.textContent).not.toContain("female-skewed");
    expect(document.body.textContent).not.toContain("Xiaohongshu");
    expect(
      document.querySelector('[data-profile-source="product_information_supplied"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-profile-source="marketing_strategy_supplied"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-profile-source="inferred_run_assumptions"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-profile-card="competitor"]')?.textContent,
    ).toContain("values.confirmationRequired");
    expect(
      document.querySelectorAll('[data-profile-provenance="declared"]')
        .length,
    ).toBeGreaterThan(0);
    expect(
      document.querySelectorAll('[data-profile-provenance="inferred"]')
        .length,
    ).toBeGreaterThan(0);
    expect(
      document.querySelectorAll('[data-profile-provenance="missing"]')
        .length,
    ).toBeGreaterThan(0);
    expect(
      document.querySelector('[aria-label="fields.targetUrl"]'),
    ).not.toBeNull();
    expect(document.querySelector('[aria-label="fields.country"]')).toBeNull();
    expect(
      document.querySelector('button[data-profile-action="review"]')?.textContent,
    ).toBe("actions.review");
    expect(
      document.querySelector('button[data-profile-action="confirm"]')?.textContent,
    ).toBe("actions.confirmRun");
  });

  it("keeps supplied document excerpts separate from explicitly accepted live profile fields", () => {
    const refresh = makeProfileRefreshData();
    const refreshed = applyAgentProfileRefresh(
      updateAgentProfile(
        createAgentProfileDraft("seo", "astrologywiki.com"),
        { country: "US", locale: "en-US" },
      ),
      refresh,
    );
    const accepted = acceptAgentProfileRefreshFields(refreshed, refresh, [
      "oneLinePositioning",
      "primaryIcp",
    ]);

    renderPanel(accepted);

    const documentExperience = document.querySelector(
      '[data-product-information-section="experience"]',
    );
    expect(documentExperience?.textContent).toContain(
      "Users enter a birth date, time, and place",
    );
    expect(
      documentExperience?.querySelector(
        '[data-profile-source-class="live_public_page"]',
      ),
    ).toBeNull();

    const documentOverview = document.querySelector(
      '[data-product-information-section="overview"]',
    );
    expect(documentOverview?.textContent).toContain(
      "People interested in astrology who use a birth chart",
    );
    expect(
      documentOverview?.querySelector(
        '[data-profile-source-class="live_public_page"]',
      ),
    ).toBeNull();

    expect(document.querySelector('[data-profile-card="icp"]')).toBeNull();
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
    ).toBe("Observed primaryIcp");
  });

  it("renders empty run-context inputs as confirmation-required missing values", () => {
    renderPanel(createAgentProfileDraft("seo", "astrologywiki.com"));

    const context = document.querySelector('[data-profile-card="context"]');
    const facts = Array.from(context?.querySelectorAll("dl > div") ?? []);
    const fact = (label: string) =>
      facts.find((entry) => entry.querySelector("dt")?.textContent === label);

    for (const label of [
      "fields.country",
      "fields.locale",
      "fields.targetQuery",
    ]) {
      expect(fact(label)?.querySelector("dd")?.textContent).toBe(
        "values.confirmationRequired",
      );
      expect(
        fact(label)?.querySelector('[data-profile-provenance="missing"]'),
      ).not.toBeNull();
    }
  });

  it("shows provider-observed domains with editable system relationship defaults without mutating the draft", () => {
    const profile = createAgentProfileDraft("seo", "astrologywiki.com");
    renderPanel(
      profile,
      undefined,
      undefined,
      {
        loading: false,
        errorCode: null,
        onDiscover: vi.fn(),
        data: {
          schemaVersion: "agent_profile_search.v1",
          agent: "seo",
          targetHost: "astrologywiki.com",
          availability: "available",
          method: "target_query_serp",
          market: {
            code: "US",
            locationCode: 2_840,
            languageCode: "en",
          },
          observedAt: "2026-08-13T00:00:00.000Z",
          rows: [
            {
              kind: "target_query_serp",
              domain: "observed-one.example",
              rank: 1,
            },
            {
              kind: "target_query_serp",
              domain: "observed-two.example",
              rank: 2,
            },
          ],
        },
      },
    );

    const competitor = document.querySelector(
      '[data-profile-card="competitor"]',
    );
    const declaredBusinessFrame = competitor?.querySelector("dl");
    const summary = competitor?.querySelector(
      '[data-profile-search-summary="available"]',
    );

    expect(summary?.textContent).toBe("search.summary.available:2");
    expect(competitor?.querySelector("h3")?.textContent).toBe(
      "search.review.candidatesReady",
    );
    expect(declaredBusinessFrame?.textContent).toContain(
      "observed-one.example",
    );
    expect(declaredBusinessFrame?.textContent).toContain(
      "observed-two.example",
    );
    expect(declaredBusinessFrame?.textContent).toContain(
      "search.review.systemSuggestionProvenance",
    );
    expect(declaredBusinessFrame?.textContent).not.toContain(
      "search.review.awaitingClassification",
    );
    expect(declaredBusinessFrame?.textContent).toContain(
      "search.review.noneExcluded",
    );
    expect(
      competitor?.querySelectorAll("[data-profile-search-domain]"),
    ).toHaveLength(2);
    expect(
      competitor?.querySelectorAll("[data-profile-competitor-candidate]"),
    ).toHaveLength(2);
    expect(
      competitor?.querySelector(
        '[data-profile-competitor-count="provider"]',
      )?.textContent,
    ).toContain("2");
    expect(competitor?.textContent).toContain(
      "search.review.suggestedIndirect",
    );
    expect(
      competitor
        ?.querySelector('[data-profile-competitor-action="indirect"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(competitor?.textContent).toContain(
      "search.review.providerEvidence",
    );
    expect(profile.directCompetitors).toEqual([]);
    expect(profile.indirectAlternatives).toEqual([]);
    expect(profile.excludedAlternatives).toEqual([]);
  });

  it("shows Product Profile seed SERP domains with editable indirect defaults without mutating the draft", () => {
    const profile = createAgentProfileDraft("seo", "astrologywiki.com");
    renderPanel(
      profile,
      undefined,
      undefined,
      {
        loading: false,
        errorCode: null,
        onDiscover: vi.fn(),
        data: {
          schemaVersion: "agent_profile_search.v1",
          agent: "seo",
          targetHost: "astrologywiki.com",
          availability: "available",
          method: "serp_competitors",
          market: {
            code: "US",
            locationCode: 2_840,
            languageCode: "en",
          },
          observedAt: "2026-08-13T00:00:00.000Z",
          rows: [
            {
              kind: "profile_seed_serp_competitor",
              domain: "seed-one.example",
              averagePosition: 4.1,
              medianPosition: 3.8,
              rating: 0.72,
              organicEstimatedTrafficVolume: 540,
              keywordsCount: 8,
              visibility: 0.34,
              relevantSerpItems: 3,
            },
            {
              kind: "profile_seed_serp_competitor",
              domain: "seed-two.example",
              averagePosition: 9.2,
              medianPosition: 7.4,
              rating: 0.41,
              organicEstimatedTrafficVolume: 210,
              keywordsCount: 5,
              visibility: 0.13,
              relevantSerpItems: 2,
            },
          ],
        },
      },
    );

    const competitor = document.querySelector(
      '[data-profile-card="competitor"]',
    );
    const declaredBusinessFrame = competitor?.querySelector("dl");
    const summary = competitor?.querySelector(
      '[data-profile-search-summary="available"]',
    );

    expect(summary?.textContent).toBe("search.summary.available:2");
    expect(competitor?.querySelector("h3")?.textContent).toBe(
      "search.review.candidatesReady",
    );
    expect(declaredBusinessFrame?.textContent).toContain("seed-one.example");
    expect(declaredBusinessFrame?.textContent).toContain("seed-two.example");
    expect(declaredBusinessFrame?.textContent).toContain(
      "search.review.systemSuggestionProvenance",
    );
    expect(competitor?.textContent).toContain("search.seedSerpBoundary");
    expect(competitor?.textContent).toContain(
      "search.review.seedSerpEvidence",
    );
    expect(competitor?.textContent).toContain(
      "search.review.seedSerpObserved",
    );
    expect(competitor?.textContent).toContain(
      "search.review.suggestedIndirect",
    );
    expect(
      competitor
        ?.querySelector('[data-profile-competitor-action="indirect"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(profile.directCompetitors).toEqual([]);
    expect(profile.indirectAlternatives).toEqual([]);
    expect(profile.excludedAlternatives).toEqual([]);
  });

  it("turns an explicit provider-candidate review into exactly one local classification", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      {
        directCompetitors: ["existing.example"],
        indirectAlternatives: ["rival.example"],
        excludedAlternatives: ["ignored.example"],
      },
    );
    const onChange = vi.fn();
    renderPanel(profile, onChange, undefined, {
      loading: false,
      errorCode: null,
      onDiscover: vi.fn(),
      data: {
        schemaVersion: "agent_profile_search.v1",
        agent: "seo",
        targetHost: "astrologywiki.com",
        availability: "available",
        method: "competitors_domain",
        market: {
          code: "US",
          locationCode: 2_840,
          languageCode: "en",
        },
        observedAt: "2026-08-13T00:00:00.000Z",
        rows: [
          {
            kind: "organic_search_overlap",
            domain: "rival.example",
            intersections: 8,
            averagePosition: 5,
            summedPosition: 40,
            organicEstimatedTrafficVolume: 250,
          },
        ],
      },
    });

    act(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-profile-competitor-action="direct"]',
        )
        ?.click();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        directCompetitors: ["existing.example", "rival.example"],
        indirectAlternatives: [],
        excludedAlternatives: ["ignored.example"],
      }),
    );
    expect(profile.directCompetitors).toEqual(["existing.example"]);
    expect(profile.indirectAlternatives).toEqual(["rival.example"]);
  });

  it("counts only reviewable provider domains after self and platform filtering", () => {
    renderPanel(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      undefined,
      undefined,
      {
        loading: false,
        errorCode: null,
        onDiscover: vi.fn(),
        data: {
          schemaVersion: "agent_profile_search.v1",
          agent: "seo",
          targetHost: "astrologywiki.com",
          availability: "available",
          method: "competitors_domain",
          market: {
            code: "US",
            locationCode: 2_840,
            languageCode: "en",
          },
          observedAt: "2026-08-13T00:00:00.000Z",
          rows: [
            {
              kind: "organic_search_overlap",
              domain: "astrologywiki.com",
              intersections: 20,
              averagePosition: 2,
              summedPosition: 40,
              organicEstimatedTrafficVolume: 1_000,
            },
            {
              kind: "organic_search_overlap",
              domain: "reddit.com",
              intersections: 10,
              averagePosition: 3,
              summedPosition: 30,
              organicEstimatedTrafficVolume: 900,
            },
          ],
        },
      },
    );

    expect(
      document.querySelector('[data-profile-search-summary="available"]')
        ?.textContent,
    ).toBe("search.summary.available:0");
    expect(
      document.querySelectorAll("[data-profile-competitor-candidate]"),
    ).toHaveLength(0);
  });

  it("shows a reviewed business frame when competitors were entered manually", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      {
        directCompetitors: ["observed-only.example"],
        indirectAlternatives: ["Manual Alternative"],
      },
    );
    renderPanel(profile, undefined, undefined, {
      loading: false,
      errorCode: null,
      onDiscover: vi.fn(),
      data: {
        schemaVersion: "agent_profile_search.v1",
        agent: "seo",
        targetHost: "astrologywiki.com",
        availability: "available",
        method: "target_query_serp",
        market: {
          code: "US",
          locationCode: 2_840,
          languageCode: "en",
        },
        observedAt: "2026-08-13T00:00:00.000Z",
        rows: [
          {
            kind: "target_query_serp",
            domain: "observed-only.example",
            rank: 1,
          },
        ],
      },
    });

    const competitor = document.querySelector(
      '[data-profile-card="competitor"]',
    );
    expect(competitor?.querySelector("h3")?.textContent).toBe(
      "values.businessFrameReviewed",
    );
    expect(competitor?.querySelector("dl")?.textContent).toContain(
      "observed-only.example",
    );
    expect(competitor?.querySelector("dl")?.textContent).toContain(
      "Manual Alternative",
    );
    expect(
      competitor?.querySelector(
        '[data-profile-search-summary="available"]',
      )?.textContent,
    ).toBe("search.summary.available:1");
    expect(
      en.agents.workbench.profile.search.summary.available,
    ).toContain("editable system relationship suggestion");
    expect(
      zh.agents.workbench.profile.search.summary.available,
    ).toContain("可修改关系建议");
  });

  it("leaves search summary announcements to the existing results live region", () => {
    renderPanel(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      undefined,
      undefined,
      {
        loading: true,
        data: null,
        errorCode: null,
        onDiscover: vi.fn(),
      },
    );

    const summary = document.querySelector("[data-profile-search-summary]");
    expect(summary).not.toBeNull();
    expect(summary?.hasAttribute("aria-live")).toBe(false);
  });

  it.each([
    {
      state: "loading",
      profileSearch: {
        loading: true,
        data: null,
        errorCode: null,
        onDiscover: vi.fn(),
      },
      message: "search.summary.loading",
    },
    {
      state: "no_data",
      profileSearch: {
        loading: false,
        errorCode: null,
        onDiscover: vi.fn(),
        data: {
          schemaVersion: "agent_profile_search.v1" as const,
          agent: "tech" as const,
          targetHost: "astrologywiki.com",
          availability: "no_data" as const,
          method: "competitors_domain" as const,
          market: {
            code: "US",
            locationCode: 2_840,
            languageCode: "en",
          },
          observedAt: "2026-08-13T00:00:00.000Z",
          rows: [] as const,
        },
      },
      message: "search.summary.noData",
    },
    {
      state: "source_unavailable",
      profileSearch: {
        loading: false,
        errorCode: null,
        onDiscover: vi.fn(),
        data: {
          schemaVersion: "agent_profile_search.v1" as const,
          agent: "tech" as const,
          targetHost: "astrologywiki.com",
          availability: "source_unavailable" as const,
          method: "competitors_domain" as const,
          market: {
            code: "US",
            locationCode: 2_840,
            languageCode: "en",
          },
          observedAt: null,
          rows: [] as const,
        },
      },
      message: "search.summary.sourceUnavailable",
    },
  ])("shows a truthful $state search-domain summary near Stage 03", ({
    state,
    profileSearch,
    message,
  }) => {
    renderPanel(
      createAgentProfileDraft("tech", "astrologywiki.com"),
      undefined,
      undefined,
      profileSearch,
    );

    expect(
      document.querySelector(
        `[data-profile-search-summary="${state}"]`,
      )?.textContent,
    ).toBe(message);
  });

  it("uses dedicated timeout copy for a search_timeout client error", () => {
    renderPanel(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      undefined,
      undefined,
      {
        loading: false,
        data: null,
        errorCode: "search_timeout",
        onDiscover: vi.fn(),
      },
    );

    expect(
      document.querySelector('[data-profile-search-error="search_timeout"]')
        ?.textContent,
    ).toContain("search.errors.searchTimeout");
  });

  it("requires a target query before provider search in the CN market", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      { country: "CN", locale: "zh-CN" },
    );
    renderPanel(profile, undefined, undefined, {
      loading: false,
      data: null,
      errorCode: null,
      onDiscover: vi.fn(),
    });

    const searchButton = document.querySelector(
      "[data-profile-search] button",
    ) as HTMLButtonElement;
    expect(searchButton.disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "search.missingPrerequisite:fields.targetQuery",
    );
  });

  it("allows non-CN provider search without a target query", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      { country: "US", locale: "en-US" },
    );
    renderPanel(profile, undefined, undefined, {
      loading: false,
      data: null,
      errorCode: null,
      onDiscover: vi.fn(),
    });

    const searchButton = document.querySelector(
      "[data-profile-search] button",
    ) as HTMLButtonElement;
    expect(searchButton.disabled).toBe(false);
    expect(document.body.textContent).not.toContain(
      "search.missingPrerequisite:fields.targetQuery",
    );
  });

  it("keeps English and Chinese source-honest summary and timeout copy aligned", () => {
    expect(en.agents.workbench.profile.search.summary.available).toContain(
      "editable system relationship suggestion",
    );
    expect(zh.agents.workbench.profile.search.summary.available).toContain(
      "可修改关系建议",
    );
    expect(en.agents.workbench.profile.search.title).toBe(
      "Domains worth review",
    );
    expect(zh.agents.workbench.profile.search.title).toBe(
      "值得审核的搜索域",
    );
    expect(en.agents.workbench.profile.search.errors.searchTimeout).toContain(
      "timed out",
    );
    expect(zh.agents.workbench.profile.search.errors.searchTimeout).toContain(
      "超时",
    );
  });

  it("exposes accessible fields and emits an immutable edit", () => {
    const profile = createAgentProfileDraft("tech", "astrologywiki.com");
    const { onChange } = renderPanel(profile);

    act(() => {
      (
        document.querySelector(
          'button[data-profile-action="review"]',
        ) as HTMLButtonElement
      ).click();
    });
    const country = document.querySelector(
      '[data-profile-refresh-field="market"]',
    ) as HTMLInputElement;
    const locale = document.querySelector(
      '[data-profile-refresh-field="language"]',
    ) as HTMLInputElement;
    const targetQuery = document.querySelector(
      '[aria-label="fields.targetQuery"]',
    ) as HTMLInputElement;
    const device = document.querySelector(
      '[aria-label="fields.device"]',
    ) as HTMLSelectElement;
    const pageType = document.querySelector(
      '[aria-label="fields.pageType"]',
    ) as HTMLSelectElement;
    const auditScope = document.querySelector(
      '[aria-label="fields.auditScope"]',
    ) as HTMLSelectElement;
    const primaryCta = document.querySelector(
      '[aria-label="fields.primaryCta"]',
    ) as HTMLInputElement;
    const categories = document.querySelector(
      '[aria-label="fields.categories"]',
    ) as HTMLInputElement;
    const coreFeatures = document.querySelector(
      '[aria-label="fields.coreFeatures"]',
    ) as HTMLInputElement;
    const useCases = document.querySelector(
      '[aria-label="fields.useCases"]',
    ) as HTMLInputElement;
    const buyer = document.querySelector(
      '[aria-label="fields.buyer"]',
    ) as HTMLInputElement;
    const directCompetitors = document.querySelector(
      '[aria-label="fields.directCompetitors"]',
    ) as HTMLInputElement;

    expect(country).not.toBeNull();
    expect(locale).not.toBeNull();
    expect(targetQuery).not.toBeNull();
    expect(device).not.toBeNull();
    expect(pageType).not.toBeNull();
    expect(auditScope).not.toBeNull();
    expect(primaryCta).not.toBeNull();
    expect(categories).not.toBeNull();
    expect(coreFeatures).not.toBeNull();
    expect(useCases).not.toBeNull();
    expect(buyer).not.toBeNull();
    expect(directCompetitors).not.toBeNull();

    setValue(country, "US");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ agent: "tech", country: "US" }),
    );
    expect(profile.country).toBe("");

    setValue(categories, "Astrology SaaS, Reflection tool");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agent: "tech",
        categories: ["Astrology SaaS", "Reflection tool"],
      }),
    );

    setValue(directCompetitors, "Alternative A, Alternative B");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agent: "tech",
        directCompetitors: ["Alternative A", "Alternative B"],
      }),
    );
  });

  it("redrafts on URL change and never carries AstrologyWiki facts to another host", () => {
    const { onChange } = renderPanel(
      createAgentProfileDraft("seo", "astrologywiki.com"),
    );
    const url = document.querySelector(
      '[aria-label="fields.targetUrl"]',
    ) as HTMLInputElement;

    setValue(url, "https://example.com");

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agent: "seo",
        host: "example.com",
        productName: "example.com",
        reviewState: "needs_confirmation",
      }),
    );
  });

  it("confirms only the supplied Agent draft and does not persist it", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      { country: "US", locale: "en-US" },
    );
    const { onConfirm } = renderPanel(profile);

    act(() => {
      (
        document.querySelector(
          'button[data-profile-action="confirm"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "seo", reviewState: "confirmed" }),
    );
    expect(sessionStorage.length).toBe(0);
  });

  it("marks generic-host Product and ICP cards as inferred or confirmation-required", () => {
    renderPanel(
      createAgentProfileDraft("tech", "example.com"),
      undefined,
      undefined,
      {
        loading: false,
        data: null,
        errorCode: null,
        onDiscover: vi.fn(),
      },
    );

    expect(
      document.querySelector('[data-profile-source="hostname_inference"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-profile-source="confirmation_required"]'),
    ).not.toBeNull();
    expect(
      document.querySelectorAll("[data-product-information-section]"),
    ).toHaveLength(0);
    expect(document.body.textContent).not.toContain(
      "Only facts stated in the supplied Product Information",
    );
    expect(document.body.textContent).not.toContain("22–38");
    expect(
      (
        document.querySelector(
          'button[data-profile-action="confirm"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(document.body.textContent).toContain("readiness.missing");
    expect(document.body.textContent).toContain("search.missingPrerequisite");
  });

  it("marks the visible source-backed card while retaining hidden ICP adjustments for review", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      { primaryCta: "Create my chart", icpPain: "Needs clearer guidance" },
    );
    renderPanel(profile);

    expect(
      document.body.textContent?.match(/sources\.locally_adjusted/g),
    ).toHaveLength(1);
    act(() => {
      (
        document.querySelector(
          'button[data-profile-action="review"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      (document.querySelector('[aria-label="fields.icpPain"]') as HTMLInputElement)
        .value,
    ).toBe("Needs clearer guidance");
  });
});
