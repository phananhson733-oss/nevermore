import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";
import { OpportunityRuleId } from "./opportunities.ts";

/**
 * Action recheck contract (Slice 1, Task 8). A recheck is a targeted re-run of
 * the frozen diagnostic pipeline against fresh crawl data for one already
 * confirmed Action. It creates a brand-new immutable audit run and never mutates
 * the prior run; the Results surface then compares the two runs strictly on
 * technical rule conditions. This contract is JSON camelCase and carries no
 * impact/lift/business-outcome language — only technical condition state.
 */

/**
 * The raw FindingTarget kind the recheck pins to. It must equal the confirmed
 * Action's root FindingTarget `target_kind`; the recheck refuses a scope that
 * does not match the frozen target of the prior run (spec §8.6, §9.1).
 */
export const RecheckTargetKind = z.enum([
  "url",
  "template",
  "site",
  "page_set",
  "http_status",
  "canonical_issue",
  "keyword_cluster",
  "user_agent",
]);
export type RecheckTargetKind = z.infer<typeof RecheckTargetKind>;

/** The frozen target scope the recheck re-verifies: kind + exact reference. */
export const RecheckTargetScope = z
  .object({
    kind: RecheckTargetKind,
    ref: z.string().trim().min(1).max(2048),
  })
  .strict();
export type RecheckTargetScope = z.infer<typeof RecheckTargetScope>;

/** The per-rule diagnostic outcome recorded on each immutable run. */
export const RecheckRuleStatus = z.enum([
  "pass",
  "candidate",
  "skipped",
  "inconclusive",
]);
export type RecheckRuleStatus = z.infer<typeof RecheckRuleStatus>;

/**
 * Rule-level comparison state (裁决 1: three technical states). `verified` means
 * the technical condition is now observed as resolved; `observed` means the
 * candidate condition is still present; `insufficient_data` means the recheck
 * could not observe the condition (skipped/inconclusive), so no claim is made.
 */
export const RecheckComparisonState = z.enum([
  "verified",
  "observed",
  "insufficient_data",
]);
export type RecheckComparisonState = z.infer<typeof RecheckComparisonState>;

/** The direction the technical condition moved between the two immutable runs. */
export const RecheckDisposition = z.enum(["resolved", "unchanged", "unknown"]);
export type RecheckDisposition = z.infer<typeof RecheckDisposition>;

/**
 * Queue a recheck for one confirmed Action. The command freezes nothing beyond
 * the Action + prior run pointers and the target scope; the service selects the
 * latest eligible crawl snapshot as new data for the fresh run.
 */
export const CreateActionRecheckRequest = z
  .object({
    actionId: Uuid,
    priorRunId: Uuid,
    targetScope: RecheckTargetScope,
    capabilityContractVersion: z.literal("growth-audit.0.3.0"),
  })
  .strict();
export type CreateActionRecheckRequest = z.infer<
  typeof CreateActionRecheckRequest
>;

/** One rule's read-only technical comparison across the prior and current run. */
export const ActionRecheckRuleComparison = z
  .object({
    ruleId: OpportunityRuleId,
    ruleVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    priorStatus: RecheckRuleStatus,
    currentStatus: RecheckRuleStatus,
    state: RecheckComparisonState,
    disposition: RecheckDisposition,
    label: z.string().trim().min(1).max(500),
  })
  .strict();
export type ActionRecheckRuleComparison = z.infer<
  typeof ActionRecheckRuleComparison
>;

/**
 * The read-only Results comparison of two immutable runs. Timestamps are strict
 * RFC3339 UTC instants (canonicalized). The response never claims traffic, rank,
 * revenue, or AI-citation movement — only technical condition state.
 */
export const ActionRecheckResultsResponse = z
  .object({
    priorRunId: Uuid,
    currentRunId: Uuid,
    priorObservedAt: IsoDateTime,
    currentObservedAt: IsoDateTime,
    rules: z.array(ActionRecheckRuleComparison).max(11),
    limitations: z.array(z.string().trim().min(1).max(2000)).max(200),
  })
  .strict();
export type ActionRecheckResultsResponse = z.infer<
  typeof ActionRecheckResultsResponse
>;
