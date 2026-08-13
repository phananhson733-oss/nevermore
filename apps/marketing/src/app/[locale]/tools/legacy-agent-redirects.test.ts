// @input  -- English and Chinese params for the retired audit pages
// @output -- regression proof of permanent, locale-preserving Agent redirects
// @pos    -- route-level compatibility tests for legacy marketing URLs

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permanentRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  permanentRedirect: mocks.permanentRedirect,
}));

const { default: SeoAuditPage } = await import("./seo-audit/page.tsx");
const { default: InternalLinkAuditPage } = await import(
  "./internal-link-audit/page.tsx"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("legacy audit page redirects", () => {
  it.each([
    { page: SeoAuditPage, locale: "en", expected: "/agents/seo" },
    { page: SeoAuditPage, locale: "zh", expected: "/zh/agents/seo" },
    { page: InternalLinkAuditPage, locale: "en", expected: "/agents/tech" },
    {
      page: InternalLinkAuditPage,
      locale: "zh",
      expected: "/zh/agents/tech",
    },
  ])("redirects $locale to $expected", async ({ page, locale, expected }) => {
    await page({ params: Promise.resolve({ locale }) });

    expect(mocks.permanentRedirect).toHaveBeenCalledOnce();
    expect(mocks.permanentRedirect).toHaveBeenCalledWith(expected);
  });
});
