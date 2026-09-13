/**
 * Technical audit mock (jsx:449-498). Pure: the stamp and salt are parameters
 * (R3), and the score is always derived from the returned findings, never
 * overwritten afterwards (R11).
 */
import type { AuditCrawl, AuditPageRow, AuditReport, Finding, Profile, Severity } from "../types.ts";
import { FIND_LIB, type FindingTemplate } from "./find-lib.ts";
import { pick, rngOf, seedKey } from "./rng.ts";
import { domainOf, slugify, splitList } from "./text.ts";

export interface AuditDelta {
  readonly score: number;
  readonly fixed: readonly Finding[];
  readonly added: readonly Finding[];
}

const FINDING_LIMIT = 12;
const DRAW_THRESHOLD = 0.4;
const SLOW_LCP_SECONDS = 2.5;
const LCP_TOKEN = "{lcp}";
const SCORE_FLOOR = 18;
const PENALTY_PER_WEIGHT = 2.1;
const TOOL_PAGE_LIMIT = 3;
const FALLBACK_DOMAIN = "example.com";
const FALLBACK_SEED_DOMAIN = "demo";

/** Builds a persisted Finding field by field: never spreads the template, so needsSlowLcp cannot leak. */
export function findingFromTemplate(template: FindingTemplate, index: number, page: string, lcp: string): Finding {
  return {
    id: `FIX-${String(index + 1).padStart(2, "0")}`,
    cat: template.cat,
    t: template.t,
    sev: template.sev,
    eng: template.eng,
    found: template.found.replaceAll(LCP_TOKEN, lcp),
    expect: template.expect,
    fix: template.fix,
    w: template.w,
    page,
  };
}

/** Pages the mock crawl "found". No /compare/ page without both a brand and a competitor. */
export function sitePages(profile: Pick<Profile, "url" | "brand" | "features" | "competitors">): readonly string[] {
  const origin = `https://${domainOf(profile.url) || FALLBACK_DOMAIN}`;
  const features = splitList(profile.features);
  const brand = profile.brand.trim();
  const rival = splitList(profile.competitors)[0];
  const paths = [
    "/", "/pricing", "/about", "/blog", "/docs",
    ...features.slice(0, TOOL_PAGE_LIMIT).map((feature) => `/tools/${slugify(feature)}`),
    `/blog/${slugify(`${features[0] ?? "guide"}-guide`)}`,
    ...(brand !== "" && rival !== undefined ? [`/compare/${slugify(`${brand}-vs-${rival}`)}`] : []),
  ];
  return [...new Set(paths)].map((path) => `${origin}${path}`);
}

/** `max(18, round(100 - Σ w × 2.1))`. With at most 12 library findings the floor is unreachable (Σ w ≤ 29). */
export function auditScore(findings: readonly Finding[]): number {
  const penalty = findings.reduce((sum, finding) => sum + finding.w * PENALTY_PER_WEIGHT, 0);
  return Math.max(SCORE_FLOOR, Math.round(100 - penalty));
}

function mockCrawl(next: () => number): AuditCrawl {
  const pages = 40 + Math.floor(next() * 60);
  const blocked = 2 + Math.floor(next() * 5);
  const orphan = 1 + Math.floor(next() * 4);
  const lcp = (2.1 + next() * 2.2).toFixed(1);
  const schema = Math.floor(30 + next() * 50);
  const llmReadable = Math.floor(45 + next() * 40);
  return { pages, indexable: pages - blocked, blocked, orphan, lcp, schema, llmReadable };
}

/** One draw per library entry, in order, whether or not the entry is eligible, so the gate does not shift later draws. */
function drawTemplates(lcp: string, next: () => number): readonly FindingTemplate[] {
  const draws = FIND_LIB.map(() => next());
  const slow = Number(lcp) >= SLOW_LCP_SECONDS;
  return FIND_LIB.filter((template, index) => (draws[index] ?? 0) > DRAW_THRESHOLD && (slow || template.needsSlowLcp !== true))
    .slice(0, FINDING_LIMIT);
}

function pageRowsOf(pages: readonly string[], findings: readonly Finding[]): readonly AuditPageRow[] {
  return pages.map((url, index) => {
    const next = rngOf(seedKey("audit-page", url));
    const redirected = next() > 0.94;
    return {
      url,
      status: index === 0 || !redirected ? 200 : 301,
      h1: next() > 0.8 ? 2 : 1,
      hasSchema: next() > 0.45,
      lcp: (1.6 + next() * 2.6).toFixed(1),
      issues: findings.filter((finding) => finding.page === url).length,
    };
  });
}

export function runAudit(profile: Profile, options: { readonly at: string; readonly salt: string }): AuditReport {
  const pages = sitePages(profile);
  const next = rngOf(seedKey(domainOf(profile.url) || FALLBACK_SEED_DOMAIN, options.salt));
  const crawl = mockCrawl(next);
  const findings = drawTemplates(crawl.lcp, next).map((template, index) =>
    findingFromTemplate(template, index, pick(pages, next), crawl.lcp),
  );
  return { at: options.at, score: auditScore(findings), findings, crawl, pageRows: pageRowsOf(pages, findings) };
}

export function countBySeverity(findings: readonly Finding[]): Readonly<Record<Severity, number>> {
  const count = (severity: Severity): number => findings.filter((finding) => finding.sev === severity).length;
  return { high: count("high"), mid: count("mid"), low: count("low") };
}

/** Findings are matched by title `t`: a check that moved to another page is neither fixed nor added. */
export function diffAudits(current: AuditReport, previous: AuditReport | null): AuditDelta | null {
  if (previous === null) return null;
  const currentTitles = new Set(current.findings.map((finding) => finding.t));
  const previousTitles = new Set(previous.findings.map((finding) => finding.t));
  return {
    score: current.score - previous.score,
    fixed: previous.findings.filter((finding) => !currentTitles.has(finding.t)),
    added: current.findings.filter((finding) => !previousTitles.has(finding.t)),
  };
}
