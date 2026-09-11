import { describe, expect, it } from "vitest";
import {
  LEGACY_LINKS,
  WORKBENCH_PAGE_IDS,
  WORKBENCH_SEGMENTS,
  activeWorkbenchPage,
  legacyHref,
  workbenchHref,
} from "./routes.ts";

const PID = "00000000-0000-4000-8000-000000000042";

describe("workbench routes", () => {
  it("has exactly fifteen pages with unique segments", () => {
    expect(WORKBENCH_PAGE_IDS).toHaveLength(15);
    const segments = WORKBENCH_PAGE_IDS.map((id) => WORKBENCH_SEGMENTS[id]);
    expect(new Set(segments).size).toBe(15);
    expect(segments).not.toContain("sources"); // the legacy OAuth target keeps it
    expect(WORKBENCH_SEGMENTS.dataSources).toBe("data-sources");
    expect(WORKBENCH_SEGMENTS.keywordLibrary).toBe("keyword-library");
  });

  it("pins every segment (the same table is hand-copied into page dirs and e2e)", () => {
    expect(WORKBENCH_SEGMENTS).toEqual({
      overview: "overview", week: "week", keywords: "keywords",
      keywordLibrary: "keyword-library", competitors: "competitors",
      audit: "audit", visibility: "visibility", profile: "profile",
      dataSources: "data-sources", links: "links", content: "content",
      kb: "kb", answers: "answers", artifacts: "artifacts", settings: "settings",
    });
  });

  it("keeps new segments disjoint from legacy ones so legacy pages never highlight a nav item", () => {
    const legacy = new Set(Object.values(LEGACY_LINKS).flat());
    expect(legacy.size).toBe(8); // every LegacySegment member is reachable from the table
    for (const id of WORKBENCH_PAGE_IDS) {
      expect(legacy.has(WORKBENCH_SEGMENTS[id]), WORKBENCH_SEGMENTS[id]).toBe(false);
    }
  });

  it("builds project-scoped hrefs", () => {
    expect(workbenchHref(PID, "overview")).toBe(`/p/${PID}/overview`);
    expect(legacyHref(PID, "legacy/overview")).toBe(`/p/${PID}/legacy/overview`);
    expect(legacyHref(PID, "growth-map")).toBe(`/p/${PID}/growth-map`);
  });

  it("resolves the active page from the pathname and ignores legacy routes", () => {
    expect(activeWorkbenchPage(`/p/${PID}/audit`, PID)).toBe("audit");
    expect(activeWorkbenchPage(`/p/${PID}/keyword-library?x=1`, PID)).toBe("keywordLibrary");
    expect(activeWorkbenchPage(`/p/${PID}/growth-map`, PID)).toBeNull();
    expect(activeWorkbenchPage(`/p/${PID}/legacy/overview`, PID)).toBeNull();
    expect(activeWorkbenchPage(`/p/other/audit`, PID)).toBeNull();
    expect(activeWorkbenchPage(`/p/${PID}/audit/x`, PID)).toBe("audit"); // nested route keeps the item active
    expect(activeWorkbenchPage(`/p/${PID}/audit/`, PID)).toBe("audit");
    expect(activeWorkbenchPage(`/p/${PID}`, PID)).toBeNull();
    expect(activeWorkbenchPage(`/p/${PID}x/audit`, PID)).toBeNull(); // id that is a prefix of another id
  });

  it("maps every overlapping page to its legacy destinations (design §4.3)", () => {
    expect(LEGACY_LINKS.overview).toEqual(["legacy/overview"]);
    expect(LEGACY_LINKS.keywords).toEqual(["growth-map"]);
    expect(LEGACY_LINKS.keywordLibrary).toEqual(["growth-map"]);
    expect(LEGACY_LINKS.competitors).toEqual(["growth-map"]);
    expect(LEGACY_LINKS.audit).toEqual(["growth-map"]); // diagnosis/ only redirects to growth-map
    expect(LEGACY_LINKS.profile).toEqual(["context", "setup-sources"]);
    expect(LEGACY_LINKS.dataSources).toEqual(["sources"]);
    expect(LEGACY_LINKS.content).toEqual(["studio", "execution"]); // plan 308s to execution
    expect(LEGACY_LINKS.answers).toEqual(["results"]); // report 308s to results
    for (const id of ["week", "visibility", "links", "kb", "artifacts", "settings"] as const) {
      expect(LEGACY_LINKS[id]).toEqual([]);
    }
  });
});
