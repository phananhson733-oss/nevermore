// @input  -- Agent identity, a selected evaluated v2 check, and the run's own measured facts
// @output -- solution-specific, preview-only content or code/config shape filled with observed values
// @pos    -- pure Stage 04 semantic adapter; never applies, saves, or deploys

import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import type { AgentKind } from "./agent-types";

export type AgentSolutionPresentation = "content" | "code" | "investigation";

export type AgentSolutionKind =
  | "search-opportunity"
  | "search-presentation"
  | "content-brief"
  | "heading-structure"
  | "internal-link-exposure"
  | "structured-data"
  | "media-assets"
  | "technical-issue-brief"
  | "indexability"
  | "crawl"
  | "redirect"
  | "canonical"
  | "performance"
  | "rendering"
  | "template"
  | "schema"
  | "link-integrity";

/**
 * Message-path segment for each solution kind.
 *
 * Stage 04 copy is written per solution kind, not per Agent: the same Agent
 * gives different advice, validation steps, risks, and limits for a canonical
 * fix than for a redirect chain.
 */
const KIND_MESSAGE_SEGMENT = {
  "search-opportunity": "searchOpportunity",
  "search-presentation": "searchPresentation",
  "content-brief": "contentBrief",
  "heading-structure": "headingStructure",
  "internal-link-exposure": "internalLinkExposure",
  "structured-data": "structuredData",
  "media-assets": "mediaAssets",
  "technical-issue-brief": "technicalIssueBrief",
  indexability: "indexability",
  crawl: "crawl",
  redirect: "redirect",
  canonical: "canonical",
  performance: "performance",
  rendering: "rendering",
  template: "template",
  schema: "schema",
  "link-integrity": "linkIntegrity",
} as const satisfies Readonly<Record<AgentSolutionKind, string>>;

export type AgentSolutionKindSegment =
  (typeof KIND_MESSAGE_SEGMENT)[AgentSolutionKind];

type AgentSolutionKindMessageKey<Name extends string> =
  `recommendations.${AgentKind}.kinds.${AgentSolutionKindSegment}.${Name}`;

type AgentSolutionAgentMessageKey<Name extends string> =
  `recommendations.${AgentKind}.${Name}`;

export interface AgentSolutionTemplate {
  readonly agent: AgentKind;
  readonly kind: AgentSolutionKind;
  readonly presentation: AgentSolutionPresentation;
  readonly preview: string;
  readonly recommendationKey: AgentSolutionKindMessageKey<"recommendation">;
  readonly applicableContextKey: AgentSolutionAgentMessageKey<"applicableContext">;
  readonly validationKeys: readonly [
    AgentSolutionKindMessageKey<"validation1">,
    AgentSolutionKindMessageKey<"validation2">,
    AgentSolutionKindMessageKey<"validation3">,
  ];
  readonly impactSurfaceKey: AgentSolutionKindMessageKey<"impactSurface">;
  readonly risksKey: AgentSolutionKindMessageKey<"risks">;
  readonly limitsKey: AgentSolutionKindMessageKey<"limits">;
}

/**
 * Run facts a preview may quote.
 *
 * Every field is either a value this run actually measured or `null`. A null
 * field is rendered as an explicit marker, never as invented content.
 */
export interface AgentSolutionPreviewInput {
  /** Marker for a slot the reviewer still has to decide or write. */
  readonly fillIn: string;
  /** Marker for a value this bounded run did not capture. */
  readonly notCaptured: string;
  readonly targetUrl: string;
  readonly productName: string;
  readonly targetQuery: string;
  /** Already localized confirmed page type. */
  readonly pageType: string;
  /** Already localized "country · locale · device" summary. */
  readonly searchContext: string;
  /** Already localized measured value for the selected check, if any. */
  readonly measurement: string | null;
  readonly evidenceRecords: readonly SeoAuditRecord[];
  /**
   * What the crawl actually read off the target page.
   *
   * A record only publishes the values its own check measured, so 2.1 carries
   * a title WIDTH and no title. Without this the preview printed "observed
   * title: [not captured]" beside a title the same run had collected and had
   * already sent to the draft endpoint.
   */
  readonly targetPageExtract?: {
    readonly title: string | null;
    readonly metaDescription: string | null;
    readonly h1: readonly string[];
  } | null;
}

interface PreviewFacts {
  readonly fillIn: string;
  readonly notCaptured: string;
  readonly targetUrl: string;
  readonly host: string;
  readonly targetPath: string;
  readonly productName: string;
  readonly targetQuery: string;
  readonly pageType: string;
  readonly searchContext: string;
  readonly measurement: string;
  readonly scope: "site" | "page";
  readonly observedUrls: readonly string[];
  readonly observedValues: Readonly<Record<string, string>>;
  /** Fallbacks for values the crawl read but this check's records do not carry. */
  readonly extractValues: Readonly<Record<string, string>>;
}

interface SolutionShape {
  readonly kind: AgentSolutionKind;
  readonly presentation: AgentSolutionPresentation;
  readonly buildPreview: (facts: PreviewFacts) => string;
}

const MAX_QUOTED_VALUE = 120;

function present(value: string | null | undefined, marker: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) return marker;
  return trimmed.length > MAX_QUOTED_VALUE
    ? `${trimmed.slice(0, MAX_QUOTED_VALUE)}…`
    : trimmed;
}

function observedValue(facts: PreviewFacts, label: string): string {
  return present(
    facts.observedValues[label] ?? facts.extractValues[label],
    facts.notCaptured,
  );
}

function observedUrl(facts: PreviewFacts, index: number): string {
  return present(facts.observedUrls[index], facts.notCaptured);
}

/**
 * The page a fix applies to.
 *
 * For a page-scope check that is the audited page. For a site-scope check it is
 * whichever page the evidence names; falling back to the audit entry URL would
 * tell the reader to change a page that has no such problem.
 */
function affectedUrl(facts: PreviewFacts): string {
  return facts.observedUrls[0] ?? (facts.scope === "page" ? facts.targetUrl : facts.fillIn);
}

function collectObservedUrls(
  records: readonly SeoAuditRecord[],
): readonly string[] {
  const urls: string[] = [];
  for (const record of records) {
    for (const observation of record.observations) {
      if (observation.url && !urls.includes(observation.url)) {
        urls.push(observation.url);
      }
    }
  }
  return urls;
}

function collectObservedValues(
  records: readonly SeoAuditRecord[],
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const record of records) {
    for (const observation of record.observations) {
      for (const entry of observation.values) {
        if (entry.value === null || entry.label in values) continue;
        values[entry.label] = String(entry.value);
      }
    }
  }
  return values;
}

/**
 * Display-only parse of the visitor's exact input. Server-side URL
 * normalization stays authoritative; this only decides what a preview may
 * quote instead of a placeholder.
 */
function urlParts(
  targetUrl: string,
): { href: string; host: string; path: string } | null {
  const trimmed = targetUrl.trim();
  if (!trimmed || trimmed.length > 2_048) return null;
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return {
      href: parsed.href,
      host: parsed.host,
      path: `${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return null;
  }
}

/**
 * The page's own text, under the labels a preview asks for.
 *
 * Deliberately narrow: only values the crawl read verbatim off the target
 * page. Anything derived or counted stays with the record that measured it.
 */
function extractValuesOf(
  extract: AgentSolutionPreviewInput["targetPageExtract"],
): Readonly<Record<string, string>> {
  if (extract === undefined || extract === null) return {};
  const values: Record<string, string> = {};
  if (extract.title !== null) values["title"] = extract.title;
  if (extract.metaDescription !== null) {
    values["meta_description"] = extract.metaDescription;
  }
  if (extract.h1.length > 0) {
    values["h1"] = extract.h1[0]!;
    values["h1_count"] = String(extract.h1.length);
  }
  return values;
}

function previewFacts(
  input: AgentSolutionPreviewInput,
  scope: "site" | "page",
): PreviewFacts {
  const parts = urlParts(input.targetUrl);
  return {
    scope,
    fillIn: input.fillIn,
    notCaptured: input.notCaptured,
    targetUrl: present(parts?.href ?? input.targetUrl, input.notCaptured),
    host: present(parts?.host, input.notCaptured),
    targetPath: present(parts?.path, input.notCaptured),
    productName: present(input.productName, input.fillIn),
    targetQuery: present(input.targetQuery, input.fillIn),
    pageType: present(input.pageType, input.notCaptured),
    searchContext: present(input.searchContext, input.notCaptured),
    measurement: present(input.measurement, input.notCaptured),
    observedUrls: collectObservedUrls(input.evidenceRecords),
    observedValues: collectObservedValues(input.evidenceRecords),
    extractValues: extractValuesOf(input.targetPageExtract),
  };
}

const SEO_SHAPES = {
  searchOpportunity: {
    kind: "search-opportunity",
    presentation: "investigation",
    buildPreview: (facts) =>
      [
        "search decision",
        `  target query: ${facts.targetQuery}`,
        `  country / locale / device: ${facts.searchContext}`,
        `  page under review: ${facts.targetUrl}`,
        `  measured this run: ${facts.measurement}`,
        "  required source: SERP snapshot or authorized Search Console",
        `  decision (pursue / refine / defer): ${facts.fillIn}`,
        `  evidence behind that decision: ${facts.fillIn}`,
      ].join("\n"),
  },
  searchPresentation: {
    kind: "search-presentation",
    presentation: "content",
    buildPreview: (facts) =>
      [
        "search presentation draft",
        `  page: ${facts.targetUrl}`,
        `  measured this run: ${facts.measurement}`,
        `  observed title: ${observedValue(facts, "title")}`,
        `  observed meta description: ${observedValue(facts, "meta_description")}`,
        `  new title: ${facts.fillIn}`,
        `  new meta description: ${facts.fillIn}`,
        `  opening line that answers the first decision: ${facts.fillIn}`,
        `  stay true to: ${facts.productName} · ${facts.targetQuery}`,
      ].join("\n"),
  },
  contentBrief: {
    kind: "content-brief",
    presentation: "content",
    buildPreview: (facts) =>
      [
        "content brief seed",
        `  page: ${facts.targetUrl}`,
        `  product: ${facts.productName}`,
        `  target query: ${facts.targetQuery}`,
        `  measured this run: ${facts.measurement}`,
        `  page facts worth keeping: ${facts.fillIn}`,
        `  sections to add or rewrite: ${facts.fillIn}`,
        `  source for every new claim: ${facts.fillIn}`,
      ].join("\n"),
  },
  headingStructure: {
    kind: "heading-structure",
    presentation: "content",
    buildPreview: (facts) =>
      [
        "document outline",
        `  page: ${facts.targetUrl}`,
        `  measured this run: ${facts.measurement}`,
        `  observed h1 count: ${observedValue(facts, "h1_count")}`,
        `  page-type preset: ${facts.pageType}`,
        `  h1 (one page decision): ${facts.fillIn}`,
        `  h2 (major decision steps): ${facts.fillIn}`,
        `  h3 (subquestions with substantive answers): ${facts.fillIn}`,
      ].join("\n"),
  },
  internalLinkExposure: {
    kind: "internal-link-exposure",
    presentation: "content",
    buildPreview: (facts) =>
      [
        "contextual discovery path",
        `  destination page: ${facts.targetUrl}`,
        `  measured this run: ${facts.measurement}`,
        `  observed inbound links: ${observedValue(facts, "observed_inbound_links")}`,
        `  source page to link from: ${facts.fillIn}`,
        `  anchor text (descriptive, user-facing): ${facts.fillIn}`,
        `  why the link helps the reader there: ${facts.fillIn}`,
      ].join("\n"),
  },
  structuredData: {
    kind: "structured-data",
    presentation: "content",
    buildPreview: (facts) =>
      [
        "visible-content schema brief",
        `  page: ${facts.targetUrl}`,
        `  page role: ${facts.pageType}`,
        `  measured this run: ${facts.measurement}`,
        `  entity described: ${facts.fillIn}`,
        `  facts already visible on the page to mark up: ${facts.fillIn}`,
        `  vocabulary / version: ${facts.fillIn}`,
        "  rich-result eligibility: not promised",
      ].join("\n"),
  },
  mediaAssets: {
    kind: "media-assets",
    presentation: "content",
    buildPreview: (facts) =>
      [
        "image and alt-text pass",
        `  page: ${facts.targetUrl}`,
        `  measured this run: ${facts.measurement}`,
        `  alt text per affected image (what it shows): ${facts.fillIn}`,
        `  format or file-size decision: ${facts.fillIn}`,
        `  owner of the media pipeline: ${facts.fillIn}`,
      ].join("\n"),
  },
  technicalIssueBrief: {
    kind: "technical-issue-brief",
    presentation: "content",
    buildPreview: (facts) =>
      [
        "technical issue brief",
        `  page: ${facts.targetUrl}`,
        `  observed condition: ${facts.measurement}`,
        `  first observed URL: ${observedUrl(facts, 0)}`,
        `  affected search decision: ${facts.fillIn}`,
        `  owner or system to involve: ${facts.fillIn}`,
        "  next step: review independently on the technical focus",
      ].join("\n"),
  },
} as const satisfies Readonly<Record<string, SolutionShape>>;

const TECH_SHAPES = {
  indexability: {
    kind: "indexability",
    presentation: "code",
    buildPreview: (facts) =>
      [
        "# preview only — confirm owner intent before changing any directive",
        `# target: ${facts.targetUrl}`,
        `# measured this run: ${facts.measurement}`,
        `# observed final status: ${observedValue(facts, "final_status")}`,
        `# observed robots directive: ${observedValue(facts, "robots_directive")}`,
        "HTTP/1.1 200 OK",
        "X-Robots-Tag: index, follow",
        '<meta name="robots" content="index,follow">',
      ].join("\n"),
  },
  crawl: {
    kind: "crawl",
    presentation: "code",
    buildPreview: (facts) =>
      [
        "# preview only — public crawl policy",
        `# target: ${facts.targetUrl}`,
        `# measured this run: ${facts.measurement}`,
        "User-agent: *",
        `Allow: ${facts.targetPath}`,
        `Sitemap: https://${facts.host}/sitemap.xml`,
        `# paths that must stay disallowed: ${facts.fillIn}`,
      ].join("\n"),
  },
  redirect: {
    kind: "redirect",
    presentation: "code",
    buildPreview: (facts) =>
      [
        "# preview only — framework syntax depends on the owning system",
        `# target: ${facts.targetUrl}`,
        `# measured this run: ${facts.measurement}`,
        `# observed hops: ${observedValue(facts, "redirect_hops")}`,
        `# observed final URL: ${observedValue(facts, "final_url")}`,
        `# affected source: ${affectedUrl(facts)}`,
        `redirect("${affectedUrl(facts)}", "${observedValue(facts, "final_url")}", 301)`,
        "# verify: one hop, HTTPS, 200 destination",
      ].join("\n"),
  },
  canonical: {
    kind: "canonical",
    presentation: "code",
    buildPreview: (facts) =>
      [
        "<!-- preview only — emit from the owning page template -->",
        `<!-- measured this run: ${facts.measurement} -->`,
        `<!-- affected page: ${affectedUrl(facts)} -->`,
        `<!-- its canonical currently points at: ${observedValue(facts, "canonical_target")} -->`,
        `<!-- emit on the affected page, pointing at the URL you want indexed -->`,
        `<link rel="canonical" href="${facts.fillIn}" />`,
      ].join("\n"),
  },
  performance: {
    kind: "performance",
    presentation: "investigation",
    buildPreview: (facts) =>
      [
        "performance investigation",
        `  page: ${facts.targetUrl}`,
        `  measured this run: ${facts.measurement}`,
        `  field source (CrUX p75, 28-day window): ${facts.fillIn}`,
        `  lab source (separate Lighthouse run): ${facts.fillIn}`,
        `  owning route or template: ${facts.fillIn}`,
        "  change: only after the bottleneck is evidenced",
      ].join("\n"),
  },
  rendering: {
    kind: "rendering",
    presentation: "investigation",
    buildPreview: (facts) =>
      [
        "rendering investigation",
        `  page: ${facts.targetUrl}`,
        `  measured this run: ${facts.measurement}`,
        "  compare: static HTML response vs rendered DOM",
        "  inspect: blocking scripts, styles, hydration, blocked resources",
        `  owning framework and runtime: ${facts.fillIn}`,
        "  fix preview: written only after that comparison",
      ].join("\n"),
  },
  template: {
    kind: "template",
    presentation: "code",
    buildPreview: (facts) =>
      [
        "template guard (pseudocode)",
        `  page: ${facts.targetUrl}`,
        `  measured this run: ${facts.measurement}`,
        `  owning layout or template: ${facts.fillIn}`,
        "  derive one value from canonical page data",
        "  emit it once in the owning template",
        `  representative routes to test before release: ${facts.fillIn}`,
      ].join("\n"),
  },
  schema: {
    kind: "schema",
    presentation: "code",
    buildPreview: (facts) =>
      [
        `<!-- measured this run: ${facts.measurement} -->`,
        '<script type="application/ld+json">',
        "{",
        '  "@context": "https://schema.org",',
        `  "@type": "${facts.fillIn}",`,
        `  "url": "${facts.targetUrl}",`,
        `  "name": "${facts.productName}",`,
        `  "[required property]": "${facts.fillIn}"`,
        "}",
        "</script>",
      ].join("\n"),
  },
  internalLinkExposure: {
    kind: "internal-link-exposure",
    presentation: "code",
    buildPreview: (facts) =>
      [
        "discovery path repair",
        `  page that needs reaching: ${facts.targetUrl}`,
        `  measured this run: ${facts.measurement}`,
        `  observed inbound links: ${observedValue(facts, "observed_inbound_links")}`,
        `  observed click depth: ${observedValue(facts, "observed_click_depth")}`,
        `  source page or template to link from: ${facts.fillIn}`,
        `  descriptive anchor text: ${facts.fillIn}`,
        "  re-test: recrawl and compare inbound links and depth for this page",
      ].join("\n"),
  },
  linkIntegrity: {
    kind: "link-integrity",
    presentation: "code",
    buildPreview: (facts) =>
      [
        "link integrity fix",
        `  page: ${facts.targetUrl}`,
        `  measured this run: ${facts.measurement}`,
        `  observed broken outbound targets: ${observedValue(facts, "broken_link_targets")}`,
        `  observed failing target status: ${observedValue(facts, "final_status")}`,
        `  first observed source page: ${observedUrl(facts, 0)}`,
        `  per broken target — repoint, restore, or remove: ${facts.fillIn}`,
        `  owning template or content source: ${facts.fillIn}`,
        "  re-test: the corrected link plus one nearby control link",
      ].join("\n"),
  },
} as const satisfies Readonly<Record<string, SolutionShape>>;

function seoShape(checkId: string): SolutionShape {
  if (/^(?:E\d+|9\.)/.test(checkId)) return SEO_SHAPES.searchOpportunity;
  if (/^(?:D[12]|2\.)/.test(checkId)) return SEO_SHAPES.searchPresentation;
  if (/^(?:D3|3\.)/.test(checkId)) return SEO_SHAPES.headingStructure;
  if (/^4\./.test(checkId)) return SEO_SHAPES.contentBrief;
  if (/^(?:D4|5\.)/.test(checkId)) return SEO_SHAPES.mediaAssets;
  if (/^(?:C[1-5]|6\.)/.test(checkId)) return SEO_SHAPES.internalLinkExposure;
  if (/^(?:D5|7\.)/.test(checkId)) return SEO_SHAPES.structuredData;
  return SEO_SHAPES.technicalIssueBrief;
}

function techShape(checkId: string): SolutionShape {
  // Redirects: the site-level chain and the page-level hop both end in a
  // redirect rule, not a template guard.
  if (/^(?:A6|C6|1\.6)$/.test(checkId)) return TECH_SHAPES.redirect;
  // Canonical: a page pointing elsewhere, at either scope.
  if (/^(?:D7|1\.4)$/.test(checkId)) return TECH_SHAPES.canonical;
  if (/^8\.6$/.test(checkId)) return TECH_SHAPES.rendering;
  if (/^(?:B3|8\.)/.test(checkId)) return TECH_SHAPES.performance;
  if (/^(?:D5|7\.)/.test(checkId)) return TECH_SHAPES.schema;
  // Broken links are the only link checks a repoint/restore/remove preview
  // fits. Reachability checks (orphans, depth, missing inbound links) need
  // links added, which is the internal-link exposure shape.
  if (/^(?:C2|6\.3)$/.test(checkId)) return TECH_SHAPES.linkIntegrity;
  if (/^(?:C[1345]|6\.[1245])$/.test(checkId)) {
    return TECH_SHAPES.internalLinkExposure;
  }
  // Indexability covers noindex and HTTPS delivery as well as the status and
  // hreflang checks.
  if (/^(?:A[1-4]|A7|A8|D6|1\.[13578])$/.test(checkId)) {
    return TECH_SHAPES.indexability;
  }
  if (/^(?:A5|B[1245]|1\.2)$/.test(checkId)) return TECH_SHAPES.crawl;
  return TECH_SHAPES.template;
}

export function solutionTemplate(
  agent: AgentKind,
  evaluated: AgentAuditEvaluatedCheck,
  input: AgentSolutionPreviewInput,
): AgentSolutionTemplate {
  const shape =
    agent === "seo"
      ? seoShape(evaluated.check.id)
      : techShape(evaluated.check.id);
  const segment = KIND_MESSAGE_SEGMENT[shape.kind];
  const base = `recommendations.${agent}.kinds.${segment}` as const;

  return {
    agent,
    kind: shape.kind,
    presentation: shape.presentation,
    preview: shape.buildPreview(previewFacts(input, evaluated.check.scope)),
    recommendationKey: `${base}.recommendation`,
    applicableContextKey: `recommendations.${agent}.applicableContext`,
    validationKeys: [
      `${base}.validation1`,
      `${base}.validation2`,
      `${base}.validation3`,
    ],
    impactSurfaceKey: `${base}.impactSurface`,
    risksKey: `${base}.risks`,
    limitsKey: `${base}.limits`,
  };
}
