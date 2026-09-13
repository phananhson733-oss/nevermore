/** A sample report must not contradict itself: findings, page rows and crawl numbers agree. */
import { describe, expect, it } from "vitest";
import type { AuditReport, Profile } from "../types.ts";
import { runAudit, sitePages } from "./audit.ts";
import {
  AT, GENGROWTH_LIKE, NO_FEATURES, PROFILE, SITE0, SITE13, SITE3, SWEEP_PROFILES, SWEEP_SALTS,
  rowDraws, templateFor, templateValues,
} from "./audit-test-fixtures.ts";
import type { AuditScope } from "./find-lib.ts";

const SCOPE_PATHS: Readonly<Record<AuditScope, RegExp>> = {
  site: /^\/$/,
  blog: /^\/blog(\/.+)?$/,
  tools: /^\/tools\/.+$/,
  sales: /^\/(pricing|compare\/.+)$/,
  any: /^\//,
};
const MULTI_H1_TITLE = "多个页面有多个 H1";
const SLOW_LCP_TITLE = "移动端 LCP 偏慢";
const ROW_SCHEMA_TITLES = ["Article schema 缺 dateModified", "FAQ schema 与页面可见内容不符"];

interface Run { readonly profile: Profile; readonly salt: string; readonly report: AuditReport }

const RUNS: readonly Run[] = SWEEP_PROFILES.flatMap((profile) =>
  SWEEP_SALTS.map((salt) => ({ profile, salt, report: runAudit(profile, { at: AT, salt }) })),
);

function pathOf(profile: Profile, url: string): string {
  const home = sitePages(profile)[0] ?? "";
  return url.slice(home.length - 1);
}

function rowOf(report: AuditReport, url: string) {
  const row = report.pageRows.find((candidate) => candidate.url === url);
  if (row === undefined) throw new Error(`no page row for ${url}`);
  return row;
}

describe("audit fixtures", () => {
  it("site0.com really has a 301 row and site13.com's home draw would redirect", () => {
    const site0 = runAudit(SITE0, { at: AT, salt: "k0" });
    expect(rowOf(site0, "https://site0.com/tools/site-audit").status).toBe(301);
    expect(rowDraws("https://site13.com/")[0]).toBeGreaterThan(0.94);
  });
});

describe("finding placement", () => {
  it("puts every finding on a 200 row inside its template's scope", () => {
    const scopesSeen = new Set<AuditScope>();
    for (const { profile, report } of RUNS) {
      for (const finding of report.findings) {
        const scope = templateFor(finding.t).scope;
        scopesSeen.add(scope);
        expect(rowOf(report, finding.page).status).toBe(200);
        expect(pathOf(profile, finding.page)).toMatch(SCOPE_PATHS[scope]);
      }
    }
    expect([...scopesSeen].sort()).toEqual(["any", "blog", "sales", "site", "tools"]);
  });

  it("never places a finding on site0.com's 301 row", () => {
    for (const salt of ["k0", ...SWEEP_SALTS]) {
      const report = runAudit(SITE0, { at: AT, salt });
      expect(report.findings.some((finding) => finding.page === "https://site0.com/tools/site-audit")).toBe(false);
    }
  });

  it("carries each template's values unchanged", () => {
    for (const { report } of RUNS) {
      for (const finding of report.findings) {
        const template = templateFor(finding.t);
        expect(templateValues(finding)).toEqual(templateValues(template));
        expect(finding.found).toBe(template.found.replaceAll("{lcp}", report.crawl.lcp));
      }
    }
  });

  it("never mentions /tools/ for a profile without features", () => {
    const toolsFindingSeen = RUNS.some(({ profile, report }) =>
      profile === PROFILE && report.findings.some((finding) => finding.found.includes("/tools/")),
    );
    expect(toolsFindingSeen).toBe(true);
    for (const { profile, report } of RUNS.filter((run) => run.profile === NO_FEATURES)) {
      expect(sitePages(profile).some((page) => page.includes("/tools/"))).toBe(false);
      expect(JSON.stringify(report)).not.toContain("/tools/");
    }
  });
});

describe("page rows agree with findings", () => {
  it("keeps the home row at 200 even when its redirect draw passes", () => {
    for (const { report } of RUNS) expect(report.pageRows[0]?.status).toBe(200);
    expect(runAudit(SITE13, { at: AT, salt: "alpha" }).pageRows[0]?.status).toBe(200);
  });

  it("shows h1 = 2 only with the multi-H1 finding: on its page, elsewhere by the row draw", () => {
    const outcomes = RUNS.map(({ report }) => {
      const finding = report.findings.find((candidate) => candidate.t === MULTI_H1_TITLE);
      for (const row of report.pageRows) {
        const drawn = (rowDraws(row.url)[1] ?? 0) > 0.8;
        const expected = finding !== undefined && (row.url === finding.page || drawn) ? 2 : 1;
        expect(row.h1).toBe(expected);
      }
      return finding !== undefined;
    });
    expect(outcomes.some(Boolean)).toBe(true);
    expect(outcomes.some((present) => !present)).toBe(true);
  });

  it("pins site3.com at k1", () => {
    const report = runAudit(SITE3, { at: AT, salt: "k1" });
    const finding = report.findings.find((candidate) => candidate.t === MULTI_H1_TITLE);
    expect(finding?.page).toBe("https://site3.com/tools/rank-tracker");
    expect(report.pageRows.filter((row) => row.h1 === 2).map((row) => row.url)).toEqual([
      "https://site3.com/tools/rank-tracker",
      "https://site3.com/compare/site3-vs-rival",
    ]);
  });

  it("shows crawl.lcp on the home row, where the slow-LCP finding lands", () => {
    for (const { report } of RUNS) {
      expect(report.pageRows[0]?.lcp).toBe(report.crawl.lcp);
      const slow = report.findings.find((finding) => finding.t === SLOW_LCP_TITLE);
      if (slow !== undefined) expect(slow.page).toBe(report.pageRows[0]?.url);
    }
    const demo = runAudit(GENGROWTH_LIKE, { at: AT, salt: "demo-prev2" });
    const slow = demo.findings.find((finding) => finding.t === SLOW_LCP_TITLE);
    expect(slow?.page).toBe("https://gengrowth.ai/");
    expect(rowOf(demo, "https://gengrowth.ai/").lcp).toBe(demo.crawl.lcp);
    expect(slow?.found).toBe(`LCP ${demo.crawl.lcp}s（移动端）`);
  });

  it("marks schema on the page of a finding about that page's schema", () => {
    let seen = 0;
    for (const { report } of RUNS) {
      for (const finding of report.findings.filter((candidate) => ROW_SCHEMA_TITLES.includes(candidate.t))) {
        seen += 1;
        expect(rowOf(report, finding.page).hasSchema).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("does not place the slow-LCP finding unless crawl.lcp >= 2.5", () => {
    const outcomes = RUNS.map(({ report }) => {
      const slow = report.findings.some((finding) => finding.t === SLOW_LCP_TITLE);
      if (slow) expect(Number(report.crawl.lcp)).toBeGreaterThanOrEqual(2.5);
      return { slow, fast: Number(report.crawl.lcp) < 2.5 };
    });
    expect(outcomes.some((outcome) => outcome.slow)).toBe(true);
    expect(outcomes.some((outcome) => outcome.fast)).toBe(true);
  });

  it("keeps crawl, ids, cap and score invariants across the sweep", () => {
    for (const { profile, report } of RUNS) {
      expect(report.findings.length).toBeLessThanOrEqual(12);
      report.findings.forEach((finding, index) => {
        expect(finding.id).toBe(`FIX-${String(index + 1).padStart(2, "0")}`);
        expect(sitePages(profile)).toContain(finding.page);
      });
      const penalty = report.findings.reduce((sum, finding) => sum + finding.w * 2.1, 0);
      expect(report.score).toBe(Math.max(18, Math.round(100 - penalty)));
      expect(report.crawl.lcp).toMatch(/^\d+\.\d$/);
      expect(report.crawl.indexable).toBe(report.crawl.pages - report.crawl.blocked);
    }
  });
});
