import { describe, expect, it } from "vitest";
import { initialProjectState, reduce } from "../store/reducer.ts";
import { PERSISTED_VERSION, parsePersistedState } from "../store/schema.ts";
import type { DemoPayload, GscRow, Profile, VisResult } from "../types.ts";
import { comparedCompetitors } from "./competitors.ts";
import { DEMO_AI_LEAK_PHRASES } from "./demo-ai-leak-phrases.ts";
import { DEMO_SEEDS, makeDemoSite, type DemoLevel } from "./demo.ts";
import { PROFILES, SAMPLE_FILL_EVIDENCE, provenanceLine, required, testDeps } from "./demo-test-fixtures.ts";
import { SERP_POOL } from "./keywords.ts";
import { DEFAULT_LINK_TYPES } from "./links.ts";
import { SAMPLE_CSV_MARKER } from "./provenance.ts";
import { competitorNames, domainOf, normQ, splitList } from "./text.ts";

/** Invariants the sample site must hold for any profile (plan Task 13 checks 1-12, plus review checks). */

const LEAK = /GenGrowth|gengrowth|\$29|Ahrefs|Semrush|独立开发者|一人公司|solo founder|核对日期：|2026-09-01 核对/;
const OVERCLAIMS = ["实测", "已修复", "已核实"] as const;
const LEVELS: readonly DemoLevel[] = ["full", "basic"];
/** `demoAiDoc`'s neutral stand-in when no real competitor was entered: not a name. */
const NEUTRAL_RIVAL = "同类产品";
const NAMED_RIVAL = /与 (.+?) 相比/gu;

function pathOf(url: string): string {
  return new URL(url).pathname.replace(/\/+$/, "") || "/";
}

/** Rounded position of the first `normQ`-matching GSC row that has a usable one, else null. */
function gscRank(gscRows: readonly GscRow[], query: string): number | null {
  const key = normQ(query);
  const usable = gscRows.flatMap((row) =>
    normQ(row.query) === key && row.position !== null && Number.isFinite(row.position) && row.position > 0 ? [row.position] : [],
  );
  const [first] = usable;
  return first === undefined ? null : Math.round(first);
}

function allVisResults(payload: DemoPayload): readonly VisResult[] {
  return [...payload.visResults, ...payload.visHistory.flatMap((snapshot) => snapshot.results)];
}

for (const [name, profile] of PROFILES) {
  describe(`demo honesty: ${name}`, () => {
    let cached: DemoPayload | undefined;
    const payload = (): DemoPayload => {
      cached ??= makeDemoSite(profile, "full", DEMO_SEEDS, testDeps());
      return cached;
    };

    it("1. survives the persisted-state round trip without being clamped, at both levels", () => {
      const seed = { url: profile.url, brand: profile.brand, market: profile.market };
      for (const level of LEVELS) {
        const demo = makeDemoSite(profile, level, DEMO_SEEDS, testDeps());
        const state = reduce(initialProjectState(seed), { type: "loadDemo", payload: demo });
        expect(parsePersistedState(JSON.parse(JSON.stringify({ v: PERSISTED_VERSION, state }))), level).not.toBeNull();
        expect(state.artifacts.map((artifact) => [artifact.title, artifact.content, artifact.filename]), level).toEqual(
          demo.artifacts.map((artifact) => [artifact.title, artifact.content, artifact.filename]),
        );
      }
    });

    it("2a. matches none of the known GenGrowth leak patterns", () => {
      expect(normQ(`${profile.brand} ${profile.url}`)).not.toContain("gengrowth");
      expect(JSON.stringify(payload())).not.toMatch(LEAK);
    });

    it("2b. contains no phrase of the prototype's DEMO_AI", () => {
      const text = JSON.stringify(payload());
      expect(DEMO_AI_LEAK_PHRASES.filter((phrase) => text.includes(phrase))).toEqual([]);
    });

    it("3. KB entries say where they came from; sample fills are AI drafts", () => {
      const entries = required(payload().kb, "kb").entries;
      expect(entries.filter((entry) => entry.from === "crawl")).toEqual([]);
      const rawValues = [profile.positioning, ...splitList(profile.features)].filter((value) => value.trim() !== "");
      const manual = entries.filter((entry) => entry.from === "manual");
      expect(manual.length > 0).toBe(rawValues.length > 0);
      for (const entry of manual) {
        expect(rawValues.some((value) => entry.statement.includes(value)), entry.statement).toBe(true);
      }
      const fills = entries.filter((entry) => entry.evidence === SAMPLE_FILL_EVIDENCE);
      expect(fills.length).toBeGreaterThanOrEqual(2);
      expect(fills.filter((entry) => entry.from !== "aiDraft")).toEqual([]);
    });

    it("4. no artifact claims an observation, a fix or a verification", () => {
      for (const artifact of payload().artifacts) {
        expect(OVERCLAIMS.filter((word) => artifact.content.includes(word)), artifact.id).toEqual([]);
      }
    });

    it("5. every artifact carries its provenance first", () => {
      const { artifacts } = payload();
      expect(artifacts.map((artifact) => artifact.type).sort()).toEqual(["csv", "csv", "md", "prompt", "prompt"]);
      for (const artifact of artifacts) {
        const lines = artifact.content.split("\n");
        const expected = artifact.type === "csv" ? [SAMPLE_CSV_MARKER, `# ${provenanceLine(artifact.at)}`] : [provenanceLine(artifact.at)];
        expect(lines.slice(0, expected.length), artifact.id).toEqual(expected);
      }
    });

    it("6. visibility answers agree with their own hit and rank", () => {
      const results = allVisResults(payload());
      expect(results.some((result) => result.hit)).toBe(true);
      expect(results.some((result) => !result.hit)).toBe(true);
      for (const result of results) {
        expect(result.hit, result.p).toBe(result.brands.includes(profile.brand));
        if (result.rank === null) expect(result.hit).toBe(false);
        else expect(result.brands[result.rank - 1]).toBe(profile.brand);
      }
    });

    it("7. with GSC connected, our gap rank is GSC's or null", () => {
      const { gscRows } = payload();
      const { rows } = required(payload().compData, "compData").gap;
      expect(gscRows.length).toBeGreaterThan(0);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.ours, row.q).toBe(gscRank(gscRows, row.q));
    });

    it("8. competitors are the names entered, SERP domains the generic pool", () => {
      const compData = required(payload().compData, "compData");
      const own = domainOf(profile.url);
      expect(compData.domains[0]?.domain).toBe(own);
      const others = compData.domains.filter((stats) => stats.domain !== own).map((stats) => stats.domain);
      expect(others).toEqual([...comparedCompetitors(profile)]);
      expect(compData.gap.comps).toEqual(others);
      const names = competitorNames(profile);
      for (const domain of others) expect(names).toContain(domain);
      for (const result of allVisResults(payload())) {
        for (const domain of result.domains) expect(SERP_POOL).toContain(domain);
      }
    });

    it("9. llms.txt lists no invented key pages", () => {
      const llms = required(payload().artifacts.find((artifact) => artifact.id === "demo-kb"), "llms.txt artifact");
      for (const path of ["/compare/", "/tools/", "/docs"]) expect(llms.content).not.toContain(path);
    });

    it("10. GA4 is not connected", () => {
      expect(payload().conns).toStrictEqual({ GSC: true, GA4: false });
    });

    it("11. the profile crawl agrees with the sample audit's reachable pages", () => {
      const crawl = required(required(payload().profileDoc, "profileDoc").crawl, "profileDoc.crawl");
      const audit = required(payload().audit, "audit");
      const paths = audit.pageRows.filter((row) => row.status >= 200 && row.status < 300).map((row) => pathOf(row.url));
      expect(crawl.pages).toBe(audit.crawl.pages);
      expect(crawl.indexed).toBe(audit.crawl.indexable);
      expect(crawl.hasPricing).toBe(paths.includes("/pricing"));
      expect(crawl.hasDocs).toBe(paths.includes("/docs"));
      expect(crawl.hasBlog).toBe(paths.some((path) => path === "/blog" || path.startsWith("/blog/")));
    });

    it("12. a link channel without a domain has no DR and no difficulty", () => {
      const targets = required(payload().targets, "targets");
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets.filter((entry) => entry.domain === "")) {
        expect(target.dr, target.site).toBeNull();
        expect(target.difficulty, target.site).toBeNull();
      }
      // Vacuous for dir / agg / comm, which all have domains: changing the defaults must bring someone here.
      expect(DEFAULT_LINK_TYPES).toEqual(["dir", "agg", "comm"]);
    });

    it("13. the AI differentiator and KB comparisons name only compared competitors", () => {
      const doc = required(payload().profileDoc, "profileDoc");
      const texts = [...doc.ai.diff, ...required(payload().kb, "kb").entries.map((entry) => entry.statement)];
      const named = texts.flatMap((text) => [...text.matchAll(NAMED_RIVAL)].map((match) => match[1] ?? ""));
      expect(named.length).toBeGreaterThan(0);
      const compared = comparedCompetitors(profile);
      for (const rival of named.filter((value) => value !== NEUTRAL_RIVAL)) expect(compared, rival).toContain(rival);
      expect(named.map(normQ)).not.toContain(normQ(profile.brand));
    });
  });
}

describe("demo honesty fixtures", () => {
  it("cover a profile with nothing but a brand and one with every field", () => {
    const filled = (profile: Profile): readonly string[] =>
      (["positioning", "features", "competitors"] as const).filter((key) => profile[key].trim() !== "");
    expect(PROFILES.map(([, profile]) => filled(profile))).toEqual([[], ["positioning", "features", "competitors"]]);
  });
});
