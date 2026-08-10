// @input  -- two authenticated POSTs: one to read the site, one to price the candidates
// @output -- a sealed carry-over token, then a keyword opportunity envelope, or a stable error code
// @pos    -- shared handler behind /api/tools/hidden-keywords/{context,opportunities}
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  buildKeywordOpportunityPayload,
  buildKeywordCoverageIndex,
  createPublicToolError,
  judgeKeywordWinnability,
  keywordTokens,
  keywordValidationFor,
  keywordVolumeKey,
  observeKeywordCoverage,
  resolveKeywordValidations,
  toKeywordOpportunityErrorCode,
  type KeywordCoveragePage,
  type KeywordCoverageQueryRow,
  type KeywordOpportunityBasis,
  type KeywordOpportunityContext,
  type KeywordOpportunityObservation,
  type KeywordOpportunityProposition,
  type KeywordOpportunityProviderRow,
} from "@sf/public-tools";
import { open, seal } from "../auth/sealed-cookie.ts";
import type { CrawlGateResult } from "./crawl-gate.ts";
import type { GscGateResult } from "./gsc-gate.ts";
import { readPublicToolJson } from "./public-tool-request.ts";

/** Room for a URL, a market pair and up to ten seed terms. */
const CONTEXT_BODY_LIMIT_BYTES = 4_096;

/**
 * Larger than every sibling tool's limit, on purpose.
 *
 * Stage two carries the sealed context back up. AES-GCM plus base64url runs
 * about 1.4x the plaintext, and the plaintext is a list of propositions. At
 * 4,096 a legitimate request would 413 before any handler logging ran, which
 * leaves nothing in the trace to explain it.
 */
const OPPORTUNITIES_BODY_LIMIT_BYTES = 16_384;

/** How long a carry-over token stays usable. */
export const KEYWORD_CONTEXT_TTL_SECONDS = 600;

/** Candidates sent for pricing in one run. The linear cost driver. */
export const KEYWORD_CANDIDATE_CAP = 150;

/**
 * Pages of page-one sampling per run.
 *
 * The other linear cost driver, and the more expensive one per unit. Twenty
 * covers the survivors of a typical run at roughly four cents; the survivors
 * are sorted before sampling so the cap cuts the least promising tail.
 */
export const KEYWORD_SERP_SAMPLE_CAP = 20;

/** Seed terms a visitor may supply. */
export const KEYWORD_MAX_SEEDS = 10;
export const KEYWORD_MAX_SEED_LENGTH = 80;

/** What stage one seals and stage two opens. */
export interface KeywordContextToken {
  readonly siteUrl: string;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly propositions: readonly KeywordOpportunityProposition[];
  readonly pages: readonly { readonly url: string; readonly title: string }[];
  readonly pagesFetched: number;
  readonly productPagesFetched: number;
  readonly stopReason: string;
  /**
   * The seed terms the visitor supplied at stage one.
   *
   * Carried rather than re-collected because stage two is where they are used
   * and the two stages are separate requests. Dropping them here would make
   * the "add seed keywords" suggestion a thin run produces into advice that
   * changes nothing.
   */
  readonly seeds: readonly string[];
  /**
   * The identity stage one was issued to.
   *
   * Stage two refuses a token that does not name the caller. Without this a
   * token is a bearer credential for the expensive half of the pipeline.
   */
  readonly sub: string;
}

/** One candidate as the generator produced it, before any pricing. */
export interface KeywordCandidateDraft {
  readonly keyword: string;
  readonly discoveryBasis: KeywordOpportunityBasis;
  readonly questionForm: boolean;
  readonly propositionIndex: number | null;
}

export interface KeywordSerpSampleResult {
  readonly keyword: string;
  readonly domains: readonly string[];
}

export interface KeywordContextCrawlResult {
  readonly pages: readonly {
    readonly url: string;
    readonly title: string;
    readonly headings: readonly string[];
    readonly text: string;
    readonly score: number;
  }[];
  readonly pagesFetched: number;
  readonly productPagesFetched: number;
  readonly stopReason: string;
}

/**
 * Every effect the two stages need, named so a test can drive all of them.
 *
 * Nothing here reaches the network by itself. The repo's coverage gate is a
 * whole-repo aggregate, so an un-injectable fetch is not a style problem: its
 * lines can never run offline and they pull the gate down for everyone.
 */
export interface KeywordOpportunityDependencies {
  /** Who is asking. Null when the visitor is not signed in. */
  readonly readIdentity: () => Promise<{ readonly sub: string } | null>;
  /** Admission for the crawl half, keyed by IP and by target host. */
  readonly openCrawlGate: (
    clientIp: string,
    targetHost: string,
  ) => Promise<CrawlGateResult>;
  /** Admission for the Search Console half. */
  readonly openGscGate: (clientIp: string) => Promise<GscGateResult>;
  /** Offline test seam. Reads the site with page-value ordering. */
  readonly crawlContext: (
    siteUrl: string,
  ) => Promise<KeywordContextCrawlResult>;
  /** Offline test seam. Reads positioning off crawled text only. */
  readonly extractPropositions: (
    pages: KeywordContextCrawlResult["pages"],
  ) => Promise<readonly KeywordOpportunityProposition[]>;
  /** Offline test seam. Produces both lanes' candidates. */
  readonly expandCandidates: (input: {
    readonly propositions: readonly KeywordOpportunityProposition[];
    readonly pages: readonly { readonly url: string; readonly title: string }[];
    readonly seeds: readonly string[];
    readonly languageCode: string;
    readonly cap: number;
  }) => Promise<readonly KeywordCandidateDraft[]>;
  /** Offline test seam. Prices candidates; must report what it did not find. */
  readonly validateVolumes: (input: {
    readonly keywords: readonly string[];
    readonly marketCode: string;
    readonly languageCode: string;
  }) => Promise<readonly KeywordOpportunityProviderRow[]>;
  /** Offline test seam. Samples page one for the survivors. */
  readonly sampleSerp: (input: {
    readonly keywords: readonly string[];
    readonly marketCode: string;
    readonly languageCode: string;
  }) => Promise<readonly KeywordSerpSampleResult[]>;
  /** Offline test seam. Resolves domains to provider ranks. */
  readonly resolveDomainRanks: (
    domains: readonly string[],
  ) => Promise<ReadonlyMap<string, number>>;
  /** Offline test seam. The visitor's own Search Console queries. */
  readonly readCoverageQueries: (
    siteUrl: string,
  ) => Promise<readonly KeywordCoverageQueryRow[]>;
  readonly now: () => Date;
  readonly extractClientIp: (headers: Headers) => string;
}

function json(
  body: unknown,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    // Built from the visitor's own property data; never cached or shared.
    headers: { "Cache-Control": "no-store, private", ...extraHeaders },
  });
}

function hostOf(siteUrl: string): string | null {
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

interface ContextInput {
  readonly siteUrl: string;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly seeds: readonly string[];
}

function parseContextInput(body: unknown): ContextInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Readonly<Record<string, unknown>>;
  const siteUrl = record["siteUrl"];
  const marketCode = record["marketCode"];
  const languageCode = record["languageCode"];
  if (typeof siteUrl !== "string" || hostOf(siteUrl) === null) return null;
  // Market and language are required. Volume and page one both mean nothing
  // without them, and defaulting silently would label US English numbers as
  // if they described whichever market the visitor had in mind.
  if (typeof marketCode !== "string" || marketCode.trim() === "") return null;
  if (typeof languageCode !== "string" || languageCode.trim() === "") {
    return null;
  }

  const rawSeeds = record["seeds"];
  if (rawSeeds !== undefined && !Array.isArray(rawSeeds)) return null;
  const seeds: string[] = [];
  for (const seed of rawSeeds ?? []) {
    if (typeof seed !== "string") return null;
    if (seed.length > KEYWORD_MAX_SEED_LENGTH) return null;
    const trimmed = seed.trim();
    if (trimmed !== "") seeds.push(trimmed);
  }
  if (seeds.length > KEYWORD_MAX_SEEDS) return null;

  return {
    siteUrl,
    marketCode: marketCode.trim(),
    languageCode: languageCode.trim(),
    seeds,
  };
}

/**
 * Stage one: read the site and hand back a sealed summary.
 *
 * Deliberately does NOT open the Search Console gate. Every public tool that
 * reads Search Console shares one in-flight key per IP, so gating both stages
 * on it would make the second call from the same visitor collide with the
 * first and 409. Stage one needs no Search Console data anyway: it crawls.
 */
export async function handleKeywordContextRequest(
  request: Request,
  dependencies: KeywordOpportunityDependencies,
): Promise<Response> {
  const identity = await dependencies.readIdentity();
  if (identity === null) {
    return json(createPublicToolError("authentication_required"), 401);
  }

  const body = await readPublicToolJson(request, CONTEXT_BODY_LIMIT_BYTES);
  if (!body.ok) {
    const status = body.code === "payload_too_large" ? 413 : 400;
    return json(createPublicToolError(body.code), status);
  }

  const input = parseContextInput(body.value);
  if (input === null) return json(createPublicToolError("invalid_input"), 400);

  const targetHost = hostOf(input.siteUrl);
  if (targetHost === null) {
    return json(createPublicToolError("invalid_input"), 400);
  }

  const gate = await dependencies.openCrawlGate(
    dependencies.extractClientIp(request.headers),
    targetHost,
  );
  if (!gate.ok) return gate.response;

  try {
    const crawl = await dependencies.crawlContext(input.siteUrl);
    const propositions = await dependencies.extractPropositions(crawl.pages);

    const token: KeywordContextToken = {
      siteUrl: input.siteUrl,
      marketCode: input.marketCode,
      languageCode: input.languageCode,
      propositions,
      pages: crawl.pages.map((page) => ({
        url: page.url,
        title: page.title,
      })),
      pagesFetched: crawl.pagesFetched,
      productPagesFetched: crawl.productPagesFetched,
      stopReason: crawl.stopReason,
      seeds: input.seeds,
      sub: identity.sub,
    };

    return json(
      {
        data: {
          propositions,
          pagesFetched: crawl.pagesFetched,
          productPagesFetched: crawl.productPagesFetched,
          stopReason: crawl.stopReason,
          contextSufficient: crawl.pages.length >= 3,
          contextToken: seal(
            "gg_kw_context",
            token,
            KEYWORD_CONTEXT_TTL_SECONDS,
          ),
        },
      },
      200,
    );
  } catch (error) {
    const code = toKeywordOpportunityErrorCode(
      error instanceof Error && "code" in error
        ? (error as { readonly code: unknown }).code
        : undefined,
    );
    // The failure reason is the product here: a Cloudflare challenge, a rate
    // limit from the target, and a protocol downgrade the URL guard refused
    // are three different things the visitor can act on differently. A quarter
    // of real sites hit one of them.
    console.error(
      JSON.stringify({ tool: "keyword_opportunity", stage: "context", code }),
    );
    return json(createPublicToolError(code), 200);
  } finally {
    gate.release();
  }
}

function parseOpportunitiesInput(
  body: unknown,
): { readonly contextToken: string } | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const token = (body as Readonly<Record<string, unknown>>)["contextToken"];
  if (typeof token !== "string" || token === "") return null;
  return { contextToken: token };
}

/**
 * Order the survivors before the sample cap bites.
 *
 * Proposition-derived terms first, then by ascending difficulty. The cap is a
 * cost control, so what it cuts should be the tail the reader would have
 * looked at last — and the proposition lane is the scarce output: Tranche 2
 * produced 19 priced proposition terms against 343 expansion ones.
 */
function serpSampleOrder(
  a: {
    readonly basis: KeywordOpportunityBasis;
    readonly difficulty: number | null;
  },
  b: {
    readonly basis: KeywordOpportunityBasis;
    readonly difficulty: number | null;
  },
): number {
  const aProposition = a.basis === "site_proposition" ? 0 : 1;
  const bProposition = b.basis === "site_proposition" ? 0 : 1;
  if (aProposition !== bProposition) return aProposition - bProposition;
  return (
    (a.difficulty ?? Number.MAX_SAFE_INTEGER) -
    (b.difficulty ?? Number.MAX_SAFE_INTEGER)
  );
}

/**
 * Stage two: price the candidates and judge them.
 *
 * This is where the money is spent, so this is where the durable limit sits.
 * Putting it on stage one instead would turn the carry-over token into a
 * free-reruns oracle for the expensive half.
 */
export async function handleKeywordOpportunitiesRequest(
  request: Request,
  dependencies: KeywordOpportunityDependencies,
): Promise<Response> {
  const identity = await dependencies.readIdentity();
  if (identity === null) {
    return json(createPublicToolError("authentication_required"), 401);
  }

  const body = await readPublicToolJson(
    request,
    OPPORTUNITIES_BODY_LIMIT_BYTES,
  );
  if (!body.ok) {
    const status = body.code === "payload_too_large" ? 413 : 400;
    return json(createPublicToolError(body.code), status);
  }

  const input = parseOpportunitiesInput(body.value);
  if (input === null) return json(createPublicToolError("invalid_input"), 400);

  const token = open<KeywordContextToken>("gg_kw_context", input.contextToken);
  if (token === null) {
    return json(createPublicToolError("context_token_invalid"), 400);
  }
  // A token names the identity it was issued to. Accepting someone else's
  // would let one sign-in hand out the expensive half of the pipeline.
  if (token.sub !== identity.sub) {
    return json(createPublicToolError("context_token_invalid"), 403);
  }

  const gate = await dependencies.openGscGate(
    dependencies.extractClientIp(request.headers),
  );
  if (!gate.ok) return gate.response;

  const unavailableStages: string[] = [];
  try {
    const drafts = await dependencies.expandCandidates({
      propositions: token.propositions,
      pages: token.pages,
      seeds: token.seeds,
      languageCode: token.languageCode,
      cap: KEYWORD_CANDIDATE_CAP,
    });

    // Deduplicated before pricing: a repeated term is a second charge for the
    // same fact, and the second charge is the expensive one — the survivor
    // would be sampled twice.
    //
    // Keyed with the provider's own comparison key rather than a local
    // lowercase. They differed by one whitespace collapse, which was enough
    // for "dental  billing" to be priced and sampled as a separate term while
    // the validation layer folded it back onto the same row.
    const unique = new Map<string, KeywordCandidateDraft>();
    for (const draft of drafts) {
      const key = keywordVolumeKey(draft.keyword);
      if (key !== "" && !unique.has(key)) unique.set(key, draft);
    }
    // The cap bites after deduplication so it spends its slots on distinct
    // terms; `generated` below still reports what the generator produced, so
    // the gap to `deduplicated` covers both the duplicates and the cap.
    const candidates = [...unique.values()].slice(0, KEYWORD_CANDIDATE_CAP);

    const providerRows = await dependencies.validateVolumes({
      keywords: candidates.map((candidate) => candidate.keyword),
      marketCode: token.marketCode,
      languageCode: token.languageCode,
    });
    const validations = resolveKeywordValidations(
      candidates.map((candidate) => candidate.keyword),
      providerRows,
    );

    let coverageRows: readonly KeywordCoverageQueryRow[] = [];
    try {
      coverageRows = await dependencies.readCoverageQueries(token.siteUrl);
    } catch {
      // Coverage is the one stage whose absence must not stop the run: without
      // it the tool cannot say a term is already served, which is a weaker
      // claim, not a wrong one. It is named so the result reads `partial`.
      unavailableStages.push("gsc_coverage");
    }
    const coverageIndex = buildKeywordCoverageIndex(coverageRows);
    const coveragePages: readonly KeywordCoveragePage[] = token.pages.map(
      (page) => ({ url: page.url, tokens: keywordTokens(page.title) }),
    );

    const priced = candidates.map((candidate) => ({
      candidate,
      validation: keywordValidationFor(validations, candidate.keyword),
      coverage: observeKeywordCoverage(
        candidate.keyword,
        coverageIndex,
        coveragePages,
      ),
    }));

    const sampleTargets = priced
      .filter(
        (row) =>
          row.validation.availability === "available" &&
          row.coverage.state === "not_observed_in_gsc_query_sample",
      )
      .sort((a, b) =>
        serpSampleOrder(
          {
            basis: a.candidate.discoveryBasis,
            difficulty: a.validation.difficulty,
          },
          {
            basis: b.candidate.discoveryBasis,
            difficulty: b.validation.difficulty,
          },
        ),
      )
      .slice(0, KEYWORD_SERP_SAMPLE_CAP);

    let samples: readonly KeywordSerpSampleResult[] = [];
    let domainRanks: ReadonlyMap<string, number> = new Map();
    if (sampleTargets.length > 0) {
      try {
        samples = await dependencies.sampleSerp({
          keywords: sampleTargets.map((row) => row.candidate.keyword),
          marketCode: token.marketCode,
          languageCode: token.languageCode,
        });
        domainRanks = await dependencies.resolveDomainRanks([
          ...new Set(samples.flatMap((sample) => sample.domains)),
        ]);
      } catch {
        // Without page one no term may be called winnable, so the run reports
        // the gap rather than falling back to the difficulty score — that
        // fallback is exactly what misled the team's own selection.
        unavailableStages.push("serp_sample");
      }
    }
    const samplesByKeyword = new Map(
      samples.map((sample) => [sample.keyword, sample]),
    );

    const observations: KeywordOpportunityObservation[] = priced.map((row) => {
      const sample = samplesByKeyword.get(row.candidate.keyword);
      return {
        keyword: row.candidate.keyword,
        lane: row.candidate.questionForm ? "geo" : "seo",
        discoveryBasis: row.candidate.discoveryBasis,
        questionForm: row.candidate.questionForm,
        propositionIndex: row.candidate.propositionIndex,
        validation: row.validation,
        serp:
          sample === undefined
            ? {
                verdict: "no_serp_evidence" as const,
                weakestTopTenDomainRank: null,
                topTenDomains: [],
                isEstimate: false,
              }
            : judgeKeywordWinnability(
                { domains: sample.domains, domainRanks },
                null,
              ),
        coverage: row.coverage.state,
        supportingPageUrl: row.coverage.supportingPageUrl,
      };
    });

    const context: KeywordOpportunityContext = {
      siteUrl: token.siteUrl,
      pagesFetched: token.pagesFetched,
      productPagesFetched: token.productPagesFetched,
      propositions: token.propositions,
      contextSufficient: token.pages.length >= 3,
      stopReason: token.stopReason,
    };

    const payload = buildKeywordOpportunityPayload({
      marketCode: token.marketCode,
      languageCode: token.languageCode,
      context,
      generated: drafts.length,
      observations,
      unavailableStages,
      completedAt: dependencies.now().toISOString(),
    });

    return json({ data: payload }, 200);
  } catch (error) {
    console.error(
      JSON.stringify({
        tool: "keyword_opportunity",
        stage: "opportunities",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return json(createPublicToolError("keyword_source_unavailable"), 502);
  } finally {
    gate.release();
  }
}
