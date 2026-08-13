// @input  — frozen pre-cutover /en route inventory and reviewed target overrides
// @output — 95 old English URLs with the final unprefixed migration target
// @pos    — temporary site-move authority for sitemap-legacy-en.xml and tests

export interface LegacyEnMigrationEntry {
  readonly legacyPath: string;
  readonly targetPath: string;
}

// These routes existed before the default English locale became unprefixed on
// 2026-07-31. low-competition-keywords is deliberately absent: that page first
// shipped after cutover and never had a public /en URL.
const LEGACY_EN_SITE_PATHS = [
  "/en",
  "/en/about",
  "/en/blog",
  "/en/compare",
  "/en/contact",
  "/en/cookies",
  "/en/copyright",
  "/en/features",
  "/en/glossary",
  "/en/playbooks",
  "/en/pricing",
  "/en/privacy",
  "/en/templates",
  "/en/terms",
  "/en/tools",
  "/en/tools/internal-link-audit",
  "/en/tools/seo-audit",
  "/en/tools/seo-quick-wins",
  "/en/tools/traffic-drop-diagnosis",
  "/en/use-cases",
] as const;

// Frozen union of the connected index-tracking register (64 rows), the
// repository-backed English corpus present at cutover, and the separately
// evidenced AstrologyWiki recovery URL. Four articles first published on
// 2026-08-07 are intentionally excluded because they never had /en routes.
const LEGACY_EN_BLOG_PATHS = [
  "/en/blog/9-best-marketing-attribution-tools-for-saas-in-2026",
  "/en/blog/affordable-seo-software",
  "/en/blog/affordable-seo-tools",
  "/en/blog/agency-rank-tracking",
  "/en/blog/agentic-ai-marketing-automation",
  "/en/blog/ai-agents-for-sales",
  "/en/blog/ai-marketing-automation-for-saas",
  "/en/blog/ai-search-visibility",
  "/en/blog/ai-seo-audit",
  "/en/blog/all-in-one-seo",
  "/en/blog/astrologywiki-case-study",
  "/en/blog/astrologywiki-zero-to-5000-users",
  "/en/blog/b2b-saas-seo",
  "/en/blog/best-ai-marketing-and-cmo-tools-for-saas-in-2026",
  "/en/blog/best-ai-seo-tools",
  "/en/blog/best-cheap-seo-tools",
  "/en/blog/best-tools-for-seo-for-b2b",
  "/en/blog/best-white-label-seo-tool",
  "/en/blog/bounded-internal-link-crawl",
  "/en/blog/chatgpt-seo",
  "/en/blog/cheap-seo",
  "/en/blog/content-audit-tool",
  "/en/blog/cost-effective-seo-services",
  "/en/blog/ethical-seo",
  "/en/blog/ethical-seo-services",
  "/en/blog/evidence-first-growth-experiments",
  "/en/blog/free-seo-company",
  "/en/blog/free-seo-consultation",
  "/en/blog/free-white-label-seo",
  "/en/blog/generative-engine-optimization",
  "/en/blog/gengrowth-vs-blaze",
  "/en/blog/gengrowth-vs-cometly",
  "/en/blog/gengrowth-vs-improvado",
  "/en/blog/gengrowth-vs-okara",
  "/en/blog/google-ai-search-agents-2026",
  "/en/blog/google-july-2026-update",
  "/en/blog/gpt-5-6-seo",
  "/en/blog/growth-experiment-playbook",
  "/en/blog/integrated-seo",
  "/en/blog/international-seo-audit",
  "/en/blog/local-seo-audit",
  "/en/blog/manual-seo-service",
  "/en/blog/marketing-attribution-for-saas",
  "/en/blog/marketing-attribution-models",
  "/en/blog/organic-seo-service",
  "/en/blog/organic-seo-services",
  "/en/blog/organic-traffic-growth-case-study",
  "/en/blog/programmatic-seo-at-scale",
  "/en/blog/public-seo-audit-boundaries",
  "/en/blog/saas-seo-consultant",
  "/en/blog/saas-seo-expert",
  "/en/blog/saas-seo-platform",
  "/en/blog/seo-audit-checklist",
  "/en/blog/seo-automation",
  "/en/blog/seo-diagrams",
  "/en/blog/seo-for-saas",
  "/en/blog/seo-for-saas-startups",
  "/en/blog/seo-for-technology-companies",
  "/en/blog/seo-outreach-agency",
  "/en/blog/seo-reporting-tool-for-seo-companies",
  "/en/blog/seo-starter-package",
  "/en/blog/serankings",
  "/en/blog/serankings-alternative",
  "/en/blog/social-first-probe-week-1",
  "/en/blog/social-first-week-1",
  "/en/blog/sony-playstation-physical-games-strategy-2026",
  "/en/blog/startup-seo",
  "/en/blog/taylor-swift-wedding-brand-economics-2026",
  "/en/blog/tiktok-seo-tool",
  "/en/blog/website-health-score",
  "/en/blog/what-is-growth-automation",
  "/en/blog/white-label-keyword-research",
  "/en/blog/whitelabel-seo-tool",
  "/en/blog/why-use-a-backlink-monitor-tool",
  "/en/blog/world-cup-2026-content-marketing-ai",
] as const;

const FINAL_TARGET_OVERRIDES: Readonly<Record<string, string>> = {
  "/en/about": "/pricing",
  "/en/compare": "/blog#comparisons",
  "/en/features": "/pricing",
  "/en/glossary": "/blog",
  "/en/playbooks": "/blog",
  "/en/templates": "/blog",
  "/en/use-cases": "/blog",
  "/en/tools/internal-link-audit": "/agents/tech",
  "/en/tools/seo-audit": "/agents/seo",
  "/en/blog/free-seo-consultation": "/blog/free-seo-company",
  "/en/blog/free-white-label-seo": "/blog/best-white-label-seo-tool",
  "/en/blog/marketing-attribution-for-saas":
    "/blog/marketing-attribution-models",
  "/en/blog/astrologywiki-zero-to-5000-users":
    "/blog/astrologywiki-case-study",
  "/en/blog/serankings": "/blog/serankings-alternative",
  "/en/blog/whitelabel-seo-tool": "/blog/best-white-label-seo-tool",
};

function defaultTarget(legacyPath: string): string {
  const unprefixed = legacyPath.slice("/en".length);
  return unprefixed || "/";
}

export const LEGACY_EN_MIGRATION_ENTRIES: readonly LegacyEnMigrationEntry[] =
  Object.freeze(
    [...LEGACY_EN_SITE_PATHS, ...LEGACY_EN_BLOG_PATHS].map((legacyPath) =>
      Object.freeze({
        legacyPath,
        targetPath: FINAL_TARGET_OVERRIDES[legacyPath] ?? defaultTarget(legacyPath),
      }),
    ),
  );
