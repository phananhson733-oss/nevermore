import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/blog", () => ({
  getAllBlogPosts: async () => [
    {
      locale: "en",
      slug: "english-post",
      updated_at: "2026-08-13T00:00:00.000Z",
    },
    {
      locale: "zh",
      slug: "chinese-post",
      updated_at: "2026-08-13T00:00:00.000Z",
    },
  ],
}));

vi.mock("../lib/legal", () => ({
  getLegalDocument: async () => null,
}));

vi.mock("../lib/locale-path", () => ({
  localeUrl: (locale: string, path = "") =>
    `https://gengrowth.ai${locale === "zh" ? "/zh" : ""}${path}`,
}));

vi.mock("../config/sitemap-tools", () => ({
  SITEMAP_TOOLS: [
    "seo-quick-wins",
    "traffic-drop-diagnosis",
    "low-competition-keywords",
  ],
}));

describe("canonical marketing sitemap", () => {
  it("keeps legacy /en URLs out of the normal sitemap", async () => {
    const { default: sitemap } = await import("./sitemap");
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain("https://gengrowth.ai/blog/english-post");
    expect(urls).toContain("https://gengrowth.ai/zh/blog/chinese-post");
    expect(urls).toContain("https://gengrowth.ai/tools/seo-quick-wins");
    expect(urls).not.toContain("https://gengrowth.ai/tools/seo-audit");
    expect(urls).not.toContain(
      "https://gengrowth.ai/tools/internal-link-audit",
    );
    expect(
      urls.some((url) => url.startsWith("https://gengrowth.ai/en")),
    ).toBe(false);
  });
});
