// @vitest-environment jsdom
// @input  -- owned homepage and header CTA source files plus browser navigation
// @output -- Agent-route conversion-link and disabled-storage regressions
// @pos    -- guards the marketing shell from drifting back to tools/app CTAs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () =>
    Object.assign((key: string) => key, {
      rich: (key: string) => key,
    }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

const { HeroSection } = await import("./hero-section");

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(
    source(`../../i18n/messages/${locale}.json`),
  ) as Record<string, unknown>;
}

function lookup(tree: Record<string, unknown>, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      tree,
    );
}

const AGENT_SHELL_COPY_KEYS = [
  "common.runAudit",
  "home.hero.eyebrow",
  "home.hero.title",
  "home.hero.subtitle",
  "home.hero.urlLabel",
  "home.hero.urlPlaceholder",
  "home.hero.primaryCta",
  "home.hero.secondaryCta",
  "home.hero.socialProof",
  "home.capabilities.eyebrow",
  "home.capabilities.title",
  "home.capabilities.subtitle",
  "home.capabilities.seoTitle",
  "home.capabilities.seoDesc",
  "home.capabilities.techTitle",
  "home.capabilities.techDesc",
  "home.capabilities.accountRequired",
  "home.capabilities.liveCrawl",
  "home.capabilities.cardCta",
  "home.capabilities.viewAll",
  "home.bottomCta.title",
  "home.bottomCta.subtitle",
  "home.bottomCta.cta",
] as const;

describe("homepage Agent links", () => {
  it("collects one URL and offers exactly two non-running Agent destinations", () => {
    const contents = source("./hero-section.tsx");
    expect(contents).toContain('type="text"');
    expect(contents).toContain('inputMode="url"');
    expect(contents).toContain("storePendingAgentIntent(");
    expect(contents).toContain('"prepare_profile"');
    expect(contents).toContain("getSessionIntentStorage()");
    expect(contents).not.toContain("window.sessionStorage");
    expect(contents).toContain("AGENT_PATH[agent]");
    expect(contents.match(/<button\b/g) ?? []).toHaveLength(2);
    expect(contents).not.toContain('fetch("/api/');
    expect(contents).not.toContain("SeoAuditTool");
  });

  it.each([
    [
      "sessionStorage acquisition",
      () =>
        vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
          throw new DOMException("Storage disabled", "SecurityError");
        }),
    ],
    [
      "sessionStorage writes",
      () =>
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new DOMException("Storage disabled", "QuotaExceededError");
        }),
    ],
  ] as const)(
    "still navigates to the selected Agent when %s throw",
    (_scenario, disableStorage) => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      disableStorage();

      act(() => root.render(createElement(HeroSection)));
      const input = document.querySelector(
        "#homepage-agent-url",
      ) as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setValue) throw new Error("HTMLInputElement.value setter unavailable");
      act(() => {
        setValue.call(input, "example.com");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() => {
        (
          document.querySelector(
            'button[value="seo"]',
          ) as HTMLButtonElement
        ).click();
      });

      expect(routerPush).toHaveBeenCalledWith("/agents/seo");
      act(() => root.unmount());
    },
  );

  it("defaults an Enter-key submission to SEO and keeps Tech explicit", () => {
    const contents = source("./hero-section.tsx");
    expect(contents).toContain(
      'submitter?.value === "tech" ? "tech" : "seo"',
    );
    expect(contents).toContain('value="tech"');
  });

  it("offers only the SEO and Tech Agent cards", () => {
    const contents = source("./capabilities-preview.tsx");
    expect(contents).toContain('slug: "seo"');
    expect(contents).toContain('slug: "tech"');
    expect(contents).toContain("`/agents/${card.slug}`");
    expect(contents).not.toContain("`/tools/${card.slug}`");
  });

  it("sends the bottom CTA to the localized SEO Agent", () => {
    const contents = source("./bottom-cta-section.tsx");
    expect(contents).toContain('localePath(locale, "/agents/seo")');
    expect(contents).not.toContain("siteConfig.appUrl");
  });
});

describe("header primary CTA", () => {
  it("uses the localized SEO Agent and Run audit copy", () => {
    const contents = source("../auth/sign-in-control.tsx");
    expect(contents).toContain('localePath(locale, "/agents/seo")');
    expect(contents).toContain('t("common.runAudit")');
    expect(contents).not.toContain("siteConfig.appUrl");
  });
});

describe("Agent shell copy", () => {
  it.each(["en", "zh"])(
    "provides every bounded Agent acquisition string in %s",
    (locale) => {
      const tree = messages(locale);
      const values = AGENT_SHELL_COPY_KEYS.map((key) => {
        const value = lookup(tree, key);
        expect(typeof value, `${locale}: ${key} is not a string`).toBe("string");
        expect(value, `${locale}: ${key} is empty`).not.toBe("");
        return value as string;
      });

      expect(values.join(" ")).not.toMatch(
        /\bfree\b|no account|without (?:an )?account|anonymous|免费|无需账号|匿名/i,
      );
    },
  );

  it("describes both new captures and completed-crawl cache evidence", () => {
    expect(lookup(messages("en"), "home.capabilities.liveCrawl")).toBe(
      "Bounded crawl evidence",
    );
    expect(lookup(messages("zh"), "home.capabilities.liveCrawl")).toBe(
      "有边界的抓取证据",
    );
  });
});

afterEach(() => {
  routerPush.mockReset();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
