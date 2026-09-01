// @input  -- active Tools hub source
// @output -- regression guard for formal tools and the website-owned GEO asset boundary
// @pos    -- keeps the supporting-tools hub complete and the Internal Link Audit public

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HUB_PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));
const TOOL_CARD = fileURLToPath(
  new URL("../../../components/tools/tool-card.tsx", import.meta.url),
);

describe("Tools hub execution boundaries", () => {
  it("describes the actual two-engine GEO visibility input", () => {
    const source = readFileSync(HUB_PAGE, "utf8");
    const entry = source.slice(source.indexOf('slug: "ai-visibility-check"'), source.indexOf('slug: "geo-brief"'));
    expect(entry).toContain("ChatGPT");
    expect(entry).toContain("Perplexity");
    expect(entry).not.toContain("one AI surface");
    expect(entry).not.toContain("一个 AI 面");
  });
  it("keeps formal tool entries in their established order, with GEO Knowledge Base owned by Settings", () => {
    const source = readFileSync(HUB_PAGE, "utf8");
    const slugs = [...source.matchAll(/slug: "([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(slugs).toEqual([
      "daily-search-briefing",
      "seo-quick-wins",
      "internal-link-audit",
      "traffic-drop-diagnosis",
      "on-page-seo-check",
      "seo-audit",
      "low-competition-keywords",
      "competitor-keyword-gap",
      "content-brief",
      "content-draft",
      "page-citability-check",
      "ai-visibility-check",
      "geo-brief",
    ]);
    expect(source).toContain(
      'cta: { en: "Run internal link audit", zh: "运行内链审计" }',
    );
    expect(source).toContain(
      'cta: { en: "Open SEO Agent", zh: "打开 SEO Agent" }',
    );
  });

  it("keeps the existing KB URL as an information shortcut, with editing only in Website Profile", () => {
    const legacy = readFileSync(new URL("./geo-knowledge-base/page.tsx", import.meta.url), "utf8");
    const canonical = readFileSync(new URL("../account/websites/[websiteId]/geo/page.tsx", import.meta.url), "utf8");
    expect(legacy).not.toContain("<GeoKnowledgeBase");
    expect(legacy).toContain('t("asset.shortcutDescription")');
    expect(legacy).toContain('localePath(locale, "/account/websites")');
    expect(legacy).not.toContain("redirect(");
    expect(canonical).toContain("redirect(");
    expect(canonical).toContain("#geo");
    const profile = readFileSync(new URL("../account/websites/[websiteId]/page.tsx", import.meta.url), "utf8");
    expect(profile).toContain("<WebsiteProfileWithGeo");
  });

  it("describes Internal Link Audit as a standalone no-login public audit", () => {
    const source = readFileSync(HUB_PAGE, "utf8");

    expect(source).toContain(
      'en: "Audit your public internal-link graph without signing in, with click-depth, orphan-page candidates, and source-link evidence."',
    );
    expect(source).toContain(
      'zh: "无需登录即可审计公开网站的内链图谱，查看点击深度、孤岛页候选与来源链接证据。"',
    );
    expect(source).not.toContain(
      "Review crawl, indexability, and internal-link evidence in the SEO Agent, opened on its technical focus. A verified account is required to run it.",
    );
    expect(source).not.toContain(
      "在 SEO Agent 的技术焦点下检查抓取、可索引性与内链证据；运行时需要已验证账号。",
    );
  });

  it("routes the Internal Link Audit slug through the public ToolCard path", () => {
    const hubSource = readFileSync(HUB_PAGE, "utf8");
    const cardSource = readFileSync(TOOL_CARD, "utf8");

    expect(hubSource).toContain('slug: "internal-link-audit"');
    expect(cardSource).toContain(
      "<Link href={localePath(locale, `/tools/${slug}`)}",
    );
  });

  it("keeps the full-product CTA on the marketing waitlist rather than the app", () => {
    const source = readFileSync(HUB_PAGE, "utf8");

    expect(source).toContain('localePath(locale, "/waitlist")');
    expect(source).not.toContain("siteConfig.appUrl");
  });
});
