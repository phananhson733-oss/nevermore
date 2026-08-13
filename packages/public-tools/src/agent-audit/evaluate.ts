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

function projectRecordToTarget(
  record: SeoAuditRecord,
  targetUrl: string,
): SeoAuditRecord {
  if (record.state !== "observed") return record;
  const target = comparableUrl(targetUrl);
  const observations = record.observations.filter(
    (observation) => comparableUrl(observation.url) === target,
  );
  if (observations.length === 0) {
    return {
      ...record,
      state: "unverified",
      tested: 0,
      affected: 0,
      observations: [],
      limitation: "No target-specific observation in the bounded site crawl.",
    };
  }
  return {
    ...record,
    tested: Math.max(1, observations.length),
    affected: observations.length,
    observations,
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
  return records.map((record) => projectRecordToTarget(record, input.targetUrl!));
}

function measurement(records: readonly SeoAuditRecord[]): AgentAuditLocalizedText {
  const affected = records.reduce((total, record) => total + record.affected, 0);
  const tested = records.reduce((total, record) => total + record.tested, 0);
  return l(
    `${affected} affected observations across ${tested} tested units`,
    `${tested} 个测试单元中有 ${affected} 个受影响观测`,
  );
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
  if (records.every((record) => record.state === "not_observed")) {
    return {
      check,
      result: "excluded",
      engine: "ready",
      truth: "not-observed",
      measurement: measurement(records),
      evidenceRecordIds: records.map((record) => record.id),
      scoreValue: null,
      scoreContribution: null,
    };
  }

  const issueRecords = records.filter(
    (record) => record.state === "observed" && record.affected > 0,
  );
  const result =
    issueRecords.length > 0
      ? failureState(check, new Set(issueRecords.map((record) => record.id)))
      : "pass";
  const scoreValue =
    !check.scored
      ? null
      : result === "pass"
        ? 1
        : result === "tip"
          ? 0.5
          : result === "warning"
            ? 0
            : null;
  return {
    check,
    result,
    engine: "ready",
    truth: input.availability === "partial" ? "partial" : "observed",
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
  let health =
    totalGroupWeight === 0
      ? null
      : Math.round(
          scoredGroups.reduce(
            (total, group) =>
              total + (group.health ?? 0) * (group.group.weight ?? 0),
            0,
          ) / totalGroupWeight,
        );
  if (health === 100 && checks.some((check) => check.result === "excluded")) {
    health = 99;
  }

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
