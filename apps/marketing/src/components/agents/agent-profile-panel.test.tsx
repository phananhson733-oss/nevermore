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
  it("shows URL plus three source-honest decision cards before expanding fields", () => {
    renderPanel(createAgentProfileDraft("seo", "astrologywiki.com"));

    expect(document.querySelectorAll("[data-profile-card]")).toHaveLength(3);
    expect(
      document.querySelector('[data-profile-card="product"]')?.textContent,
    ).toContain("AstrologyWiki");
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

    expect(country).not.toBeNull();
    expect(locale).not.toBeNull();
    expect(targetQuery).not.toBeNull();
    expect(device).not.toBeNull();
    expect(pageType).not.toBeNull();
    expect(auditScope).not.toBeNull();
    expect(primaryCta).not.toBeNull();
    expect(categories).not.toBeNull();

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
    renderPanel(createAgentProfileDraft("tech", "example.com"));

    expect(
      document.querySelector('[data-profile-source="hostname_inference"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-profile-source="confirmation_required"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("22–38");
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
