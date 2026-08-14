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
    expect(urls.some((url) => url.startsWith("https://gengrowth.ai/en"))).toBe(
      false,
    );
  });

  // The resource libraries are read from the real content directories rather
  // than mocked, so this also proves every cross-reference in them resolves —
  // the loader throws on a dangling related slug.
  it("lists both hubs in both locales and each resource under its own locale", async () => {
    const { default: sitemap } = await import("./sitemap");
    const { getPrompts } = await import("../lib/prompt-content");
    const { getSkills } = await import("../lib/skill-content");

    const entries = await sitemap();
    const urls = new Set(entries.map((entry) => entry.url));
    const prompts = await getPrompts("en");
    const skills = await getSkills("en");

    expect(prompts.length).toBeGreaterThan(0);
    expect(skills.length).toBeGreaterThan(0);

    expect(urls).toContain("https://gengrowth.ai/prompts");
    expect(urls).toContain("https://gengrowth.ai/skills");
    expect(urls).toContain("https://gengrowth.ai/zh/prompts");
    expect(urls).toContain("https://gengrowth.ai/zh/skills");

    // Detail pages are listed for the locale that owns the file. With no zh
    // translations, listing a zh detail URL would advertise a second document
    // carrying the same English text.
    for (const prompt of prompts) {
      expect(urls).toContain(`https://gengrowth.ai/prompts/${prompt.slug}`);
      expect(urls).not.toContain(`https://gengrowth.ai/zh/prompts/${prompt.slug}`);
    }
    for (const skill of skills) {
      expect(urls).toContain(`https://gengrowth.ai/skills/${skill.slug}`);
      expect(urls).not.toContain(`https://gengrowth.ai/zh/skills/${skill.slug}`);
    }
  });

  it("never lists the skill download endpoint", async () => {
    const { default: sitemap } = await import("./sitemap");
    const entries = await sitemap();

    // The download route returns an attachment, not a page. Listing it would
    // ask crawlers to index a file with no canonical of its own.
    expect(entries.some((entry) => entry.url.endsWith("/file"))).toBe(false);
  });
});
