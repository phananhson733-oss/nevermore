import {
  AUTO_KEYWORD_GOVERNANCE_VERSION,
  KeywordGovernanceRepository,
  KeywordsRepository,
  MAX_AUTO_GOVERNANCE_CANDIDATE_READ,
  MAX_SYSTEM_KEYWORD_GOVERNANCE_BATCH,
  type AutoGovernanceCandidateRow,
  type DbTx,
  type ProjectScope,
  type SystemKeywordApprovalInput,
  type SystemKeywordApprovalSkip,
} from "@sf/db";
import { CLUSTER_KEY_VERSION, clusterKey } from "@sf/sources";

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

export interface AutoKeywordGovernanceReport {
  readonly enabled: boolean;
  /**
   * Untouched candidates read this run. The repository already drops candidates
   * with no qualifying evidence at all, so this counts evidence-bearing rows.
   */
  readonly considered: number;
  /** Candidates that produced an automated approval attempt. */
  readonly proposed: number;
  /** Automated approvals actually appended to the ledger. */
  readonly approved: number;
  readonly rejected: Readonly<Record<AutoKeywordGovernanceRejection, number>>;
  readonly skipped: Readonly<Record<SystemKeywordApprovalSkip, number>>;
}

const EMPTY_REPORT: AutoKeywordGovernanceReport = Object.freeze({
  enabled: false,
  considered: 0,
  proposed: 0,
  approved: 0,
  rejected: Object.freeze({
    insufficient_evidence: 0,
    no_cluster_key: 0,
  }),
  skipped: Object.freeze({
    keyword_absent: 0,
    human_decision_exists: 0,
    already_reviewed: 0,
    revision_moved: 0,
    revision_exhausted: 0,
    site_page_absent: 0,
    ledger_unreadable: 0,
  }),
});

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

export interface RunAutoKeywordGovernanceOptions {
  /** Resolved from the worker env flag by the caller; never read here. */
  readonly enabled: boolean;
  readonly limit?: number;
}

/**
 * Approve every candidate keyword whose immutable provider evidence already
 * justifies it, so an ingested library is not invisible to the diagnostic
 * freeze merely because no operator has clicked through it.
 *
 * MUST run inside the caller's open Growth Audit transaction and BEFORE
 * `freezeDiagnosticGovernance`, so the freeze observes the approvals it just
 * produced. Everything it writes is recorded as an actorless
 * `system_suggestion`; a human decision is never overwritten.
 */
export async function runAutoKeywordGovernance(
  tx: DbTx,
  scope: ProjectScope,
  options: RunAutoKeywordGovernanceOptions,
): Promise<AutoKeywordGovernanceReport> {
  if (!options.enabled) return EMPTY_REPORT;

  const limit = Math.min(
    options.limit ?? MAX_AUTO_GOVERNED_KEYWORDS_PER_RUN,
    MAX_AUTO_GOVERNED_KEYWORDS_PER_RUN,
  );
  const candidates = await new KeywordsRepository(
    tx,
  ).listAutoGovernanceCandidates(scope, { limit });

  const rejected = { insufficient_evidence: 0, no_cluster_key: 0 };
  const approvals: SystemKeywordApprovalInput[] = [];
  for (const candidate of candidates) {
    const decision = deriveAutoKeywordApproval(candidate);
    if (decision.kind === "reject") {
      rejected[decision.reason] += 1;
      continue;
    }
    approvals.push(decision.input);
  }

  const outcomes =
    approvals.length === 0
      ? []
      : await new KeywordGovernanceRepository(tx).applySystemApprovals(
          scope,
          approvals,
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
    proposed: approvals.length,
    approved,
    rejected,
    skipped,
  };
}
