import { and, eq, sql } from "drizzle-orm";
import { keywordReviewSuggestions } from "../schema.ts";
import { projectPredicate, Repository, type ProjectScope } from "./base.ts";

export type KeywordReviewSuggestionStatus =
  | "pending"
  | "approved"
  | "superseded";
export type KeywordReviewSuggestionResolutionMode = "accepted" | "edited";
export type KeywordReviewSuggestionIntentAuthority =
  | "provider_observed"
  | "llm_generated"
  | "unavailable";
export type KeywordReviewSuggestionIntent =
  | "informational"
  | "navigational"
  | "commercial"
  | "transactional";
export type KeywordReviewSuggestionBuyerStage =
  | "awareness"
  | "consideration"
  | "decision"
  | "retention";

export interface KeywordReviewSuggestionRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly keyword_entity_id: string;
  readonly generation_run_id: string;
  readonly output_ordinal: number;
  readonly expected_governance_revision: number;
  readonly suggestion_version: "keyword-governance-suggestion.v1";
  readonly generation_version: "keyword-governance-suggestion-generation.v1";
  readonly prompt_set_version: "keyword-governance-suggestion.prompt.v1";
  readonly input_hash: string;
  readonly output_hash: string;
  readonly status: KeywordReviewSuggestionStatus;
  readonly suggested_status: "candidate" | "approved" | "excluded" | "parked";
  readonly suggested_intent: KeywordReviewSuggestionIntent | null;
  readonly suggested_buyer_stage: KeywordReviewSuggestionBuyerStage | null;
  readonly suggested_topic_node_id: string | null;
  readonly suggested_topic_model_revision: number | null;
  readonly suggested_mapping_decision:
    | "unassigned"
    | "existing_page"
    | "new_asset";
  readonly suggested_mapped_site_page_id: string | null;
  readonly suggested_reason: string;
  readonly analysis_invocation_id: string;
  readonly intent_authority: KeywordReviewSuggestionIntentAuthority;
  readonly intent_snapshot_id: string | null;
  readonly intent_observation_id: string | null;
  readonly intent_observed_at: string | null;
  readonly resolution_mode: KeywordReviewSuggestionResolutionMode | null;
  readonly keyword_review_decision_id: string | null;
  readonly superseded_by_suggestion_id: string | null;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

export interface KeywordReviewSuggestionBatchItem {
  readonly suggestionId: string;
  readonly ordinal: number;
  readonly keywordId: string;
  readonly expectedGovernanceRevision: number;
  readonly suggestionVersion: "keyword-governance-suggestion.v1";
  readonly status: "candidate" | "approved" | "excluded" | "parked";
  readonly intent: KeywordReviewSuggestionIntent | null;
  readonly buyerStage: KeywordReviewSuggestionBuyerStage | null;
  readonly topicNodeId: string | null;
  readonly topicModelRevision: number | null;
  readonly mappingDecision: "unassigned" | "existing_page" | "new_asset";
  readonly mappedSitePageId: string | null;
  readonly reason: string;
  readonly intentAuthority: KeywordReviewSuggestionIntentAuthority;
  readonly intentSnapshotId: string | null;
  readonly intentObservationId: string | null;
  readonly intentObservedAt: string | null;
}

export interface InsertKeywordReviewSuggestionBatchInput {
  readonly generationRunId: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly analysisInvocationId: string;
  readonly suggestions: readonly KeywordReviewSuggestionBatchItem[];
}

export type InsertKeywordReviewSuggestionBatchResult =
  | {
      readonly kind: "inserted" | "replayed";
      readonly suggestions: readonly KeywordReviewSuggestionRow[];
    }
  | {
      readonly kind:
        | "stale"
        | "stale_authority"
        | "concurrent_human"
        | "conflict";
    };

export type ReusableKeywordReviewSuggestionBatchResult =
  | {
      readonly kind: "reusable";
      readonly generationRunId: string;
      readonly inputHash: string;
      readonly resultOutputHash: string;
      readonly suggestions: readonly KeywordReviewSuggestionRow[];
    }
  | { readonly kind: "not_found" };

export type KeywordReviewSuggestionReadinessResult =
  | {
      readonly kind: "ready" | "stale";
      readonly suggestion: KeywordReviewSuggestionRow;
      readonly topicLabel: string | null;
      readonly mappedSitePageTitle: string | null;
    }
  | { readonly kind: "not_found" };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const STATUSES = new Set<KeywordReviewSuggestionStatus>([
  "pending",
  "approved",
  "superseded",
]);
const SUGGESTED_STATUSES = new Set([
  "candidate",
  "approved",
  "excluded",
  "parked",
]);
const MAPPING_DECISIONS = new Set([
  "unassigned",
  "existing_page",
  "new_asset",
]);
const INTENT_AUTHORITIES = new Set<KeywordReviewSuggestionIntentAuthority>([
  "provider_observed",
  "llm_generated",
  "unavailable",
]);
const INTENTS = new Set<KeywordReviewSuggestionIntent>([
  "informational",
  "navigational",
  "commercial",
  "transactional",
]);
const BUYER_STAGES = new Set<KeywordReviewSuggestionBuyerStage>([
  "awareness",
  "consideration",
  "decision",
  "retention",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function nullableUuid(value: unknown): boolean {
  return value === null || (typeof value === "string" && UUID.test(value));
}

function nullableRevision(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 1 &&
      value <= 2_147_483_647)
  );
}

function parseRow(value: unknown): KeywordReviewSuggestionRow | null {
  if (!isRecord(value)) return null;
  const status = value["status"];
  const resolutionMode = value["resolution_mode"];
  const intentAuthority = value["intent_authority"];
  const createdAt = timestamp(value["created_at"]);
  const resolvedAt =
    value["resolved_at"] === null ? null : timestamp(value["resolved_at"]);
  const intentObservedAt =
    value["intent_observed_at"] === null
      ? null
      : timestamp(value["intent_observed_at"]);
  if (
    typeof status !== "string" ||
    !STATUSES.has(status as KeywordReviewSuggestionStatus) ||
    typeof intentAuthority !== "string" ||
    !INTENT_AUTHORITIES.has(
      intentAuthority as KeywordReviewSuggestionIntentAuthority,
    ) ||
    !UUID.test(String(value["id"])) ||
    !UUID.test(String(value["workspace_id"])) ||
    !UUID.test(String(value["project_id"])) ||
    !UUID.test(String(value["keyword_entity_id"])) ||
    !UUID.test(String(value["generation_run_id"])) ||
    !Number.isSafeInteger(value["output_ordinal"]) ||
    Number(value["output_ordinal"]) < 1 ||
    Number(value["output_ordinal"]) > 100 ||
    !Number.isSafeInteger(value["expected_governance_revision"]) ||
    Number(value["expected_governance_revision"]) < 0 ||
    Number(value["expected_governance_revision"]) > 2_147_483_646 ||
    value["suggestion_version"] !== "keyword-governance-suggestion.v1" ||
    value["generation_version"] !==
      "keyword-governance-suggestion-generation.v1" ||
    value["prompt_set_version"] !==
      "keyword-governance-suggestion.prompt.v1" ||
    !HASH.test(String(value["input_hash"])) ||
    !HASH.test(String(value["output_hash"])) ||
    typeof value["suggested_status"] !== "string" ||
    !SUGGESTED_STATUSES.has(value["suggested_status"]) ||
    (value["suggested_intent"] !== null &&
      (typeof value["suggested_intent"] !== "string" ||
        !INTENTS.has(value["suggested_intent"] as KeywordReviewSuggestionIntent))) ||
    (value["suggested_buyer_stage"] !== null &&
      (typeof value["suggested_buyer_stage"] !== "string" ||
        !BUYER_STAGES.has(
          value["suggested_buyer_stage"] as KeywordReviewSuggestionBuyerStage,
        ))) ||
    !nullableUuid(value["suggested_topic_node_id"]) ||
    !nullableRevision(value["suggested_topic_model_revision"]) ||
    typeof value["suggested_mapping_decision"] !== "string" ||
    !MAPPING_DECISIONS.has(value["suggested_mapping_decision"]) ||
    !nullableUuid(value["suggested_mapped_site_page_id"]) ||
    !boundedText(value["suggested_reason"], 3, 2_000) ||
    !UUID.test(String(value["analysis_invocation_id"])) ||
    !nullableUuid(value["intent_snapshot_id"]) ||
    !nullableUuid(value["intent_observation_id"]) ||
    (value["intent_observed_at"] !== null && intentObservedAt === null) ||
    (resolutionMode !== null &&
      resolutionMode !== "accepted" &&
      resolutionMode !== "edited") ||
    !nullableUuid(value["keyword_review_decision_id"]) ||
    !nullableUuid(value["superseded_by_suggestion_id"]) ||
    createdAt === null ||
    (value["resolved_at"] !== null && resolvedAt === null)
  ) {
    return null;
  }
  if (
    (value["suggested_topic_node_id"] === null) !==
      (value["suggested_topic_model_revision"] === null) ||
    (value["suggested_mapping_decision"] !== "unassigned" &&
      value["suggested_topic_node_id"] === null) ||
    (value["suggested_mapping_decision"] === "existing_page") !==
      (value["suggested_mapped_site_page_id"] !== null) ||
    (intentAuthority === "provider_observed" &&
      (value["suggested_intent"] === null ||
        value["intent_snapshot_id"] === null ||
        value["intent_observation_id"] === null ||
        intentObservedAt === null)) ||
    (intentAuthority === "llm_generated" &&
      (value["suggested_intent"] === null ||
        value["intent_snapshot_id"] !== null ||
        value["intent_observation_id"] !== null ||
        value["intent_observed_at"] !== null)) ||
    (intentAuthority === "unavailable" &&
      (value["suggested_intent"] !== null ||
        value["intent_snapshot_id"] !== null ||
        value["intent_observation_id"] !== null ||
        value["intent_observed_at"] !== null)) ||
    (status === "pending" &&
      (resolutionMode !== null ||
        value["keyword_review_decision_id"] !== null ||
        value["superseded_by_suggestion_id"] !== null ||
        resolvedAt !== null)) ||
    (status === "approved" &&
      (resolutionMode === null ||
        value["keyword_review_decision_id"] === null ||
        value["superseded_by_suggestion_id"] !== null ||
        resolvedAt === null)) ||
    (status === "superseded" &&
      (resolutionMode !== null ||
        value["keyword_review_decision_id"] !== null ||
        resolvedAt === null))
  ) {
    return null;
  }
  return value as unknown as KeywordReviewSuggestionRow;
}

function validBatchItem(item: KeywordReviewSuggestionBatchItem): boolean {
  return (
    UUID.test(item.suggestionId) &&
    UUID.test(item.keywordId) &&
    Number.isSafeInteger(item.ordinal) &&
    item.ordinal >= 1 &&
    item.ordinal <= 100 &&
    Number.isSafeInteger(item.expectedGovernanceRevision) &&
    item.expectedGovernanceRevision >= 0 &&
    item.expectedGovernanceRevision <= 2_147_483_646 &&
    item.suggestionVersion === "keyword-governance-suggestion.v1" &&
    SUGGESTED_STATUSES.has(item.status) &&
    (item.intent === null || INTENTS.has(item.intent)) &&
    (item.buyerStage === null || BUYER_STAGES.has(item.buyerStage)) &&
    nullableUuid(item.topicNodeId) &&
    nullableRevision(item.topicModelRevision) &&
    MAPPING_DECISIONS.has(item.mappingDecision) &&
    nullableUuid(item.mappedSitePageId) &&
    boundedText(item.reason, 3, 2_000) &&
    INTENT_AUTHORITIES.has(item.intentAuthority) &&
    nullableUuid(item.intentSnapshotId) &&
    nullableUuid(item.intentObservationId) &&
    (item.intentObservedAt === null || timestamp(item.intentObservedAt) !== null) &&
    (item.topicNodeId === null) === (item.topicModelRevision === null) &&
    (item.mappingDecision === "unassigned" || item.topicNodeId !== null) &&
    (item.mappingDecision === "existing_page") ===
      (item.mappedSitePageId !== null) &&
    (item.status !== "excluded" ||
      (item.topicNodeId === null &&
        item.mappingDecision === "unassigned" &&
        item.mappedSitePageId === null)) &&
    (item.intentAuthority !== "provider_observed" ||
      (item.intent !== null &&
        item.intentSnapshotId !== null &&
        item.intentObservationId !== null &&
        item.intentObservedAt !== null)) &&
    (item.intentAuthority !== "llm_generated" ||
      (item.intent !== null &&
        item.intentSnapshotId === null &&
        item.intentObservationId === null &&
        item.intentObservedAt === null)) &&
    (item.intentAuthority !== "unavailable" ||
      (item.intent === null &&
        item.intentSnapshotId === null &&
        item.intentObservationId === null &&
        item.intentObservedAt === null))
  );
}

function validateBatch(
  scope: ProjectScope,
  input: InsertKeywordReviewSuggestionBatchInput,
): void {
  if (
    !UUID.test(scope.workspaceId) ||
    !UUID.test(scope.projectId) ||
    !UUID.test(input.generationRunId) ||
    !UUID.test(input.analysisInvocationId) ||
    !HASH.test(input.inputHash) ||
    !HASH.test(input.outputHash) ||
    input.suggestions.length < 1 ||
    input.suggestions.length > 100 ||
    input.suggestions.some((item) => !validBatchItem(item))
  ) {
    throw new RangeError("invalid Keyword review suggestion batch");
  }
  const suggestionIds = new Set<string>();
  const keywordIds = new Set<string>();
  const ordinals = new Set<number>();
  for (const suggestion of input.suggestions) {
    suggestionIds.add(suggestion.suggestionId);
    keywordIds.add(suggestion.keywordId);
    ordinals.add(suggestion.ordinal);
  }
  if (
    suggestionIds.size !== input.suggestions.length ||
    keywordIds.size !== input.suggestions.length ||
    ordinals.size !== input.suggestions.length
  ) {
    throw new RangeError("Keyword review suggestion batch identities conflict");
  }
}

function parseRows(value: unknown): KeywordReviewSuggestionRow[] {
  if (!Array.isArray(value)) {
    throw new Error("invalid Keyword review suggestion row collection");
  }
  return value.map((entry) => {
    const row = parseRow(entry);
    if (row === null) {
      throw new Error("invalid Keyword review suggestion row");
    }
    return row;
  });
}

function firstResult(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
    throw new Error("invalid Keyword review suggestion database response");
  }
  const first = raw["rows"][0];
  if (!isRecord(first) || !isRecord(first["result"])) {
    throw new Error("missing Keyword review suggestion database result");
  }
  return first["result"];
}

function boundedUniqueKeywordIds(keywordIds: readonly string[]): string[] {
  if (
    keywordIds.length < 1 ||
    keywordIds.length > 500 ||
    keywordIds.some((keywordId) => !UUID.test(keywordId)) ||
    new Set(keywordIds).size !== keywordIds.length
  ) {
    throw new RangeError("keywordIds must contain 1 to 500 unique UUIDs");
  }
  return [...keywordIds];
}

function parseChangedCount(raw: unknown): number {
  if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
    throw new Error("invalid Keyword suggestion invalidation response");
  }
  const first = raw["rows"][0];
  const changed = isRecord(first) ? first["changed"] : undefined;
  if (
    typeof changed !== "number" ||
    !Number.isSafeInteger(changed) ||
    changed < 0
  ) {
    throw new Error("invalid Keyword suggestion invalidation count");
  }
  return changed;
}

export class KeywordReviewSuggestionsRepository extends Repository {
  async insertBatch(
    scope: ProjectScope,
    input: InsertKeywordReviewSuggestionBatchInput,
  ): Promise<InsertKeywordReviewSuggestionBatchResult> {
    validateBatch(scope, input);
    const raw = await this.exec.execute(sql`
      select app.insert_keyword_review_suggestions_batch(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${input.generationRunId}::uuid,
        ${input.inputHash}::text,
        ${input.outputHash}::text,
        ${input.analysisInvocationId}::uuid,
        ${JSON.stringify(input.suggestions)}::jsonb
      ) as result
    `);
    const result = firstResult(raw);
    if (
      result["kind"] === "stale" ||
      result["kind"] === "stale_authority" ||
      result["kind"] === "concurrent_human" ||
      result["kind"] === "conflict"
    ) {
      return { kind: result["kind"] };
    }
    if (result["kind"] === "inserted" || result["kind"] === "replayed") {
      const suggestions = parseRows(result["suggestions"]);
      if (suggestions.length !== input.suggestions.length) {
        throw new Error("Keyword review suggestion batch was partial");
      }
      return { kind: result["kind"], suggestions };
    }
    throw new Error("invalid Keyword review suggestion insert result");
  }

  async findReusableCompletedBatch(
    scope: ProjectScope,
    inputHash: string,
  ): Promise<ReusableKeywordReviewSuggestionBatchResult> {
    if (!HASH.test(inputHash)) return { kind: "not_found" };
    return this.findReusableCompletedBatchBy(scope, { inputHash });
  }

  async findCurrentReusableCompletedBatch(
    scope: ProjectScope,
  ): Promise<ReusableKeywordReviewSuggestionBatchResult> {
    return this.findReusableCompletedBatchBy(scope, { current: true });
  }

  private async findReusableCompletedBatchBy(
    scope: ProjectScope,
    lookup:
      | { readonly inputHash: string }
      | { readonly current: true },
  ): Promise<ReusableKeywordReviewSuggestionBatchResult> {
    const lookupPredicate = "inputHash" in lookup
      ? sql`generation.input_hash = ${lookup.inputHash}`
      : sql`true`;
    const raw = await this.exec.execute(sql`
      with candidate_run as (
        select
          generation.*,
          topic_model.revision as authority_topic_model_revision,
          primary_site.id as authority_primary_site_id
        from app.keyword_governance_suggestion_generation_runs generation
        inner join app.async_runs run on run.id = generation.id
        inner join app.client_projects project
          on project.id = generation.project_id
         and project.workspace_id = generation.workspace_id
         and project.archived_at is null
         and project.default_delivery_locale =
           generation.input_manifest ->> 'languageTag'
        inner join app.sites primary_site
          on primary_site.workspace_id = project.workspace_id
         and primary_site.project_id = project.id
         and primary_site.is_primary
         and generation.input_manifest ->> 'marketCode' =
           any(primary_site.market_codes)
         and generation.input_manifest ->> 'languageTag' =
           any(primary_site.language_codes)
        inner join app.icp_profiles profile
          on profile.id = project.confirmed_icp_profile_id
         and profile.workspace_id = project.workspace_id
         and profile.project_id = project.id
         and profile.status = 'complete'
         and profile.id = (generation.input_manifest #>>
           '{confirmedProductProfile,productProfileId}')::uuid
         and profile.version = (generation.input_manifest #>>
           '{confirmedProductProfile,version}')::integer
         and profile.content_hash = generation.input_manifest #>>
           '{confirmedProductProfile,contentHash}'
         and (
           select count(*)
           from jsonb_array_elements(profile.profile -> 'targetMarkets')
             market(value)
           where market.value ->> 'priority' = 'primary'
         ) = 1
         and exists (
           select 1
           from jsonb_array_elements(profile.profile -> 'targetMarkets')
             market(value)
           where market.value ->> 'priority' = 'primary'
             and market.value ->> 'marketCode' =
               generation.input_manifest ->> 'marketCode'
         )
        inner join app.topic_model_revisions topic_model
          on topic_model.id = (generation.input_manifest #>>
            '{confirmedTopicModel,topicModelRevisionId}')::uuid
         and topic_model.workspace_id = generation.workspace_id
         and topic_model.project_id = generation.project_id
         and topic_model.revision = (generation.input_manifest #>>
           '{confirmedTopicModel,revision}')::integer
         and topic_model.status = 'confirmed'
         and topic_model.content_hash = generation.input_manifest #>>
           '{confirmedTopicModel,contentHash}'
         and not exists (
           select 1
           from app.topic_model_revisions newer_topic
           where newer_topic.workspace_id = topic_model.workspace_id
             and newer_topic.project_id = topic_model.project_id
             and newer_topic.status = 'confirmed'
             and newer_topic.revision > topic_model.revision
         )
        where generation.workspace_id = ${scope.workspaceId}::uuid
          and generation.project_id = ${scope.projectId}::uuid
          and ${lookupPredicate}
          and generation.prompt_input_hash is not null
          and generation.result_output_hash is not null
          and run.kind = 'keyword_governance_suggestion_generation'
          and run.result_type =
            'keyword_governance_suggestion_generation_run'
          and run.result_id = generation.id
          and run.status = 'completed'
        order by generation.created_at desc, generation.id desc
        limit 1
      ), reusable_run as (
        select candidate_run.*
        from candidate_run
        where not exists (
          select 1
          from jsonb_array_elements(
            candidate_run.input_manifest -> 'candidates'
          ) frozen(value)
          left join app.keyword_review_suggestions suggestion
            on suggestion.generation_run_id = candidate_run.id
           and suggestion.output_ordinal =
             (frozen.value ->> 'ordinal')::integer
           and suggestion.keyword_entity_id =
             (frozen.value ->> 'keywordId')::uuid
          left join app.keyword_entities keyword
            on keyword.id = suggestion.keyword_entity_id
           and keyword.workspace_id = suggestion.workspace_id
           and keyword.project_id = suggestion.project_id
          left join app.keyword_review_decisions current_decision
            on current_decision.workspace_id = keyword.workspace_id
           and current_decision.project_id = keyword.project_id
           and current_decision.keyword_entity_id = keyword.id
           and current_decision.governance_revision = keyword.mapping_revision
           and current_decision.status = keyword.status
           and current_decision.intent is not distinct from keyword.intent
           and current_decision.buyer_stage is not distinct from
             keyword.buyer_stage
           and current_decision.mapping_decision = keyword.mapping_decision
           and current_decision.mapped_site_page_id is not distinct from
             keyword.mapped_site_page_id
           and current_decision.review_state = keyword.mapping_review_state
          where suggestion.id is null
             or keyword.id is null
             or current_decision.id is null
             or suggestion.status <> 'pending'
             or suggestion.input_hash <> candidate_run.input_hash
             or suggestion.output_hash <>
               candidate_run.result_output_hash
             or suggestion.expected_governance_revision <>
               keyword.mapping_revision
             or keyword.query_kind <> 'search_query'
             or keyword.status <> 'candidate'
             or keyword.mapping_review_state <> 'unreviewed'
             or keyword.display_keyword <>
               frozen.value ->> 'displayKeyword'
             or keyword.normalized_keyword <>
               frozen.value ->> 'normalizedKeyword'
             or keyword.market <>
               candidate_run.input_manifest ->> 'marketCode'
             or keyword.language_tag <>
               candidate_run.input_manifest ->> 'languageTag'
             or exists (
               select 1
               from app.keyword_review_decisions decision
               where decision.workspace_id = candidate_run.workspace_id
                 and decision.project_id = candidate_run.project_id
                 and decision.keyword_entity_id = suggestion.keyword_entity_id
                 and decision.decision_origin = 'user'
             )
             or (
               frozen.value #>>
                 '{deterministicEvidence,currentTopicKey}' is null
               and current_decision.topic_node_id is not null
             )
             or (
               frozen.value #>>
                 '{deterministicEvidence,currentTopicKey}' is not null
               and not exists (
                 select 1
                 from jsonb_array_elements(
                   candidate_run.input_manifest -> 'topicAllowlist'
                 ) allowed_topic(value)
                 inner join app.topic_node_revisions current_topic
                   on current_topic.workspace_id = keyword.workspace_id
                  and current_topic.project_id = keyword.project_id
                  and current_topic.topic_node_id =
                    (allowed_topic.value ->> 'topicNodeId')::uuid
                  and current_topic.topic_model_revision =
                    candidate_run.authority_topic_model_revision
                  and current_topic.lifecycle_state = 'active'
                 where allowed_topic.value ->> 'topicKey' = frozen.value #>>
                   '{deterministicEvidence,currentTopicKey}'
                   and current_decision.topic_node_id =
                     current_topic.topic_node_id
                   and current_decision.topic_model_revision =
                     current_topic.topic_model_revision
               )
             )
             or (
               frozen.value #>>
                 '{deterministicEvidence,currentPageKey}' is null
               and keyword.mapped_site_page_id is not null
             )
             or (
               frozen.value #>>
                 '{deterministicEvidence,currentPageKey}' is not null
               and not exists (
                 select 1
                 from jsonb_array_elements(
                   candidate_run.input_manifest -> 'pageAllowlist'
                 ) allowed_page(value)
                 inner join app.site_pages current_page
                   on current_page.id =
                     (allowed_page.value ->> 'sitePageId')::uuid
                  and current_page.workspace_id = keyword.workspace_id
                  and current_page.project_id = keyword.project_id
                  and current_page.site_id =
                    candidate_run.authority_primary_site_id
                 where allowed_page.value ->> 'pageKey' = frozen.value #>>
                   '{deterministicEvidence,currentPageKey}'
                   and keyword.mapped_site_page_id = current_page.id
               )
             )
             or (
               suggestion.suggested_topic_node_id is not null
               and not exists (
                 select 1
                 from app.topic_node_revisions suggested_topic
                 where suggested_topic.workspace_id = suggestion.workspace_id
                   and suggested_topic.project_id = suggestion.project_id
                   and suggested_topic.topic_node_id =
                     suggestion.suggested_topic_node_id
                   and suggested_topic.topic_model_revision =
                     suggestion.suggested_topic_model_revision
                   and suggested_topic.lifecycle_state = 'active'
               )
             )
             or (
               suggestion.suggested_mapped_site_page_id is not null
               and not exists (
                 select 1
                 from app.site_pages suggested_page
                 inner join app.sites suggested_site
                   on suggested_site.id = suggested_page.site_id
                  and suggested_site.workspace_id = suggested_page.workspace_id
                  and suggested_site.project_id = suggested_page.project_id
                  and suggested_site.is_primary
                 where suggested_page.id =
                     suggestion.suggested_mapped_site_page_id
                   and suggested_page.workspace_id = suggestion.workspace_id
                   and suggested_page.project_id = suggestion.project_id
               )
             )
             or app.current_keyword_governance_suggestion_occurrence_ids(
               candidate_run.workspace_id,
               candidate_run.project_id,
               suggestion.keyword_entity_id,
               frozen.value ->> 'displayKeyword',
               frozen.value ->> 'normalizedKeyword',
               candidate_run.input_manifest ->> 'marketCode',
               candidate_run.input_manifest ->> 'languageTag'
             ) is distinct from (
               select coalesce(
                 jsonb_agg(value::uuid order by value::uuid),
                 '[]'::jsonb
               )
               from jsonb_array_elements_text(
                 frozen.value #>
                   '{deterministicEvidence,sourceOccurrenceIds}'
               ) occurrence_id(value)
             )
             or not exists (
               select 1
               from app.analysis_invocations invocation
               inner join
                 app.keyword_governance_suggestion_invocation_attempts attempt
                 on attempt.analysis_invocation_id = invocation.id
                and attempt.status = 'succeeded'
               where invocation.id = suggestion.analysis_invocation_id
                 and invocation.workspace_id = suggestion.workspace_id
                 and invocation.project_id = suggestion.project_id
                 and invocation.async_run_id = suggestion.generation_run_id
                 and invocation.task =
                   'keyword_governance_suggestion_generation'
                 and invocation.status = 'succeeded'
                 and invocation.input_hash = candidate_run.prompt_input_hash
                 and invocation.output_hash = suggestion.output_hash
             )
        )
        and (
          select count(*)
          from app.keyword_review_suggestions suggestion
          where suggestion.generation_run_id = candidate_run.id
        ) = jsonb_array_length(candidate_run.input_manifest -> 'candidates')
      )
      select jsonb_build_object(
        'kind', 'reusable',
        'generationRunId', reusable_run.id,
        'inputHash', reusable_run.input_hash,
        'resultOutputHash', reusable_run.result_output_hash,
        'suggestions', (
          select jsonb_agg(to_jsonb(suggestion)
            order by suggestion.output_ordinal)
          from app.keyword_review_suggestions suggestion
          where suggestion.generation_run_id = reusable_run.id
        )
      ) as result
      from reusable_run
    `);
    if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
      throw new Error("invalid reusable Keyword suggestion database response");
    }
    if (raw["rows"].length === 0) return { kind: "not_found" };
    const result = firstResult(raw);
    if (
      result["kind"] !== "reusable" ||
      !UUID.test(String(result["generationRunId"])) ||
      !HASH.test(String(result["inputHash"])) ||
      ("inputHash" in lookup && result["inputHash"] !== lookup.inputHash) ||
      !HASH.test(String(result["resultOutputHash"]))
    ) {
      throw new Error("invalid reusable Keyword suggestion result");
    }
    const suggestions = parseRows(result["suggestions"]);
    if (suggestions.length < 1 || suggestions.length > 100) {
      throw new Error("invalid reusable Keyword suggestion batch size");
    }
    return {
      kind: "reusable",
      generationRunId: String(result["generationRunId"]),
      inputHash: String(result["inputHash"]),
      resultOutputHash: String(result["resultOutputHash"]),
      suggestions,
    };
  }

  async supersedePendingForKeywords(
    scope: ProjectScope,
    keywordIds: readonly string[],
  ): Promise<number> {
    const ids = boundedUniqueKeywordIds(keywordIds);
    const idArray = sql`array[${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]`;
    return parseChangedCount(await this.exec.execute(sql`
      select app.supersede_keyword_review_suggestions_for_keywords(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${idArray}
      ) as changed
    `));
  }

  async supersedeAllPendingForProject(
    scope: ProjectScope,
  ): Promise<number> {
    return parseChangedCount(await this.exec.execute(sql`
      select app.supersede_keyword_review_suggestions_for_project(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid
      ) as changed
    `));
  }

  async supersedeStalePendingForProject(
    scope: ProjectScope,
  ): Promise<number> {
    const changed = parseChangedCount(await this.exec.execute(sql`
      select app.supersede_stale_pending_keyword_review_suggestions(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid
      ) as changed
    `));
    if (changed > 100) {
      throw new Error("invalid bounded stale-pending invalidation count");
    }
    return changed;
  }

  async findById(
    scope: ProjectScope,
    suggestionId: string,
  ): Promise<KeywordReviewSuggestionRow | null> {
    if (!UUID.test(suggestionId)) return null;
    const rows = await this.exec
      .select()
      .from(keywordReviewSuggestions)
      .where(
        and(
          projectPredicate(keywordReviewSuggestions, scope),
          eq(keywordReviewSuggestions.id, suggestionId),
        ),
      )
      .limit(1);
    if (!rows[0]) return null;
    const row = parseRow(rows[0]);
    if (row === null) throw new Error("invalid Keyword review suggestion row");
    return row;
  }

  async findCurrentPending(
    scope: ProjectScope,
    keywordId: string,
    expectedGovernanceRevision?: number,
  ): Promise<KeywordReviewSuggestionRow | null> {
    if (
      !UUID.test(keywordId) ||
      (expectedGovernanceRevision !== undefined &&
        (!Number.isSafeInteger(expectedGovernanceRevision) ||
          expectedGovernanceRevision < 0 ||
          expectedGovernanceRevision > 2_147_483_646))
    ) {
      return null;
    }
    const rows = await this.exec
      .select()
      .from(keywordReviewSuggestions)
      .where(
        and(
          projectPredicate(keywordReviewSuggestions, scope),
          eq(keywordReviewSuggestions.keyword_entity_id, keywordId),
          eq(keywordReviewSuggestions.status, "pending"),
          ...(expectedGovernanceRevision === undefined
            ? []
            : [
                eq(
                  keywordReviewSuggestions.expected_governance_revision,
                  expectedGovernanceRevision,
                ),
              ]),
        ),
      )
      .limit(1);
    if (!rows[0]) return null;
    const row = parseRow(rows[0]);
    if (row === null) throw new Error("invalid Keyword review suggestion row");
    return row;
  }

  async findCurrentPendingReadiness(
    scope: ProjectScope,
    keywordId: string,
  ): Promise<KeywordReviewSuggestionReadinessResult> {
    if (!UUID.test(keywordId)) return { kind: "not_found" };
    const raw = await this.exec.execute(sql`
      select
        to_jsonb(suggestion) as suggestion,
        (
          select topic.label
          from app.topic_node_revisions topic
          where topic.workspace_id = suggestion.workspace_id
            and topic.project_id = suggestion.project_id
            and topic.topic_node_id = suggestion.suggested_topic_node_id
            and topic.topic_model_revision =
              suggestion.suggested_topic_model_revision
          limit 1
        ) as suggested_topic_label,
        (
          select coalesce(
            nullif(btrim(latest_snapshot.extract ->> 'title'), ''),
            left(page.normalized_url, 500)
          )
          from app.site_pages page
          left join lateral (
            select snapshot.extract
            from app.page_snapshots snapshot
            where snapshot.workspace_id = page.workspace_id
              and snapshot.project_id = page.project_id
              and snapshot.site_page_id = page.id
            order by snapshot.captured_at desc, snapshot.id desc
            limit 1
          ) latest_snapshot on true
          where page.workspace_id = suggestion.workspace_id
            and page.project_id = suggestion.project_id
            and page.id = suggestion.suggested_mapped_site_page_id
          limit 1
        ) as suggested_page_title,
        (
          run.status = 'completed'
          and generation.result_output_hash = suggestion.output_hash
          and exists (
            select 1
            from app.client_projects project
            inner join app.icp_profiles profile
              on profile.id = project.confirmed_icp_profile_id
             and profile.workspace_id = project.workspace_id
             and profile.project_id = project.id
             and profile.status = 'complete'
            inner join app.sites primary_site
              on primary_site.workspace_id = project.workspace_id
             and primary_site.project_id = project.id
             and primary_site.is_primary
            where project.id = suggestion.project_id
              and project.workspace_id = suggestion.workspace_id
              and project.archived_at is null
              and project.default_delivery_locale =
                generation.input_manifest ->> 'languageTag'
              and generation.input_manifest ->> 'marketCode' =
                any(primary_site.market_codes)
              and generation.input_manifest ->> 'languageTag' =
                any(primary_site.language_codes)
              and profile.id = (generation.input_manifest #>>
                '{confirmedProductProfile,productProfileId}')::uuid
              and profile.version = (generation.input_manifest #>>
                '{confirmedProductProfile,version}')::integer
              and profile.content_hash = generation.input_manifest #>>
                '{confirmedProductProfile,contentHash}'
          )
          and exists (
            select 1
            from app.topic_model_revisions topic_model
            where topic_model.id = (generation.input_manifest #>>
                '{confirmedTopicModel,topicModelRevisionId}')::uuid
              and topic_model.workspace_id = suggestion.workspace_id
              and topic_model.project_id = suggestion.project_id
              and topic_model.revision = (generation.input_manifest #>>
                '{confirmedTopicModel,revision}')::integer
              and topic_model.status = 'confirmed'
              and topic_model.content_hash = generation.input_manifest #>>
                '{confirmedTopicModel,contentHash}'
              and not exists (
                select 1
                from app.topic_model_revisions newer_topic
                where newer_topic.workspace_id = topic_model.workspace_id
                  and newer_topic.project_id = topic_model.project_id
                  and newer_topic.status = 'confirmed'
                  and newer_topic.revision > topic_model.revision
              )
          )
          and exists (
            select 1
            from app.keyword_entities keyword
            where keyword.id = suggestion.keyword_entity_id
              and keyword.workspace_id = suggestion.workspace_id
              and keyword.project_id = suggestion.project_id
              and keyword.query_kind = 'search_query'
              and keyword.status = 'candidate'
              and keyword.mapping_review_state = 'unreviewed'
              and keyword.mapping_revision =
                suggestion.expected_governance_revision
              and keyword.display_keyword =
                frozen.value ->> 'displayKeyword'
              and keyword.normalized_keyword =
                frozen.value ->> 'normalizedKeyword'
              and keyword.market = generation.input_manifest ->> 'marketCode'
              and keyword.language_tag =
                generation.input_manifest ->> 'languageTag'
              and not exists (
                select 1
                from app.keyword_review_decisions human_decision
                where human_decision.workspace_id = keyword.workspace_id
                  and human_decision.project_id = keyword.project_id
                  and human_decision.keyword_entity_id = keyword.id
                  and human_decision.decision_origin = 'user'
              )
          )
          and app.current_keyword_governance_suggestion_occurrence_ids(
            suggestion.workspace_id,
            suggestion.project_id,
            suggestion.keyword_entity_id,
            frozen.value ->> 'displayKeyword',
            frozen.value ->> 'normalizedKeyword',
            generation.input_manifest ->> 'marketCode',
            generation.input_manifest ->> 'languageTag'
          ) = frozen.value #>
            '{deterministicEvidence,sourceOccurrenceIds}'
          and (
            suggestion.suggested_topic_node_id is null
            or exists (
              select 1
              from app.topic_node_revisions suggested_topic
              where suggested_topic.workspace_id = suggestion.workspace_id
                and suggested_topic.project_id = suggestion.project_id
                and suggested_topic.topic_node_id =
                  suggestion.suggested_topic_node_id
                and suggested_topic.topic_model_revision =
                  suggestion.suggested_topic_model_revision
                and suggested_topic.lifecycle_state = 'active'
            )
          )
          and (
            suggestion.suggested_mapped_site_page_id is null
            or exists (
              select 1
              from app.site_pages suggested_page
              inner join app.sites suggested_site
                on suggested_site.id = suggested_page.site_id
               and suggested_site.workspace_id = suggested_page.workspace_id
               and suggested_site.project_id = suggested_page.project_id
               and suggested_site.is_primary
              where suggested_page.id =
                  suggestion.suggested_mapped_site_page_id
                and suggested_page.workspace_id = suggestion.workspace_id
                and suggested_page.project_id = suggestion.project_id
            )
          )
          and exists (
            select 1
            from app.analysis_invocations invocation
            inner join app.keyword_governance_suggestion_invocation_attempts
              attempt
              on attempt.analysis_invocation_id = invocation.id
             and attempt.status = 'succeeded'
            where invocation.id = suggestion.analysis_invocation_id
              and invocation.workspace_id = suggestion.workspace_id
              and invocation.project_id = suggestion.project_id
              and invocation.async_run_id = suggestion.generation_run_id
              and invocation.task =
                'keyword_governance_suggestion_generation'
              and invocation.status = 'succeeded'
              and invocation.input_hash = generation.prompt_input_hash
              and invocation.output_hash = suggestion.output_hash
          )
        ) as authority_current
      from app.keyword_review_suggestions suggestion
      inner join app.keyword_governance_suggestion_generation_runs generation
        on generation.id = suggestion.generation_run_id
       and generation.workspace_id = suggestion.workspace_id
       and generation.project_id = suggestion.project_id
      inner join app.async_runs run on run.id = generation.id
      inner join lateral jsonb_array_elements(
        generation.input_manifest -> 'candidates'
      ) frozen(value)
        on (frozen.value ->> 'ordinal')::integer =
             suggestion.output_ordinal
       and (frozen.value ->> 'keywordId')::uuid =
             suggestion.keyword_entity_id
      where suggestion.workspace_id = ${scope.workspaceId}::uuid
        and suggestion.project_id = ${scope.projectId}::uuid
        and suggestion.keyword_entity_id = ${keywordId}::uuid
        and suggestion.status = 'pending'
      limit 1
    `);
    if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
      throw new Error("invalid Keyword suggestion readiness response");
    }
    if (raw["rows"].length === 0) return { kind: "not_found" };
    const first = raw["rows"][0];
    if (
      !isRecord(first) ||
      typeof first["authority_current"] !== "boolean"
    ) {
      throw new Error("invalid Keyword suggestion readiness result");
    }
    const suggestion = parseRow(first["suggestion"]);
    const topicLabel = first["suggested_topic_label"];
    const mappedSitePageTitle = first["suggested_page_title"];
    if (
      suggestion === null ||
      (topicLabel !== null && !boundedText(topicLabel, 1, 500)) ||
      (mappedSitePageTitle !== null &&
        !boundedText(mappedSitePageTitle, 1, 500)) ||
      (suggestion.suggested_topic_node_id === null) !==
        (topicLabel === null) ||
      (suggestion.suggested_mapped_site_page_id === null) !==
        (mappedSitePageTitle === null)
    ) {
      throw new Error("invalid Keyword suggestion readiness row");
    }
    return {
      kind: first["authority_current"] ? "ready" : "stale",
      suggestion,
      topicLabel,
      mappedSitePageTitle,
    };
  }
}
