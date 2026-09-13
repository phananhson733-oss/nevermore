/** Test-only fixtures shared by audit.test.ts and audit-consistency.test.ts (not a *.test.ts file). */
import type { Finding, Profile } from "../types.ts";
import { FIND_LIB, type FindingTemplate } from "./find-lib.ts";
import { rngOf, seedKey } from "./rng.ts";

export const AT = "2026-09-13 10:00";

export const PROFILE: Profile = {
  url: "https://www.acme.io/",
  brand: "Acme",
  positioning: "rank tracking for small teams",
  features: "Rank Tracker, Site Audit, Backlinks, Keyword Explorer",
  competitors: "Rival, Other",
  market: "US",
};
export const ORIGIN = "https://acme.io";

/** Row status is seeded by URL only. acme.io has no 301 row; site0.com's /tools/site-audit is 301. */
export const SITE0: Profile = {
  url: "https://site0.com",
  brand: "Site0",
  positioning: "",
  features: "Rank Tracker, Site Audit, Backlinks",
  competitors: "Rival",
  market: "US",
};
export const SITE3: Profile = { ...SITE0, url: "https://site3.com", brand: "Site3" };
/** Home row's redirect draw is above 0.94, so only the home-200 guard keeps it 200. */
export const SITE13: Profile = { ...SITE0, url: "https://site13.com", brand: "Site13" };
export const NO_FEATURES: Profile = { ...PROFILE, url: "https://nofeatures.dev", features: "" };
export const GENGROWTH_LIKE: Profile = {
  url: "https://gengrowth.ai",
  brand: "GenGrowth",
  positioning: "SEO and GEO workbench",
  features: "GEO audit, keyword research, content briefs",
  competitors: "Ahrefs, Semrush",
  market: "US",
};

export const SWEEP_SALTS: readonly string[] = Array.from({ length: 200 }, (_, index) => `sweep-${index}`);
export const SWEEP_PROFILES: readonly Profile[] = [PROFILE, SITE0, SITE3, SITE13, NO_FEATURES, GENGROWTH_LIKE];

/** Crawl numbers consume the first six draws of a run (audit.ts `mockCrawl`). */
const CRAWL_DRAWS = 6;

export function templateFor(title: string): FindingTemplate {
  const template = FIND_LIB.find((candidate) => candidate.t === title);
  if (template === undefined) throw new Error(`no FIND_LIB entry titled ${title}`);
  return template;
}

/** Replays a run's per-template draws (one per FIND_LIB entry, after the crawl draws). */
export function templateDraws(domain: string, salt: string): readonly number[] {
  const next = rngOf(seedKey(domain, salt));
  return Array.from({ length: CRAWL_DRAWS + FIND_LIB.length }, () => next()).slice(CRAWL_DRAWS);
}

/** Replays a page row's URL-seeded draws: [redirect, h1, schema, lcp]. */
export function rowDraws(url: string): readonly number[] {
  const next = rngOf(seedKey("audit-page", url));
  return Array.from({ length: 4 }, () => next());
}

/** The template-owned values of a finding, written out field by field. */
export function templateValues(value: FindingTemplate | Finding): Readonly<Record<string, unknown>> {
  return { cat: value.cat, t: value.t, sev: value.sev, eng: value.eng, expect: value.expect, fix: value.fix, w: value.w };
}
