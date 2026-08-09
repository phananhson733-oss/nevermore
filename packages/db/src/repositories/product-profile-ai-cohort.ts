import { and, eq, sql } from "drizzle-orm";
import { sha256Hex } from "../hash.ts";
import { clientProjects, keywordEntities } from "../schema.ts";
import type { DbTx } from "../client.ts";
import { IcpProfilesRepository } from "./icp-profiles.ts";
import {
  KeywordGovernanceRepository,
  type SystemKeywordApprovalInput,
} from "./keyword-governance.ts";
import {
  KeywordsRepository,
  type KeywordEntityRow,
} from "./keywords.ts";
import {
  KeywordOccurrencesRepository,
  normalizeKeywordIdentity,
  type ProductProfileKeywordOccurrenceInput,
} from "./keyword-occurrences.ts";
import { Repository, type Executor, type ProjectScope } from "./base.ts";
import { acquireTopicGovernanceProjectWriterLock } from "./topic-models.ts";

export interface ProductProfileGenerativeQueryAudience {
  readonly reviewStatus: string;
  readonly targetCompanyOrAudience: string | null;
  readonly buyerRoles: readonly string[];
  readonly userRoles: readonly string[];
  readonly useCases: readonly string[];
  readonly triggers: readonly string[];
  readonly pains: readonly string[];
  readonly jtbd: readonly string[];
}

export interface ProductProfileGenerativeQueryCompetitor {
  readonly reviewStatus: string;
  readonly name: string;
  readonly domain: string;
}

export interface ProductProfileGenerativeQueryProfile {
  readonly productName: string;
  readonly category: string;
  readonly productType: string;
  readonly valueProposition: string;
  readonly coreFeatures: readonly string[];
  readonly targetAudiences: readonly ProductProfileGenerativeQueryAudience[];
  readonly competitorCandidates: readonly ProductProfileGenerativeQueryCompetitor[];
}

export interface ProductProfileAiCohortBootstrapInput {
  readonly confirmedProfileId: string;
  readonly confirmedProfileVersion: number;
  readonly confirmedProfileContentHash: string;
  readonly confirmedAt: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly profile: ProductProfileGenerativeQueryProfile;
}

export interface DerivedProductProfileGenerativeQuery {
  readonly templateId: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
  readonly sourceRef: string;
}

export type DerivedProductProfileGenerativeQueryResult =
  | {
      readonly status: "ready";
      readonly queries: readonly DerivedProductProfileGenerativeQuery[];
    }
  | {
      readonly status: "skipped_unsupported_locale" | "skipped_inexact_generation";
      readonly queries: readonly [];
    };

export type ProductProfileAiCohortBootstrapResult =
  | {
      readonly status: "bootstrapped";
      readonly bootstrappedCount: number;
      readonly existingQueryCount: 0;
      readonly querySetHash: string;
    }
  | {
      readonly status:
        | "skipped_existing_queries"
        | "skipped_unsupported_locale"
        | "skipped_inexact_generation";
      readonly bootstrappedCount: 0;
      readonly existingQueryCount: number;
      readonly querySetHash: null;
    };

interface ProductProfileAiCohortAdapters {
  readonly countGenerativeQueries: (
    scope: ProjectScope,
  ) => Promise<number>;
  readonly upsertManyIntoLibrary: (
    scope: ProjectScope,
    inputs: readonly ProductProfileKeywordOccurrenceInput[],
  ) => Promise<readonly { readonly occurrenceId: string; readonly entityId: string }[]>;
  readonly listKeywordsByIds: (
    scope: ProjectScope,
    entityIds: readonly string[],
  ) => Promise<readonly KeywordEntityRow[]>;
  readonly applySystemApprovals: (
    scope: ProjectScope,
    inputs: readonly SystemKeywordApprovalInput[],
  ) => Promise<
    readonly {
      readonly keywordId: string;
      readonly applied: boolean;
      readonly skipped: string | null;
      readonly governanceRevision: number | null;
    }[]
  >;
  readonly assertConfirmedProfileIdentity: (
    scope: ProjectScope,
    input: ProductProfileAiCohortBootstrapInput,
  ) => Promise<void>;
}

const GENERATIVE_QUERY_COUNT_LIMIT = 10_000;
const EXACT_QUERY_COUNT = 20;

/**
 * Preserve the Site's stored spelling while deriving one canonical occurrence
 * tag. Product Profile cohort authority accepts case-only BCP-47 differences;
 * aliases that change identity remain ambiguous so dry-run and PostgreSQL
 * apply cannot disagree.
 */
export function canonicalProductProfileSiteLanguageTag(
  rawLanguageTag: string,
): string | null {
  if (rawLanguageTag.trim() !== rawLanguageTag || rawLanguageTag.length > 255) {
    return null;
  }
  try {
    const canonical = Intl.getCanonicalLocales(rawLanguageTag)[0];
    return canonical && canonical.toLowerCase() === rawLanguageTag.toLowerCase()
      ? canonical
      : null;
  } catch {
    return null;
  }
}

type TransactionalExecutor = Executor & {
  transaction<T>(
    callback: (tx: DbTx) => Promise<T>,
  ): Promise<T>;
};

function pickPrimaryAudience(
  profile: ProductProfileGenerativeQueryProfile,
): ProductProfileGenerativeQueryAudience | null {
  return (
    profile.targetAudiences.find(
      (audience) => audience.reviewStatus === "primary",
    ) ?? null
  );
}

function first(values: readonly string[]): string | null {
  return values[0]?.trim() || null;
}

function cleanText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function englishCandidates(
  input: ProductProfileAiCohortBootstrapInput,
): readonly [templateId: string, query: string][] {
  const audience = pickPrimaryAudience(input.profile);
  if (!audience) return [];
  const product = cleanText(input.profile.productName);
  const category = cleanText(input.profile.category);
  const type = cleanText(input.profile.productType);
  const value = cleanText(input.profile.valueProposition);
  const company = cleanText(audience.targetCompanyOrAudience ?? category);
  const buyer = cleanText(first(audience.buyerRoles) ?? category);
  const user = cleanText(first(audience.userRoles) ?? category);
  const useCase = cleanText(first(audience.useCases) ?? category);
  const trigger = cleanText(first(audience.triggers) ?? category);
  const pain = cleanText(first(audience.pains) ?? category);
  const jtbd = cleanText(first(audience.jtbd) ?? category);
  const featureOne = cleanText(first(input.profile.coreFeatures) ?? category);
  const featureTwo = cleanText(input.profile.coreFeatures[1] ?? featureOne);
  const approvedCompetitors = input.profile.competitorCandidates
    .filter((competitor) => competitor.reviewStatus === "approved")
    .map((competitor) => cleanText(competitor.name));
  const competitorOne = approvedCompetitors[0] ?? "alternatives";
  const competitorTwo = approvedCompetitors[1] ?? `${category} alternatives`;

  return [
    ["what-is-product", `what is ${product}`],
    ["product-pricing", `${product} pricing`],
    ["product-reviews", `${product} reviews`],
    ["product-alternatives", `${product} alternatives`],
    ["best-category", `best ${category} software`],
    ["best-category-audience", `best ${category} software for ${company}`],
    ["best-type-audience", `best ${type} for ${company}`],
    ["buyer-use-case", `${buyer} software for ${useCase}`],
    ["user-use-case", `${user} workflow for ${useCase}`],
    ["how-to-jtbd", `how to ${jtbd}`],
    ["how-to-use-case", `how to ${useCase}`],
    ["pain-solution", `${pain} solution`],
    ["trigger-process", `${trigger} process`],
    ["feature-software-1", `${featureOne} software`],
    ["feature-workflow-2", `${featureTwo} workflow`],
    ["value-proposition", value],
    ["category-comparison", `${category} comparison`],
    ["product-implementation", `${product} implementation`],
    ["compare-approved-competitor-1", `${product} vs ${competitorOne}`],
    ["compare-approved-competitor-2", `${product} vs ${competitorTwo}`],
  ];
}

function chineseCandidates(
  input: ProductProfileAiCohortBootstrapInput,
): readonly [templateId: string, query: string][] {
  const audience = pickPrimaryAudience(input.profile);
  if (!audience) return [];
  const product = cleanText(input.profile.productName);
  const category = cleanText(input.profile.category);
  const type = cleanText(input.profile.productType);
  const value = cleanText(input.profile.valueProposition);
  const company = cleanText(audience.targetCompanyOrAudience ?? category);
  const buyer = cleanText(first(audience.buyerRoles) ?? category);
  const user = cleanText(first(audience.userRoles) ?? category);
  const useCase = cleanText(first(audience.useCases) ?? category);
  const trigger = cleanText(first(audience.triggers) ?? category);
  const pain = cleanText(first(audience.pains) ?? category);
  const jtbd = cleanText(first(audience.jtbd) ?? category);
  const featureOne = cleanText(first(input.profile.coreFeatures) ?? category);
  const featureTwo = cleanText(input.profile.coreFeatures[1] ?? featureOne);
  const approvedCompetitors = input.profile.competitorCandidates
    .filter((competitor) => competitor.reviewStatus === "approved")
    .map((competitor) => cleanText(competitor.name));
  const competitorOne = approvedCompetitors[0] ?? "替代方案";
  const competitorTwo = approvedCompetitors[1] ?? `${category} 替代方案`;

  return [
    ["what-is-product", `${product} 是什么`],
    ["product-pricing", `${product} 价格`],
    ["product-reviews", `${product} 评价`],
    ["product-alternatives", `${product} 替代方案`],
    ["best-category", `最好的 ${category} 软件`],
    ["best-category-audience", `适合 ${company} 的 ${category} 软件`],
    ["best-type-audience", `适合 ${company} 的 ${type}`],
    ["buyer-use-case", `${buyer} 用什么软件来 ${useCase}`],
    ["user-use-case", `${user} 如何用工作流来 ${useCase}`],
    ["how-to-jtbd", `如何 ${jtbd}`],
    ["how-to-use-case", `如何 ${useCase}`],
    ["pain-solution", `${pain} 解决方案`],
    ["trigger-process", `${trigger} 怎么处理`],
    ["feature-software-1", `${featureOne} 软件`],
    ["feature-workflow-2", `${featureTwo} 工作流`],
    ["value-proposition", value],
    ["category-comparison", `${category} 对比`],
    ["product-implementation", `${product} 实施`],
    ["compare-approved-competitor-1", `${product} 对比 ${competitorOne}`],
    ["compare-approved-competitor-2", `${product} 对比 ${competitorTwo}`],
  ];
}

export function deriveConfirmedProductProfileGenerativeQueries(
  input: ProductProfileAiCohortBootstrapInput,
): DerivedProductProfileGenerativeQueryResult {
  let language: string | undefined;
  try {
    language = Intl.getCanonicalLocales(input.languageTag)[0];
  } catch {
    language = undefined;
  }
  if (!language) {
    return { status: "skipped_unsupported_locale", queries: [] };
  }
  const family = language.split("-")[0]?.toLowerCase();
  const candidates =
    family === "en"
      ? englishCandidates(input)
      : family === "zh"
        ? chineseCandidates(input)
        : null;
  if (candidates === null) {
    return { status: "skipped_unsupported_locale", queries: [] };
  }
  const seen = new Set<string>();
  const queries: DerivedProductProfileGenerativeQuery[] = [];
  for (const [templateId, rawQuery] of candidates) {
    const displayKeyword = cleanText(rawQuery);
    if (displayKeyword.length === 0 || displayKeyword.length > 500) continue;
    const normalizedKeyword = normalizeKeywordIdentity(displayKeyword);
    if (seen.has(normalizedKeyword)) continue;
    seen.add(normalizedKeyword);
    queries.push({
      templateId,
      displayKeyword,
      normalizedKeyword,
      sourceRef: `product_profile:${input.confirmedProfileId}#profile-generative-query.v1/${templateId}`,
    });
  }
  return queries.length === EXACT_QUERY_COUNT
    ? { status: "ready", queries }
    : { status: "skipped_inexact_generation", queries: [] };
}

export class ProductProfileAiCohortRepository extends Repository {
  private readonly adapterOverrides:
    | Partial<ProductProfileAiCohortAdapters>
    | undefined;
  private readonly hasCustomAdapters: boolean;

  constructor(exec: Executor, adapters?: Partial<ProductProfileAiCohortAdapters>) {
    super(exec);
    this.adapterOverrides = adapters;
    this.hasCustomAdapters = adapters !== undefined;
  }

  async countGenerativeQueries(scope: ProjectScope): Promise<number> {
    return this.countGenerativeQueriesWithExecutor(this.exec, scope);
  }

  private adaptersFor(exec: Executor): ProductProfileAiCohortAdapters {
    const adapters = this.adapterOverrides;
    return {
      countGenerativeQueries: adapters?.countGenerativeQueries
        ?? ((scope) => this.countGenerativeQueriesWithExecutor(exec, scope)),
      upsertManyIntoLibrary: adapters?.upsertManyIntoLibrary
        ?? ((scope, inputs) =>
          new KeywordOccurrencesRepository(exec).upsertManyIntoLibrary(
            scope,
            inputs,
          )),
      listKeywordsByIds: adapters?.listKeywordsByIds
        ?? ((scope, entityIds) =>
          new KeywordsRepository(exec).listByIds(scope, entityIds)),
      applySystemApprovals: adapters?.applySystemApprovals
        ?? ((scope, inputs) =>
          new KeywordGovernanceRepository(exec).applySystemApprovals(
            scope,
            inputs,
          )),
      assertConfirmedProfileIdentity: adapters?.assertConfirmedProfileIdentity
        ?? ((scope, input) =>
          this.assertConfirmedProfileIdentityWithExecutor(exec, scope, input)),
    };
  }

  private async countGenerativeQueriesWithExecutor(
    exec: Executor,
    scope: ProjectScope,
  ): Promise<number> {
    const rows = await exec
      .select({ count: sql<number>`count(*)::int` })
      .from(keywordEntities)
      .where(
        and(
          eq(keywordEntities.workspace_id, scope.workspaceId),
          eq(keywordEntities.project_id, scope.projectId),
          eq(keywordEntities.query_kind, "generative_query"),
        ),
      );
    const value = rows[0]?.count;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > GENERATIVE_QUERY_COUNT_LIMIT
    ) {
      throw new Error("Product Profile AI cohort count is unreadable.");
    }
    return value;
  }

  async bootstrapConfirmedProfileGenerativeQueries(
    scope: ProjectScope,
    input: ProductProfileAiCohortBootstrapInput,
  ): Promise<ProductProfileAiCohortBootstrapResult> {
    const transactional = this.exec as TransactionalExecutor;
    if (typeof transactional.transaction === "function") {
      return transactional.transaction((tx) =>
        this.bootstrapConfirmedProfileGenerativeQueriesWithExecutor(
          tx,
          scope,
          input,
        ),
      );
    }
    return this.bootstrapConfirmedProfileGenerativeQueriesWithExecutor(
      this.exec,
      scope,
      input,
    );
  }

  private async bootstrapConfirmedProfileGenerativeQueriesWithExecutor(
    exec: Executor,
    scope: ProjectScope,
    input: ProductProfileAiCohortBootstrapInput,
  ): Promise<ProductProfileAiCohortBootstrapResult> {
    if (!this.hasCustomAdapters) {
      await acquireTopicGovernanceProjectWriterLock(exec, scope);
    }
    const adapters = this.adaptersFor(exec);
    await adapters.assertConfirmedProfileIdentity(scope, input);
    const existingQueryCount = await adapters.countGenerativeQueries(scope);
    if (existingQueryCount > 0) {
      return {
        status: "skipped_existing_queries",
        bootstrappedCount: 0,
        existingQueryCount,
        querySetHash: null,
      };
    }
    const derived = deriveConfirmedProductProfileGenerativeQueries(input);
    if (derived.status !== "ready") {
      return {
        status: derived.status,
        bootstrappedCount: 0,
        existingQueryCount: 0,
        querySetHash: null,
      };
    }

    const occurrenceInputs: ProductProfileKeywordOccurrenceInput[] =
      derived.queries.map((query) => ({
        manualEntryId: null,
        dataSnapshotId: null,
        normalizedObservationId: null,
        productProfileId: input.confirmedProfileId,
        displayKeyword: query.displayKeyword,
        normalizedKeyword: query.normalizedKeyword,
        market: input.marketCode,
        languageTag: input.languageTag,
        queryKind: "generative_query",
        sourceKind: "product_profile",
        scopeBasis: "project_context",
        sourcePointer: null,
        sourceRef: query.sourceRef,
        collectedAt: input.confirmedAt,
        providerDataAsOf: null,
      }));
    const upserted = await adapters.upsertManyIntoLibrary(
      scope,
      occurrenceInputs,
    );
    if (upserted.length !== EXACT_QUERY_COUNT) {
      throw new Error("Product Profile AI cohort batch upsert is incomplete.");
    }
    const entityIds = upserted.map((row) => row.entityId);
    if (new Set(entityIds).size !== EXACT_QUERY_COUNT) {
      throw new Error("Product Profile AI cohort entity identity is not unique.");
    }
    const rows = await adapters.listKeywordsByIds(scope, entityIds);
    if (rows.length !== EXACT_QUERY_COUNT) {
      throw new Error("Product Profile AI cohort keyword entity set is incomplete.");
    }
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const approvals: SystemKeywordApprovalInput[] = [];
    for (const entityId of entityIds) {
      const entity = rowsById.get(entityId);
      if (!entity) {
        throw new Error("Product Profile AI cohort keyword entity is missing.");
      }
      approvals.push({
        keywordId: entity.id,
        expectedGovernanceRevision: entity.mapping_revision,
        clusterKey: entity.normalized_keyword,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        reason:
          "System bootstrap from the confirmed Product Profile exact market/language cohort.",
      });
    }

    const outcomes = await adapters.applySystemApprovals(scope, approvals);
    if (
      outcomes.length !== EXACT_QUERY_COUNT ||
      outcomes.some((outcome) => !outcome.applied)
    ) {
      throw new Error("Product Profile AI cohort bootstrap lost governance truth.");
    }

    return {
      status: "bootstrapped",
      bootstrappedCount: EXACT_QUERY_COUNT,
      existingQueryCount: 0,
      querySetHash: sha256Hex(
        JSON.stringify(
          derived.queries.map((query) => ({
            query: query.displayKeyword,
            normalized: query.normalizedKeyword,
            market: input.marketCode,
            language: input.languageTag,
            sourceRef: query.sourceRef,
          })),
        ),
      ),
    };
  }

  private async assertConfirmedProfileIdentityWithExecutor(
    exec: Executor,
    scope: ProjectScope,
    input: ProductProfileAiCohortBootstrapInput,
  ): Promise<void> {
    const projects = await exec
      .select({
        confirmedId: clientProjects.confirmed_icp_profile_id,
      })
      .from(clientProjects)
      .where(
        and(
          eq(clientProjects.workspace_id, scope.workspaceId),
          eq(clientProjects.id, scope.projectId),
        ),
      )
      .limit(1);
    const project = projects[0];
    if (!project || project.confirmedId !== input.confirmedProfileId) {
      throw new Error("Confirmed Product Profile identity mismatch.");
    }
    const profile = await new IcpProfilesRepository(exec).findById(
      scope,
      input.confirmedProfileId,
    );
    if (
      !profile ||
      profile.status !== "complete" ||
      profile.version !== input.confirmedProfileVersion ||
      profile.content_hash !== input.confirmedProfileContentHash ||
      profile.created_at !== input.confirmedAt
    ) {
      throw new Error("Confirmed Product Profile frozen identity mismatch.");
    }
  }
}
