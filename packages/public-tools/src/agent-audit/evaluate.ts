import type { SeoAuditRecord } from "../seo-audit/types.ts";
import { PAGE_AUDIT_GROUPS, SITE_AUDIT_GROUPS } from "./catalog.ts";
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
  inspectedTargetUrl: string | null,
): SeoAuditRecord {
  if (record.state === "unverified") return record;
  // Already about this page and nothing else, so there is nothing to narrow.
  // Running it through the filter below would drop a clean record's absent
  // observation and report a page that passed as one that was never checked.
  if (record.population === "target_page") return record;

  // Match on the collected page's own URL as well as the submitted one: entry
  // redirects and URL normalisation routinely make them differ, and matching on
  // the submitted form alone reads a page's real problems as a clean pass.
  const targets = new Set(
    [inspectedTargetUrl, targetUrl]
      .map((value) => comparableUrl(value))
      .filter((value): value is string => value !== null),
  );
  const observations =
    record.state === "observed"
      ? record.observations.filter((observation) => {
          const url = comparableUrl(observation.url);
          return url !== null && targets.has(url);
        })
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

  // Absence is evidence about this page only when the rule tested it. That is
  // what `targetTested` answers, and it answers it for a qualifying subset too
  // — the case this used to get wrong. A record that tested only pages with an
  // hreflang alternate says nothing about a page that has none, and everything
  // about one that has three and no broken target; keying on population alone
  // reported both as "not tested", so a correctly-built page came back looking
  // like a hole in the audit.
  return inspectedTargetUrl !== null &&
    (record.targetTested === true ||
      record.population === "every_collected_page")
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
        limitation:
          inspectedTargetUrl === null
            ? "The submitted page was not collected in this crawl."
            : "This condition was only tested on pages meeting a precondition the target may not meet.",
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
      input.targetInspected === true
        ? (input.inspectedTargetUrl ?? input.targetUrl!)
        : null,
    ),
  );
}

/**
 * Sibling records of one check measure the same population, so their counts are
 * de-duplicated rather than summed: a page missing both a title and an H1 is one
 * affected page, and 100 pages tested twice are still 100 tested units.
 */
/** Renders an aggregate in the unit its label declares, so it reads as measured. */
function formatAggregate(label: string, value: number): [string, string] {
  if (label.endsWith("_share")) {
    const pct = `${(value * 100).toFixed(1)}%`;
    return [pct, pct];
  }
  if (label.endsWith("_ms"))
    return [`${Math.round(value)} ms`, `${Math.round(value)} 毫秒`];
  // A unitless score needs its own precision. One decimal renders a CLS of
  // 0.05 as "0.1" — the pass boundary itself — so a page comfortably inside
  // the good band displays as sitting exactly on the line.
  if (label.endsWith("_score")) {
    const score = value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    return [score, score];
  }
  const rounded = value.toFixed(1).replace(/\.0$/, "");
  return [rounded, rounded];
}

function measurement(
  records: readonly SeoAuditRecord[],
  check: AgentAuditCheckDefinition,
): AgentAuditLocalizedText {
  // A check whose published threshold is about the population as a whole must
  // display that same aggregate. Counting affected observations here would show
  // "1 affected" for every average, which is neither the executed number nor a
  // fact about the site.
  const aggregate = check.issueRules.find(
    (rule) => rule.kind === "aggregate-max" || rule.kind === "aggregate-min",
  );
  if (aggregate !== undefined) {
    const source = records.find((entry) => entry.id === aggregate.recordId);
    const value = source ? namedValue(source, aggregate.label) : null;
    if (source !== undefined && value !== null) {
      const [en, zh] = formatAggregate(aggregate.label, value);
      return l(
        `${en} across ${source.tested} measured units`,
        `${source.tested} 个已测单元上为 ${zh}`,
      );
    }
  }

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

/** The single finite number a record publishes under a label, or null. */
function namedValue(record: SeoAuditRecord, label: string): number | null {
  for (const observation of record.observations) {
    for (const entry of observation.values) {
      if (entry.label !== label) continue;
      if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
        continue;
      }
      return entry.value;
    }
  }
  return null;
}

type RecordIssueSeverity = "none" | "degraded" | "full" | "unmeasured";

/** Applies the check's published threshold to one record. */
function issueSeverity(
  record: SeoAuditRecord,
  check: AgentAuditCheckDefinition,
): RecordIssueSeverity {
  if (record.state !== "observed" || record.affected === 0) return "none";

  const rule = check.issueRules.find((entry) => entry.recordId === record.id);
  if (rule === undefined) return "full";

  if (
    rule.kind === "affected-ratio" ||
    rule.kind === "affected-ratio-at-most"
  ) {
    if (record.tested <= 0) return "full";
    const share = record.affected / record.tested;
    const passes =
      rule.kind === "affected-ratio"
        ? share < rule.passBelow
        : share <= rule.passAtOrBelow;
    if (passes) return "none";
    if (rule.failAbove === undefined || share > rule.failAbove) return "full";
    return "degraded";
  }

  if (rule.kind === "aggregate-max" || rule.kind === "aggregate-min") {
    const aggregate = namedValue(record, rule.label);
    // An aggregate the detector did not compute must never read as "within the
    // limit": there is no number to compare, which is a gap, not a pass.
    if (aggregate === null) return "unmeasured";
    if (rule.kind === "aggregate-max") {
      const passes =
        rule.passAtOrBelow !== undefined
          ? aggregate <= rule.passAtOrBelow
          : rule.passBelow !== undefined
            ? aggregate < rule.passBelow
            : // Neither bound set is a catalogue defect, not a passing site.
              false;
      if (passes) return "none";
      if (rule.failAbove === undefined || aggregate > rule.failAbove) {
        return "full";
      }
      return "degraded";
    }
    if (aggregate >= rule.passAtOrAbove) return "none";
    if (rule.failBelow === undefined || aggregate < rule.failBelow) {
      return "full";
    }
    return "degraded";
  }

  // Every affected observation has to carry a readable measurement. A missing or
  // non-numeric value means the rule could not be applied, and an unapplied rule
  // must never be reported as "within the limit".
  let comparable = 0;
  let exceeds = false;
  for (const observation of record.observations) {
    for (const entry of observation.values) {
      if (entry.label !== rule.label) continue;
      if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
        continue;
      }
      comparable += 1;
      if (entry.value > rule.max) exceeds = true;
    }
  }
  if (exceeds) return "full";
  return comparable === record.observations.length ? "none" : "unmeasured";
}

/**
 * The softer state for a measurement past the pass mark but under the fail mark.
 *
 * One step below whatever this check's failure is, rather than a fixed Tip.
 * The fixed version was right only for checks that fail at Warning: on a check
 * that fails at Blocker it rendered the middle band as a Tip, so A1 — whose
 * published sentence reads "at least 90%; below 70% is Blocker, 70-90% is
 * Warning" — reported a site sitting at 80% index coverage as a Tip. The
 * threshold the reader is shown and the severity the product executes have to
 * be the same sentence.
 */
function degradedResult(
  check: AgentAuditCheckDefinition,
): AgentAuditResultState {
  if (check.blockerEvidenceRecordIds.length > 0) return "warning";
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
  if (
    records.length === 0 ||
    records.every((record) => record.state === "unverified")
  ) {
    return {
      check,
      result: "excluded",
      engine:
        // A missing source outranks a present detector. Once these checks got
        // detectors, `inventoryReady` started reporting an unauthorized run as
        // "needs supplement", which reads as our gap when it is an
        // authorization the visitor can grant in a minute.
        check.engine === "access-required" || check.engine === "not-integrated"
          ? check.engine
          : records.length > 0 || check.inventoryReady
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
  if (severities.includes("unmeasured")) {
    return {
      check,
      result: "excluded",
      engine: "needs-supplement",
      truth: "partial",
      measurement: measurement(records, check),
      evidenceRecordIds: records.map((record) => record.id),
      scoreValue: null,
      scoreContribution: null,
    };
  }
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
    measurement: measurement(records, check),
    evidenceRecordIds: records.map((record) => record.id),
    scoreValue,
    scoreContribution:
      scoreValue === null ? null : scoreValue * check.scoreWeight,
  };
}

function groupHealth(
  checks: readonly AgentAuditEvaluatedCheck[],
): number | null {
  const scored = checks.filter(
    (check) => check.check.scored && check.scoreValue !== null,
  );
  if (scored.length === 0) return null;
  const weight = scored.reduce(
    (total, check) => total + check.check.scoreWeight,
    0,
  );
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
