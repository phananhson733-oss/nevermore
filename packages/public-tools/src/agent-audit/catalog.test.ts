import { describe, expect, it } from "vitest";
import {
  AGENT_AUDIT_DEFAULT_GROUPS,
  AGENT_AUDIT_HEADING_PRESETS,
  PAGE_AUDIT_GROUPS,
  SITE_AUDIT_GROUPS,
} from "./catalog.ts";

describe("v2 Agent audit catalog", () => {
  it("freezes 5/31 site and 9/50 page entries with unique IDs", () => {
    const site = SITE_AUDIT_GROUPS.flatMap((group) => group.checks);
    const page = PAGE_AUDIT_GROUPS.flatMap((group) => group.checks);
    expect(SITE_AUDIT_GROUPS).toHaveLength(5);
    expect(site).toHaveLength(31);
    expect(new Set(site.map((check) => check.id)).size).toBe(31);
    expect(PAGE_AUDIT_GROUPS).toHaveLength(9);
    expect(page).toHaveLength(50);
    expect(new Set(page.map((check) => check.id)).size).toBe(50);
    expect([...site, ...page].every((check) => check.threshold.en && check.impact.en && check.howToFix.en)).toBe(true);
  });

  it("keeps the v2 weights, inventory, Agent defaults, and heading presets", () => {
    expect(SITE_AUDIT_GROUPS.reduce((sum, group) => sum + (group.weight ?? 0), 0)).toBe(100);
    expect(PAGE_AUDIT_GROUPS.reduce((sum, group) => sum + (group.weight ?? 0), 0)).toBe(100);
    const all = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap((group) => group.checks);
    // Inventory readiness is derived, not listed, so it cannot drift from the
    // detectors again. A hand-kept list is what let 47 checks advertise
    // readiness while only 24 could ever produce a verdict.
    expect(all.filter((check) => check.inventoryReady)).toHaveLength(30);
    for (const check of all) {
      expect(check.inventoryReady).toBe(check.evidenceRecordIds.length > 0);
    }
    // A check with no detector must say so rather than borrow the state that
    // means "the detector ran and matched nothing".
    for (const check of all) {
      if (check.engine !== "needs-integration") continue;
      expect(check.evidenceRecordIds).toEqual([]);
      // D1 and 4.5 have a detector; it is held behind the P6 gate, and their
      // data source names that instead — a more specific reason, not a looser one.
      expect(check.dataSource.en).toContain(
        check.id === "D1" || check.id === "4.5" ? "P6" : "no detector",
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
    for (const id of ["D1", "4.5"]) {
      const check = all.find((candidate) => candidate.id === id);
      expect(check).toMatchObject({
        inventoryReady: false,
        evidenceRecordIds: [],
      });
      expect(check?.boundary.en).toContain("P6 hard gate");
    }
  });

  it("gives every decidable check instructions written for that check", () => {
    const all = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap(
      (group) => group.checks,
    );
    const decidable = all.filter((check) => check.evidenceRecordIds.length > 0);
    expect(decidable).toHaveLength(30);

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

  it("keeps Official CWV immutable and display-only checks out of Health", () => {
    const all = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap(
      (group) => group.checks,
    );
    for (const id of ["8.1", "8.2", "8.3"]) {
      expect(all.find((check) => check.id === id)?.thresholdAuthority).toBe(
        "official",
      );
    }
    for (const id of ["B5", "6.5"]) {
      expect(all.find((check) => check.id === id)?.scored).toBe(false);
    }
  });
});
