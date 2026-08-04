import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildTrafficDropReport,
  SELF_CHECK_ANSWERS,
  TRAFFIC_CHECK_IDS,
  type SelfCheckAnswers,
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

  // Over thirteen months. Without this the longest scenario was 120 days, so
  // every branch gated on `span >= SEASONALITY_MIN_DAYS` was unreachable from
  // this suite — which is how `seasonality_yoy` shipped reporting "clear" with
  // an empty explanation for every site old enough to reach that branch.
  const longHistory = Array.from({ length: 430 }, (_unused, index) => ({
    date: day(index),
    clicks: 120,
    impressions: 9_000,
  }));

  return [twoStage, outage, tiny, short, flat, longHistory];
}

/**
 * Every combination of the two self-check answers.
 *
 * Nine runs per series rather than one. The previous version passed a single
 * (implicit) answer, so the copy for every other path existed only because
 * someone remembered to write it — the branch that would have caught a missing
 * string was never taken. `resolve_security_issue` and `check_security_issues`
 * are reachable from exactly two of these nine.
 */
function selfCheckCombinations(): readonly SelfCheckAnswers[] {
  return SELF_CHECK_ANSWERS.flatMap((manualAction) =>
    SELF_CHECK_ANSWERS.map((securityIssue) => ({
      manualAction,
      securityIssue,
    })),
  );
}

function codesFrom(result: TrafficDropResult): readonly string[] {
  const { selfChecks } = result.siteSignals;
  const paths: string[] = [
    `siteSignals.paths.${
      selfChecks.path === "issue_reported"
        ? "issueReported"
        : selfChecks.path === "no_issue_reported"
          ? "noIssue"
          : "unconfirmed"
    }Title`,
    `siteSignals.paths.${
      selfChecks.path === "issue_reported"
        ? "issueReported"
        : selfChecks.path === "no_issue_reported"
          ? "noIssue"
          : "unconfirmed"
    }Body`,
    // The playback of the visitor's own answers, which is prose per answer per
    // page and therefore six strings that only appear on their own branch.
    ...[selfChecks.manualAction, selfChecks.securityIssue].flatMap((check) => [
      `siteSignals.${check.id}.label`,
      `siteSignals.recorded.${check.id}.${check.answer}`,
    ]),
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
      ...action.signalBasis.map((id) => `siteSignals.${id}.label`),
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
        for (const selfChecks of selfCheckCombinations()) {
          const { result } = buildTrafficDropReport({
            daily,
            completedAt: "2026-07-31T00:00:00.000Z",
            selfChecks,
          });
          for (const path of codesFrom(result)) {
            const value = lookup(bundle, `tools.trafficDrop.${path}`);
            // An empty string is a string. Accepting one let six copy slots
            // ship blank — including `checkOutcomes.seasonality_yoy.clear`,
            // which the report rendered as a check with a status, a name, and
            // no explanation at all beside it.
            if (typeof value !== "string" || value.trim() === "") {
              missing.add(path);
            }
          }
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
