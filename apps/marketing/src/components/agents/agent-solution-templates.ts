// @input  -- Agent identity and a selected evaluated v2 check
// @output -- Agent-specific, preview-only content or code/config solution shape
// @pos    -- pure Stage 04 semantic adapter; never applies, saves, or deploys

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
  | "technical-issue-brief"
  | "indexability"
  | "crawl"
  | "redirect"
  | "canonical"
  | "performance"
  | "rendering"
  | "template"
  | "schema";

type AgentSolutionMessageKey<
  Agent extends AgentKind,
  Name extends string,
> = `recommendations.${Agent}.${Name}`;

export interface AgentSolutionTemplate {
  readonly agent: AgentKind;
  readonly kind: AgentSolutionKind;
  readonly presentation: AgentSolutionPresentation;
  readonly preview: string;
  readonly recommendationKey: AgentSolutionMessageKey<
    AgentKind,
    "recommendation"
  >;
  readonly applicableContextKey: AgentSolutionMessageKey<
    AgentKind,
    "applicableContext"
  >;
  readonly validationKeys: readonly [
    AgentSolutionMessageKey<AgentKind, "validation1">,
    AgentSolutionMessageKey<AgentKind, "validation2">,
    AgentSolutionMessageKey<AgentKind, "validation3">,
  ];
  readonly impactSurfaceKey: AgentSolutionMessageKey<
    AgentKind,
    "impactSurface"
  >;
  readonly risksKey: AgentSolutionMessageKey<AgentKind, "risks">;
  readonly limitsKey: AgentSolutionMessageKey<AgentKind, "limits">;
}

interface SolutionShape {
  readonly kind: AgentSolutionKind;
  readonly presentation: AgentSolutionPresentation;
  readonly preview: string;
}

const SEO_SHAPES = {
  searchOpportunity: {
    kind: "search-opportunity",
    presentation: "investigation",
    preview:
      "search decision\n  target query: [confirmed query]\n  country / locale / device: [confirmed context]\n  required source: [SERP or authorized GSC]\n  decision: [pursue, refine, or defer after evidence]",
  },
  searchPresentation: {
    kind: "search-presentation",
    presentation: "content",
    preview:
      "page role: [confirmed user decision]\n  title: [distinct promise + confirmed topic]\n  meta description: [page-specific outcome]\n  opening: [answer the first decision without invented demand]",
  },
  contentBrief: {
    kind: "content-brief",
    presentation: "content",
    preview:
      "content brief seed\n  audience / JTBD: [confirmed Profile]\n  intent: [interpretation, not ranking fact]\n  evidence to preserve: [observed page facts]\n  sections: [decision-led outline]",
  },
  headingStructure: {
    kind: "heading-structure",
    presentation: "content",
    preview:
      "document outline\n  h1: [one clear page decision]\n  h2: [major decision steps]\n  h3: [subquestions with substantive answers]\n  preset: [confirmed page type]",
  },
  internalLinkExposure: {
    kind: "internal-link-exposure",
    presentation: "content",
    preview:
      "contextual discovery path\n  source page: [observed relevant context]\n  anchor: [descriptive user-facing phrase]\n  target page: [confirmed canonical destination]",
  },
  structuredData: {
    kind: "structured-data",
    presentation: "content",
    preview:
      "visible-content schema brief\n  page role: [confirmed type]\n  entity: [facts visible on page]\n  vocabulary/version: [selected rule set]\n  eligibility: not promised",
  },
  technicalIssueBrief: {
    kind: "technical-issue-brief",
    presentation: "content",
    preview:
      "technical issue brief\n  observed condition: [preserved evidence]\n  affected search decision: [bounded interpretation]\n  owner/context needed: [template, CMS, or platform]\n  next step: review independently in Tech Agent",
  },
} as const satisfies Readonly<Record<string, SolutionShape>>;

const TECH_SHAPES = {
  indexability: {
    kind: "indexability",
    presentation: "code",
    preview:
      "# preview only — choose directives after owner intent is confirmed\nHTTP/1.1 200 OK\nX-Robots-Tag: index, follow\n<meta name=\"robots\" content=\"index,follow\">",
  },
  crawl: {
    kind: "crawl",
    presentation: "code",
    preview:
      "# preview only — public crawl policy\nUser-agent: *\nAllow: /[intended public path]\nSitemap: https://[host]/sitemap.xml",
  },
  redirect: {
    kind: "redirect",
    presentation: "code",
    preview:
      "# preview only — framework syntax depends on the owning system\nredirect(\"[legacy path]\", \"[single HTTPS 200 destination]\", 301)\n# verify: one hop, intended canonical target",
  },
  canonical: {
    kind: "canonical",
    presentation: "code",
    preview:
      "<!-- preview only — emit from the owning page template -->\n<link rel=\"canonical\" href=\"https://[host]/[confirmed-200-path]\" />",
  },
  performance: {
    kind: "performance",
    presentation: "investigation",
    preview:
      "performance investigation\n  field: [CrUX p75 / 28-day window]\n  lab: [Lighthouse run, shown separately]\n  route/template: [confirmed owner]\n  change: only after bottleneck evidence",
  },
  rendering: {
    kind: "rendering",
    presentation: "investigation",
    preview:
      "rendering investigation\n  compare: static response vs rendered DOM\n  inspect: scripts, styles, hydration, blocked resources\n  fix preview: conditional on framework and runtime evidence",
  },
  template: {
    kind: "template",
    presentation: "code",
    preview:
      "template guard (pseudocode)\n  derive one value from canonical page data\n  emit once in the owning layout/template\n  test representative routes before release",
  },
  schema: {
    kind: "schema",
    presentation: "code",
    preview:
      '<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "[page-type match]",\n  "[required field]": "[visible page fact]"\n}\n</script>',
  },
} as const satisfies Readonly<Record<string, SolutionShape>>;

function seoShape(checkId: string): SolutionShape {
  if (/^(?:E\d+|9\.)/.test(checkId)) return SEO_SHAPES.searchOpportunity;
  if (/^(?:D[12]|2\.)/.test(checkId)) return SEO_SHAPES.searchPresentation;
  if (/^(?:D3|3\.)/.test(checkId)) return SEO_SHAPES.headingStructure;
  if (/^4\./.test(checkId)) return SEO_SHAPES.contentBrief;
  if (/^(?:C[1-5]|6\.)/.test(checkId)) return SEO_SHAPES.internalLinkExposure;
  if (/^(?:D5|7\.)/.test(checkId)) return SEO_SHAPES.structuredData;
  return SEO_SHAPES.technicalIssueBrief;
}

function techShape(checkId: string): SolutionShape {
  if (/^(?:A6|1\.6)$/.test(checkId)) return TECH_SHAPES.redirect;
  if (/^1\.4$/.test(checkId)) return TECH_SHAPES.canonical;
  if (/^8\.6$/.test(checkId)) return TECH_SHAPES.rendering;
  if (/^(?:B3|8\.)/.test(checkId)) return TECH_SHAPES.performance;
  if (/^(?:D5|7\.)/.test(checkId)) return TECH_SHAPES.schema;
  if (/^(?:A[134]|1\.[134578])$/.test(checkId)) {
    return TECH_SHAPES.indexability;
  }
  if (/^(?:A5|B[1245]|1\.2)$/.test(checkId)) return TECH_SHAPES.crawl;
  return TECH_SHAPES.template;
}

export function solutionTemplate(
  agent: AgentKind,
  evaluated: AgentAuditEvaluatedCheck,
): AgentSolutionTemplate {
  const shape =
    agent === "seo"
      ? seoShape(evaluated.check.id)
      : techShape(evaluated.check.id);

  return {
    agent,
    ...shape,
    recommendationKey: `recommendations.${agent}.recommendation`,
    applicableContextKey: `recommendations.${agent}.applicableContext`,
    validationKeys: [
      `recommendations.${agent}.validation1`,
      `recommendations.${agent}.validation2`,
      `recommendations.${agent}.validation3`,
    ],
    impactSurfaceKey: `recommendations.${agent}.impactSurface`,
    risksKey: `recommendations.${agent}.risks`,
    limitsKey: `recommendations.${agent}.limits`,
  };
}
