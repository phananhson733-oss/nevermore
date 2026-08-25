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
  "first_observed",
] as const;

const PROPERTY_CHANGE_KINDS = [
  "sitewide_click_decline",
  "sitewide_visibility_decline",
  "sitewide_visibility_gain",
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
  "review.title",
  "review.intro",
  "review.empty",
  "review.partial",
  "review.unavailable",
  "review.pageUnavailable",
  "review.observationKinds.evaluation_eligible.title",
  "review.observationKinds.evaluation_eligible.body",
  "review.observationKinds.sample_building.title",
  "review.observationKinds.sample_building.body",
  "review.columns.status",
  "review.columns.queryPage",
  "review.columns.clicks",
  "review.columns.position",
  "review.columns.interpretation",
  "evidence.title",
  "evidence.thresholdSummary",
  "evidence.filteredComplete",
  "evidence.filteredPartial",
  "evidence.coverageTitle",
  "evidence.coverageObserved",
  "evidence.coverageUnavailable",
  "evidence.anonymizationTitle",
  "evidence.anonymizationObserved",
  "evidence.anonymizationUnavailable",
  "evidence.signalFunnel.title",
  "evidence.signalFunnel.intro",
  "evidence.signalFunnel.laneUnavailable",
  "evidence.signalFunnel.lanes.ctrBaseline.title",
  "evidence.signalFunnel.lanes.ctrBaseline.body",
  "evidence.signalFunnel.lanes.ctrBaseline.notEvaluated",
  "evidence.signalFunnel.lanes.clickOpportunity.title",
  "evidence.signalFunnel.lanes.clickOpportunity.body",
  "evidence.signalFunnel.lanes.stableDecline.title",
  "evidence.signalFunnel.lanes.stableDecline.body",
  "evidence.signalFunnel.lanes.firstObserved.title",
  "evidence.signalFunnel.lanes.firstObserved.body",
  "evidence.signalFunnel.lanes.pageAttribution.title",
  "evidence.signalFunnel.lanes.pageAttribution.body",
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
  const child = value[key];
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
      expect(
        propertyActionKinds[kind],
        `missing property action kind ${kind}`,
      ).toEqual(expect.any(Object));
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

  it("uses the approved evidence-yield vocabulary and placeholders", () => {
    const enNoise = recordAt(daily(en), "noise");
    const zhNoise = recordAt(daily(zh), "noise");

    expect(placeholders(enNoise.observed)).toEqual([
      "eligible",
      "observations",
      "observed",
      "selected",
      "trend",
    ]);
    expect(placeholders(zhNoise.observed)).toEqual(
      placeholders(enNoise.observed),
    );
    expect(String(enNoise.observed)).toContain("evaluation sample floor");
    expect(String(zhNoise.observed)).toContain("可评估样本门槛");
    expect(String(enNoise.observed)).not.toContain("action sample floor");
    expect(String(zhNoise.observed)).not.toContain("动作样本门槛");
    expect(String(enNoise.observed)).not.toContain("fallback");
    expect(String(zhNoise.observed)).not.toContain("回退");
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
