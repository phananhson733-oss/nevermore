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
    "daily-search-briefing",
    "seo-quick-wins",
    "traffic-drop-diagnosis",
    "low-competition-keywords",
  ],
}));

describe("canonical marketing sitemap", () => {
  /**
   * `/agents/tech` keeps serving and keeps its URL, but it is canonical to
   * `/agents/seo`. Advertising it here would ask for crawl budget on a page
   * whose own markup says not to index it, on a site that sells finding
   * exactly that mistake.
   */
  it("leaves the consolidated Tech Agent route out", async () => {
    const { default: sitemap } = await import("./sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain("https://gengrowth.ai/agents/seo");
    expect(urls).toContain("https://gengrowth.ai/zh/agents/seo");
    expect(urls).not.toContain("https://gengrowth.ai/agents/tech");
    expect(urls).not.toContain("https://gengrowth.ai/zh/agents/tech");
  });

  it("keeps legacy /en URLs out of the normal sitemap", async () => {
    const { default: sitemap } = await import("./sitemap");
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain("https://gengrowth.ai/blog/english-post");
    expect(urls).toContain("https://gengrowth.ai/zh/blog/chinese-post");
    expect(urls).toContain(
      "https://gengrowth.ai/tools/daily-search-briefing",
    );
    expect(urls).toContain(
      "https://gengrowth.ai/zh/tools/daily-search-briefing",
    );
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

    // Detail pages are listed for the locale that owns the file, and only for
    // that locale: a locale serving another's text as a fallback still answers
    // the URL, but listing it would advertise a second document carrying the
    // same words. Asserted as that rule rather than as "zh never appears", so
    // the check keeps meaning something as translations land.
    const { localesOwningPrompt } = await import("../lib/prompt-content");
    const { localesOwningSkill } = await import("../lib/skill-content");

    // `zz-` slugs belong to other test files, which write them into the real
    // content directories and delete them again. This file reads those
    // directories twice — once through sitemap(), once through the owner
    // lookup — so a fixture appearing or vanishing between the two reads would
    // fail this test for a reason that has nothing to do with the sitemap.
    const isFixture = (slug: string) => slug.startsWith("zz-");

    for (const prompt of prompts.filter((p) => !isFixture(p.slug))) {
      expect(urls).toContain(`https://gengrowth.ai/prompts/${prompt.slug}`);
      const owners = await localesOwningPrompt(prompt.slug);
      expect(urls.has(`https://gengrowth.ai/zh/prompts/${prompt.slug}`)).toBe(
        owners.includes("zh"),
      );
    }
    for (const skill of skills.filter((s) => !isFixture(s.slug))) {
      expect(urls).toContain(`https://gengrowth.ai/skills/${skill.slug}`);
      const owners = await localesOwningSkill(skill.slug);
      expect(urls.has(`https://gengrowth.ai/zh/skills/${skill.slug}`)).toBe(
        owners.includes("zh"),
      );
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
