/**
 * Technical audit mock (jsx:449-498). Pure: the stamp and salt are parameters
 * (R3), and the score is always derived from the returned findings, never
 * overwritten afterwards (R11). A sample report must not contradict itself:
 * findings land only on 200 rows inside their template's scope, and the page
 * rows' H1, schema and home LCP columns agree with the findings placed on them.
 */
import type { AuditCrawl, AuditPageRow, AuditReport, Finding, Profile, Severity } from "../types.ts";
import { FIND_LIB, type AuditScope, type FindingTemplate } from "./find-lib.ts";
import { pick, rngOf, seedKey } from "./rng.ts";
import { domainOf, slugify, splitList } from "./text.ts";

export interface AuditDelta {
  readonly score: number;
  readonly fixed: readonly Finding[];
  readonly added: readonly Finding[];
}

type SiteProfile = Pick<Profile, "url" | "brand" | "features" | "competitors">;

/** A page row before findings are placed: everything here is seeded by the URL alone. */
interface RowDraft {
  readonly url: string;
  readonly path: string;
  readonly status: number;
  readonly h1Draw: number;
  readonly hasSchema: boolean;
  readonly lcp: string;
}

const FINDING_LIMIT = 12;
const DRAW_THRESHOLD = 0.4;
const SLOW_LCP_SECONDS = 2.5;
const LCP_TOKEN = "{lcp}";
const SCORE_FLOOR = 18;
const PENALTY_PER_WEIGHT = 2.1;
const TOOL_PAGE_LIMIT = 3;
const REDIRECT_DRAW = 0.94;
const EXTRA_H1_DRAW = 0.8;
const SCHEMA_DRAW = 0.45;
const FALLBACK_DOMAIN = "example.com";
const FALLBACK_SEED_DOMAIN = "demo";

const SCOPE_MATCHES: Readonly<Record<AuditScope, (path: string) => boolean>> = {
  site: (path) => path === "/",
  blog: (path) => path === "/blog" || path.startsWith("/blog/"),
  tools: (path) => path.startsWith("/tools/"),
  sales: (path) => path === "/pricing" || path.startsWith("/compare/"),
  any: () => true,
};

/** Builds a persisted Finding field by field: never spreads the template, so template-only fields cannot leak. */
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

function siteLayout(profile: SiteProfile): { readonly origin: string; readonly paths: readonly string[] } {
  const features = splitList(profile.features);
  const toolSlugs = [...new Set(features.map((feature) => slugify(feature)))].slice(0, TOOL_PAGE_LIMIT);
  const brand = profile.brand.trim();
  const rival = splitList(profile.competitors)[0];
  const paths = [
    "/", "/pricing", "/about", "/blog", "/docs",
    ...toolSlugs.map((slug) => `/tools/${slug}`),
    `/blog/${slugify(`${features[0] ?? "guide"}-guide`)}`,
    ...(brand !== "" && rival !== undefined ? [`/compare/${slugify(`${brand}-vs-${rival}`)}`] : []),
  ];
  return { origin: `https://${domainOf(profile.url) || FALLBACK_DOMAIN}`, paths: [...new Set(paths)] };
}

/** Pages the mock crawl "found". No /compare/ page without both a brand and a competitor. */
export function sitePages(profile: SiteProfile): readonly string[] {
  const { origin, paths } = siteLayout(profile);
  return paths.map((path) => `${origin}${path}`);
}

/** `max(18, round(100 - Σ w × 2.1))`. runAudit never reaches the floor (find-lib.test.ts pins the worst case). */
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

/** Row draws in order: redirect, h1, schema, lcp. The home row is always 200. */
function draftRows(profile: SiteProfile): readonly RowDraft[] {
  const { origin, paths } = siteLayout(profile);
  return paths.map((path, index) => {
    const url = `${origin}${path}`;
    const next = rngOf(seedKey("audit-page", url));
    const redirected = next() > REDIRECT_DRAW;
    const h1Draw = next();
    const hasSchema = next() > SCHEMA_DRAW;
    const lcp = (1.6 + next() * 2.6).toFixed(1);
    return { url, path, status: index === 0 || !redirected ? 200 : 301, h1Draw, hasSchema, lcp };
  });
}

/**
 * One draw per library entry, in order, always consumed, so gates do not shift
 * later draws. A template is placed when its draw passes, the LCP gate passes
 * and it has a 200 row in scope; its page is then picked from those rows.
 */
function placeFindings(rows: readonly RowDraft[], lcp: string, next: () => number): readonly Finding[] {
  const draws = FIND_LIB.map(() => next());
  const slow = Number(lcp) >= SLOW_LCP_SECONDS;
  return FIND_LIB.map((template, index) => ({
    template,
    passes: (draws[index] ?? 0) > DRAW_THRESHOLD && (slow || template.needsSlowLcp !== true),
    pages: rows.filter((row) => row.status === 200 && SCOPE_MATCHES[template.scope](row.path)).map((row) => row.url),
  }))
    .filter(({ passes, pages }) => passes && pages.length > 0)
    .slice(0, FINDING_LIMIT)
    .map(({ template, pages }, index) => findingFromTemplate(template, index, pick(pages, next), lcp));
}

function pagesFlagged(findings: readonly Finding[], flag: "raisesRowH1" | "needsRowSchema"): ReadonlySet<string> {
  const titles = new Set(FIND_LIB.filter((template) => template[flag] === true).map((template) => template.t));
  return new Set(findings.filter((finding) => titles.has(finding.t)).map((finding) => finding.page));
}

/** h1 = 2 only with the multi-H1 finding (its own row, or rows whose draw passes); home LCP is the crawl's LCP. */
function finalizeRows(rows: readonly RowDraft[], findings: readonly Finding[], crawlLcp: string): readonly AuditPageRow[] {
  const h1Pages = pagesFlagged(findings, "raisesRowH1");
  const schemaPages = pagesFlagged(findings, "needsRowSchema");
  return rows.map((row, index) => ({
    url: row.url,
    status: row.status,
    h1: h1Pages.has(row.url) || (h1Pages.size > 0 && row.h1Draw > EXTRA_H1_DRAW) ? 2 : 1,
    hasSchema: row.hasSchema || schemaPages.has(row.url),
    lcp: index === 0 ? crawlLcp : row.lcp,
    issues: findings.filter((finding) => finding.page === row.url).length,
  }));
}

export function runAudit(profile: Profile, options: { readonly at: string; readonly salt: string }): AuditReport {
  const rows = draftRows(profile);
  const next = rngOf(seedKey(domainOf(profile.url) || FALLBACK_SEED_DOMAIN, options.salt));
  const crawl = mockCrawl(next);
  const findings = placeFindings(rows, crawl.lcp, next);
  return { at: options.at, score: auditScore(findings), findings, crawl, pageRows: finalizeRows(rows, findings, crawl.lcp) };
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
