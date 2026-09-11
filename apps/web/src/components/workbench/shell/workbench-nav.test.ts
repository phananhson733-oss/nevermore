import { describe, expect, it } from "vitest";
import { WORKBENCH_PAGE_IDS } from "../../../lib/workbench/routes.ts";
import { WORKBENCH_NAV } from "./workbench-nav.ts";

describe("WORKBENCH_NAV", () => {
  it("lists every route exactly once across six groups", () => {
    const ids = WORKBENCH_NAV.flatMap((g) => g.items.map((i) => i.id));
    expect(WORKBENCH_NAV).toHaveLength(6);
    expect([...ids].sort()).toEqual([...WORKBENCH_PAGE_IDS].sort());
  });

  it("badges only fields selectCounts produces", () => {
    const badged = WORKBENCH_NAV.flatMap((g) => g.items)
      .filter((i) => i.badge !== null)
      .map((i) => i.badge);
    expect(badged).toEqual([
      "keywords",
      "keywordLibrary",
      "competitors",
      "audit",
      "visibility",
      "dataSources",
      "links",
      "kb",
      "artifacts",
    ]);
  });
});
