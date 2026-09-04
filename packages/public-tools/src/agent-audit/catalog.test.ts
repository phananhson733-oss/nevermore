import { describe, expect, it } from "vitest";
import {
  AGENT_AUDIT_COVERAGE,
  AGENT_AUDIT_DEFAULT_GROUPS,
  AGENT_AUDIT_HEADING_PRESETS,
  PAGE_AUDIT_GROUPS,
  SITE_AUDIT_GROUPS,
  UNMEASURABLE_HERE,
} from "./catalog.ts";

const ON_PAGE_CHECKER_CHECK_IDS = [
  "2.3",
  "3.2",
  "2.10",
  "4.2",
  "4.3",
] as const;

describe("v2 Agent audit catalog", () => {
  it("keeps unique catalog IDs while delegating the five deeper keyword checks", () => {
    const site = SITE_AUDIT_GROUPS.flatMap((group) => group.checks);
    const page = PAGE_AUDIT_GROUPS.flatMap((group) => group.checks);
    expect(SITE_AUDIT_GROUPS).toHaveLength(5);
    expect(PAGE_AUDIT_GROUPS).toHaveLength(9);
    expect(new Set(site.map((check) => check.id)).size).toBe(site.length);
    expect(new Set(page.map((check) => check.id)).size).toBe(page.length);
    expect(AGENT_AUDIT_COVERAGE.total).toBe(site.length + page.length);
    expect(
      page
        .filter((check) => ON_PAGE_CHECKER_CHECK_IDS.includes(check.id as never))
        .map((check) => check.id),
    ).toEqual([]);
    expect([...site, ...page].every((check) => check.threshold.en && check.impact.en && check.howToFix.en)).toBe(true);
  });

  it("keeps the v2 weights, inventory, Agent defaults, and heading presets", () => {
    expect(SITE_AUDIT_GROUPS.reduce((sum, group) => sum + (group.weight ?? 0), 0)).toBe(100);
    expect(PAGE_AUDIT_GROUPS.reduce((sum, group) => sum + (group.weight ?? 0), 0)).toBe(100);
    const all = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap((group) => group.checks);
    // Inventory readiness is derived, not listed, so it cannot drift from the
    // detectors again. A hand-kept list is what let 47 checks advertise
    // readiness while only 24 could ever produce a verdict.
    expect(AGENT_AUDIT_COVERAGE.decided).toBe(
      all.filter((check) => check.inventoryReady).length,
    );
    for (const check of all) {
      expect(check.inventoryReady).toBe(check.evidenceRecordIds.length > 0);
    }
    // A check with no detector must say so rather than borrow the state that
    // means "the detector ran and matched nothing".
    for (const check of all) {
      if (check.engine !== "needs-integration") continue;
      expect(check.evidenceRecordIds).toEqual([]);
      // Two different sentences, and the difference matters to a reader
      // planning work: "no detector reads it yet" promises a later release,
      // while "outside what this run can observe" is a boundary they can plan
      // around. Every unwired check must say exactly one of them.
      expect(check.dataSource.en).toMatch(
        /no detector reads it yet|Outside what a bounded anonymous crawl can observe/,
      );
    }
    // Impression shares only exist in Search Console, whatever supplies the URLs.
    for (const id of ["A1", "A2", "A3", "E1", "E2", "E3", "E4", "E5"]) {
      expect(all.find((check) => check.id === id)?.engine).toBe(
        "access-required",
      );
    }
    expect(AGENT_AUDIT_DEFAULT_GROUPS).toEqual({
      seo: { site: "D", page: "2" },
      tech: { site: "C", page: "1" },
    });
    // Every default group must contain at least one check this crawl can decide.
    for (const defaults of Object.values(AGENT_AUDIT_DEFAULT_GROUPS)) {
      const siteGroup = SITE_AUDIT_GROUPS.find((g) => g.id === defaults.site)!;
      const pageGroup = PAGE_AUDIT_GROUPS.find((g) => g.id === defaults.page)!;
      for (const group of [siteGroup, pageGroup]) {
        expect(
          group.checks.some((check) => check.evidenceRecordIds.length > 0),
        ).toBe(true);
      }
    }
    expect(AGENT_AUDIT_HEADING_PRESETS.tool).toMatchObject({
      h2: { min: 5, max: 9 },
      h3: { min: 6, max: 18 },
      substanceWords: 60,
      blocker: false,
    });
  });

  it("never makes a check blocker-capable that does not publish a Blocker", () => {
    // The forward direction is checked below. This is the reverse, and it can
    // happen silently: BLOCKER_EVIDENCE and EVIDENCE are adjacent tables with
    // overlapping keys, so an entry meant for one lands in the other and the
    // check quietly gains a severity its own published sentence never offers.
    // 5.2 — "Below 200 KB; otherwise Tip" — did exactly that.
    const all = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap(
      (group) => group.checks,
    );
    const overclaiming = all
      .filter(
        (check) =>
          check.blockerEvidenceRecordIds.length > 0 &&
          !/blocker/i.test(check.threshold.en),
      )
      .map((check) => check.id);

    expect(overclaiming).toEqual([]);
  });

  it("never calls a working check unobservable", () => {
    // This label overrides every other data-source string, so an id left in
    // the table after its detector lands renders "outside what a bounded
    // anonymous crawl can observe" directly above a result that same crawl
    // produced. 7.3, 7.4 and 4.5 each sat here while shipping.
    const all = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap(
      (group) => group.checks,
    );
    const contradictory = all
      .filter((check) => check.inventoryReady && UNMEASURABLE_HERE[check.id])
      .map((check) => check.id);

    expect(contradictory).toEqual([]);
  });

  it("marks every v2 blocker-capable check and locks the P6 detectors", () => {
    const all = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap(
      (group) => group.checks,
    );
    expect(all.filter((check) => check.blocking).map((check) => check.id)).toEqual([
      "A1",
      "A2",
      "A4",
      "A5",
      "D6",
      "1.1",
      "1.2",
      "1.3",
      "1.4",
      "1.6",
      "1.7",
      "1.8",
    ]);
    // 4.5 cleared the gate. The paginated archive this lock named is the
    // KNOWN FALSE POSITIVE fixture in page-similarity.test.ts, and it is
    // handled by the page's own `rel="next"`/`rel="prev"` rather than by a
    // guess about its URL — the exemption has to be earned by the markup, or
    // any site could opt out by having similar pages. Site chrome is removed
    // before anything is compared, and pages with too little text left are
    // not scored. Both fixtures execute; neither is asserted in prose.
    const similarity = all.find((candidate) => candidate.id === "4.5");
    expect(similarity).toMatchObject({
      inventoryReady: true,
      evidenceRecordIds: ["page_near_duplicate_of_another_page"],
    });

    const duplicateTitles = all.find((candidate) => candidate.id === "D1");
    expect(duplicateTitles).toMatchObject({
      inventoryReady: true,
      evidenceRecordIds: ["title_duplicate"],
    });
  });

  it("never renders a Warning for a check that says it does not judge", () => {
    // 4.2 published "density is not used to judge a page" and resolved to
    // Warning anyway, because the severity came from a hand-kept list that
    // nobody had added it to. It is read off the same sentence now.
    const declines = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS]
      .flatMap((group) => group.checks)
      .filter((check) =>
        /Internal heuristic only|Display only|Listed for review, not judged/.test(
          check.threshold.en,
        ),
      );

    expect(declines.length).toBeGreaterThan(0);
    expect(
      declines.filter((check) => check.failureResult !== "tip").map((c) => c.id),
    ).toEqual([]);
    // And none of them moves the score either.
    expect(declines.filter((check) => check.scored).map((c) => c.id)).toEqual([]);
  });

  it("can actually reach Blocker wherever its threshold promises one", () => {
    // Two separate switches decide this — one says a check may reach Blocker,
    // the other names the record that takes it there — and they disagreed
    // silently. A5 and 1.2 published "above 0 is Blocker", were listed as
    // capable, and had no record mapped, so a site that failed them was told
    // Warning. Nothing tied the sentence to the wiring.
    const broken = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS]
      .flatMap((group) => group.checks)
      .filter(
        (check) =>
          check.inventoryReady &&
          /\bBlocker\b/.test(check.threshold.en) &&
          check.blockerEvidenceRecordIds.length === 0,
      )
      .map((check) => check.id);
    expect(broken).toEqual([]);
  });

  it("gives every decidable check instructions written for that check", () => {
    const all = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap(
      (group) => group.checks,
    );
    const decidable = all.filter((check) => check.evidenceRecordIds.length > 0);
    expect(decidable).toHaveLength(AGENT_AUDIT_COVERAGE.decided);

    // The group fallback emits one sentence for every check in a group, so a
    // check still sharing its text with a sibling has no instructions of its
    // own. Detecting a problem and then saying nothing specific about it is the
    // failure this guards: a detector has to land with its fix.
    for (const check of decidable) {
      const siblings = all.filter(
        (other) =>
          other.scope === check.scope &&
          other.groupId === check.groupId &&
          other.id !== check.id,
      );
      expect(
        siblings.some((other) => other.howToFix.en === check.howToFix.en),
      ).toBe(false);
      expect(check.howToFix.zh).not.toBe("");
      expect(check.howToFix.en.length).toBeGreaterThan(120);
    }
  });

  it("marks exactly the checks whose own threshold declines to judge", () => {
    // Pinned by name. The flag is derived from the threshold sentence, so
    // asserting it against that same sentence would pass whatever the set
    // contained; changing this list has to be a decision someone writes down.
    const declining = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS]
      .flatMap((group) => group.checks)
      .filter((check) => check.declaresNoJudgement)
      .map((check) => check.id)
      .sort();

    expect(declining).toEqual(
      [
        "A7",
        "B4",
        "B5",
        "C6",
        "D7",
        "E4",
        "4.4",
        "6.5",
      ].sort(),
    );
  });

  it("keeps Official CWV immutable and display-only checks out of Health", () => {
    const all = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap(
      (group) => group.checks,
    );
    for (const id of ["8.1", "8.2", "8.3"]) {
      expect(all.find((check) => check.id === id)?.thresholdAuthority).toBe(
        "official",
      );
    }
    // Pinned by name, not re-derived from the threshold text the catalog reads:
    // asserting the rule against itself would pass no matter which checks it
    // covered. Changing this set has to be a decision someone writes down.
    expect(
      all
        .filter((check) => !check.scored)
        .map((check) => check.id)
        .sort(),
    ).toEqual(
      [
        // Deliberate conditions listed for review.
        "A7",
        "C6",
        "D7",
        // Published with no defensible pass mark.
        "B4",
        "B5",
        "E4",
        "4.4",
        "6.5",
        // Indexability gates a page rather than scoring it.
        "1.1",
        "1.2",
        "1.3",
        "1.4",
        "1.5",
        "1.6",
        "1.7",
        "1.8",
        // Group 1 gates a page rather than scoring it, and the viewport
        // declaration joined that group: a page that renders at desktop width
        // on a phone is not a page with a lower score.
        "1.9",
      ].sort(),
    );
  });
});
