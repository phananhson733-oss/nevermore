import { describe, expect, it } from "vitest";
import {
  AGENT_AUDIT_DEFAULT_GROUPS,
  AGENT_AUDIT_HEADING_PRESETS,
  PAGE_AUDIT_GROUPS,
  SITE_AUDIT_GROUPS,
} from "./catalog.ts";

describe("v2 Agent audit catalog", () => {
  it("freezes 5/27 site and 9/50 page entries with unique IDs", () => {
    const site = SITE_AUDIT_GROUPS.flatMap((group) => group.checks);
    const page = PAGE_AUDIT_GROUPS.flatMap((group) => group.checks);
    expect(SITE_AUDIT_GROUPS).toHaveLength(5);
    expect(site).toHaveLength(27);
    expect(new Set(site.map((check) => check.id)).size).toBe(27);
    expect(PAGE_AUDIT_GROUPS).toHaveLength(9);
    expect(page).toHaveLength(50);
    expect(new Set(page.map((check) => check.id)).size).toBe(50);
    expect([...site, ...page].every((check) => check.threshold.en && check.impact.en && check.howToFix.en)).toBe(true);
  });

  it("keeps the v2 weights, inventory, Agent defaults, and heading presets", () => {
    expect(SITE_AUDIT_GROUPS.reduce((sum, group) => sum + (group.weight ?? 0), 0)).toBe(100);
    expect(PAGE_AUDIT_GROUPS.reduce((sum, group) => sum + (group.weight ?? 0), 0)).toBe(100);
    const all = [...SITE_AUDIT_GROUPS, ...PAGE_AUDIT_GROUPS].flatMap((group) => group.checks);
    expect(all.filter((check) => check.inventoryReady)).toHaveLength(43);
    expect(AGENT_AUDIT_DEFAULT_GROUPS).toEqual({
      seo: { site: "E", page: "9" },
      tech: { site: "A", page: "1" },
    });
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
