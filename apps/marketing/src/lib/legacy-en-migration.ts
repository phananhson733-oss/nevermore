// @input  — cutover route history, connected blog register evidence, and repair cohort overrides
// @output — auditable legacy /en inventory with disposition, target, and migration cohort
// @pos    — temporary site-move authority for sitemap-legacy-en.xml and route tests

export type LegacyEnDisposition =
  | "direct_redirect"
  | "replacement_redirect"
  | "recovered_redirect"
  | "gone";

export type LegacyEnMigrationDate = "2026-07-31" | "2026-08-13";

export interface LegacyEnMigrationEntry {
  readonly legacyPath: string;
  readonly targetPath: string | null;
  readonly disposition: LegacyEnDisposition;
  readonly migrationDate: LegacyEnMigrationDate;
  readonly provenance:
    | "cutover_route_history"
    | "connected_blog_register"
    | "repair_evidence";
}

const CUTOVER_MIGRATION_DATE: LegacyEnMigrationDate = "2026-07-31";
const REPAIR_MIGRATION_DATE: LegacyEnMigrationDate = "2026-08-13";

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

const CONNECTED_REGISTER_BLOG_PATHS = [
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

const POST_CUTOVER_EXCLUSIONS = new Set([
  "/en/blog/how-to-find-low-hanging-fruit-keywords",
  "/en/blog/pagerank-sculpting",
  "/en/blog/seo-content-clusters-draft",
  "/en/blog/striking-distance-keywords",
  "/en/blog/zero-search-volume-keywords",
  "/en/tools/low-competition-keywords",
]);

const EXTRA_TOOL_PATHS = [
  "/en/tools/ab-test-calculator",
  "/en/tools/growth-roi-calculator",
  "/en/tools/hidden-keywords",
] as const;

// These leaf paths are deliberately frozen here instead of derived from the
// current mock/content modules. A future editorial add, rename, or deletion is
// not evidence that a URL existed before the 2026-07-31 locale cutover.
const GLOSSARY_PATHS = [
  "/en/glossary/a-b-testing-framework",
  "/en/glossary/ab-testing",
  "/en/glossary/activation-rate",
  "/en/glossary/ai-citation",
  "/en/glossary/ai-content-detection",
  "/en/glossary/ai-overview-optimization",
  "/en/glossary/ai-search-engine",
  "/en/glossary/answer-engine-optimization",
  "/en/glossary/attribution-model",
  "/en/glossary/backlink-profile",
  "/en/glossary/bounce-rate",
  "/en/glossary/brand-visibility-score",
  "/en/glossary/canonical-url",
  "/en/glossary/churn-rate",
  "/en/glossary/citation-potential",
  "/en/glossary/click-through-rate",
  "/en/glossary/competitive-analysis",
  "/en/glossary/content-marketing-funnel",
  "/en/glossary/conversion-rate",
  "/en/glossary/core-web-vitals",
  "/en/glossary/customer-acquisition-cost",
  "/en/glossary/daily-active-users",
  "/en/glossary/domain-authority",
  "/en/glossary/entity-seo",
  "/en/glossary/generative-engine-optimization",
  "/en/glossary/growth-loop",
  "/en/glossary/hreflang-tag",
  "/en/glossary/lifetime-value",
  "/en/glossary/link-building-strategy",
  "/en/glossary/llm-content-optimization",
  "/en/glossary/ltv-cac-ratio",
  "/en/glossary/market-positioning",
  "/en/glossary/mobile-first-indexing",
  "/en/glossary/monthly-recurring-revenue",
  "/en/glossary/net-promoter-score",
  "/en/glossary/north-star-metric",
  "/en/glossary/page-speed-optimization",
  "/en/glossary/product-led-growth",
  "/en/glossary/referral-program",
  "/en/glossary/retention-curve",
  "/en/glossary/robots-txt",
  "/en/glossary/schema-markup",
  "/en/glossary/seo-content-strategy",
  "/en/glossary/social-proof-strategy",
  "/en/glossary/structured-data",
  "/en/glossary/topical-authority",
  "/en/glossary/utm-parameters",
  "/en/glossary/viral-coefficient",
  "/en/glossary/xml-sitemap",
  "/en/glossary/zero-click-search",
] as const;

const COMPARE_PATHS = [
  "/en/compare/ahrefs",
  "/en/compare/babylovegrowth",
  "/en/compare/manual-growth",
  "/en/compare/okara-ai-cmo",
] as const;

const PLAYBOOK_PATHS = [
  "/en/playbooks/community-devrel-loop",
  "/en/playbooks/email-nurture-sequence",
  "/en/playbooks/link-building-starter",
  "/en/playbooks/product-page-optimization",
  "/en/playbooks/seo-scale-up",
  "/en/playbooks/social-first-probe",
] as const;

const USE_CASE_PATHS = [
  "/en/use-cases/content-site-seo-scale",
  "/en/use-cases/devtool-community-growth",
  "/en/use-cases/ecommerce-product-seo",
  "/en/use-cases/saas-zero-to-1000",
] as const;

const CUTOVER_HISTORY_PATHS = [
  ...LEGACY_EN_SITE_PATHS,
  ...GLOSSARY_PATHS,
  ...COMPARE_PATHS,
  ...PLAYBOOK_PATHS,
  ...USE_CASE_PATHS,
  ...EXTRA_TOOL_PATHS,
] as const;

const GONE_LEGACY_PATHS = new Set<string>([
  "/en/about",
  "/en/features",
  "/en/glossary",
  "/en/playbooks",
  "/en/templates",
  "/en/use-cases",
  "/en/tools/ab-test-calculator",
  "/en/tools/growth-roi-calculator",
  "/en/blog/gengrowth-vs-blaze",
  "/en/blog/gengrowth-vs-cometly",
  "/en/blog/gengrowth-vs-okara",
  ...GLOSSARY_PATHS,
  ...COMPARE_PATHS,
  ...PLAYBOOK_PATHS,
  ...USE_CASE_PATHS,
]);

const REPAIR_TARGET_OVERRIDES: Readonly<
  Partial<Record<string, readonly [string, LegacyEnDisposition]>>
> = {
  "/en/compare": ["/blog#comparisons", "replacement_redirect"],
  "/en/tools/seo-audit": ["/agents/seo", "replacement_redirect"],
  "/en/tools/hidden-keywords": [
    "/tools/low-competition-keywords",
    "replacement_redirect",
  ],
  "/en/blog/free-seo-consultation": [
    "/blog/free-seo-company",
    "replacement_redirect",
  ],
  "/en/blog/free-white-label-seo": [
    "/blog/best-white-label-seo-tool",
    "replacement_redirect",
  ],
  "/en/blog/marketing-attribution-for-saas": [
    "/blog/marketing-attribution-models",
    "replacement_redirect",
  ],
  "/en/blog/serankings": [
    "/blog/serankings-alternative",
    "replacement_redirect",
  ],
  "/en/blog/whitelabel-seo-tool": [
    "/blog/best-white-label-seo-tool",
    "replacement_redirect",
  ],
  // Retired on 2026-08-25. The recovered article was an evidence-boundary
  // correction of an unverifiable case study; it read to visitors as a
  // publishing fault rather than a story, so both slugs now land on the
  // page-production guide they were cited from. The migration cohort stays at
  // its original date: this records where the legacy URL resolves today, and
  // Google reads it from sitemap-legacy-en.xml, so it has to match the live
  // 301 rather than preserve a target that no longer exists.
  "/en/blog/astrologywiki-zero-to-5000-users": [
    "/blog/programmatic-seo-at-scale",
    "replacement_redirect",
  ],
  "/en/blog/astrologywiki-case-study": [
    "/blog/programmatic-seo-at-scale",
    "replacement_redirect",
  ],
  "/en/blog/9-best-marketing-attribution-tools-for-saas-in-2026": [
    "/blog/9-best-marketing-attribution-tools-for-saas-in-2026",
    "recovered_redirect",
  ],
  "/en/blog/ai-marketing-automation-for-saas": [
    "/blog/ai-marketing-automation-for-saas",
    "recovered_redirect",
  ],
  "/en/blog/best-ai-marketing-and-cmo-tools-for-saas-in-2026": [
    "/blog/best-ai-marketing-and-cmo-tools-for-saas-in-2026",
    "recovered_redirect",
  ],
  "/en/blog/gengrowth-vs-improvado": [
    "/blog/gengrowth-vs-improvado",
    "recovered_redirect",
  ],
};

function defaultTarget(legacyPath: string): string {
  const unprefixed = legacyPath.slice("/en".length);
  return unprefixed || "/";
}

function createEntry(
  legacyPath: string,
  provenance: LegacyEnMigrationEntry["provenance"],
): LegacyEnMigrationEntry {
  if (GONE_LEGACY_PATHS.has(legacyPath)) {
    return Object.freeze({
      legacyPath,
      targetPath: null,
      disposition: "gone" as const,
      migrationDate: REPAIR_MIGRATION_DATE,
      provenance: "repair_evidence" as const,
    });
  }

  const repairOverride = REPAIR_TARGET_OVERRIDES[legacyPath];

  if (repairOverride) {
    const [targetPath, disposition] = repairOverride;
    return Object.freeze({
      legacyPath,
      targetPath,
      disposition,
      migrationDate: REPAIR_MIGRATION_DATE,
      provenance: "repair_evidence",
    });
  }

  return Object.freeze({
    legacyPath,
    targetPath: defaultTarget(legacyPath),
    disposition: "direct_redirect" as const,
    migrationDate: CUTOVER_MIGRATION_DATE,
    provenance,
  });
}

export const LEGACY_EN_MIGRATION_ENTRIES: readonly LegacyEnMigrationEntry[] =
  Object.freeze(
    Array.from(
      new Set(
        [...CUTOVER_HISTORY_PATHS, ...CONNECTED_REGISTER_BLOG_PATHS].filter(
          (legacyPath) => !POST_CUTOVER_EXCLUSIONS.has(legacyPath),
        ),
      ),
    )
      .sort((left, right) => left.localeCompare(right))
      .map((legacyPath) =>
        createEntry(
          legacyPath,
          CONNECTED_REGISTER_BLOG_PATHS.includes(
            legacyPath as (typeof CONNECTED_REGISTER_BLOG_PATHS)[number],
          )
            ? "connected_blog_register"
            : "cutover_route_history",
        ),
      ),
  );
