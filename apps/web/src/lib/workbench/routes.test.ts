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
