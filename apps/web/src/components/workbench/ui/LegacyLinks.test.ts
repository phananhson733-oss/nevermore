import { describe, expect, it } from "vitest";
import { getMessages } from "@sf/i18n";
import { LEGACY_LINKS, type LegacySegment } from "@/lib/workbench/routes";
import { LEGACY_LABEL_KEY } from "./LegacyLinks.tsx";

/**
 * `LegacyLinks` renders `tNav(LEGACY_LABEL_KEY[segment])`. next-intl renders a
 * missing key as its own dotted path rather than throwing, so a typo here would
 * ship as the literal string "nav.growthMap" in the UI. Pin the keys against
 * both catalogs, and pin the map against the segments pages actually link to.
 */
const NAV_BY_LOCALE = [
  ["en", getMessages("en").nav],
  ["zh-CN", getMessages("zh-CN").nav],
] as const satisfies readonly (readonly [string, object])[];

describe("LEGACY_LABEL_KEY", () => {
  it.each(NAV_BY_LOCALE)("names a non-empty nav label in %s", (_locale, nav) => {
    const catalog = nav as Readonly<Record<string, unknown>>;
    const missing = Object.entries(LEGACY_LABEL_KEY).filter(([, key]) => {
      const value = catalog[key];
      return typeof value !== "string" || value.length === 0;
    });
    expect(missing).toEqual([]);
  });

  it("covers exactly the segments reachable through LEGACY_LINKS", () => {
    const linked = new Set<string>(Object.values(LEGACY_LINKS).flat());
    const labelled = new Set<string>(Object.keys(LEGACY_LABEL_KEY));
    expect([...labelled].sort()).toEqual([...linked].sort());
  });

  it("accepts every LegacySegment as a lookup key", () => {
    const segments: readonly LegacySegment[] = Object.keys(
      LEGACY_LABEL_KEY,
    ) as readonly LegacySegment[];
    for (const segment of segments) {
      expect(typeof LEGACY_LABEL_KEY[segment]).toBe("string");
    }
  });
});
