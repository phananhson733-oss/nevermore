/**
 * Test-only fixtures. `populatedProjectState` fills every nullable and gives
 * every array an element, which is the only way the nested `strictObject`s in
 * `schema.ts` are exercised: the initial state leaves them all null or empty.
 * Shared by `schema.test.ts` and `persistence.test.ts`.
 */
import type {
  AnswerPlan, Artifact, AuditReport, CompData, CrawlSignals, GscRow,
  KnowledgeBase, LinkTarget, ProfileDoc, SavedKeyword, VisResult, VisSnapshot,
  WorkbenchProjectState,
} from "../types.ts";
import type { ProjectSeed } from "./reducer.ts";

const gscRow: GscRow = { query: "example brand", clicks: 12, impressions: 340, ctr: 0.035, position: 8.4 };

const crawl: CrawlSignals = {
  pages: 42, lang: "en", stack: "Next.js", h1: "Example", hasPricing: true,
  hasDocs: true, hasBlog: true, indexed: 40, traffic: 1200, dr: 31, refdomains: 88,
};

const report: AuditReport = {
  at: "2026-09-11 10:00",
  score: 56,
  findings: [{
    id: "f1", cat: "tech", t: "Missing canonical", sev: "high", eng: "seo",
    found: "none", expect: "one", fix: "add one", w: 8, page: "/pricing",
  }],
  crawl: { pages: 42, indexable: 40, blocked: 2, orphan: 1, lcp: "2.4", schema: 12, llmReadable: 61 },
  pageRows: [{ url: "/pricing", status: 200, h1: 1, hasSchema: true, lcp: "2.4", issues: 3 }],
};

const visResult: VisResult = {
  p: "best analytics tool", platform: "ChatGPT", hit: true, rank: 2,
  brands: ["Example"], domains: ["example.test"], real: false,
};

const snapshot: VisSnapshot = { at: "2026-09-11 11:00", results: [visResult] };

const compData: CompData = {
  domains: [{
    domain: "rival.test", traffic: 9000, kws: 1400, dr: 62, refdomains: 310,
    topPages: [{ path: "/compare", share: 0.18 }],
  }],
  gap: {
    comps: ["rival.test"],
    rows: [{
      q: "rival alternative", volume: 480, kd: 21, cpc: "3.20", aio: true,
      ranks: [4, null], ours: 14, page: "comparison",
    }],
  },
  at: "2026-09-11 12:00",
};

const plan: AnswerPlan = {
  url: "/answers/what-is-geo", h1: "What is GEO?", lead: "A short answer.",
  subq: ["How is it measured?"], facts: ["Cited by three engines."],
  dims: ["coverage"], faq: ["Is it the same as SEO?"],
  internal: ["/pricing"], schema: "FAQPage", beat: "weekly",
};

const target: LinkTarget = {
  type: "dir", site: "Example Directory", domain: "dir.test", dr: 55,
  relevance: "high", difficulty: "mid", action: "submit", asset: "listing",
};

const kb: KnowledgeBase = {
  entries: [{ id: "k1", cat: "pricing", statement: "Plans start at $49.", evidence: "/pricing", source: "crawl", from: "crawl" }],
  at: "2026-09-11 13:00",
};

const saved: SavedKeyword = { q: "geo audit", addedAt: "2026-09-11 09:00", source: "matrix", note: "brief written" };

const artifact: Artifact = {
  id: "a1", at: "2026-09-11 14:00", module: "keywordLibrary", type: "csv",
  engine: "both", title: "Keyword library", content: "q\ngeo audit\n", filename: "keywords.csv",
};

const profileDoc: ProfileDoc = {
  crawl,
  gsc: { total: 900, brandQueries: 120, brandClicks: 80, nonBrandClicks: 240, top: [gscRow], near: 14 },
  third: crawl,
  ai: {
    summary: "Example sells analytics.",
    icp: [{ seg: "SMB", role: "Head of Growth", pain: "no attribution", trigger: "new funding", objection: "price" }],
    value_props: ["fast setup"], diff: ["no agent needed"], pillars: ["attribution"],
    facts: ["Founded 2021."], tone: "plain",
  },
  at: "2026-09-11 15:00",
};

/** Every nullable non-null and every array non-empty, so the nested strict shapes are covered. */
export function populatedProjectState(seed: ProjectSeed): WorkbenchProjectState {
  return {
    profile: { url: seed.url, brand: seed.brand, market: seed.market, positioning: "analytics for SMBs", features: "dashboards, alerts", competitors: "rival.test" },
    profileDoc,
    conns: { GSC: true, GA4: true },
    gscRows: [gscRow],
    seeds: "geo audit\nseo audit",
    built: true,
    saved: [saved],
    audit: report,
    auditHistory: [report],
    lastAudit: report,
    visResults: [visResult],
    visPartial: false,
    visHistory: [snapshot],
    lastVis: snapshot,
    compData,
    plans: { "/answers/what-is-geo": plan },
    targets: [target],
    kb,
    artifacts: [artifact],
    notify: { weekly: true, drop: false, mention: true, gsc: false },
    demo: true,
  };
}
