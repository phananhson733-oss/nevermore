import {
  AUTO_KEYWORD_GOVERNANCE_VERSION,
  KeywordGovernanceIntegrityError,
  KeywordGovernanceRepository,
  KeywordsRepository,
  MAX_AUTO_GOVERNANCE_CANDIDATE_READ,
  MAX_SYSTEM_KEYWORD_GOVERNANCE_BATCH,
  type AutoGovernanceCandidateRow,
  type DbTx,
  type DiagnosticGovernanceLoad,
  type ProjectScope,
  type SystemKeywordApprovalInput,
  type SystemKeywordApprovalSkip,
} from "@sf/db";
import { CLUSTER_KEY_VERSION, clusterKey } from "@sf/sources";
import { DIAGNOSTIC_GOVERNANCE_LIMITS } from "./governance.ts";

/**
 * How many untouched candidates one Analysis Refresh may govern. This runs
 * inside the already-open Growth Audit transaction, so the write volume is
 * bounded well below the repository read ceiling; a larger library converges
 * over consecutive runs instead of holding one long transaction.
 */
export const MAX_AUTO_GOVERNED_KEYWORDS_PER_RUN = Math.min(
  MAX_SYSTEM_KEYWORD_GOVERNANCE_BATCH,
  MAX_AUTO_GOVERNANCE_CANDIDATE_READ,
);

/**
 * Headroom this pass refuses to spend, in eligible keyword entities.
 *
 * Automated governance and `freezeDiagnosticGovernance` share ONE transaction,
 * so a freeze that overflows its hard ceiling also rolls the approvals back —
 * and the next Analysis Refresh reads the same candidates in the same id order
 * and overflows again, wedging the Growth Audit forever while the committed
 * database still looks under the ceiling. The reserve keeps a run from
 * approving right up to the edge, where an operator review or a concurrent
 * ingestion landing between this budget read and the freeze would tip it over.
 */
export const AUTO_GOVERNANCE_ENTITY_SAFETY_RESERVE = 50;

/** The same reserve for occurrence references. See the entity reserve. */
export const AUTO_GOVERNANCE_OCCURRENCE_SAFETY_RESERVE = 500;

/**
 * Minimum immutable DataForSEO evidence.
 *
 * DataForSEO `ranked_keywords` answers "which queries does THIS domain already
 * hold a SERP position for", so a single occurrence whose Observation carries
 * `currentRank >= 1` is already the provider asserting that this project's site
 * competes for the query. There is nothing to average or corroborate, so the
 * gate is presence of one such immutable row — not a tuned score. Rank 0 or
 * null is not a SERP position and never counts.
 */
const MIN_DATAFORSEO_RANKED_EVIDENCE = 1;

/**
 * Minimum immutable Search Console evidence.
 *
 * Search Console legitimately returns zero-impression query rows, and a
 * zero-impression row proves only that the query exists in Google's index of
 * the report — not that this site was ever served for it. One impression is
 * Google's own record that the site appeared. Clicks are deliberately NOT
 * required: a high-impression, zero-click query is exactly the opportunity the
 * Growth Map exists to surface.
 */
const MIN_GSC_IMPRESSION_EVIDENCE = 1;

/** Mirrors the `cluster_key_at_decision` database CHECK. */
const MAX_CLUSTER_KEY_LENGTH = 200;

/** Why one candidate produced no automated decision at all. */
export type AutoKeywordGovernanceRejection =
  | "insufficient_evidence"
  | "no_cluster_key";

/**
 * Why an approval the evidence policy accepted was NOT submitted this run.
 *
 * Every value is a fact observed before any write, and every one of them is
 * reported. A withheld candidate keeps its previous governance and is read
 * again by the next Analysis Refresh; nothing is silently dropped.
 */
export type AutoKeywordGovernanceWithholding =
  /** The diagnostic freeze has no room left for another eligible keyword. */
  | "entity_budget_exhausted"
  /** The freeze has no room left for this keyword's occurrence references. */
  | "occurrence_budget_exhausted"
  /**
   * This keyword alone carries more occurrences than the freeze reads per
   * entity, so approving it would make every future freeze fail. It is left
   * ungoverned instead, which is honest and reversible.
   */
  | "occurrence_history_unfreezable"
  /**
   * No immutable occurrence backs this keyword, and the freeze rejects an
   * eligible keyword with no occurrence as corrupt.
   */
  | "occurrence_lineage_absent";

/** What the diagnostic freeze budget looked like before this pass wrote. */
export interface AutoKeywordGovernanceBudget {
  /** Eligible keyword entities already committed, read before any write. */
  readonly eligibleEntities: number;
  /** Occurrence references those entities already contribute. */
  readonly occurrenceRefs: number;
  /** Entities this run was allowed to add, after the safety reserve. */
  readonly entityHeadroom: number;
  /** Occurrence references this run was allowed to add. */
  readonly occurrenceHeadroom: number;
}

/**
 * Why an automated governance pass produced nothing. The Growth Audit
 * continues with the library exactly as it already stands, and this is
 * reported rather than swallowed.
 */
export interface AutoKeywordGovernanceFailure {
  readonly code: string;
  readonly summary: string;
}

export interface AutoKeywordGovernanceReport {
  readonly enabled: boolean;
  /**
   * Untouched candidates read this run. The repository already drops candidates
   * with no qualifying evidence at all, so this counts evidence-bearing rows.
   */
  readonly considered: number;
  /** Candidates the evidence policy would approve, before any budget. */
  readonly proposed: number;
  /** Approvals actually sent to the repository after the freeze budget. */
  readonly submitted: number;
  /** Automated approvals actually appended to the ledger. */
  readonly approved: number;
  readonly rejected: Readonly<Record<AutoKeywordGovernanceRejection, number>>;
  readonly withheld: Readonly<
    Record<AutoKeywordGovernanceWithholding, number>
  >;
  readonly skipped: Readonly<Record<SystemKeywordApprovalSkip, number>>;
  /** Null only when no budget was read (disabled, or the pass failed). */
  readonly budget: AutoKeywordGovernanceBudget | null;
  readonly failure: AutoKeywordGovernanceFailure | null;
}

const EMPTY_REJECTIONS: Readonly<
  Record<AutoKeywordGovernanceRejection, number>
> = Object.freeze({
  insufficient_evidence: 0,
  no_cluster_key: 0,
});

const EMPTY_WITHHOLDINGS: Readonly<
  Record<AutoKeywordGovernanceWithholding, number>
> = Object.freeze({
  entity_budget_exhausted: 0,
  occurrence_budget_exhausted: 0,
  occurrence_history_unfreezable: 0,
  occurrence_lineage_absent: 0,
});

const EMPTY_SKIPS: Readonly<Record<SystemKeywordApprovalSkip, number>> =
  Object.freeze({
    keyword_absent: 0,
    human_decision_exists: 0,
    already_reviewed: 0,
    revision_moved: 0,
    revision_exhausted: 0,
    site_page_absent: 0,
    ledger_unreadable: 0,
  });

const EMPTY_REPORT: AutoKeywordGovernanceReport = Object.freeze({
  enabled: false,
  considered: 0,
  proposed: 0,
  submitted: 0,
  approved: 0,
  rejected: EMPTY_REJECTIONS,
  withheld: EMPTY_WITHHOLDINGS,
  skipped: EMPTY_SKIPS,
  budget: null,
  failure: null,
});

/**
 * Turn a thrown automated-governance failure into the same honest report shape
 * the success path produces, so the caller can log one thing and carry on.
 *
 * The caller MUST still freeze and create the Growth Audit: the Keyword Library
 * simply stays at the governance it already had, which is an existing and
 * truthful state. Losing an entire diagnostic because a best-effort governance
 * pass threw would be the strictly worse failure.
 */
export function autoKeywordGovernanceFailureReport(
  error: unknown,
): AutoKeywordGovernanceReport {
  const code =
    error instanceof KeywordGovernanceIntegrityError
      ? `AUTO_KEYWORD_GOVERNANCE_${error.code}`
      : error instanceof RangeError
        ? "AUTO_KEYWORD_GOVERNANCE_BOUND_EXCEEDED"
        : "AUTO_KEYWORD_GOVERNANCE_FAILED";
  return {
    ...EMPTY_REPORT,
    enabled: true,
    failure: {
      code,
      summary:
        "Automated keyword governance produced no decision this run. " +
        "The Keyword Library keeps the governance it already had and the " +
        "Growth Audit continues from it.",
    },
  };
}

/**
 * The policy gate. The repository read already enforces the presence floor in
 * SQL so evidence-free candidates cannot starve the page, but the thresholds
 * themselves live here, where they can be raised without touching a query.
 */
function hasProviderEvidence(candidate: AutoGovernanceCandidateRow): boolean {
  return (
    candidate.dataforseo_ranked_evidence >= MIN_DATAFORSEO_RANKED_EVIDENCE ||
    candidate.gsc_impression_evidence >= MIN_GSC_IMPRESSION_EVIDENCE
  );
}

/**
 * Reuse the Search Console page attribution that was already proven at persist
 * time: `resolveObservationSitePageLineage` attaches a Site Page id only for an
 * unambiguous exact canonical subject and persists null otherwise. Exactly one
 * distinct attributed page is therefore proof, not a guess; zero pages or two
 * conflicting pages leave the keyword unassigned.
 *
 * DataForSEO keyword Observations are never page-attributed at persist time, so
 * a DataForSEO-only keyword is always left unassigned. `unassigned` still
 * satisfies all three diagnostic-freeze conditions, so visibility is unaffected.
 */
function mappedSitePageId(
  candidate: AutoGovernanceCandidateRow,
): string | null {
  return candidate.gsc_impression_evidence >= MIN_GSC_IMPRESSION_EVIDENCE &&
    candidate.gsc_attributed_site_page_count === 1
    ? candidate.gsc_attributed_site_page_id
    : null;
}

function approvalReason(
  candidate: AutoGovernanceCandidateRow,
  sitePageId: string | null,
): string {
  const mapping =
    sitePageId === null
      ? "No single Site Page is proven by the persisted Observation lineage, so the keyword stays unassigned."
      : "The page mapping reuses the Search Console page attribution already proven on the persisted Observation lineage.";
  return (
    `${AUTO_KEYWORD_GOVERNANCE_VERSION} approved this candidate from immutable provider evidence only: ` +
    `${candidate.dataforseo_ranked_evidence} DataForSEO occurrence(s) with a SERP position and ` +
    `${candidate.gsc_impression_evidence} Search Console occurrence(s) with at least one impression. ` +
    `The cluster label is derived by ${CLUSTER_KEY_VERSION} and no Topic Model node was assigned. ` +
    `${mapping} No human has reviewed this keyword.`
  );
}

export interface AutoKeywordGovernanceProposal {
  readonly input: SystemKeywordApprovalInput;
}

/**
 * Decide, from immutable provider evidence alone, whether one candidate may be
 * auto-approved. Pure and deterministic: the same candidate row always yields
 * the same decision, which is what keeps repeated Analysis Refresh runs stable.
 *
 * Returns the rejection reason instead of a decision when the evidence gate is
 * not met, or when `cluster_key.v1` cannot produce a usable label.
 *
 * Known accepted trade-off for CJK: `cluster_key.v1` splits on whitespace and
 * only treats tokens of three or more characters as "long", so a CJK keyword
 * degrades in two ways. Written without spaces it stays a single token and
 * becomes its own cluster (one keyword per cluster); written with spaces its
 * typically two-character tokens never qualify as long, so every token is kept
 * instead of the first two. Both outcomes are honest (nothing is invented) and
 * neither affects visibility, because the diagnostic freeze only requires a
 * non-null cluster key. Real CJK segmentation would require a new
 * `cluster_key` version, which is out of scope here.
 */
export function deriveAutoKeywordApproval(
  candidate: AutoGovernanceCandidateRow,
):
  | { readonly kind: "approve"; readonly input: SystemKeywordApprovalInput }
  | { readonly kind: "reject"; readonly reason: AutoKeywordGovernanceRejection } {
  if (!hasProviderEvidence(candidate)) {
    return { kind: "reject", reason: "insufficient_evidence" };
  }
  const cluster = clusterKey(candidate.display_keyword);
  if (
    cluster === null ||
    cluster.length < 1 ||
    cluster.length > MAX_CLUSTER_KEY_LENGTH ||
    cluster.trim() !== cluster
  ) {
    return { kind: "reject", reason: "no_cluster_key" };
  }
  const sitePageId = mappedSitePageId(candidate);
  return {
    kind: "approve",
    input: {
      keywordId: candidate.id,
      expectedGovernanceRevision: candidate.mapping_revision,
      clusterKey: cluster,
      mappingDecision: sitePageId === null ? "unassigned" : "existing_page",
      mappedSitePageId: sitePageId,
      reason: approvalReason(candidate, sitePageId),
    },
  };
}

/**
 * What the diagnostic freeze still has room for, after subtracting the load
 * that is already committed and the reserve this pass never spends.
 */
export function freezeBudget(
  load: DiagnosticGovernanceLoad,
): AutoKeywordGovernanceBudget {
  return {
    eligibleEntities: load.eligibleEntities,
    occurrenceRefs: load.occurrenceRefs,
    entityHeadroom: Math.max(
      0,
      DIAGNOSTIC_GOVERNANCE_LIMITS.keywordEntities -
        AUTO_GOVERNANCE_ENTITY_SAFETY_RESERVE -
        load.eligibleEntities,
    ),
    occurrenceHeadroom: Math.max(
      0,
      DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrenceRefsTotal -
        AUTO_GOVERNANCE_OCCURRENCE_SAFETY_RESERVE -
        load.occurrenceRefs,
    ),
  };
}

interface BudgetedApprovals {
  readonly approvals: readonly SystemKeywordApprovalInput[];
  readonly withheld: Readonly<
    Record<AutoKeywordGovernanceWithholding, number>
  >;
}

/**
 * Spend the freeze's remaining budget on as many policy-approved candidates as
 * fit, in the repository's own id order, and account for every candidate that
 * does not fit.
 *
 * Deterministic and side-effect free, so the decision to withhold is testable
 * without a database and identical across retries of the same input.
 */
export function withinFreezeBudget(
  proposals: readonly {
    readonly candidate: AutoGovernanceCandidateRow;
    readonly input: SystemKeywordApprovalInput;
  }[],
  budget: AutoKeywordGovernanceBudget,
): BudgetedApprovals {
  const withheld: Record<AutoKeywordGovernanceWithholding, number> = {
    entity_budget_exhausted: 0,
    occurrence_budget_exhausted: 0,
    occurrence_history_unfreezable: 0,
    occurrence_lineage_absent: 0,
  };
  const approvals: SystemKeywordApprovalInput[] = [];
  let entityHeadroom = budget.entityHeadroom;
  let occurrenceHeadroom = budget.occurrenceHeadroom;

  for (const proposal of proposals) {
    const occurrences = proposal.candidate.occurrence_count;
    if (!Number.isSafeInteger(occurrences) || occurrences < 1) {
      withheld.occurrence_lineage_absent += 1;
      continue;
    }
    if (occurrences > DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrencesPerEntity) {
      withheld.occurrence_history_unfreezable += 1;
      continue;
    }
    if (entityHeadroom < 1) {
      withheld.entity_budget_exhausted += 1;
      continue;
    }
    if (occurrenceHeadroom < occurrences) {
      withheld.occurrence_budget_exhausted += 1;
      continue;
    }
    entityHeadroom -= 1;
    occurrenceHeadroom -= occurrences;
    approvals.push(proposal.input);
  }

  return { approvals, withheld };
}

export interface RunAutoKeywordGovernanceOptions {
  /** Resolved from the worker env flag by the caller; never read here. */
  readonly enabled: boolean;
  readonly limit?: number;
}

interface NestingExecutor {
  readonly transaction?: <T>(run: (inner: DbTx) => Promise<T>) => Promise<T>;
}

/**
 * Approve every candidate keyword whose immutable provider evidence already
 * justifies it AND that still fits inside the diagnostic freeze's hard budget,
 * so an ingested library is not invisible to the freeze merely because no
 * operator has clicked through it — and so a library larger than the freeze can
 * hold degrades into "governed later" instead of "diagnostic wedged forever".
 *
 * MUST run inside the caller's open Growth Audit transaction and BEFORE
 * `freezeDiagnosticGovernance`, so the freeze observes the approvals it just
 * produced. Everything it writes is recorded as an actorless
 * `system_suggestion`; a human decision is never overwritten.
 *
 * The whole pass runs inside a nested transaction (a PostgreSQL SAVEPOINT)
 * whenever the executor supports one, so a failure part-way through a batch
 * rolls back only the automated writes and leaves the caller's transaction
 * usable for the freeze.
 */
export async function runAutoKeywordGovernance(
  tx: DbTx,
  scope: ProjectScope,
  options: RunAutoKeywordGovernanceOptions,
): Promise<AutoKeywordGovernanceReport> {
  if (!options.enabled) return EMPTY_REPORT;
  const executor = tx as unknown as NestingExecutor;
  if (typeof executor.transaction === "function") {
    return executor.transaction((inner) =>
      governInTransaction(inner, scope, options),
    );
  }
  return governInTransaction(tx, scope, options);
}

async function governInTransaction(
  tx: DbTx,
  scope: ProjectScope,
  options: RunAutoKeywordGovernanceOptions,
): Promise<AutoKeywordGovernanceReport> {
  const limit = Math.min(
    options.limit ?? MAX_AUTO_GOVERNED_KEYWORDS_PER_RUN,
    MAX_AUTO_GOVERNED_KEYWORDS_PER_RUN,
  );
  const keywords = new KeywordsRepository(tx);
  // Read the committed load BEFORE proposing anything: the freeze that follows
  // in this same transaction cannot be retried on its own, so overflowing it is
  // not a recoverable error but a permanently repeating rollback.
  const budget = freezeBudget(
    await keywords.readDiagnosticGovernanceLoad(scope),
  );
  const candidates = await keywords.listAutoGovernanceCandidates(scope, {
    limit,
  });

  const rejected = { insufficient_evidence: 0, no_cluster_key: 0 };
  const proposals: {
    readonly candidate: AutoGovernanceCandidateRow;
    readonly input: SystemKeywordApprovalInput;
  }[] = [];
  for (const candidate of candidates) {
    const decision = deriveAutoKeywordApproval(candidate);
    if (decision.kind === "reject") {
      rejected[decision.reason] += 1;
      continue;
    }
    proposals.push({ candidate, input: decision.input });
  }

  const budgeted = withinFreezeBudget(proposals, budget);
  const outcomes =
    budgeted.approvals.length === 0
      ? []
      : await new KeywordGovernanceRepository(tx).applySystemApprovals(
          scope,
          budgeted.approvals,
        );

  const skipped: Record<SystemKeywordApprovalSkip, number> = {
    keyword_absent: 0,
    human_decision_exists: 0,
    already_reviewed: 0,
    revision_moved: 0,
    revision_exhausted: 0,
    site_page_absent: 0,
    ledger_unreadable: 0,
  };
  let approved = 0;
  for (const outcome of outcomes) {
    if (outcome.applied) {
      approved += 1;
      continue;
    }
    if (outcome.skipped !== null) skipped[outcome.skipped] += 1;
  }

  return {
    enabled: true,
    considered: candidates.length,
    proposed: proposals.length,
    submitted: budgeted.approvals.length,
    approved,
    rejected,
    withheld: budgeted.withheld,
    skipped,
    budget,
    failure: null,
  };
}
