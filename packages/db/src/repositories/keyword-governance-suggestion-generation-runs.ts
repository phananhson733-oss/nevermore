import type { KeywordGovernanceSuggestionInputManifest } from "@sf/contracts";
import {
  ConfirmedProductProfile as ConfirmedProductProfileSchema,
  KeywordGovernanceSuggestionInputManifest as ManifestSchema,
} from "@sf/contracts";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  canonicalize,
  contentHash,
  type CanonicalValue,
} from "../hash.ts";
import { canonicalUtcTimestamptz } from "../instant.ts";
import { keywordGovernanceSuggestionGenerationRuns } from "../schema.ts";
import type { RunAttempt } from "./async-runs.ts";
import { projectPredicate, Repository, type ProjectScope } from "./base.ts";

export interface KeywordGovernanceSuggestionGenerationRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly generation_version: "keyword-governance-suggestion-generation.v1";
  readonly prompt_set_version: "keyword-governance-suggestion.prompt.v1";
  readonly input_manifest: KeywordGovernanceSuggestionInputManifest;
  readonly input_hash: string;
  readonly prompt_input_hash: string | null;
  readonly result_output_hash: string | null;
  readonly created_at: string;
}

export interface KeywordGovernanceSuggestionGenerationTerminalInput {
  readonly status: "completed" | "failed" | "cancelled";
  readonly resultOutputHash: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorSummary: string | null;
}

export type KeywordGovernanceSuggestionGenerationTerminalizeResult =
  | {
      readonly kind: "terminalized";
      readonly run: KeywordGovernanceSuggestionGenerationRunRow;
    }
  | { readonly kind: "stale" }
  | {
      readonly kind: "conflict";
      readonly run: KeywordGovernanceSuggestionGenerationRunRow | null;
    };

export interface KeywordGovernanceSuggestionOccurrenceAuthority {
  readonly occurrenceId: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly valid: true;
  readonly sourceKind: string;
  readonly providerSearchIntent: {
    readonly value:
      | "informational"
      | "navigational"
      | "commercial"
      | "transactional";
    readonly snapshotId: string;
    readonly observationId: string;
    readonly observedAt: string;
  } | null;
}

export interface KeywordGovernanceSuggestionCandidateAuthority {
  readonly keywordId: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly queryKind: "search_query";
  readonly status: "candidate";
  readonly reviewState: "unreviewed";
  readonly reviewOrigin: null;
  readonly hasHumanDecision: false;
  readonly governanceRevision: number;
  readonly topicNodeId: string | null;
  readonly topicModelRevision: number | null;
  readonly mappedSitePageId: string | null;
  readonly occurrences: readonly KeywordGovernanceSuggestionOccurrenceAuthority[];
}

export interface KeywordGovernanceSuggestionFreezeAuthority {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly primaryMarketCode: string;
  readonly primaryLanguageTag: string;
  readonly confirmedProductProfile: {
    readonly state: "confirmed";
    readonly productProfileId: string;
    readonly version: number;
    readonly contentHash: string;
    readonly facts: KeywordGovernanceSuggestionInputManifest[
      "confirmedProductProfile"
    ]["facts"];
  };
  readonly confirmedTopicModel: {
    readonly state: "confirmed";
    readonly topicModelRevisionId: string;
    readonly revision: number;
    readonly contentHash: string;
    readonly topics: readonly {
      readonly topicNodeId: string;
      readonly label: string;
    }[];
  };
  readonly pages: readonly {
    readonly sitePageId: string;
    readonly normalizedUrl: string;
    readonly title: string;
    readonly owned: true;
  }[];
  readonly keywords: readonly KeywordGovernanceSuggestionCandidateAuthority[];
}

export type KeywordGovernanceSuggestionFreezeAuthorityReadResult =
  | {
      readonly kind: "ready";
      readonly authority: KeywordGovernanceSuggestionFreezeAuthority;
      /** The 101st eligible Keyword is a sentinel; it is never returned. */
      readonly hasMore: boolean;
    }
  | { readonly kind: "no_candidates" }
  | { readonly kind: "unavailable" };

export type KeywordGovernanceSuggestionGenerationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type KeywordGovernanceSuggestionSafeTerminalCode =
  | "KEYWORD_GOVERNANCE_SUGGESTION_RUN_INVALID"
  | "KEYWORD_GOVERNANCE_SUGGESTION_INPUT_INVALID"
  | "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN"
  | "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_BUDGET_EXHAUSTED"
  | "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_CONFIGURATION_MISMATCH"
  | "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE"
  | "KEYWORD_GOVERNANCE_SUGGESTION_CONCURRENT_HUMAN"
  | "KEYWORD_GOVERNANCE_SUGGESTION_BATCH_CONFLICT";

export interface LatestKeywordGovernanceSuggestionGeneration {
  /** Public generating-state placeholder until a durable suggestion exists. */
  readonly suggestionId: string;
  readonly generationRunId: string;
  readonly keywordId: string;
  readonly expectedGovernanceRevision: number;
  readonly createdAt: string;
  readonly status: KeywordGovernanceSuggestionGenerationStatus;
  /** Unknown/internal provider failures deliberately collapse to null. */
  readonly safeTerminalCode: KeywordGovernanceSuggestionSafeTerminalCode | null;
  readonly authorityCurrent: boolean;
  readonly hasSuggestion: boolean;
}

export type CurrentKeywordGovernanceSuggestionGeneration =
  LatestKeywordGovernanceSuggestionGeneration & {
    readonly status: "queued" | "running";
    readonly safeTerminalCode: null;
    readonly authorityCurrent: true;
  };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const MARKET = /^[A-Z]{2,3}$/u;
const CANONICAL_INTENTS = new Set([
  "informational",
  "navigational",
  "commercial",
  "transactional",
] as const);
const SAFE_TERMINAL_CODES = new Set<KeywordGovernanceSuggestionSafeTerminalCode>([
  "KEYWORD_GOVERNANCE_SUGGESTION_RUN_INVALID",
  "KEYWORD_GOVERNANCE_SUGGESTION_INPUT_INVALID",
  "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
  "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_BUDGET_EXHAUSTED",
  "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_CONFIGURATION_MISMATCH",
  "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE",
  "KEYWORD_GOVERNANCE_SUGGESTION_CONCURRENT_HUMAN",
  "KEYWORD_GOVERNANCE_SUGGESTION_BATCH_CONFLICT",
]);
const MAX_BYTES = 524_288;
const MAX_DEPTH = 20;
const MAX_NODES = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPlainJson(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
  budget = { nodes: 0 },
): void {
  budget.nodes += 1;
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES) {
    throw new RangeError("keyword suggestion generation manifest is unbounded");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== "object" || seen.has(value)) {
    throw new RangeError("keyword suggestion generation manifest is not plain JSON");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        !/^(?:0|[1-9]\d*)$/u.test(key) ||
        !descriptor?.enumerable ||
        !("value" in descriptor)
      ) {
        throw new RangeError("keyword suggestion generation manifest is not plain JSON");
      }
      assertPlainJson(descriptor.value, depth + 1, seen, budget);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RangeError("keyword suggestion generation manifest is not plain JSON");
    }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        key === "toJSON" ||
        !descriptor?.enumerable ||
        !("value" in descriptor)
      ) {
        throw new RangeError("keyword suggestion generation manifest is not plain JSON");
      }
      assertPlainJson(descriptor.value, depth + 1, seen, budget);
    }
  }
  seen.delete(value);
}

function freezeManifest(value: unknown): KeywordGovernanceSuggestionInputManifest {
  assertPlainJson(value);
  const canonical = canonicalize(value as CanonicalValue);
  if (Buffer.byteLength(canonical, "utf8") > MAX_BYTES) {
    throw new RangeError("keyword suggestion generation manifest is unbounded");
  }
  return ManifestSchema.parse(JSON.parse(canonical));
}

function parseTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function parseRun(
  value: unknown,
): KeywordGovernanceSuggestionGenerationRunRow | null {
  if (!isRecord(value)) return null;
  if (
    !UUID.test(String(value["id"])) ||
    !UUID.test(String(value["workspace_id"])) ||
    !UUID.test(String(value["project_id"])) ||
    value["generation_version"] !==
      "keyword-governance-suggestion-generation.v1" ||
    value["prompt_set_version"] !==
      "keyword-governance-suggestion.prompt.v1" ||
    !HASH.test(String(value["input_hash"])) ||
    (value["prompt_input_hash"] !== null &&
      !HASH.test(String(value["prompt_input_hash"]))) ||
    (value["result_output_hash"] !== null &&
      !HASH.test(String(value["result_output_hash"]))) ||
    parseTimestamp(value["created_at"]) === null
  ) {
    return null;
  }
  try {
    const manifest = ManifestSchema.parse(value["input_manifest"]);
    if (
      manifest.workspaceId !== value["workspace_id"] ||
      manifest.projectId !== value["project_id"] ||
      manifest.generationVersion !== value["generation_version"] ||
      manifest.promptSetVersion !== value["prompt_set_version"] ||
      contentHash(manifest as CanonicalValue) !== value["input_hash"]
    ) {
      return null;
    }
    return {
      ...(value as unknown as KeywordGovernanceSuggestionGenerationRunRow),
      input_manifest: manifest,
    };
  } catch {
    return null;
  }
}

function validAttempt(attempt: RunAttempt): boolean {
  return (
    UUID.test(attempt.workspaceId) &&
    UUID.test(attempt.projectId) &&
    UUID.test(attempt.runId) &&
    Number.isSafeInteger(attempt.attemptCount) &&
    attempt.attemptCount >= 1 &&
    attempt.attemptCount <= 2_147_483_647
  );
}

function validTerminal(
  input: KeywordGovernanceSuggestionGenerationTerminalInput,
): boolean {
  if (input.status === "completed") {
    return (
      input.resultOutputHash !== null &&
      HASH.test(input.resultOutputHash) &&
      input.lastErrorCode === null &&
      input.lastErrorSummary === null
    );
  }
  return (
    input.resultOutputHash === null &&
    input.lastErrorCode !== null &&
    ERROR_CODE.test(input.lastErrorCode) &&
    input.lastErrorSummary !== null &&
    input.lastErrorSummary === input.lastErrorSummary.trim() &&
    input.lastErrorSummary.length >= 1 &&
    input.lastErrorSummary.length <= 2_000
  );
}

function firstResult(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
    throw new Error("invalid Keyword suggestion generation database response");
  }
  const first = raw["rows"][0];
  if (!isRecord(first) || !isRecord(first["result"])) {
    throw new Error("missing Keyword suggestion generation database result");
  }
  return first["result"];
}

function boundedTrimmedString(
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

/**
 * The server-owned freezer is the canonicalization boundary. PostgreSQL only
 * prefilters singleton Site/Keyword spelling by case identity; it does not
 * duplicate Intl alias canonicalization.
 */
function canonicalSiteLanguageIdentity(value: unknown): string | null {
  if (!boundedTrimmedString(value, 2, 35)) return null;
  try {
    const canonical = Intl.getCanonicalLocales(value);
    const languageTag = canonical.length === 1 ? canonical[0] : undefined;
    return languageTag !== undefined &&
        languageTag.toLowerCase() === value.toLowerCase()
      ? languageTag
      : null;
  } catch {
    return null;
  }
}

function parseProviderIntent(
  value: unknown,
): KeywordGovernanceSuggestionOccurrenceAuthority["providerSearchIntent"] {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 4 ||
    typeof value["value"] !== "string" ||
    !CANONICAL_INTENTS.has(
      value["value"] as
        | "informational"
        | "navigational"
        | "commercial"
        | "transactional",
    ) ||
    !UUID.test(String(value["snapshotId"])) ||
    !UUID.test(String(value["observationId"])) ||
    typeof value["observedAt"] !== "string"
  ) {
    throw new Error("invalid frozen DataForSEO intent authority");
  }
  return {
    value: value["value"] as
      | "informational"
      | "navigational"
      | "commercial"
      | "transactional",
    snapshotId: String(value["snapshotId"]),
    observationId: String(value["observationId"]),
    observedAt: canonicalUtcTimestamptz(value["observedAt"]),
  };
}

function parseFreezeAuthority(
  raw: unknown,
  scope: ProjectScope,
  expected?: {
    readonly marketCode: string;
    readonly languageTag: string;
  },
): KeywordGovernanceSuggestionFreezeAuthorityReadResult {
  if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
    throw new Error("invalid Keyword suggestion freezer database response");
  }
  if (raw["rows"].length === 0) return { kind: "unavailable" };
  const row = raw["rows"][0];
  if (!isRecord(row)) {
    throw new Error("invalid Keyword suggestion freezer authority row");
  }
  const profile = ConfirmedProductProfileSchema.safeParse(row["profile"]);
  const marketCode = row["market_code"];
  const rawLanguageTag = row["language_tag"];
  const languageTag = canonicalSiteLanguageIdentity(rawLanguageTag);
  if (languageTag === null) return { kind: "unavailable" };
  if (
    !profile.success ||
    typeof marketCode !== "string" ||
    !MARKET.test(marketCode) ||
    (expected !== undefined &&
      (marketCode !== expected.marketCode ||
        languageTag !== expected.languageTag)) ||
    row["workspace_id"] !== scope.workspaceId ||
    row["project_id"] !== scope.projectId ||
    row["market_code"] !== marketCode ||
    row["primary_market_code"] !== marketCode ||
    row["primary_language_tag"] !== rawLanguageTag ||
    !UUID.test(String(row["profile_id"])) ||
    !Number.isSafeInteger(row["profile_version"]) ||
    Number(row["profile_version"]) < 1 ||
    !HASH.test(String(row["profile_content_hash"])) ||
    !UUID.test(String(row["topic_revision_id"])) ||
    !Number.isSafeInteger(row["topic_revision"]) ||
    Number(row["topic_revision"]) < 1 ||
    !HASH.test(String(row["topic_content_hash"])) ||
    typeof row["has_more"] !== "boolean" ||
    !Array.isArray(row["topics"]) ||
    row["topics"].length > 100 ||
    !Array.isArray(row["pages"]) ||
    row["pages"].length > 100 ||
    !Array.isArray(row["keywords"]) ||
    row["keywords"].length > 100
  ) {
    throw new Error("invalid Keyword suggestion freezer authority row");
  }

  const primaryMarkets = profile.data.targetMarkets.filter(
    (market) => market.priority === "primary",
  );
  const primaryAudiences = profile.data.targetAudiences.filter(
    (audience) => audience.reviewStatus === "primary",
  );
  const primaryAudience = primaryAudiences[0];
  if (
    primaryMarkets.length !== 1 ||
    primaryMarkets[0]?.marketCode !== marketCode ||
    primaryAudiences.length !== 1 ||
    primaryAudience?.targetCompanyOrAudience === null ||
    primaryAudience === undefined
  ) {
    throw new Error("confirmed Product Profile freezer authority is invalid");
  }

  const topics = row["topics"].map((value) => {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 2 ||
      !UUID.test(String(value["topicNodeId"])) ||
      !boundedTrimmedString(value["label"], 1, 500)
    ) {
      throw new Error("invalid confirmed Topic freezer authority");
    }
    return {
      topicNodeId: String(value["topicNodeId"]),
      label: value["label"],
    };
  });
  if (new Set(topics.map((topic) => topic.topicNodeId)).size !== topics.length) {
    throw new Error("duplicate confirmed Topic freezer authority");
  }

  const pages = row["pages"].map((value) => {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 4 ||
      !UUID.test(String(value["sitePageId"])) ||
      !boundedTrimmedString(value["normalizedUrl"], 1, 2_048) ||
      !boundedTrimmedString(value["title"], 1, 500) ||
      value["owned"] !== true
    ) {
      throw new Error("invalid owned Page freezer authority");
    }
    try {
      new URL(value["normalizedUrl"]);
    } catch {
      throw new Error("invalid owned Page freezer URL");
    }
    return {
      sitePageId: String(value["sitePageId"]),
      normalizedUrl: value["normalizedUrl"],
      title: value["title"],
      owned: true as const,
    };
  });
  if (new Set(pages.map((page) => page.sitePageId)).size !== pages.length) {
    throw new Error("duplicate owned Page freezer authority");
  }

  if (row["keywords"].length === 0) return { kind: "no_candidates" };

  const keywords = row["keywords"].map((value) => {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 15 ||
      !UUID.test(String(value["keywordId"])) ||
      !boundedTrimmedString(value["displayKeyword"], 1, 500) ||
      !boundedTrimmedString(value["normalizedKeyword"], 1, 500) ||
      value["marketCode"] !== marketCode ||
      value["languageTag"] !== languageTag ||
      value["queryKind"] !== "search_query" ||
      value["status"] !== "candidate" ||
      value["reviewState"] !== "unreviewed" ||
      value["reviewOrigin"] !== null ||
      value["hasHumanDecision"] !== false ||
      !Number.isSafeInteger(value["governanceRevision"]) ||
      Number(value["governanceRevision"]) < 0 ||
      Number(value["governanceRevision"]) > 2_147_483_646 ||
      (value["topicNodeId"] !== null &&
        !UUID.test(String(value["topicNodeId"]))) ||
      (value["topicModelRevision"] !== null &&
        (!Number.isSafeInteger(value["topicModelRevision"]) ||
          Number(value["topicModelRevision"]) < 1)) ||
      (value["topicNodeId"] === null) !==
        (value["topicModelRevision"] === null) ||
      (value["mappedSitePageId"] !== null &&
        !UUID.test(String(value["mappedSitePageId"]))) ||
      (value["mappedSitePageId"] !== null && value["topicNodeId"] === null) ||
      !Array.isArray(value["occurrences"]) ||
      value["occurrences"].length < 1 ||
      value["occurrences"].length > 100
    ) {
      throw new Error("invalid Keyword candidate freezer authority");
    }
    const occurrences = value["occurrences"].map((occurrence) => {
      if (
        !isRecord(occurrence) ||
        Object.keys(occurrence).length !== 6 ||
        !UUID.test(String(occurrence["occurrenceId"])) ||
        occurrence["marketCode"] !== marketCode ||
        occurrence["languageTag"] !== languageTag ||
        occurrence["valid"] !== true ||
        !boundedTrimmedString(occurrence["sourceKind"], 1, 100)
      ) {
        throw new Error("invalid Keyword occurrence freezer authority");
      }
      return {
        occurrenceId: String(occurrence["occurrenceId"]),
        marketCode,
        languageTag,
        valid: true as const,
        sourceKind: occurrence["sourceKind"],
        providerSearchIntent: parseProviderIntent(
          occurrence["providerSearchIntent"],
        ),
      };
    });
    const occurrenceIds = occurrences.map((occurrence) =>
      occurrence.occurrenceId
    );
    if (
      new Set(occurrenceIds).size !== occurrenceIds.length ||
      [...occurrenceIds].sort().some((id, index) => id !== occurrenceIds[index])
    ) {
      throw new Error("Keyword occurrence window is not canonical");
    }
    return {
      keywordId: String(value["keywordId"]),
      displayKeyword: value["displayKeyword"],
      normalizedKeyword: value["normalizedKeyword"],
      marketCode,
      languageTag,
      queryKind: "search_query" as const,
      status: "candidate" as const,
      reviewState: "unreviewed" as const,
      reviewOrigin: null,
      hasHumanDecision: false as const,
      governanceRevision: Number(value["governanceRevision"]),
      topicNodeId: value["topicNodeId"] === null
        ? null
        : String(value["topicNodeId"]),
      topicModelRevision: value["topicModelRevision"] === null
        ? null
        : Number(value["topicModelRevision"]),
      mappedSitePageId: value["mappedSitePageId"] === null
        ? null
        : String(value["mappedSitePageId"]),
      occurrences,
    };
  });
  const keywordIds = keywords.map((keyword) => keyword.keywordId);
  const orderedKeywordKeys = keywords.map((keyword) =>
    `${keyword.normalizedKeyword}\u0000${keyword.displayKeyword}\u0000${keyword.keywordId}`
  );
  if (
    new Set(keywordIds).size !== keywordIds.length ||
    [...orderedKeywordKeys].sort().some(
      (key, index) => key !== orderedKeywordKeys[index],
    )
  ) {
    throw new Error("Keyword candidate freezer order is not canonical");
  }
  const topicIds = new Set(topics.map((topic) => topic.topicNodeId));
  const pageIds = new Set(pages.map((page) => page.sitePageId));
  if (keywords.some((keyword) =>
    (keyword.topicNodeId !== null && !topicIds.has(keyword.topicNodeId)) ||
    (keyword.mappedSitePageId !== null && !pageIds.has(keyword.mappedSitePageId))
  )) {
    throw new Error("current Keyword authority is absent from bounded allowlists");
  }

  return {
    kind: "ready",
    hasMore: row["has_more"],
    authority: {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      marketCode,
      languageTag,
      primaryMarketCode: marketCode,
      primaryLanguageTag: languageTag,
      confirmedProductProfile: {
        state: "confirmed",
        productProfileId: String(row["profile_id"]),
        version: Number(row["profile_version"]),
        contentHash: String(row["profile_content_hash"]),
        facts: {
          productName: profile.data.productName,
          category: profile.data.category,
          valueProposition: profile.data.valueProposition,
          targetAudience: primaryAudience.targetCompanyOrAudience,
          buyerRoles: primaryAudience.buyerRoles,
          pains: primaryAudience.pains,
          outcomes: primaryAudience.outcomes,
        },
      },
      confirmedTopicModel: {
        state: "confirmed",
        topicModelRevisionId: String(row["topic_revision_id"]),
        revision: Number(row["topic_revision"]),
        contentHash: String(row["topic_content_hash"]),
        topics,
      },
      pages,
      keywords,
    },
  };
}

export class KeywordGovernanceSuggestionGenerationRunsRepository extends Repository {
  /**
   * Reads the complete bounded freezer authority in one project-scoped SQL
   * statement. The 101st eligible Keyword is retained only as a pagination
   * sentinel, so the returned authority is always safe for the 100-item v1
   * freezer and never requires per-Keyword follow-up queries.
   */
  async readFreezeAuthority(
    scope: ProjectScope,
    options?: {
      readonly marketCode: string;
      readonly languageTag: string;
    },
  ): Promise<KeywordGovernanceSuggestionFreezeAuthorityReadResult> {
    if (
      !UUID.test(scope.workspaceId) ||
      !UUID.test(scope.projectId) ||
      (options !== undefined &&
        (!MARKET.test(options.marketCode) ||
          !boundedTrimmedString(options.languageTag, 2, 35)))
    ) {
      return { kind: "unavailable" };
    }
    const requestedAuthority = options === undefined
      ? sql`true`
      : sql`
          primary_market.market_code = ${options.marketCode}
          and app.is_bcp47_canonical_identity(
            primary_site.language_codes[1],
            ${options.languageTag}
          )
        `;
    const raw = await this.exec.execute(sql`
      with scoped_authority as (
        select
          project.workspace_id,
          project.id as project_id,
          primary_site.language_codes[1] as primary_language_tag,
          primary_market.market_code as primary_market_code,
          profile.id as profile_id,
          profile.version as profile_version,
          profile.content_hash as profile_content_hash,
          profile.profile,
          primary_site.id as primary_site_id
        from app.client_projects project
        inner join app.icp_profiles profile
          on profile.id = project.confirmed_icp_profile_id
         and profile.workspace_id = project.workspace_id
         and profile.project_id = project.id
         and profile.status = 'complete'
        inner join lateral (
          select market.value ->> 'marketCode' as market_code
          from jsonb_array_elements(profile.profile -> 'targetMarkets')
            market(value)
          where market.value ->> 'priority' = 'primary'
        ) primary_market on true
        inner join app.sites primary_site
          on primary_site.workspace_id = project.workspace_id
         and primary_site.project_id = project.id
         and primary_site.is_primary
         and cardinality(primary_site.language_codes) = 1
        where project.workspace_id = ${scope.workspaceId}::uuid
          and project.id = ${scope.projectId}::uuid
          and project.archived_at is null
          and ${requestedAuthority}
          and primary_market.market_code = any(primary_site.market_codes)
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
                primary_market.market_code
          )
        order by primary_site.id
        limit 1
      ), latest_topic as (
        select revision.*
        from scoped_authority authority
        inner join lateral (
          select candidate.*
          from app.topic_model_revisions candidate
          where candidate.workspace_id = authority.workspace_id
            and candidate.project_id = authority.project_id
            and candidate.status = 'confirmed'
            and candidate.content_hash is not null
          order by candidate.revision desc, candidate.id desc
          limit 1
        ) revision on true
      ), eligible_keywords as (
        select
          keyword.*,
          current_decision.topic_node_id,
          current_decision.topic_model_revision
        from scoped_authority authority
        inner join latest_topic topic_model
          on topic_model.workspace_id = authority.workspace_id
         and topic_model.project_id = authority.project_id
        inner join app.keyword_entities keyword
          on keyword.workspace_id = authority.workspace_id
         and keyword.project_id = authority.project_id
        inner join app.keyword_review_decisions current_decision
          on current_decision.workspace_id = keyword.workspace_id
         and current_decision.project_id = keyword.project_id
         and current_decision.keyword_entity_id = keyword.id
         and current_decision.governance_revision = keyword.mapping_revision
         and current_decision.status = keyword.status
         and current_decision.intent is not distinct from keyword.intent
         and current_decision.buyer_stage is not distinct from keyword.buyer_stage
         and current_decision.mapping_decision = keyword.mapping_decision
         and current_decision.mapped_site_page_id is not distinct from
           keyword.mapped_site_page_id
         and current_decision.review_state = keyword.mapping_review_state
        where keyword.query_kind = 'search_query'
          and keyword.status = 'candidate'
          and keyword.mapping_review_state = 'unreviewed'
          and keyword.market = authority.primary_market_code
          and app.is_bcp47_canonical_identity(
            authority.primary_language_tag,
            keyword.language_tag
          )
          and jsonb_array_length(
            app.current_keyword_governance_suggestion_occurrence_ids(
              keyword.workspace_id,
              keyword.project_id,
              keyword.id,
              keyword.display_keyword,
              keyword.normalized_keyword,
              keyword.market,
              keyword.language_tag
            )
          ) between 1 and 100
          and not exists (
            select 1
            from app.keyword_review_decisions human_decision
            where human_decision.workspace_id = keyword.workspace_id
              and human_decision.project_id = keyword.project_id
              and human_decision.keyword_entity_id = keyword.id
              and human_decision.decision_origin = 'user'
          )
          and not exists (
            select 1
            from app.keyword_review_suggestions pending
            where pending.workspace_id = keyword.workspace_id
              and pending.project_id = keyword.project_id
              and pending.keyword_entity_id = keyword.id
              and pending.status = 'pending'
          )
          and (
            current_decision.topic_node_id is null
            or exists (
              select 1
              from app.topic_node_revisions node
              where node.workspace_id = keyword.workspace_id
                and node.project_id = keyword.project_id
                and node.topic_node_id = current_decision.topic_node_id
                and node.topic_model_revision = topic_model.revision
                and current_decision.topic_model_revision = topic_model.revision
                and node.lifecycle_state = 'active'
            )
          )
          and (
            keyword.mapped_site_page_id is null
            or exists (
              select 1
              from app.site_pages mapped_page
              where mapped_page.id = keyword.mapped_site_page_id
                and mapped_page.workspace_id = keyword.workspace_id
                and mapped_page.project_id = keyword.project_id
                and mapped_page.site_id = authority.primary_site_id
            )
          )
          and (
            keyword.mapped_site_page_id is null
            or current_decision.topic_node_id is not null
          )
        order by keyword.normalized_keyword, keyword.display_keyword, keyword.id
        limit 101
      ), batch_keywords as (
        select *
        from eligible_keywords
        order by normalized_keyword, display_keyword, id
        limit 100
      ), required_topics as (
        select distinct topic_node_id
        from batch_keywords
        where topic_node_id is not null
      ), selected_topics as (
        select node.topic_node_id, node.label
        from latest_topic topic_model
        inner join app.topic_node_revisions node
          on node.workspace_id = topic_model.workspace_id
         and node.project_id = topic_model.project_id
         and node.topic_model_revision = topic_model.revision
         and node.lifecycle_state = 'active'
        left join required_topics required
          on required.topic_node_id = node.topic_node_id
        order by
          case when required.topic_node_id is null then 1 else 0 end,
          node.label,
          node.topic_node_id
        limit 100
      ), required_pages as (
        select distinct mapped_site_page_id
        from batch_keywords
        where mapped_site_page_id is not null
      ), selected_pages as (
        select
          page.id,
          page.normalized_url,
          coalesce(
            nullif(btrim(latest_snapshot.extract ->> 'title'), ''),
            left(page.normalized_url, 500)
          ) as title
        from scoped_authority authority
        inner join app.site_pages page
          on page.workspace_id = authority.workspace_id
         and page.project_id = authority.project_id
         and page.site_id = authority.primary_site_id
        left join required_pages required
          on required.mapped_site_page_id = page.id
        left join lateral (
          select snapshot.extract
          from app.page_snapshots snapshot
          where snapshot.workspace_id = page.workspace_id
            and snapshot.project_id = page.project_id
            and snapshot.site_page_id = page.id
          order by snapshot.captured_at desc, snapshot.id desc
          limit 1
        ) latest_snapshot on true
        order by
          case when required.mapped_site_page_id is null then 1 else 0 end,
          page.normalized_url,
          page.id
        limit 100
      )
      select
        authority.workspace_id::text as workspace_id,
        authority.project_id::text as project_id,
        authority.primary_market_code as market_code,
        authority.primary_language_tag as language_tag,
        authority.primary_market_code,
        authority.primary_language_tag,
        authority.profile_id::text as profile_id,
        authority.profile_version,
        authority.profile_content_hash,
        authority.profile,
        topic_model.id::text as topic_revision_id,
        topic_model.revision as topic_revision,
        topic_model.content_hash as topic_content_hash,
        (select count(*) from eligible_keywords) > 100 as has_more,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'topicNodeId', topic.topic_node_id,
            'label', topic.label
          ) order by topic.label, topic.topic_node_id)
          from selected_topics topic
        ), '[]'::jsonb) as topics,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'sitePageId', page.id,
            'normalizedUrl', page.normalized_url,
            'title', page.title,
            'owned', true
          ) order by page.normalized_url, page.id)
          from selected_pages page
        ), '[]'::jsonb) as pages,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'keywordId', keyword.id,
            'displayKeyword', keyword.display_keyword,
            'normalizedKeyword', keyword.normalized_keyword,
            'marketCode', keyword.market,
            'languageTag', keyword.language_tag,
            'queryKind', 'search_query',
            'status', 'candidate',
            'reviewState', 'unreviewed',
            'reviewOrigin', null,
            'hasHumanDecision', false,
            'governanceRevision', keyword.mapping_revision,
            'topicNodeId', keyword.topic_node_id,
            'topicModelRevision', keyword.topic_model_revision,
            'mappedSitePageId', keyword.mapped_site_page_id,
            'occurrences', (
              select jsonb_agg(jsonb_build_object(
                'occurrenceId', occurrence.id,
                'marketCode', occurrence.market,
                'languageTag', occurrence.language_tag,
                'valid', true,
                'sourceKind', occurrence.source_kind,
                'providerSearchIntent', case
                  when occurrence.source_kind = 'dataforseo_ranked'
                    and observation.value_json ? 'providerSearchIntent'
                    and observation.value_json -> 'providerSearchIntent'
                      <> 'null'::jsonb
                  then jsonb_build_object(
                    'value', observation.value_json -> 'providerSearchIntent',
                    'snapshotId', occurrence.data_snapshot_id,
                    'observationId', occurrence.normalized_observation_id,
                    'observedAt', observation.observed_at::text
                  )
                  else null
                end
              ) order by occurrence.id)
              from jsonb_array_elements_text(
                app.current_keyword_governance_suggestion_occurrence_ids(
                  keyword.workspace_id,
                  keyword.project_id,
                  keyword.id,
                  keyword.display_keyword,
                  keyword.normalized_keyword,
                  keyword.market,
                  keyword.language_tag
                )
              ) current_occurrence(value)
              inner join app.keyword_occurrences occurrence
                on occurrence.id = current_occurrence.value::uuid
               and occurrence.workspace_id = keyword.workspace_id
               and occurrence.project_id = keyword.project_id
              left join app.normalized_observations observation
                on observation.id = occurrence.normalized_observation_id
               and observation.workspace_id = occurrence.workspace_id
               and observation.project_id = occurrence.project_id
               and observation.snapshot_id = occurrence.data_snapshot_id
            )
          ) order by
            keyword.normalized_keyword,
            keyword.display_keyword,
            keyword.id)
          from batch_keywords keyword
        ), '[]'::jsonb) as keywords
      from scoped_authority authority
      inner join latest_topic topic_model
        on topic_model.workspace_id = authority.workspace_id
       and topic_model.project_id = authority.project_id
    `);
    return parseFreezeAuthority(
      raw,
      scope,
      options,
    );
  }

  /** Scheduler authority: derive the sole confirmed primary market/locale. */
  async readPrimaryFreezeAuthority(
    scope: ProjectScope,
  ): Promise<KeywordGovernanceSuggestionFreezeAuthorityReadResult> {
    return this.readFreezeAuthority(scope);
  }

  async insertPlaceholder(values: {
    readonly runId: string;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly inputManifest: unknown;
    readonly inputHash: string;
  }): Promise<KeywordGovernanceSuggestionGenerationRunRow> {
    const manifest = freezeManifest(values.inputManifest);
    if (
      !UUID.test(values.runId) ||
      !UUID.test(values.workspaceId) ||
      !UUID.test(values.projectId) ||
      manifest.workspaceId !== values.workspaceId ||
      manifest.projectId !== values.projectId ||
      contentHash(manifest as CanonicalValue) !== values.inputHash
    ) {
      throw new RangeError("Keyword suggestion generation manifest/hash scope mismatch");
    }
    const [inserted] = await this.exec
      .insert(keywordGovernanceSuggestionGenerationRuns)
      .values({
        id: values.runId,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        generation_version: manifest.generationVersion,
        prompt_set_version: manifest.promptSetVersion,
        input_manifest: manifest,
        input_hash: values.inputHash,
      })
      .returning();
    const row = parseRun(inserted);
    if (row === null) {
      throw new Error("invalid Keyword suggestion generation run row");
    }
    return row;
  }

  async findById(
    scope: ProjectScope,
    runId: string,
  ): Promise<KeywordGovernanceSuggestionGenerationRunRow | null> {
    const rows = await this.exec
      .select()
      .from(keywordGovernanceSuggestionGenerationRuns)
      .where(
        and(
          projectPredicate(keywordGovernanceSuggestionGenerationRuns, scope),
          eq(keywordGovernanceSuggestionGenerationRuns.id, runId),
        ),
      )
      .limit(1);
    if (!rows[0]) return null;
    const row = parseRun(rows[0]);
    if (row === null) {
      throw new Error("invalid Keyword suggestion generation run row");
    }
    return row;
  }

  async findLatestByInputHash(
    scope: ProjectScope,
    inputHash: string,
  ): Promise<KeywordGovernanceSuggestionGenerationRunRow | null> {
    if (!HASH.test(inputHash)) return null;
    const rows = await this.exec
      .select()
      .from(keywordGovernanceSuggestionGenerationRuns)
      .where(
        and(
          projectPredicate(keywordGovernanceSuggestionGenerationRuns, scope),
          eq(
            keywordGovernanceSuggestionGenerationRuns.input_hash,
            inputHash,
          ),
        ),
      )
      .orderBy(
        desc(keywordGovernanceSuggestionGenerationRuns.created_at),
        desc(keywordGovernanceSuggestionGenerationRuns.id),
      )
      .limit(1);
    if (!rows[0]) return null;
    const row = parseRun(rows[0]);
    if (row === null) {
      throw new Error("invalid Keyword suggestion generation run row");
    }
    return row;
  }

  async findCurrentGenerationForKeyword(
    scope: ProjectScope,
    keywordId: string,
  ): Promise<CurrentKeywordGovernanceSuggestionGeneration | null> {
    const latest = await this.findGenerationForKeyword(
      scope,
      keywordId,
      true,
    );
    if (
      latest === null ||
      !latest.authorityCurrent ||
      (latest.status !== "queued" && latest.status !== "running")
    ) {
      return null;
    }
    return {
      ...latest,
      status: latest.status,
      safeTerminalCode: null,
      authorityCurrent: true,
    };
  }

  async findLatestGenerationForKeyword(
    scope: ProjectScope,
    keywordId: string,
  ): Promise<LatestKeywordGovernanceSuggestionGeneration | null> {
    return this.findGenerationForKeyword(scope, keywordId, false);
  }

  private async findGenerationForKeyword(
    scope: ProjectScope,
    keywordId: string,
    activeOnly: boolean,
  ): Promise<LatestKeywordGovernanceSuggestionGeneration | null> {
    if (!UUID.test(keywordId)) return null;
    const statusPredicate = activeOnly
      ? sql`run.status in ('queued', 'running')`
      : sql`run.status in (
          'queued', 'running', 'completed', 'failed', 'cancelled'
        )`;
    const raw = await this.exec.execute(sql`
      select
        generation.*,
        run.status as async_status,
        case
          when run.status in ('failed', 'cancelled')
            and run.last_error_code in (
              'KEYWORD_GOVERNANCE_SUGGESTION_RUN_INVALID',
              'KEYWORD_GOVERNANCE_SUGGESTION_INPUT_INVALID',
              'KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN',
              'KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_BUDGET_EXHAUSTED',
              'KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_CONFIGURATION_MISMATCH',
              'KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE',
              'KEYWORD_GOVERNANCE_SUGGESTION_CONCURRENT_HUMAN',
              'KEYWORD_GOVERNANCE_SUGGESTION_BATCH_CONFLICT'
            )
          then run.last_error_code
          else null
        end as safe_terminal_code,
        frozen.value as frozen_candidate,
        (
          exists (
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
             and cardinality(primary_site.language_codes) = 1
            where project.workspace_id = generation.workspace_id
              and project.id = generation.project_id
              and project.archived_at is null
              and generation.input_manifest ->> 'marketCode' =
                any(primary_site.market_codes)
              and app.is_bcp47_canonical_identity(
                primary_site.language_codes[1],
                generation.input_manifest ->> 'languageTag'
              )
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
          )
          and exists (
            select 1
            from app.keyword_entities keyword
            inner join app.keyword_review_decisions current_decision
              on current_decision.workspace_id = keyword.workspace_id
             and current_decision.project_id = keyword.project_id
             and current_decision.keyword_entity_id = keyword.id
             and current_decision.governance_revision =
               keyword.mapping_revision
             and current_decision.status = keyword.status
             and current_decision.intent is not distinct from keyword.intent
             and current_decision.buyer_stage is not distinct from
               keyword.buyer_stage
             and current_decision.mapping_decision = keyword.mapping_decision
             and current_decision.mapped_site_page_id is not distinct from
               keyword.mapped_site_page_id
             and current_decision.review_state = keyword.mapping_review_state
            where keyword.id = ${keywordId}::uuid
              and keyword.workspace_id = generation.workspace_id
              and keyword.project_id = generation.project_id
              and keyword.query_kind = 'search_query'
              and keyword.status = 'candidate'
              and keyword.mapping_review_state = 'unreviewed'
              and keyword.mapping_revision =
                (frozen.value ->> 'expectedGovernanceRevision')::integer
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
              and (
                (
                  frozen.value #>>
                    '{deterministicEvidence,currentTopicKey}' is null
                  and current_decision.topic_node_id is null
                  and current_decision.topic_model_revision is null
                )
                or exists (
                  select 1
                  from jsonb_array_elements(
                    generation.input_manifest -> 'topicAllowlist'
                  ) allowed_topic(value)
                  inner join app.topic_node_revisions current_topic
                    on current_topic.workspace_id = keyword.workspace_id
                   and current_topic.project_id = keyword.project_id
                   and current_topic.topic_node_id =
                     (allowed_topic.value ->> 'topicNodeId')::uuid
                   and current_topic.topic_model_revision =
                     (allowed_topic.value ->> 'topicModelRevision')::integer
                   and current_topic.lifecycle_state = 'active'
                  where allowed_topic.value ->> 'topicKey' = frozen.value #>>
                    '{deterministicEvidence,currentTopicKey}'
                    and current_decision.topic_node_id =
                      current_topic.topic_node_id
                    and current_decision.topic_model_revision =
                      current_topic.topic_model_revision
                )
              )
              and (
                (
                  frozen.value #>>
                    '{deterministicEvidence,currentPageKey}' is null
                  and keyword.mapped_site_page_id is null
                )
                or exists (
                  select 1
                  from jsonb_array_elements(
                    generation.input_manifest -> 'pageAllowlist'
                  ) allowed_page(value)
                  inner join app.site_pages current_page
                    on current_page.id =
                      (allowed_page.value ->> 'sitePageId')::uuid
                   and current_page.workspace_id = keyword.workspace_id
                   and current_page.project_id = keyword.project_id
                  inner join app.sites current_site
                    on current_site.id = current_page.site_id
                   and current_site.workspace_id = current_page.workspace_id
                   and current_site.project_id = current_page.project_id
                   and current_site.is_primary
                  where allowed_page.value ->> 'pageKey' = frozen.value #>>
                    '{deterministicEvidence,currentPageKey}'
                    and keyword.mapped_site_page_id = current_page.id
                )
              )
          )
          and app.current_keyword_governance_suggestion_occurrence_ids(
            generation.workspace_id,
            generation.project_id,
            ${keywordId}::uuid,
            frozen.value ->> 'displayKeyword',
            frozen.value ->> 'normalizedKeyword',
            generation.input_manifest ->> 'marketCode',
            generation.input_manifest ->> 'languageTag'
          ) = frozen.value #>
            '{deterministicEvidence,sourceOccurrenceIds}'
        ) as authority_current,
        exists (
          select 1
          from app.keyword_review_suggestions suggestion
          where suggestion.workspace_id = generation.workspace_id
            and suggestion.project_id = generation.project_id
            and suggestion.generation_run_id = generation.id
            and suggestion.keyword_entity_id = ${keywordId}::uuid
            and suggestion.output_ordinal =
              (frozen.value ->> 'ordinal')::integer
        ) as has_suggestion,
        (
          select count(*)::integer
          from app.keyword_governance_suggestion_generation_runs active_generation
          inner join app.async_runs active_run
            on active_run.id = active_generation.id
           and active_run.workspace_id = active_generation.workspace_id
           and active_run.project_id = active_generation.project_id
           and active_run.kind = 'keyword_governance_suggestion_generation'
           and active_run.result_type =
             'keyword_governance_suggestion_generation_run'
           and active_run.result_id = active_generation.id
           and active_run.status in ('queued', 'running')
          cross join lateral jsonb_array_elements(
            active_generation.input_manifest -> 'candidates'
          ) active_frozen(value)
          where active_generation.workspace_id = generation.workspace_id
            and active_generation.project_id = generation.project_id
            and active_frozen.value ->> 'keywordId' = ${keywordId}
        ) as active_generation_count
      from app.keyword_governance_suggestion_generation_runs generation
      inner join app.async_runs run
        on run.id = generation.id
       and run.workspace_id = generation.workspace_id
       and run.project_id = generation.project_id
       and run.kind = 'keyword_governance_suggestion_generation'
       and run.result_type =
         'keyword_governance_suggestion_generation_run'
       and run.result_id = generation.id
       and ${statusPredicate}
      cross join lateral jsonb_array_elements(
        generation.input_manifest -> 'candidates'
      ) frozen(value)
      where generation.workspace_id = ${scope.workspaceId}::uuid
        and generation.project_id = ${scope.projectId}::uuid
        and frozen.value ->> 'keywordId' = ${keywordId}
      order by generation.created_at desc, generation.id desc
      limit 1
    `);
    if (!isRecord(raw) || !Array.isArray(raw["rows"])) {
      throw new Error("invalid latest Keyword suggestion generation response");
    }
    if (raw["rows"].length === 0) return null;
    const value = raw["rows"][0];
    if (
      !isRecord(value) ||
      !Number.isSafeInteger(value["active_generation_count"]) ||
      Number(value["active_generation_count"]) < 0
    ) {
      throw new Error("invalid latest Keyword suggestion generation count");
    }
    if (Number(value["active_generation_count"]) > 1) {
      throw new Error("multiple active Keyword suggestion generations exist");
    }
    const run = parseRun(value);
    const asyncStatus = value["async_status"];
    const safeTerminalCode = value["safe_terminal_code"];
    if (
      run === null ||
      (asyncStatus !== "queued" &&
        asyncStatus !== "running" &&
        asyncStatus !== "completed" &&
        asyncStatus !== "failed" &&
        asyncStatus !== "cancelled") ||
      (safeTerminalCode !== null &&
        (typeof safeTerminalCode !== "string" ||
          !SAFE_TERMINAL_CODES.has(
            safeTerminalCode as KeywordGovernanceSuggestionSafeTerminalCode,
          ))) ||
      typeof value["authority_current"] !== "boolean" ||
      typeof value["has_suggestion"] !== "boolean" ||
      ((asyncStatus === "queued" || asyncStatus === "running" ||
        asyncStatus === "completed") && safeTerminalCode !== null)
    ) {
      throw new Error("invalid latest Keyword suggestion generation row");
    }
    const candidates = run.input_manifest.candidates.filter(
      (candidate) => candidate.keywordId === keywordId,
    );
    const candidate = candidates[0];
    const frozen = value["frozen_candidate"];
    if (
      candidates.length !== 1 ||
      candidate === undefined ||
      !isRecord(frozen) ||
      frozen["keywordId"] !== keywordId ||
      frozen["expectedGovernanceRevision"] !==
        candidate.expectedGovernanceRevision
    ) {
      throw new Error("invalid current Keyword suggestion frozen candidate");
    }
    return {
      suggestionId: run.id,
      generationRunId: run.id,
      keywordId,
      expectedGovernanceRevision:
        candidate.expectedGovernanceRevision,
      createdAt: run.created_at,
      status: asyncStatus,
      safeTerminalCode: safeTerminalCode as
        | KeywordGovernanceSuggestionSafeTerminalCode
        | null,
      authorityCurrent: value["authority_current"],
      hasSuggestion: value["has_suggestion"],
    };
  }

  async terminalize(
    attempt: RunAttempt,
    input: KeywordGovernanceSuggestionGenerationTerminalInput,
  ): Promise<KeywordGovernanceSuggestionGenerationTerminalizeResult> {
    if (!validAttempt(attempt)) return { kind: "stale" };
    if (!validTerminal(input)) return { kind: "conflict", run: null };
    const raw = await this.exec.execute(sql`
      select app.terminalize_keyword_governance_suggestion_generation_run(
        ${attempt.workspaceId}::uuid,
        ${attempt.projectId}::uuid,
        ${attempt.runId}::uuid,
        ${attempt.attemptCount}::integer,
        ${input.status}::text,
        ${input.resultOutputHash}::text,
        ${input.lastErrorCode}::text,
        ${input.lastErrorSummary}::text
      ) as result
    `);
    const result = firstResult(raw);
    if (result["kind"] === "stale") return { kind: "stale" };
    if (result["kind"] === "conflict") {
      const run = result["run"] == null ? null : parseRun(result["run"]);
      if (run !== null || result["run"] == null) return { kind: "conflict", run };
    }
    if (result["kind"] === "terminalized") {
      const run = parseRun(result["run"]);
      if (run !== null) return { kind: "terminalized", run };
    }
    throw new Error("invalid Keyword suggestion generation terminal result");
  }
}
