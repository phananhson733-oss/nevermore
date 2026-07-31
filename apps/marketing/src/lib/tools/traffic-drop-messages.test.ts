import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildTrafficDropReport,
  TRAFFIC_CHECK_IDS,
  type TrafficDailyPoint,
  type TrafficDropResult,
} from "@sf/public-tools";

/**
 * Every code the engine emits must have copy in both locales.
 *
 * The engine deliberately returns machine codes rather than prose, so a missing
 * translation does not fail a type check — it fails in front of a user, as a
 * raw key or a thrown next-intl error, in the middle of their report. This test
 * is the thing standing between those two facts.
 */
function messages(locale: "en" | "zh"): Record<string, unknown> {
  const path = fileURLToPath(
    new URL(`../../i18n/messages/${locale}.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function lookup(bundle: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      bundle,
    );
}

/** Series shaped to exercise each branch of the engine at least once. */
function scenarios(): readonly (readonly TrafficDailyPoint[])[] {
  const day = (index: number) =>
    new Date(Date.UTC(2026, 0, 1) + index * 86_400_000)
      .toISOString()
      .slice(0, 10);

  const twoStage = Array.from({ length: 120 }, (_unused, index) => {
    if (index >= 113) return { date: day(index), clicks: 8, impressions: 700 };
    if (index >= 106)
      return { date: day(index), clicks: 25, impressions: 2_800 };
    if (index >= 99)
      return { date: day(index), clicks: 60, impressions: 2_950 };
    return { date: day(index), clicks: 6, impressions: 500 };
  });

  const outage = Array.from({ length: 120 }, (_unused, index) => ({
    date: day(index),
    clicks: index === 100 ? 0 : 30,
    impressions: index === 100 ? 10 : 1_200,
  }));

  const tiny = Array.from({ length: 120 }, (_unused, index) => ({
    date: day(index),
    clicks: 2,
    impressions: 90,
  }));

  const short = Array.from({ length: 40 }, (_unused, index) => ({
    date: day(index),
    clicks: 20,
    impressions: 1_500,
  }));

  const flat = Array.from({ length: 120 }, (_unused, index) => ({
    date: day(index),
    clicks: 300,
    impressions: 20_000,
  }));

  return [twoStage, outage, tiny, short, flat];
}

function codesFrom(result: TrafficDropResult): readonly string[] {
  const paths: string[] = [
    `states.${result.changePoint.state}.summary`,
    ...result.changePoint.windows.flatMap((window) => [
      `windows.${window.id}.label`,
      `windows.${window.id}.short`,
    ]),
    ...result.findings.flatMap((finding) => [
      `findings.${finding.id}.title`,
      `findings.${finding.id}.body`,
      `tiers.${finding.tier}`,
      ...finding.measures.map((measure) => `measures.${measure.key}`),
      ...(finding.hypothesis ? [`hypotheses.${finding.hypothesis}`] : []),
      ...(finding.limitation ? [`limitations.${finding.limitation}`] : []),
    ]),
    ...result.actions.flatMap((action) => [
      `actions.${action.id}.title`,
      `actions.${action.id}.body`,
      `actionKinds.${action.kind}`,
      ...action.basis.map((id) => `findings.${id}.title`),
    ]),
    ...result.checks.flatMap((check) => [
      `checks.${check.id}`,
      `checkStatus.${check.status}`,
      ...(check.unavailableReason
        ? [`unavailableReasons.${check.unavailableReason}`]
        : [`checkOutcomes.${check.id}.${check.status}`]),
    ]),
  ];
  if (result.changePoint.limitation) {
    paths.push(`limitations.${result.changePoint.limitation}`);
  }
  return paths;
}

describe("traffic drop copy", () => {
  const bundles = { en: messages("en"), zh: messages("zh") } as const;

  it.each(["en", "zh"] as const)(
    "has %s copy for every code the engine can emit",
    (locale) => {
      const bundle = bundles[locale];
      const missing = new Set<string>();

      for (const daily of scenarios()) {
        const { result } = buildTrafficDropReport({
          daily,
          completedAt: "2026-07-31T00:00:00.000Z",
        });
        for (const path of codesFrom(result)) {
          const value = lookup(bundle, `tools.trafficDrop.${path}`);
          if (typeof value !== "string") missing.add(path);
        }
      }

      expect([...missing]).toEqual([]);
    },
  );

  it.each(["en", "zh"] as const)(
    "names every check in %s, including ones no scenario triggers",
    (locale) => {
      const bundle = bundles[locale];
      for (const id of TRAFFIC_CHECK_IDS) {
        expect(typeof lookup(bundle, `tools.trafficDrop.checks.${id}`)).toBe(
          "string",
        );
      }
    },
  );

  it("keeps the two locales structurally identical", () => {
    const paths = (node: unknown, prefix = ""): readonly string[] =>
      typeof node === "object" && node !== null
        ? Object.entries(node as Record<string, unknown>).flatMap(
            ([key, value]) => [
              prefix + key,
              ...paths(value, `${prefix}${key}.`),
            ],
          )
        : [];

    const en = [...paths(lookup(bundles.en, "tools.trafficDrop"))].sort();
    const zh = [...paths(lookup(bundles.zh, "tools.trafficDrop"))].sort();
    expect(zh).toEqual(en);
  });
});
