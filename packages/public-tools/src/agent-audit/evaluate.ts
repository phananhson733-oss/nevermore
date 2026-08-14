import type { SeoAuditRecord } from "../seo-audit/types.ts";
import {
  PAGE_AUDIT_GROUPS,
  SITE_AUDIT_GROUPS,
} from "./catalog.ts";
import type {
  AgentAuditCheckDefinition,
  AgentAuditEvaluatedCheck,
  AgentAuditEvaluatedGroup,
  AgentAuditEvaluation,
  AgentAuditEvidenceInput,
  AgentAuditGroupDefinition,
  AgentAuditLocalizedText,
  AgentAuditResultState,
  AgentAuditScope,
  AgentAuditTruthState,
} from "./types.ts";

const l = (en: string, zh: string): AgentAuditLocalizedText => ({ en, zh });

function comparableUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Re-express a site-wide record as what it says about one page.
 *
 * A record the crawl never ran stays unverified. Otherwise the target either
 * appears in the issue list, or it does not — and "does not" is a clean result
 * for the target only when the target itself was inspected.
 */
function projectRecordToTarget(
  record: SeoAuditRecord,
  targetUrl: string,
  targetInspected: boolean,
): SeoAuditRecord {
  if (record.state === "unverified") return record;

  const target = comparableUrl(targetUrl);
  const observations =
    record.state === "observed"
      ? record.observations.filter(
          (observation) => comparableUrl(observation.url) === target,
        )
      : [];

  if (observations.length > 0) {
    return {
      ...record,
      state: "observed",
      tested: 1,
      affected: observations.length,
      observations,
    };
  }

  return targetInspected
    ? {
        ...record,
        state: "not_observed",
        tested: 1,
        affected: 0,
        observations: [],
      }
    : {
        ...record,
        state: "unverified",
        tested: 0,
        affected: 0,
        observations: [],
        limitation: "No target-specific observation in the bounded site crawl.",
      };
}

function matchingRecords(
  check: AgentAuditCheckDefinition,
  input: AgentAuditEvidenceInput,
): readonly SeoAuditRecord[] {
  const ids = new Set(check.evidenceRecordIds);
  const records = input.records.filter((record) => ids.has(record.id));
  if (check.scope !== "page") return records;
  if (!input.targetUrl || comparableUrl(input.targetUrl) === null) return [];
  return records.map((record) =>
    projectRecordToTarget(
      record,
      input.targetUrl!,
      input.targetInspected === true,
    ),
  );
}

/**
 * Sibling records of one check measure the same population, so their counts are
 * de-duplicated rather than summed: a page missing both a title and an H1 is one
 * affected page, and 100 pages tested twice are still 100 tested units.
 */
function measurement(records: readonly SeoAuditRecord[]): AgentAuditLocalizedText {
  const affectedUrls = new Set<string>();
  let siteLevelAffected = 0;
  for (const record of records) {
    for (const observation of record.observations) {
      if (observation.url === null) siteLevelAffected += 1;
      else affectedUrls.add(observation.url);
    }
  }
  const affected = affectedUrls.size + siteLevelAffected;
  const tested = records.reduce(
    (highest, record) => Math.max(highest, record.tested),
    0,
  );
  return l(
    `${affected} affected observations across ${tested} tested units`,
    `${tested} 个测试单元中有 ${affected} 个受影响观测`,
  );
}

type RecordIssueSeverity = "none" | "degraded" | "full";

/** Applies the check's published threshold to one record. */
function issueSeverity(
  record: SeoAuditRecord,
  check: AgentAuditCheckDefinition,
): RecordIssueSeverity {
  if (record.state !== "observed" || record.affected === 0) return "none";

  const rule = check.issueRules.find((entry) => entry.recordId === record.id);
  if (rule === undefined) return "full";

  if (rule.kind === "affected-ratio") {
    if (record.tested <= 0) return "full";
    const share = record.affected / record.tested;
    if (share < rule.passBelow) return "none";
    if (rule.failAbove === undefined || share > rule.failAbove) return "full";
    return "degraded";
  }

  return record.observations.some((observation) =>
    observation.values.some(
      (entry) =>
        entry.label === rule.label &&
        typeof entry.value === "number" &&
        entry.value > rule.max,
    ),
  )
    ? "full"
    : "none";
}

/** The softer state for a measurement past the pass mark but under the fail mark. */
function degradedResult(
  check: AgentAuditCheckDefinition,
): AgentAuditResultState {
  return check.failureResult === "warning" ? "tip" : check.failureResult;
}

function failureState(
  check: AgentAuditCheckDefinition,
  issueRecordIds: ReadonlySet<string>,
): AgentAuditResultState {
  return check.blockerEvidenceRecordIds.some((id) => issueRecordIds.has(id))
    ? "blocker"
    : check.failureResult;
}

function evaluateCheck(
  check: AgentAuditCheckDefinition,
  input: AgentAuditEvidenceInput,
): AgentAuditEvaluatedCheck {
  const records = matchingRecords(check, input);
  if (input.availability === "unavailable") {
    return {
      check,
      result: "excluded",
      engine: check.engine === "ready" ? "needs-supplement" : check.engine,
      truth:
        check.engine === "access-required" || check.engine === "not-integrated"
          ? "source-gated"
          : "unavailable",
      measurement: null,
      evidenceRecordIds: [],
      scoreValue: null,
      scoreContribution: null,
    };
  }
  if (records.length === 0 || records.every((record) => record.state === "unverified")) {
    return {
      check,
      result: "excluded",
      engine:
        records.length > 0 || check.inventoryReady
          ? "needs-supplement"
          : check.engine,
      truth:
        check.engine === "access-required" || check.engine === "not-integrated"
          ? "source-gated"
          : records.length > 0 || input.availability === "partial"
            ? "partial"
            : "unavailable",
      measurement: null,
      evidenceRecordIds: records.map((record) => record.id),
      scoreValue: null,
      scoreContribution: null,
    };
  }
  const severities = records.map((record) => issueSeverity(record, check));
  const failingRecords = records.filter(
    (_, index) => severities[index] === "full",
  );
  const result =
    failingRecords.length > 0
      ? failureState(check, new Set(failingRecords.map((record) => record.id)))
      : severities.includes("degraded")
        ? degradedResult(check)
        : "pass";

  // A tested population with nothing affected is a real pass, but it stays
  // labelled by how it was learned: the crawl is bounded, so "not observed in
  // the sample" never claims the condition is absent site-wide.
  const truth: AgentAuditTruthState =
    input.availability === "partial"
      ? "partial"
      : records.some((record) => record.state === "observed")
        ? "observed"
        : "not-observed";

  const scoreValue = !check.scored
    ? null
    : result === "pass"
      ? 1
      : result === "tip"
        ? 0.5
        : 0;

  return {
    check,
    result,
    engine: "ready",
    truth,
    measurement: measurement(records),
    evidenceRecordIds: records.map((record) => record.id),
    scoreValue,
    scoreContribution:
      scoreValue === null ? null : scoreValue * check.scoreWeight,
  };
}

function groupHealth(checks: readonly AgentAuditEvaluatedCheck[]): number | null {
  const scored = checks.filter(
    (check) => check.check.scored && check.scoreValue !== null,
  );
  if (scored.length === 0) return null;
  const weight = scored.reduce((total, check) => total + check.check.scoreWeight, 0);
  const earned = scored.reduce(
    (total, check) => total + (check.scoreContribution ?? 0),
    0,
  );
  return Math.round((earned / weight) * 100);
}

function evaluateGroup(
  group: AgentAuditGroupDefinition,
  input: AgentAuditEvidenceInput,
): AgentAuditEvaluatedGroup {
  const checks = group.checks.map((check) => evaluateCheck(check, input));
  return { group, checks, health: groupHealth(checks) };
}

export function evaluateAgentAuditScope(
  scope: AgentAuditScope,
  input: AgentAuditEvidenceInput,
): AgentAuditEvaluation {
  const definitions = scope === "site" ? SITE_AUDIT_GROUPS : PAGE_AUDIT_GROUPS;
  const groups = definitions.map((group) => evaluateGroup(group, input));
  const checks = groups.flatMap((group) => group.checks);
  const scoredGroups = groups.filter(
    (group) => group.group.weight !== null && group.health !== null,
  );
  const totalGroupWeight = scoredGroups.reduce(
    (total, group) => total + (group.group.weight ?? 0),
    0,
  );
  const health =
    totalGroupWeight === 0
      ? null
      : Math.round(
          scoredGroups.reduce(
            (total, group) =>
              total + (group.health ?? 0) * (group.group.weight ?? 0),
            0,
          ) / totalGroupWeight,
        );

  return {
    scope,
    groups,
    checks,
    blockers: checks.filter((check) => check.result === "blocker").length,
    health,
    evaluated: checks.filter((check) => check.result !== "excluded").length,
    excluded: checks.filter((check) => check.result === "excluded").length,
    enginesReady: checks.filter((check) => check.engine === "ready").length,
  };
}
