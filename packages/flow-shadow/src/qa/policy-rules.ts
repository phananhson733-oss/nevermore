import type { QaContext } from "./context.ts";
import {
  evidenceSourceDescription,
  findEvidenceTextMatch,
  type EvidenceTextMatch,
} from "./evidence.ts";
import {
  classifyBroadFactualClaim,
  isExplicitExternalResearchStatement,
  isFirstPartyStatement,
} from "./factual-claims.ts";
import { fail, pass, unevaluable, type QaRuleResult } from "./rule-types.ts";
import { QA_THRESHOLDS } from "./thresholds.ts";
import {
  paragraphBlocks,
  stripInlineCode,
  truncateExcerpt,
} from "./text.ts";

const DEFAULT_HYPE_TERMS: readonly string[] = [
  "best-in-class",
  "breakthrough",
  "cutting-edge",
  "effortless",
  "game-changing",
  "groundbreaking",
  "magical",
  "revolutionary",
  "transformative",
  "unmatched",
  "unparalleled",
  "world-class",
];

const DEFAULT_CLAIM_RESTRICTIONS: readonly string[] = [
  "no_guarantees",
  "no_unsupported_quantified_claims",
  "no_unverified_superlatives",
];

const MAX_POLICY_ITEMS = 64;
const MAX_POLICY_ITEM_CHARS = 300;
const MAX_EXCLAMATIONS = 2;

interface PolicyFinding {
  readonly line: number;
  readonly label: string;
  readonly excerpt: string;
}

interface SupportedStatement {
  readonly statement: string;
  readonly match: EvidenceTextMatch;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizedPolicyValues(values: readonly string[]): {
  readonly values: readonly string[];
  readonly bounded: boolean;
} {
  let bounded = values.length > MAX_POLICY_ITEMS;
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const raw of values.slice(0, MAX_POLICY_ITEMS)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > MAX_POLICY_ITEM_CHARS) bounded = true;
    const value = trimmed.slice(0, MAX_POLICY_ITEM_CHARS);
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(value);
  }
  kept.sort(compareText);
  return { values: kept, bounded };
}

function findingList(findings: readonly PolicyFinding[]): string {
  const shown = findings.slice(0, QA_THRESHOLDS.maxReportedFindings);
  const rendered = shown
    .map(
      (finding) =>
        `line ${finding.line} ${finding.label}: "${truncateExcerpt(finding.excerpt, QA_THRESHOLDS.maxExcerptChars)}"`,
    )
    .join("; ");
  const hidden = findings.length - shown.length;
  return hidden > 0 ? `${rendered}; and ${hidden} more` : rendered;
}

function bodyRows(context: QaContext): readonly {
  readonly line: number;
  readonly text: string;
}[] {
  return context.body
    .map((entry) => ({
      line: entry.line,
      text: stripInlineCode(entry.text),
    }))
    .filter((entry) => entry.text.trim().length > 0);
}

export function checkBrandVoice(context: QaContext): QaRuleResult {
  const prohibited = normalizedPolicyValues(
    context.input.pack.policy.prohibitedTerms,
  );
  const constraints = normalizedPolicyValues(
    context.input.pack.policy.brandConstraints,
  );
  const terms = normalizedPolicyValues([
    ...DEFAULT_HYPE_TERMS,
    ...prohibited.values,
  ]);
  const findings: PolicyFinding[] = [];
  let exclamations = 0;
  for (const row of bodyRows(context)) {
    const lower = row.text.toLowerCase();
    for (const term of terms.values) {
      if (lower.includes(term.toLowerCase())) {
        findings.push({
          line: row.line,
          label: prohibited.values.some(
            (candidate) => candidate.toLowerCase() === term.toLowerCase(),
          )
            ? `prohibited term "${term}"`
            : `default hype term "${term}"`,
          excerpt: row.text,
        });
      }
    }
    const marks = row.text.match(/!/g)?.length ?? 0;
    exclamations += marks;
    if (/!{3,}/.test(row.text)) {
      findings.push({
        line: row.line,
        label: "excessive exclamation run",
        excerpt: row.text,
      });
    }
  }
  if (
    exclamations > MAX_EXCLAMATIONS &&
    !findings.some((finding) => finding.label === "excessive exclamation run")
  ) {
    findings.push({
      line: 1,
      label: `${exclamations} exclamation marks`,
      excerpt: "Exclamation marks are over the default brand-voice ceiling.",
    });
  }

  if (findings.length > 0) {
    return fail(
      "rl14_brand_voice",
      "rl14_brand_voice_violation",
      `Brand-voice review found ${findings.length} deterministic issue(s): ${findingList(findings)}. The default check covers hype/prohibited literal terms and more than ${MAX_EXCLAMATIONS} exclamation marks; it does not infer tone or author identity.`,
    );
  }

  if (constraints.values.length > 0) {
    return unevaluable(
      "rl14_brand_voice",
      "rl14_brand_constraint_human_review",
      `The literal hype, prohibited-term and exclamation checks passed. ${constraints.values.length} free-text brand constraint(s) cannot be judged deterministically and require human review: ${constraints.values.map((constraint) => `"${truncateExcerpt(constraint, 160)}"`).join("; ")}. This result does not pretend a vocabulary scan can determine whether prose sounds ${constraints.values.length === 1 ? "like the requested voice" : "consistent with every requested voice constraint"}.`,
    );
  }

  if (prohibited.bounded || constraints.bounded || terms.bounded) {
    return unevaluable(
      "rl14_brand_voice",
      "rl14_brand_policy_bounded",
      `No issue appeared inside the policy bound, but not every policy item was judged. At most ${MAX_POLICY_ITEMS} entries and ${MAX_POLICY_ITEM_CHARS} characters per entry are scanned, so brand voice requires human review.`,
    );
  }

  return pass(
    "rl14_brand_voice",
    "rl14_brand_voice_clean",
    `The body contains none of the ${DEFAULT_HYPE_TERMS.length} default hype terms or configured prohibited terms and carries ${exclamations} exclamation mark(s) (ceiling ${MAX_EXCLAMATIONS}). No free-text brand constraint remains for machine judgement.`,
  );
}

interface RestrictionViolation extends PolicyFinding {
  readonly restriction: string;
}

function statementPieces(context: QaContext): readonly {
  readonly line: number;
  readonly text: string;
}[] {
  const statements: { line: number; text: string }[] = [];
  for (const block of paragraphBlocks(context.body)) {
    for (const match of block.text.matchAll(/[^.!?]+(?:[.!?]+|$)/g)) {
      const text = stripInlineCode(match[0]).trim();
      if (text.length > 0) statements.push({ line: block.line, text });
    }
  }
  return statements;
}

function hasIndependentRankingSignal(match: EvidenceTextMatch): boolean {
  return /\b(?:ranked|ranking|number\s+one|top[- ]rated|highest\s+score|#\s*1)\b/i.test(
    match.source.contentText ?? "",
  );
}

export function checkClaimRestrictions(context: QaContext): QaRuleResult {
  const configured = normalizedPolicyValues(
    context.input.pack.policy.claimRestrictions,
  );
  const compliance = normalizedPolicyValues(
    context.input.pack.policy.complianceConstraints,
  );
  const enabled = new Set([...DEFAULT_CLAIM_RESTRICTIONS, ...configured.values]);
  const unknown = configured.values.filter(
    (restriction) => !DEFAULT_CLAIM_RESTRICTIONS.includes(restriction),
  );
  const violations: RestrictionViolation[] = [];
  const supported: SupportedStatement[] = [];
  let boundedEvidence = false;

  for (const statement of statementPieces(context)) {
    const kind = classifyBroadFactualClaim(statement.text);
    if (kind === null) continue;
    if (kind === "guarantee" && enabled.has("no_guarantees")) {
      violations.push({
        line: statement.line,
        label: "guarantee",
        excerpt: statement.text,
        restriction: "no_guarantees",
      });
      continue;
    }
    if (
      kind === "quantified" &&
      enabled.has("no_unsupported_quantified_claims")
    ) {
      const explicitlyFirstParty = isFirstPartyStatement(statement.text);
      const explicitlyExternal =
        !explicitlyFirstParty &&
        isExplicitExternalResearchStatement(statement.text);
      const externalEvidence = explicitlyFirstParty
        ? null
        : findEvidenceTextMatch(context.index, statement.text, "external");
      const firstPartyEvidence =
        explicitlyExternal ||
        (externalEvidence !== null && externalEvidence.match !== null)
          ? null
          : findEvidenceTextMatch(context.index, statement.text, "first_party");
      const evidence =
        externalEvidence !== null && externalEvidence.match !== null
          ? externalEvidence
          : firstPartyEvidence ??
            externalEvidence ?? {
              match: null,
              candidateCount: 0,
              bounded: false,
            };
      const firstParty =
        explicitlyFirstParty ||
        (firstPartyEvidence !== null && firstPartyEvidence.match !== null);
      boundedEvidence ||=
        (externalEvidence?.bounded ?? false) ||
        (firstPartyEvidence?.bounded ?? false);
      if (evidence.match !== null) {
        supported.push({ statement: statement.text, match: evidence.match });
      } else {
        violations.push({
          line: statement.line,
          label: firstParty
            ? "unsupported customer-owned quantified claim; site identity is not evidence"
            : explicitlyExternal
              ? "unsupported external quantified claim"
              : "unsupported quantified claim; no captured first-party or external page aligns",
          excerpt: statement.text,
          restriction: "no_unsupported_quantified_claims",
        });
      }
      continue;
    }
    if (
      kind === "superlative" &&
      enabled.has("no_unverified_superlatives")
    ) {
      const evidence = findEvidenceTextMatch(
        context.index,
        statement.text,
        "external",
      );
      boundedEvidence ||= evidence.bounded;
      if (
        evidence.match !== null &&
        hasIndependentRankingSignal(evidence.match)
      ) {
        supported.push({ statement: statement.text, match: evidence.match });
      } else {
        violations.push({
          line: statement.line,
          label: isFirstPartyStatement(statement.text)
            ? "unverified superlative; first-party content is not external evidence"
            : "unverified superlative",
          excerpt: statement.text,
          restriction: "no_unverified_superlatives",
        });
      }
    }
  }

  if (violations.length > 0) {
    const grouped = [...new Set(violations.map((hit) => hit.restriction))].sort(
      compareText,
    );
    return fail(
      "rl15_claim_restrictions",
      "rl15_claim_restriction_violation",
      `Claim restriction violation(s) [${grouped.join(", ")}]: ${findingList(violations)}. A captured first-party page may support an exact customer-owned statement, but first-party site identity cannot; external factual or ranking claims require external page evidence. This is deterministic evidence alignment, not a full semantic fact-check.${unknown.length > 0 || compliance.values.length > 0 ? ` Human review is also required for free-text constraint(s): ${[...unknown, ...compliance.values].map((value) => `"${truncateExcerpt(value, 140)}"`).join("; ")}.` : ""}`,
    );
  }

  if (
    unknown.length > 0 ||
    compliance.values.length > 0 ||
    configured.bounded ||
    compliance.bounded ||
    boundedEvidence
  ) {
    const freeText = [...unknown, ...compliance.values];
    return unevaluable(
      "rl15_claim_restrictions",
      "rl15_claim_restriction_human_review",
      `The machine-checkable restrictions found no violation, but human review remains: ${freeText.length > 0 ? freeText.map((value) => `"${truncateExcerpt(value, 160)}"`).join("; ") : "a policy or evidence bound prevented the complete input from being judged"}. Free-text compliance meaning and semantic truth cannot be determined by this lexical gate.`,
    );
  }

  const evidenceDetail =
    supported.length === 0
      ? "No restricted claim shape needed evidence."
      : `Supported customer/external statement(s) resolve to ${[
          ...new Set(
            supported.map((entry) =>
              evidenceSourceDescription(entry.match.source),
            ),
          ),
        ].join("; ")}.`;
  return pass(
    "rl15_claim_restrictions",
    "rl15_claim_restrictions_satisfied",
    `The enforced restrictions [${[...enabled].sort(compareText).join(", ")}] found no guarantee, unsupported quantified claim, or unverified superlative. ${evidenceDetail}`,
  );
}
