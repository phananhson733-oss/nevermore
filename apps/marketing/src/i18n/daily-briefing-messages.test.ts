// @input  -- EN/ZH message catalogs and the Daily Briefing machine vocabulary
// @output -- parity and completeness guards for every code the Daily Briefing UI humanizes
// @pos    -- localized-copy contract for /[locale]/tools/daily-search-briefing

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import en from "./messages/en.json";
import zh from "./messages/zh.json";

const LIMITATION_CODES = [
  "daily_data_incomplete",
  "daily_rows_omitted",
  "query_evidence_unavailable",
  "property_totals_unavailable",
  "query_evidence_partial",
  "query_page_coverage_below_floor",
  "aggregation_basis_mismatch",
  "anonymization_gap_uncomputable",
  "brand_terms_not_confirmed",
  "property_change_inside_noise_floor",
] as const;

const ERROR_CODES = [
  "gsc_unavailable",
  "scan_in_progress",
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "rate_limited",
  "quota_unavailable",
  "gsc_revoked",
  "gsc_temporarily_unavailable",
  "unknown",
] as const;

const CHANGE_KINDS = [
  "click_opportunity",
  "stable_position_click_decline",
  "average_position_crossed_page_one_band",
  "actionable_position_decline",
  "first_observed",
] as const;

const OBSERVATION_BANDS = [
  "page_one",
  "near_page_one",
  "mid",
  "far",
] as const;

const CTR_LANE_BLOCKERS = [
  "brand_terms_not_confirmed",
  "insufficient_band_impressions",
  "insufficient_band_queries",
  "no_position_band_coverage",
] as const;

/** Every kind the site-trend card can render, action-grade or not. */
const PROPERTY_CHANGE_KINDS = [
  "sitewide_click_decline",
  "sitewide_visibility_decline",
  "sitewide_visibility_gain",
  "sitewide_click_observation",
  "sitewide_visibility_observation",
] as const;

/** Only these three may be dispatched, so only these need action copy. */
const PROPERTY_ACTION_KINDS = [
  "sitewide_click_decline",
  "sitewide_visibility_decline",
  "sitewide_visibility_gain",
] as const;

const PROVISIONAL_MOVE_KINDS = [
  "provisional_page_one_band_entry",
  "provisional_actionable_position_decline",
] as const;

const EVIDENCE_STATES = [
  "observed",
  "not_observed",
  "partial",
  "unavailable",
] as const;

const REQUIRED_LEAF_PATHS = [
  "connectTitle",
  "connectBody",
  "connectCta",
  "connectTrust",
  "connectPending",
  "inviteOnlyTitle",
  "inviteOnlyBody",
  "inviteOnlyCta",
  "inviteOnlyRequest",
  "noPropertyTitle",
  "noPropertyBody",
  "propertyLabel",
  "propertiesTruncated",
  "brand.label",
  "brand.hint",
  "brand.placeholder",
  "brand.confirm",
  "brand.unconfirmed",
  "brand.confirmed",
  "run",
  "rerun",
  "running",
  "runComplete",
  "reconnect",
  "disconnect",
  "disconnecting",
  "disconnectHint",
  "disconnectRevokeFailed",
  "disconnectFailed",
  "disconnectGoogleSettings",
  "facts.dataThrough",
  "facts.timeBasis",
  "facts.timeBasisBody",
  "facts.cadence",
  "facts.sharedRuns",
  "facts.daily",
  "facts.weekly",
  "facts.dailyReason",
  "facts.weeklyReason",
  "facts.unavailableReason",
  "facts.positionObservationReason",
  "facts.currentWatchlistReason",
  "facts.quotaAvailable",
  "facts.quotaUnavailable",
  "kpis.title",
  "kpis.clicks",
  "kpis.impressions",
  "kpis.ctr",
  "kpis.averagePosition",
  "kpis.latestDay",
  "kpis.currentSevenDays",
  "kpis.change",
  "kpis.unavailable",
  "kpis.dailySuppressed",
  "kpis.positionNote",
  "noise.label",
  "noise.observed",
  "noise.partial",
  "noise.unavailable",
  "noise.observationOnly",
  "siteTrend.title",
  "siteTrend.intro",
  "siteTrend.evidence",
  "siteTrend.actionListed",
  "siteTrend.insideNoiseFloor",
  "ctrLane.notEvaluated",
  "ctrLane.blockers.unknown",
  "ctrLane.confirmAndRerun",
  "evidence.foldSummary",
  "review.title",
  "review.intro",
  "review.empty",
  "review.partial",
  "review.unavailable",
  "review.pageUnavailable",
  "review.introUnavailable",
  "review.introPositionObservation",
  "review.introCurrentWatchlist",
  "review.withheld",
  "provisional.title",
  "provisional.intro",
  "provisional.note",
  "provisional.checkPage",
  "provisional.withheld",
  "review.observationKinds.sample_floor_reached.title",
  "review.observationKinds.sample_floor_reached.body",
  "review.observationKinds.sample_building.title",
  "review.observationKinds.sample_building.body",
  "review.columns.status",
  "review.columns.queryPage",
  "review.columns.clicks",
  "review.columns.position",
  "review.columns.interpretation",
  "evidence.title",
  "evidence.thresholdSummary",
  "evidence.paths.title",
  "evidence.paths.intro",
  "evidence.paths.rowsIntro",
  "evidence.paths.tiers.baseline",
  "evidence.paths.tiers.lanes",
  "evidence.paths.tiers.suppression",
  "evidence.paths.rowSplit",
  "evidence.paths.laneUnavailable",
  "evidence.paths.laneRequirement",
  "evidence.paths.ctrBaseline.name",
  "evidence.paths.ctrBaseline.requirement",
  "evidence.paths.ctrBaseline.evaluated",
  "evidence.paths.ctrBaseline.unavailable",
  "evidence.paths.pageAttribution.name",
  "evidence.paths.pageAttribution.observed",
  "evidence.paths.pageAttribution.none",
  "evidence.paths.pageAttribution.unavailable",
  "evidence.coverageTitle",
  "evidence.coverageObserved",
  "evidence.coverageUnavailable",
  "evidence.anonymizationTitle",
  "evidence.anonymizationObserved",
  "evidence.anonymizationUnavailable",
  "changes.title",
  "changes.empty",
  "changes.stableEmpty",
  "changes.propertyEvidence",
  "changes.entireProperty",
  "changes.query",
  "changes.page",
  "changes.current",
  "changes.previous",
  "changes.firstObservedPrevious",
  "changes.metrics",
  "changes.columns.change",
  "changes.columns.queryPage",
  "changes.columns.clicks",
  "changes.columns.position",
  "changes.columns.interpretation",
  "changes.notObserved",
  "propertyChangeKinds.sitewide_click_decline.title",
  "propertyChangeKinds.sitewide_click_decline.body",
  "propertyChangeKinds.sitewide_visibility_decline.title",
  "propertyChangeKinds.sitewide_visibility_decline.body",
  "propertyChangeKinds.sitewide_visibility_gain.title",
  "propertyChangeKinds.sitewide_visibility_gain.body",
  "actions.title",
  "actions.empty",
  "actions.rank",
  "actions.why",
  "actions.evidence",
  "actions.propertyEvidence",
  "actions.propertyWeekly",
  "propertyActionKinds.sitewide_click_decline.title",
  "propertyActionKinds.sitewide_click_decline.body",
  "propertyActionKinds.sitewide_visibility_decline.title",
  "propertyActionKinds.sitewide_visibility_decline.body",
  "propertyActionKinds.sitewide_visibility_gain.title",
  "propertyActionKinds.sitewide_visibility_gain.body",
  "actionDestinations.seo-quick-wins",
  "actionDestinations.traffic-drop-diagnosis",
  "actionDestinations.on-page-seo-check",
  "handoffError",
  "manual.title",
  "manual.body",
  "manual.manualActions",
  "manual.securityIssues",
  "manual.open",
  "manual.unconfirmed",
  "manual.checked",
  "manual.markChecked",
  "limitations.title",
  "limitations.empty",
  "methodology.title",
  "methodology.time",
  "methodology.position",
  "methodology.anonymization",
  "methodology.noPersistence",
] as const;

function daily(messages: unknown): Record<string, unknown> {
  const root = messages as {
    readonly tools?: Readonly<Record<string, unknown>>;
  };
  const namespace = root.tools?.dailyBriefing;
  expect(namespace).toEqual(expect.any(Object));
  return namespace as Record<string, unknown>;
}

function recordAt(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  let child: unknown = value;
  for (const part of key.split(".")) {
    child =
      child && typeof child === "object"
        ? (child as Record<string, unknown>)[part]
        : undefined;
  }
  expect(child, `missing tools.dailyBriefing.${key}`).toEqual(
    expect.any(Object),
  );
  return child as Readonly<Record<string, unknown>>;
}

function leafPaths(value: unknown, prefix = ""): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholders(value: unknown): readonly string[] {
  expect(value).toEqual(expect.any(String));
  return [...(value as string).matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)(?:,|\})/g)]
    .map((match) => match[1]!)
    .sort();
}

describe("Daily Briefing message catalogs", () => {
  it("defines the namespace with identical EN and ZH leaf keys", () => {
    expect([...leafPaths(daily(en))].sort()).toEqual(
      [...leafPaths(daily(zh))].sort(),
    );
  });

  it.each([
    ["en", en],
    ["zh", zh],
  ] as const)("humanizes every machine code in %s", (_locale, messages) => {
    const namespace = daily(messages);
    const limitations = recordAt(namespace, "limitationCodes");
    const errors = recordAt(namespace, "errors");
    const changeKinds = recordAt(namespace, "changeKinds");
    const actionKinds = recordAt(namespace, "actionKinds");
    const propertyChangeKinds = recordAt(namespace, "propertyChangeKinds");
    const propertyActionKinds = recordAt(namespace, "propertyActionKinds");
    const evidenceStates = recordAt(namespace, "evidenceStates");
    const observationBands = recordAt(namespace, "review.observationBands");
    const ctrLaneBlockers = recordAt(namespace, "ctrLane.blockers");
    const provisionalMoveKinds = recordAt(namespace, "provisionalMoveKinds");
    const withheldBands = recordAt(namespace, "review.withheldBands");
    const evidencePathLanes = recordAt(namespace, "evidence.paths.lanes");

    const paths = new Set(leafPaths(namespace));
    for (const path of REQUIRED_LEAF_PATHS) {
      expect(paths.has(path), `missing tools.dailyBriefing.${path}`).toBe(true);
    }

    for (const code of LIMITATION_CODES) {
      expect(limitations[code], `missing limitation ${code}`).toEqual(
        expect.any(String),
      );
    }
    for (const code of ERROR_CODES) {
      expect(errors[code], `missing error ${code}`).toEqual(expect.any(String));
    }
    for (const kind of CHANGE_KINDS) {
      expect(changeKinds[kind], `missing change kind ${kind}`).toEqual(
        expect.any(Object),
      );
      expect(actionKinds[kind], `missing action kind ${kind}`).toEqual(
        expect.any(Object),
      );
    }
    for (const kind of PROPERTY_CHANGE_KINDS) {
      expect(
        propertyChangeKinds[kind],
        `missing property change kind ${kind}`,
      ).toEqual(expect.any(Object));
    }
    for (const kind of PROPERTY_ACTION_KINDS) {
      expect(
        propertyActionKinds[kind],
        `missing property action kind ${kind}`,
      ).toEqual(expect.any(Object));
    }
    // Copy for a kind that can never be dispatched would be an invitation to
    // dispatch it. The observation kinds deliberately have no action entry.
    for (const kind of PROPERTY_CHANGE_KINDS) {
      if (PROPERTY_ACTION_KINDS.some((allowed) => allowed === kind)) continue;
      expect(propertyActionKinds[kind], `${kind} must not be dispatchable`).toBe(
        undefined,
      );
    }
    for (const kind of PROVISIONAL_MOVE_KINDS) {
      expect(
        provisionalMoveKinds[kind],
        `missing provisional move kind ${kind}`,
      ).toEqual(expect.any(Object));
    }
    for (const key of ["clickOpportunity", "stableDecline", "pageOneBand", "positionDecline", "firstObserved"] as const) {
      expect(evidencePathLanes[key], `missing evidence path ${key}`).toEqual(
        expect.any(Object),
      );
    }
    for (const band of OBSERVATION_BANDS) {
      expect(observationBands[band], `missing observation band ${band}`).toEqual(
        expect.any(Object),
      );
      expect(
        withheldBands[band],
        `missing withheld band label ${band}`,
      ).toEqual(expect.any(String));
    }
    for (const blocker of CTR_LANE_BLOCKERS) {
      expect(
        ctrLaneBlockers[blocker],
        `missing CTR lane blocker ${blocker}`,
      ).toEqual(expect.any(String));
    }
    for (const state of EVIDENCE_STATES) {
      expect(evidenceStates[state], `missing evidence state ${state}`).toEqual(
        expect.any(String),
      );
    }
  });

  it("keeps EN and ZH noise-summary placeholders aligned", () => {
    const enNoise = recordAt(daily(en), "noise");
    const zhNoise = recordAt(daily(zh), "noise");

    for (const key of [
      "observed",
      "partial",
      "unavailable",
      "observationOnly",
    ] as const) {
      expect(placeholders(zhNoise[key])).toEqual(
        placeholders(enNoise[key]),
      );
    }
  });

  it("breaks the sample floor down instead of calling it an evaluation floor", () => {
    const enNoise = recordAt(daily(en), "noise");
    const zhNoise = recordAt(daily(zh), "noise");

    // The impression floor says a row has a sample, never that a lane looked
    // at it. Calling the same count an "evaluation sample floor" is the claim
    // this breakdown replaces.
    expect(placeholders(enNoise.observed)).toEqual([
      "clickDecline",
      "currentOnly",
      "eligible",
      "observed",
      "provisional",
      "strictPaired",
    ]);
    expect(placeholders(zhNoise.observed)).toEqual(
      placeholders(enNoise.observed),
    );
    expect(String(enNoise.observed)).not.toContain("evaluation sample floor");
    expect(String(zhNoise.observed)).not.toContain("可评估样本门槛");
    expect(String(enNoise.observed)).not.toContain("fallback");
    expect(String(zhNoise.observed)).not.toContain("回退");
  });

  it("keeps material wording off the site-trend observation kinds", () => {
    for (const catalog of [daily(en), daily(zh)]) {
      const kinds = recordAt(catalog, "propertyChangeKinds");
      for (const kind of [
        "sitewide_click_observation",
        "sitewide_visibility_observation",
      ] as const) {
        const entry = kinds[kind] as Readonly<Record<string, string>>;
        // A heading that asserts a material decline over a sentence that
        // withdraws the claim is the defect these kinds exist to remove.
        for (const banned of ["实质", "material", "Material"]) {
          expect(entry.title, `${kind}.title`).not.toContain(banned);
        }
      }
    }
  });

  it("states the two-window floor in the threshold summary", () => {
    // Without it, a reader cannot tell why a query that visibly moved was not
    // reported as a change.
    expect(String(recordAt(daily(zh), "evidence").thresholdSummary)).toContain(
      "两个窗口各至少 100 次曝光",
    );
    expect(String(recordAt(daily(en), "evidence").thresholdSummary)).toContain(
      "100 impressions in each of the two windows",
    );
  });

  it("keeps placeholders aligned for every localized Daily Briefing leaf", () => {
    const enDaily = daily(en);
    const zhDaily = daily(zh);
    const paths = [...leafPaths(enDaily)];

    function valueAtPath(
      value: Readonly<Record<string, unknown>>,
      path: string,
    ): unknown {
      return path.split(".").reduce<unknown>((current, key) => {
        expect(current).toEqual(expect.any(Object));
        return (current as Readonly<Record<string, unknown>>)[key];
      }, value);
    }

    for (const path of paths) {
      expect(placeholders(valueAtPath(zhDaily, path)), path).toEqual(
        placeholders(valueAtPath(enDaily, path)),
      );
    }
  });

  it("keeps EN and ZH action-rank placeholders aligned", () => {
    const enActions = recordAt(daily(en), "actions");
    const zhActions = recordAt(daily(zh), "actions");

    expect(placeholders(enActions.rank)).toEqual(["rank"]);
    expect(placeholders(zhActions.rank)).toEqual(
      placeholders(enActions.rank),
    );
  });

  it("uses explicit localized entire-property labels without null placeholders", () => {
    const enChanges = recordAt(daily(en), "changes");
    const zhChanges = recordAt(daily(zh), "changes");

    expect(enChanges.entireProperty).toBe("Entire Search Console property");
    expect(zhChanges.entireProperty).toBe("整个 Search Console 站点");
    expect(String(enChanges.entireProperty)).not.toContain("null");
    expect(String(zhChanges.entireProperty)).not.toContain("null");
  });

  it("keeps client copy in next-intl instead of an in-component locale table", () => {
    const source = readFileSync(
      new URL("../components/tools/daily-briefing-tool.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('useTranslations("tools.dailyBriefing")');
    expect(source).not.toContain("function copy(");
  });
});
