// @input  -- English and Chinese params for the retired SEO Audit page
// @output -- regression proof of its permanent, locale-preserving SEO Agent redirect
// @pos    -- route-level compatibility test for the retired SEO Audit URL

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permanentRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  permanentRedirect: mocks.permanentRedirect,
}));

const { default: SeoAuditPage } = await import("./seo-audit/page.tsx");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("legacy SEO Audit page redirect", () => {
  it.each([
    { page: SeoAuditPage, locale: "en", expected: "/agents/seo" },
    { page: SeoAuditPage, locale: "zh", expected: "/zh/agents/seo" },
  ])("redirects $locale to $expected", async ({ page, locale, expected }) => {
    await page({ params: Promise.resolve({ locale }) });

    expect(mocks.permanentRedirect).toHaveBeenCalledOnce();
    expect(mocks.permanentRedirect).toHaveBeenCalledWith(expected);
  });
});
