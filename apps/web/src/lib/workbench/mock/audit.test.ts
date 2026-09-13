import { describe, expect, it } from "vitest";
import { PERSISTED_VERSION, parsePersistedState } from "../store/schema.ts";
import { populatedProjectState } from "../store/test-fixtures.ts";
import type { AuditReport, Finding, Profile } from "../types.ts";
import {
  auditScore,
  countBySeverity,
  diffAudits,
  findingFromTemplate,
  runAudit,
  sitePages,
} from "./audit.ts";
import { FIND_LIB } from "./find-lib.ts";
import { slugify } from "./text.ts";

const AT = "2026-09-13 10:00";
const PROFILE: Profile = {
  url: "https://www.acme.io/",
  brand: "Acme",
  positioning: "rank tracking for small teams",
  features: "Rank Tracker, Site Audit, Backlinks, Keyword Explorer",
  competitors: "Rival, Other",
  market: "US",
};
const ORIGIN = "https://acme.io";
const PERSISTED_FINDING_KEYS = [
  "cat",
  "eng",
  "expect",
  "fix",
  "found",
  "id",
  "page",
  "sev",
  "t",
  "w",
];
const SWEEP = Array.from({ length: 200 }, (_, index) => `sweep-${index}`);

/* Salts pinned by running the generator against PROFILE (domain acme.io). */
/** 15 eligible candidates before the 12-finding cap. */
const CAP_SALT = "s10";
/** crawl.lcp 2.7 and the slow-LCP template is drawn. */
const SLOW_LCP_SALT = "s0";
/** crawl.lcp exactly 2.5 and the slow-LCP template is drawn: pins `>=`, not `>`. */
const BOUNDARY_LCP_SALT = "lcp-fast";
/** crawl.lcp 2.3 although the slow-LCP template's draw passes: only the gate keeps it out. */
const FAST_LCP_SALT = "s26";
/** The demo history salts (R11): 3 fixed and 4 added between them. */
const DIFF_SALTS = ["demo-prev2", "demo-prev"] as const;

/** The plan's formula written out independently of audit.ts. */
function expectedScore(findings: readonly Finding[]): number {
  const penalty = findings.reduce((sum, finding) => sum + finding.w * 2.1, 0);
  return Math.max(18, Math.round(100 - penalty));
}

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "FIX-01",
    cat: "c",
    t: "t",
    sev: "mid",
    eng: "seo",
    found: "f",
    expect: "e",
    fix: "x",
    w: 2,
    page: `${ORIGIN}/`,
    ...overrides,
  };
}

function reportWith(findings: readonly Finding[], score: number): AuditReport {
  const base = runAudit(PROFILE, { at: AT, salt: "base" });
  return { ...base, findings, score };
}

const slowTemplate = FIND_LIB.find(
  (template) => template.needsSlowLcp === true,
);

describe("findingFromTemplate", () => {
  it("builds exactly the persisted Finding keys for every template", () => {
    FIND_LIB.forEach((template, index) => {
      const finding = findingFromTemplate(template, index, "/", "3.1");
      expect(Object.keys(finding).sort()).toEqual(PERSISTED_FINDING_KEYS);
    });
  });

  it("numbers from FIX-01, keeps the page and fills {lcp}", () => {
    const first = FIND_LIB[0];
    if (first === undefined || slowTemplate === undefined)
      throw new Error("FIND_LIB is empty");
    expect(findingFromTemplate(first, 0, "/p", "3.1")).toMatchObject({
      id: "FIX-01",
      page: "/p",
      t: first.t,
    });
    expect(findingFromTemplate(first, 11, "/p", "3.1").id).toBe("FIX-12");
    expect(findingFromTemplate(slowTemplate, 4, "/", "3.1").found).toBe(
      "LCP 3.1s（移动端）",
    );
  });
});

describe("sitePages", () => {
  it("lists core pages, up to three tool pages, a guide and the comparison page", () => {
    expect(sitePages(PROFILE)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/pricing`,
      `${ORIGIN}/about`,
      `${ORIGIN}/blog`,
      `${ORIGIN}/docs`,
      `${ORIGIN}/tools/rank-tracker`,
      `${ORIGIN}/tools/site-audit`,
      `${ORIGIN}/tools/backlinks`,
      `${ORIGIN}/blog/rank-tracker-guide`,
      `${ORIGIN}/compare/${slugify("Acme-vs-Rival")}`,
    ]);
  });

  it("omits /compare/ when brand or competitors are empty", () => {
    for (const patch of [
      { brand: "" },
      { brand: "  " },
      { competitors: "" },
      { competitors: " , " },
    ]) {
      const pages = sitePages({ ...PROFILE, ...patch });
      expect(pages.some((page) => page.includes("/compare/"))).toBe(false);
      expect(pages.some((page) => page.includes("undefined"))).toBe(false);
    }
  });

  it("falls back to example.com and a generic guide", () => {
    const pages = sitePages({
      url: "",
      brand: "",
      features: "",
      competitors: "",
    });
    expect(pages).toEqual([
      "https://example.com/",
      "https://example.com/pricing",
      "https://example.com/about",
      "https://example.com/blog",
      "https://example.com/docs",
      "https://example.com/blog/guide-guide",
    ]);
  });

  it("does not list the same page twice", () => {
    const pages = sitePages({ ...PROFILE, features: "Site Audit, site audit" });
    expect(new Set(pages).size).toBe(pages.length);
  });
});

describe("runAudit", () => {
  it("is deterministic for the same profile and salt, and writes at as given", () => {
    const first = runAudit(PROFILE, { at: AT, salt: "alpha" });
    expect(runAudit(PROFILE, { at: AT, salt: "alpha" })).toEqual(first);
    expect(first.at).toBe(AT);
    expect(
      runAudit(PROFILE, { at: "2020-01-02 03:04", salt: "alpha" }).at,
    ).toBe("2020-01-02 03:04");
  });

  it("differs across three pinned salts", () => {
    const reports = ["alpha", "beta", "gamma"].map((salt) =>
      runAudit(PROFILE, { at: AT, salt }),
    );
    const keys = reports.map((report) =>
      JSON.stringify([report.score, report.findings]),
    );
    expect(new Set(keys).size).toBe(3);
  });

  it("holds its invariants across a salt sweep", () => {
    const pages = sitePages(PROFILE);
    for (const salt of SWEEP) {
      const report = runAudit(PROFILE, { at: AT, salt });
      expect(report.findings.length).toBeLessThanOrEqual(12);
      report.findings.forEach((finding, index) => {
        expect(finding.id).toBe(`FIX-${String(index + 1).padStart(2, "0")}`);
        expect(pages).toContain(finding.page);
        expect(Object.keys(finding).sort()).toEqual(PERSISTED_FINDING_KEYS);
      });
      expect(report.score).toBe(expectedScore(report.findings));
      expect(report.crawl.lcp).toMatch(/^\d+\.\d$/);
      expect(report.crawl.indexable).toBe(
        report.crawl.pages - report.crawl.blocked,
      );
    }
  });

  it("only includes the slow-LCP finding when crawl.lcp >= 2.5, with the value filled in", () => {
    const outcomes = SWEEP.map((salt) => {
      const report = runAudit(PROFILE, { at: AT, salt });
      const slow = report.findings.find(
        (finding) => finding.t === slowTemplate?.t,
      );
      if (slow !== undefined) {
        expect(Number(report.crawl.lcp)).toBeGreaterThanOrEqual(2.5);
        expect(slow.found).toContain(report.crawl.lcp);
        expect(slow.found).not.toContain("{lcp}");
      }
      return {
        slow: Number(report.crawl.lcp) >= 2.5,
        present: slow !== undefined,
      };
    });
    // Both branches must actually occur, or the loop above proves nothing.
    expect(outcomes.some((outcome) => outcome.present)).toBe(true);
    expect(outcomes.some((outcome) => !outcome.slow)).toBe(true);
  });

  it("includes the slow-LCP finding for pinned slow runs, including lcp exactly 2.5", () => {
    const slowFound = (salt: string): string | undefined =>
      runAudit(PROFILE, { at: AT, salt }).findings.find(
        (finding) => finding.t === slowTemplate?.t,
      )?.found;
    expect(runAudit(PROFILE, { at: AT, salt: SLOW_LCP_SALT }).crawl.lcp).toBe(
      "2.7",
    );
    expect(slowFound(SLOW_LCP_SALT)).toBe("LCP 2.7s（移动端）");
    expect(
      runAudit(PROFILE, { at: AT, salt: BOUNDARY_LCP_SALT }).crawl.lcp,
    ).toBe("2.5");
    expect(slowFound(BOUNDARY_LCP_SALT)).toBe("LCP 2.5s（移动端）");
  });

  it("leaves the slow-LCP finding out of a pinned fast run whose draw passed", () => {
    const report = runAudit(PROFILE, { at: AT, salt: FAST_LCP_SALT });
    expect(Number(report.crawl.lcp)).toBeLessThan(2.5);
    expect(
      report.findings.some((finding) => finding.t === slowTemplate?.t),
    ).toBe(false);
  });

  it("caps findings at 12 when more candidates are drawn", () => {
    expect(runAudit(PROFILE, { at: AT, salt: CAP_SALT }).findings).toHaveLength(
      12,
    );
  });

  it("aligns page rows with findings", () => {
    for (const salt of ["alpha", "beta", CAP_SALT]) {
      const report = runAudit(PROFILE, { at: AT, salt });
      expect(report.pageRows.map((row) => row.url)).toEqual(sitePages(PROFILE));
      expect(report.pageRows[0]?.status).toBe(200);
      for (const row of report.pageRows) {
        expect(row.issues).toBe(
          report.findings.filter((finding) => finding.page === row.url).length,
        );
        expect(typeof row.hasSchema).toBe("boolean");
      }
      const total = report.pageRows.reduce((sum, row) => sum + row.issues, 0);
      expect(total).toBe(report.findings.length);
    }
  });

  it("round-trips through the persisted-state schema", () => {
    for (const salt of ["alpha", CAP_SALT, SLOW_LCP_SALT]) {
      const report = runAudit(PROFILE, { at: AT, salt });
      const state = {
        ...populatedProjectState({
          url: PROFILE.url,
          brand: PROFILE.brand,
          market: PROFILE.market,
        }),
        audit: report,
        auditHistory: [report],
        lastAudit: report,
      };
      expect(
        parsePersistedState({ v: PERSISTED_VERSION, state }),
      ).not.toBeNull();
    }
  });
});

describe("auditScore", () => {
  it("is 100 minus 2.1 per weight point, rounded, when the floor does not engage", () => {
    expect(auditScore([])).toBe(100);
    expect(auditScore([makeFinding({ w: 1 })])).toBe(98);
    expect(auditScore([makeFinding({ w: 3 }), makeFinding({ w: 3 })])).toBe(87);
  });

  it("floors at 18", () => {
    const heavy = Array.from({ length: 20 }, () => makeFinding({ w: 3 }));
    expect(auditScore(heavy)).toBe(18);
  });
});

describe("countBySeverity", () => {
  it("always has all three keys", () => {
    expect(countBySeverity([])).toEqual({ high: 0, mid: 0, low: 0 });
    const findings = [
      makeFinding({ sev: "high" }),
      makeFinding({ sev: "high" }),
      makeFinding({ sev: "low" }),
    ];
    expect(countBySeverity(findings)).toEqual({ high: 2, mid: 0, low: 1 });
  });
});

describe("diffAudits", () => {
  it("is null without a previous report", () => {
    expect(
      diffAudits(runAudit(PROFILE, { at: AT, salt: "alpha" }), null),
    ).toBeNull();
  });

  it("keys on t across two cycles, with fixed and added both non-empty", () => {
    const a = makeFinding({ t: "A" });
    const b = makeFinding({ t: "B", page: `${ORIGIN}/pricing` });
    const c = makeFinding({ t: "C" });
    const d = makeFinding({ t: "D" });
    const first = reportWith([a, b], 70);
    const second = reportWith(
      [makeFinding({ t: "B", page: `${ORIGIN}/about` }), c],
      75,
    );
    const third = reportWith([c, d], 72);
    expect(diffAudits(second, first)).toEqual({
      score: 5,
      fixed: [a],
      added: [c],
    });
    expect(diffAudits(third, second)).toEqual({
      score: -3,
      fixed: [second.findings[0]],
      added: [d],
    });
    expect(diffAudits(third, third)).toEqual({
      score: 0,
      fixed: [],
      added: [],
    });
  });

  it("splits two generated runs into fixed, added and common", () => {
    const previous = runAudit(PROFILE, { at: AT, salt: DIFF_SALTS[0] });
    const current = runAudit(PROFILE, { at: AT, salt: DIFF_SALTS[1] });
    const delta = diffAudits(current, previous);
    const titlesOf = (findings: readonly Finding[]): readonly string[] =>
      findings.map((finding) => finding.t);
    const common = titlesOf(current.findings).filter((t) =>
      titlesOf(previous.findings).includes(t),
    );
    expect(delta?.fixed.length).toBeGreaterThan(0);
    expect(delta?.added.length).toBeGreaterThan(0);
    expect(delta?.score).toBe(current.score - previous.score);
    expect(
      titlesOf(delta?.fixed ?? []).every(
        (t) => !titlesOf(current.findings).includes(t),
      ),
    ).toBe(true);
    expect(
      titlesOf(delta?.added ?? []).every(
        (t) => !titlesOf(previous.findings).includes(t),
      ),
    ).toBe(true);
    expect((delta?.fixed.length ?? 0) + common.length).toBe(
      previous.findings.length,
    );
    expect((delta?.added.length ?? 0) + common.length).toBe(
      current.findings.length,
    );
  });
});
