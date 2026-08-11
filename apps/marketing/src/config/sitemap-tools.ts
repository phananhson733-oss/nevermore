// @input  -- nothing; a hand-kept list
// @output -- the tool pages the sitemap offers to crawlers
// @pos    -- kept out of app/sitemap.ts so a test can import it without the `@/` alias
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * The tool pages offered to crawlers.
 *
 * Listed rather than read off the route directory because not every route is a
 * page: `ab-test-calculator` and `growth-roi-calculator` are permanent
 * redirects kept for old links, and a sitemap that names a 301 asks for the
 * crawl twice. `sitemap-tools.test.ts` checks this against the directory in
 * both directions, so a renamed or new tool cannot quietly go unlisted.
 */
export const SITEMAP_TOOLS = [
  "seo-quick-wins",
  "internal-link-audit",
  "traffic-drop-diagnosis",
  "seo-audit",
  "low-competition-keywords",
] as const;
