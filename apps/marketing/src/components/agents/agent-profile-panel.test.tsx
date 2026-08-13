// @vitest-environment jsdom
// @input  -- source-backed and generic Agent Profile drafts
// @output -- accessible review, edit, URL reset, and local confirmation behavior
// @pos    -- interaction contract for Stage 01 of each marketing Agent

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAgentProfileDraft,
  updateAgentProfile,
  type AgentProfileDraft,
} from "./agent-profile";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
      />,
    );
  });
  return { onChange, onConfirm };
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

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AgentProfilePanel", () => {
  it("presents Product, ICP, competitors, and run context as a top-to-bottom stage rail", () => {
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
      { stage: "02", card: "icp" },
      { stage: "03", card: "competitor" },
      { stage: "04", card: "context" },
    ]);
  });

  it("shows URL plus four source-honest decision cards before expanding fields", () => {
    renderPanel(createAgentProfileDraft("seo", "astrologywiki.com"));

    expect(document.querySelectorAll("[data-profile-card]")).toHaveLength(4);
    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("Use astrology to know yourself, not predict fate.");
    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("Free natal chart calculator");
    expect(
      document.querySelector('[data-profile-source="product_information_supplied"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-profile-source="marketing_strategy_supplied"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-profile-source="inferred_run_assumptions"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-profile-card="competitor"]')?.textContent,
    ).toContain("values.confirmationRequired");
    expect(
      document.querySelector('[data-profile-card="icp"]')?.textContent,
    ).toContain("Inferred — the user and payer");
    expect(
      document.querySelector('[data-profile-card="icp"]')?.textContent,
    ).toContain("Generate and explore an accurate natal chart");
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
      '[aria-label="fields.country"]',
    ) as HTMLInputElement;
    const locale = document.querySelector(
      '[aria-label="fields.locale"]',
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
    expect(profile.country).toBe("CN");

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
    const profile = createAgentProfileDraft("seo", "astrologywiki.com");
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

  it("marks source-backed cards when their accepted facts were locally adjusted", () => {
    const profile = updateAgentProfile(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      { primaryCta: "Create my chart", icpPain: "Needs clearer guidance" },
    );
    renderPanel(profile);

    expect(document.body.textContent?.match(/sources\.locally_adjusted/g)).toHaveLength(
      2,
    );
  });
});
