// @input  -- two authenticated POSTs: one to read the site, one to price the candidates
// @output -- a sealed carry-over token, then a keyword opportunity envelope, or a stable error code
// @pos    -- shared handler behind /api/tools/hidden-keywords/{context,opportunities}
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  buildKeywordOpportunityPayload,
  buildKeywordCoverageIndex,
  createPublicToolError,
  judgeKeywordWinnability,
  KEYWORD_OPPORTUNITY_UNSAMPLED,
  keywordCoverageProperty,
  keywordTokens,
  keywordValidationFor,
  KEYWORD_STAGE_GSC_COVERAGE,
  KEYWORD_STAGE_GSC_COVERAGE_TRUNCATED,
  KEYWORD_STAGE_SERP_SAMPLE,
  KEYWORD_STAGE_SERP_SAMPLE_PARTIAL,
  keywordVolumeKey,
  observeKeywordCoverage,
  resolveKeywordValidations,
  toKeywordOpportunityErrorCode,
  type KeywordCoveragePage,
  type KeywordCoverageRead,
  type KeywordCoverageQueryRow,
  type KeywordOpportunityBasis,
  type KeywordOpportunityContext,
  type KeywordOpportunityErrorCode,
  type KeywordOpportunityObservationV3,
  type KeywordOpportunityProposition,
  type KeywordOpportunityProviderRow,
  type KeywordOpportunityProviderIntent,
  type KeywordOpportunitySerpFailureReason,
  type KeywordOpportunitySerpStatus,
} from "@sf/public-tools";
import {
  normalizeRdapDomain,
  normalizeTrafficDomain,
  type DomainRegistrationEvidence,
} from "@sf/sources";
import type {
  ContextProfileSelectionSummary,
  ContextProfileSitemapInventory,
} from "@sf/sources/crawl-context-profile";
import { open, seal } from "../auth/sealed-cookie.ts";
import {
  reportKeywordRunCost,
  type KeywordCostAccumulator,
} from "./keyword-cost-guard.ts";
import {
  buildKeywordSignalEvidence,
  keywordSiteTrafficThreshold,
} from "./keyword-signal-evidence.ts";
import { KeywordLlmError, type KeywordLlmUsage } from "./keyword-llm-client.ts";
import type {
  KeywordSerpInterpretation,
  KeywordSerpInterpretationInput,
} from "./keyword-prompts.ts";
import { cookies } from "next/headers";
import { identitySubFrom, type GrantResolution } from "../auth/grant-cookie.ts";
import { openCrawlGate, type CrawlGateResult } from "./crawl-gate.ts";
import {
  openGscGate,
  refuseWithoutGrant,
  type GscGateResult,
} from "./gsc-gate.ts";
import { readPublicToolJson } from "./public-tool-request.ts";
import { resolveTrafficDropGrant } from "./traffic-drop-session.ts";

/** Room for a URL, a market pair and up to ten seed terms. */
const CONTEXT_BODY_LIMIT_BYTES = 4_096;

/**
 * Larger than every sibling tool's limit, on purpose.
 *
 * Stage two carries the sealed context back up. AES-GCM plus base64url runs
 * about 1.4x the plaintext. The 22 KiB ceiling is the smallest whole-KiB bound
 * that admits the sealed 20-page long-URL/CJK fixture while preserving the
 * measured wrapper margin below.
 */
export const OPPORTUNITIES_BODY_LIMIT_BYTES = 22_528;

/** How long a carry-over token stays usable. */
export const KEYWORD_CONTEXT_TTL_SECONDS = 600;

/** Candidates sent for pricing in one run. The linear cost driver. */
export const KEYWORD_CANDIDATE_CAP = 150;

/**
 * Least budget worth starting the optional domain enrichments with.
 *
 * Below this the wave cannot plausibly finish before the response deadline, so
 * starting it only risks the envelope. It is a floor for admission, not a
 * bound: the race that follows is what actually caps the wait.
 */
export const MIN_KEYWORD_ENRICHMENT_MS = 5_000;

/** Seed terms a visitor may supply. */
export const KEYWORD_MAX_SEEDS = 10;
export const KEYWORD_MAX_SEED_LENGTH = 80;

/**
 * Heading budgets to try, in bytes of UTF-8, largest first.
 *
 * A ladder rather than one constant because no constant can be right: the
 * sealed token also carries model-written propositions, the visitor's seeds
 * and up to twenty URLs, none of which have a fixed size. Stage one seals,
 * measures the real result against the real limit, and drops to the next rung
 * if it does not fit — so the guarantee comes from measurement rather than
 * from arithmetic that a Japanese site would quietly break.
 *
 * The last rung is zero: no headings at all, which is what shipped before and
 * still produces a usable run.
 */
export const KEYWORD_CONTEXT_HEADING_BUDGETS = [6_000, 3_000, 1_200, 0];

/**
 * Bytes the sealed token may occupy.
 *
 * Stage two reads `{"contextToken":"…"}` under a 22,528-byte limit; the margin
 * covers that wrapper and any whitespace a client adds.
 */
export const KEYWORD_CONTEXT_TOKEN_MAX_BYTES =
  OPPORTUNITIES_BODY_LIMIT_BYTES - 512;

/** Longest single heading kept. Past this it is body copy in an h3. */
export const KEYWORD_CONTEXT_HEADING_MAX_LENGTH = 120;

const UTF8 = new TextEncoder();

export function keywordByteLength(value: string): number {
  return UTF8.encode(value).length;
}

/**
 * Trim crawled headings to a byte budget.
 *
 * Bytes and not characters: the limit downstream is a byte limit, and one CJK
 * character is three of them. Counting characters would let a Japanese site
 * spend three times the intended budget and 413 at stage two — a failure that
 * every ASCII test in this suite is blind to.
 *
 * Spends the budget in crawl order, which is page-value order: the pages the
 * profile scored highest keep their headings, and a site large enough to
 * exhaust it loses the tail rather than the front.
 */
export function trimKeywordContextHeadings(
  pages: readonly {
    readonly url: string;
    readonly headings: readonly string[];
  }[],
  budgetBytes: number,
): readonly (readonly string[])[] {
  let remaining = budgetBytes;
  return pages.map((page) => {
    const kept: string[] = [];
    for (const heading of page.headings) {
      const trimmed = heading
        .trim()
        .slice(0, KEYWORD_CONTEXT_HEADING_MAX_LENGTH);
      if (trimmed === "") continue;
      const cost = keywordByteLength(trimmed);
      if (cost > remaining) break;
      remaining -= cost;
      kept.push(trimmed);
    }
    return kept;
  });
}

/** What stage one seals and stage two opens. */
export interface KeywordContextToken {
  readonly siteUrl: string;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly propositions: readonly KeywordOpportunityProposition[];
  /**
   * What each crawled page visibly targets, carried across the two stages.
   *
   * Headings travel with the title because the page-similarity half of the
   * coverage check reads exactly this, and a title alone is three or four
   * words — too thin to recognise the page that answers a question. The body
   * text does NOT travel: it would blow the sealed token past the request
   * limit, and headings carry the same signal at a fraction of the size.
   *
   * `headings` is optional because this shape describes a token that arrived,
   * not one we built. `open()` decrypts and asserts a type; it does not check
   * a schema. A token minted by the previously deployed version has no
   * `headings` key, its TTL is ten minutes, and stage two must survive that
   * window rather than throw on a spread after the visitor has already been
   * charged for the run.
   */
  readonly pages: readonly {
    readonly url: string;
    readonly title: string;
    readonly headings?: readonly string[];
  }[];
  /** Optional only while a token minted by the previous deployment is alive. */
  readonly sitemapInventory?: ContextProfileSitemapInventory;
  readonly pagesFetched: number;
  readonly productPagesFetched: number;
  /** Optional while a token from the previous deployment remains live. */
  readonly selection?: ContextProfileSelectionSummary;
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
  /** Optional only for legacy injected samples; production always supplies it. */
  readonly status?: KeywordOpportunitySerpStatus;
  /** Optional only for legacy injected samples; production always supplies it. */
  readonly failureReason?: KeywordOpportunitySerpFailureReason | null;
  /** Null for an unavailable attempt; optional only for legacy samples. */
  readonly observedAt?: string | null;
  /** Top ten organic results in rank order, position included. */
  readonly results: readonly {
    readonly domain: string;
    readonly position: number;
    /** Optional only for legacy injected samples; production always supplies it. */
    readonly title?: string | null;
    /** Optional only for legacy injected samples; production always supplies it. */
    readonly url?: string | null;
  }[];
  /** SERP element types the provider observed; null means the list was unreported. */
  readonly pageItemTypes: readonly string[] | null;
  /** Provider AI Overview block, with omitted text preserved as null. */
  readonly aiOverview?: {
    readonly markdown: string | null;
    readonly isAsync: boolean | null;
    readonly references: readonly {
      readonly title: string | null;
      readonly url: string | null;
    }[];
  } | null;
  /** Concrete provider community results; null means availability unreported. */
  readonly communityItems?:
    | readonly {
        readonly type: "discussions_and_forums" | "forum" | "video" | "twitter";
        readonly position: number;
        readonly title: string | null;
        readonly url: string | null;
        readonly domain: string | null;
      }[]
    | null;
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
  /** Optional for older injected/cached results; production supplies it. */
  readonly selection?: ContextProfileSelectionSummary;
  readonly stopReason: string;
  /** Optional for old injected results; production crawls always provide it. */
  readonly sitemapInventory?: ContextProfileSitemapInventory;
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
  /**
   * Admission for the crawl half, keyed by IP and by target host.
   *
   * Takes the site URL, not the host: the gate derives the host itself so that
   * every caller keys the per-target budget the same way. Passing a bare host
   * here parses as a relative URL and the gate refuses the request outright.
   */
  readonly openCrawlGate: (
    clientIp: string,
    siteUrl: string,
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
  /** Offline test seam. Samples page one for every candidate except explicit zero. */
  readonly sampleSerp: (input: {
    readonly keywords: readonly string[];
    readonly marketCode: string;
    readonly languageCode: string;
  }) => Promise<readonly KeywordSerpSampleResult[]>;
  /** Optional for injected legacy callers; production always supplies it. */
  readonly interpretSerpEvidence?: (
    inputs: readonly KeywordSerpInterpretationInput[],
  ) => Promise<readonly KeywordSerpInterpretation[]>;
  /**
   * Absolute epoch-ms mark by which this request must be answering.
   *
   * Set by the route, the only layer that knows when the request started and
   * what the platform kills it at. Omitted by tests and injected callers, which
   * then run unbounded exactly as before. It bounds the optional trailing work
   * only; the stages the report cannot be built without are not skippable.
   */
  readonly responseDeadlineAt?: number;
  /** Offline test seam. Resolves domains to provider ranks. */
  readonly resolveDomainRanks: (
    domains: readonly string[],
  ) => Promise<ReadonlyMap<string, number>>;
  /** Estimated organic traffic keyed by the traffic seam's normalized domain. */
  readonly resolveDomainTraffic: (input: {
    readonly domains: readonly string[];
    readonly marketCode: string;
  }) => Promise<ReadonlyMap<string, number | null> | null>;
  /** RDAP evidence keyed by normalizeRdapDomain(domain). */
  readonly resolveDomainRegistrations: (
    domains: readonly string[],
  ) => Promise<ReadonlyMap<string, DomainRegistrationEvidence>>;
  /**
   * Produce the Search Console access token for this request.
   *
   * A thunk, and called only after the gate has admitted the request. It can
   * spend two outbound Google calls against a shared OAuth client and a
   * per-project quota, so resolving it earlier would put a limiter behind the
   * thing it is supposed to limit.
   */
  readonly resolveGrant: () => Promise<GrantResolution>;
  /**
   * Offline test seam. The visitor's Search Console queries and positive
   * query-page observations for the same finalised window.
   *
   * Takes a property identifier — `sc-domain:acme.com` or a verified URL
   * prefix — not the site URL the visitor typed. Search Console is addressed
   * only by property, and passing anything else is refused upstream.
   */
  readonly readCoverageQueries: (input: {
    readonly property: string;
    /** From this request's resolution; never captured at module scope. */
    readonly accessToken: string;
  }) => Promise<KeywordCoverageRead | readonly KeywordCoverageQueryRow[]>;
  /**
   * What the model cost this run, read once at the end.
   *
   * A seam rather than an accumulator argument because the two model calls
   * happen inside `extractPropositions` / `expandCandidates`, which are
   * themselves seams — the handler never sees a completion. Optional so a test
   * that only cares about orchestration does not have to fake token counts.
   */
  readonly llmUsage?: () => KeywordLlmUsage;
  /**
   * Books actual provider spend for request telemetry.
   *
   * Passed in rather than created here so the route's provider adapters can
   * record into the same accumulator the orchestration reports.
   */
  readonly costs: KeywordCostAccumulator;
  readonly now: () => Date;
  readonly extractClientIp: (headers: Headers) => string;
}

function isLegacyCoverageRead(
  read: KeywordCoverageRead | readonly KeywordCoverageQueryRow[],
): read is readonly KeywordCoverageQueryRow[] {
  return Array.isArray(read);
}

/** Preserve injected query-only readers while production uses a structured read. */
function normalizeCoverageRead(
  read: KeywordCoverageRead | readonly KeywordCoverageQueryRow[],
): KeywordCoverageRead {
  if (!isLegacyCoverageRead(read)) return read;
  return {
    queryRows: read,
    queryPageRows: [],
    // A legacy array is still proof that its query lane completed, including
    // when it completed with zero rows. It carries no query-page read at all,
    // so that missing lane must be explicit rather than treated as clean.
    queryPaging: { pagesFetched: 1, truncated: false },
    queryPagePaging: { pagesFetched: 0, truncated: true },
  };
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

/**
 * How a stage-one failure is reported, matching the two sibling crawl tools.
 *
 * `422` is the interesting one and it is deliberate: the request was
 * well-formed and the service worked, but the target would not let itself be
 * read. That is the same class as the `robots_disallowed` the internal-link
 * audit and the SEO audit already answer 422 for, and it is what a Cloudflare
 * challenge, a rate limit from the target, and a refused protocol downgrade
 * all are. `502` stays for the failures that are genuinely ours or unknown.
 *
 * The earlier shape answered 200 with an error envelope on the grounds that
 * the failure reason is itself the product. The reason is — it is in the code
 * — but the status is not the place to say so: a 200 makes `response.ok` true
 * for a response carrying no report, which every client reads as success.
 */
const CONTEXT_ERROR_STATUS: Readonly<
  Partial<Record<KeywordOpportunityErrorCode, number>>
> = {
  bot_protection_blocked: 422,
  rate_limited_by_target: 422,
  protocol_downgrade_rejected: 422,
  too_few_pages: 422,
  site_unreachable: 502,
};

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

  if (hostOf(input.siteUrl) === null) {
    return json(createPublicToolError("invalid_input"), 400);
  }

  const gate = await dependencies.openCrawlGate(
    dependencies.extractClientIp(request.headers),
    input.siteUrl,
  );
  if (!gate.ok) return gate.response;

  try {
    const crawl = await dependencies.crawlContext(input.siteUrl);
    const propositions = await dependencies.extractPropositions(crawl.pages);

    const base = {
      siteUrl: input.siteUrl,
      marketCode: input.marketCode,
      languageCode: input.languageCode,
      propositions,
      pagesFetched: crawl.pagesFetched,
      productPagesFetched: crawl.productPagesFetched,
      ...(crawl.selection === undefined ? {} : { selection: crawl.selection }),
      stopReason: crawl.stopReason,
      seeds: input.seeds,
      sub: identity.sub,
    };

    const sealToken = (
      headingBudgetBytes: number,
      sitemapInventory: ContextProfileSitemapInventory | undefined,
    ): string => {
      const headings = trimKeywordContextHeadings(
        crawl.pages,
        headingBudgetBytes,
      );
      const token: KeywordContextToken = {
        ...base,
        ...(sitemapInventory === undefined ? {} : { sitemapInventory }),
        pages: crawl.pages.map((page, index) => ({
          url: page.url,
          title: page.title,
          headings: headings[index] ?? [],
        })),
      };
      return seal("gg_kw_context", token, KEYWORD_CONTEXT_TTL_SECONDS);
    };

    // Seal, measure, and step down the ladder until the real token fits the
    // real limit. Everything else in here is variable-length and outside this
    // handler's control — model-written propositions, the visitor's seeds, up
    // to twenty URLs — so a fixed heading budget could only ever be a guess
    // that some site disproves in production.
    let contextToken = "";
    let headingBudget = 0;
    for (const budget of KEYWORD_CONTEXT_HEADING_BUDGETS) {
      contextToken = sealToken(budget, crawl.sitemapInventory);
      headingBudget = budget;
      if (keywordByteLength(contextToken) <= KEYWORD_CONTEXT_TOKEN_MAX_BYTES) {
        break;
      }
    }

    // A complete sitemap may carry hundreds of safe URLs, while stage two has
    // a deliberately small request body. If the zero-heading token still does
    // not fit, keep the largest measured prefix and name the exact omission.
    // Ciphertext length is deterministic for a given plaintext length, so a
    // binary search proves the chosen prefix against the real sealed token.
    if (
      keywordByteLength(contextToken) > KEYWORD_CONTEXT_TOKEN_MAX_BYTES &&
      crawl.sitemapInventory !== undefined &&
      crawl.sitemapInventory.urls.length > 0
    ) {
      const originalInventory = crawl.sitemapInventory;
      let lower = 0;
      let upper = originalInventory.urls.length - 1;
      let fittedToken: string | null = null;
      while (lower <= upper) {
        const count = Math.floor((lower + upper) / 2);
        const truncatedInventory: ContextProfileSitemapInventory = {
          ...originalInventory,
          urls: originalInventory.urls.slice(0, count),
          complete: false,
          truncationReasons: [
            ...originalInventory.truncationReasons.filter(
              (reason) => reason !== "token_budget",
            ),
            "token_budget",
          ],
        };
        const candidateToken = sealToken(0, truncatedInventory);
        if (
          keywordByteLength(candidateToken) <= KEYWORD_CONTEXT_TOKEN_MAX_BYTES
        ) {
          fittedToken = candidateToken;
          lower = count + 1;
        } else {
          upper = count - 1;
        }
      }
      if (fittedToken !== null) {
        contextToken = fittedToken;
        headingBudget = 0;
      }
    }

    if (keywordByteLength(contextToken) > KEYWORD_CONTEXT_TOKEN_MAX_BYTES) {
      // The ladder bounds headings; propositions, titles and up to twenty
      // URLs are not bounded by anything here, so the last rung can still be
      // over. Answering 200 with this token would be a success the handler has
      // already proved is unusable: the surface would post it to stage two,
      // which rejects it at the body limit before it is ever opened, and
      // retrying cannot help because the token is the thing that is too big.
      // Failing here at least names the problem where it was created.
      console.error(
        JSON.stringify({
          tool: "keyword_opportunity",
          stage: "context",
          code: "payload_too_large",
          reason: "context_token_oversized",
          bytes: keywordByteLength(contextToken),
        }),
      );
      return json(createPublicToolError("payload_too_large"), 413);
    }

    return json(
      {
        data: {
          propositions,
          pagesFetched: crawl.pagesFetched,
          productPagesFetched: crawl.productPagesFetched,
          ...(crawl.selection === undefined
            ? {}
            : { selection: crawl.selection }),
          stopReason: crawl.stopReason,
          contextSufficient: crawl.pages.length >= 3,
          headingBudgetBytes: headingBudget,
          contextToken,
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
    // The reason still matters — a Cloudflare challenge, a rate limit from the
    // target and a protocol downgrade the URL guard refused are three things a
    // visitor acts on differently, and a quarter of real sites hit one — so it
    // travels in the code. But it travels with an honest status: this response
    // carries no report, and answering 200 made `response.ok` true for a
    // request that produced nothing.
    //
    // A model failure is the exception: nine transport, config and schema
    // reasons collapse into the one code a visitor can act on, which leaves an
    // operator nothing to act on at all. Stage two has logged `failureReason`
    // since it was written; on 2026-08-21 stage one's silence turned a
    // one-line answer into a production forensics run. Absent for a crawl
    // failure, whose code already names it.
    const reason = error instanceof KeywordLlmError ? error.reason : null;
    console.error(
      JSON.stringify({
        tool: "keyword_opportunity",
        stage: "context",
        code,
        ...(reason === null ? {} : { reason }),
      }),
    );
    return json(createPublicToolError(code), CONTEXT_ERROR_STATUS[code] ?? 502);
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

const PROVIDER_INTENTS: ReadonlySet<KeywordOpportunityProviderIntent> = new Set(
  ["informational", "navigational", "commercial", "transactional"],
);

function providerIntent(
  value: string | null,
): KeywordOpportunityProviderIntent | null {
  return value !== null &&
    PROVIDER_INTENTS.has(value as KeywordOpportunityProviderIntent)
    ? (value as KeywordOpportunityProviderIntent)
    : null;
}

function normalizedSiteDomain(siteUrl: string): string | null {
  try {
    return normalizeTrafficDomain(new URL(siteUrl).hostname);
  } catch {
    return null;
  }
}

/**
 * Stage two: price the candidates and judge them.
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

  // Resolved inside the gate: the coverage read is what
  // makes this tool honest about terms the site already serves, and a visitor
  // whose authorization has lapsed needs the route back to the consent screen
  // rather than a report with a silently missing stage.
  const grant = await dependencies.resolveGrant();
  if (grant.kind !== "grant") {
    gate.release();
    return refuseWithoutGrant(grant);
  }

  const unavailableStages: string[] = [];
  let costCandidateCount = 0;
  let costSerpSampled = 0;
  let reportProduced = false;
  const runStartedAt = dependencies.now().getTime();
  let coverageDurationMs: number | null = null;
  let serpSamplingDurationMs: number | null = null;
  let serpInterpretationDurationMs: number | null = null;
  let domainEnrichmentDurationMs: number | null = null;
  let serpFailureReasons: Readonly<
    Partial<Record<KeywordOpportunitySerpFailureReason, number>>
  > = {};
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
    costCandidateCount = candidates.length;

    const providerRows = await dependencies.validateVolumes({
      keywords: candidates.map((candidate) => candidate.keyword),
      marketCode: token.marketCode,
      languageCode: token.languageCode,
    });
    const validations = resolveKeywordValidations(
      candidates.map((candidate) => candidate.keyword),
      providerRows,
    );

    // Null all the way through when the sample was never read, so the domain
    // layer can tell "the property served nothing" from "nobody looked". An
    // empty array here would collapse the two and put a false negative on
    // every row.
    let coverageRead: KeywordCoverageRead | null = null;
    const coverageStartedAt = dependencies.now().getTime();
    // The grant lists properties, not sites. Resolving here also answers
    // whether this visitor is entitled to read the site at all: no match means
    // no property whose queries we may fetch.
    const property = keywordCoverageProperty(token.siteUrl, grant.properties);
    if (property === null) {
      unavailableStages.push(KEYWORD_STAGE_GSC_COVERAGE);
      console.error(
        JSON.stringify({
          tool: "keyword_opportunity",
          stage: "gsc_coverage",
          reason: "no_granted_property_for_site",
          propertyCount: grant.properties.length,
        }),
      );
    } else {
      try {
        coverageRead = normalizeCoverageRead(
          await dependencies.readCoverageQueries({
            property,
            accessToken: grant.accessToken,
          }),
        );
        if (
          coverageRead.queryPaging.truncated ||
          coverageRead.queryPagePaging.truncated
        ) {
          unavailableStages.push(KEYWORD_STAGE_GSC_COVERAGE_TRUNCATED);
        }
      } catch (error) {
        // Coverage is the one stage whose absence must not stop the run:
        // without it the tool cannot say a term is already served, which is a
        // weaker claim, not a wrong one. It is named so the result reads
        // `partial` — and logged, because the first live run degraded here on
        // every request and left nothing in the trace to explain it.
        unavailableStages.push(KEYWORD_STAGE_GSC_COVERAGE);
        console.error(
          JSON.stringify({
            tool: "keyword_opportunity",
            stage: "gsc_coverage",
            reason: "read_failed",
            message: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    }
    coverageDurationMs = dependencies.now().getTime() - coverageStartedAt;
    const coverageIndex =
      coverageRead === null
        ? null
        : buildKeywordCoverageIndex(
            coverageRead.queryRows,
            coverageRead.queryPageRows,
          );
    const coveragePages: readonly KeywordCoveragePage[] = token.pages.map(
      (page) => ({
        url: page.url,
        // `?? []` is not defensive noise: `open()` is a decrypt plus a type
        // assertion, not a schema check, and a token minted by the version
        // running right now has pages with no `headings` at all. Its TTL is
        // ten minutes, so every deployment of this change has a ten-minute
        // window where spreading `undefined` would throw — after admission,
        // after this run has already paid for expansion and volume validation.
        tokens: keywordTokens([page.title, ...(page.headings ?? [])].join(" ")),
      }),
    );
    // Every URL the crawl actually reached. The generator's attribution is
    // checked against it before it can become a link in the result: stage one
    // verified proposition URLs against the crawl, but the index arrives on
    // this request and an out-of-range or drifted one must resolve to nothing
    // rather than to a page that was never fetched.
    const crawledUrls = new Set(token.pages.map((page) => page.url));
    const attributedPage = (
      candidate: KeywordCandidateDraft,
    ): string | null => {
      // Only the proposition lane may claim one. The generator is told that
      // every `site_proposition` item must carry a valid index and that every
      // expansion item must carry none, so an expansion candidate arriving
      // with an index is the model contradicting its own instructions — and
      // honouring it would let one inconsistent field alone put a row in front
      // of the reader.
      if (candidate.discoveryBasis !== "site_proposition") return null;
      if (candidate.propositionIndex === null) return null;
      const sourceUrl =
        token.propositions[candidate.propositionIndex]?.sourceUrl;
      return sourceUrl !== undefined && crawledUrls.has(sourceUrl)
        ? sourceUrl
        : null;
    };

    const priced = candidates.map((candidate) => {
      const resolved = keywordValidationFor(validations, candidate.keyword);
      return {
        candidate,
        validation: {
          ...resolved,
          providerIntent: providerIntent(resolved.intent),
        },
        coverage: observeKeywordCoverage(
          candidate.keyword,
          coverageIndex,
          coveragePages,
          attributedPage(candidate),
          token.sitemapInventory ?? null,
        ),
      };
    });

    // The current pipeline samples the immutable deduplicated plan in input
    // order. The only intentional omission is a provider-priced numeric zero;
    // provider silence and existing-page evidence still receive the same SERP
    // facts as every other candidate.
    const sampleTargets = priced.filter(
      (row) => row.validation.availability !== "explicit_zero",
    );
    const runObservedAt = dependencies.now().toISOString();
    const serpSamplingStartedAt = dependencies.now().getTime();
    const returnedSamples =
      sampleTargets.length === 0
        ? []
        : await dependencies.sampleSerp({
            keywords: sampleTargets.map((row) => row.candidate.keyword),
            marketCode: token.marketCode,
            languageCode: token.languageCode,
          });
    const returnedByKeyword = new Map(
      returnedSamples.map((sample) => [
        keywordVolumeKey(sample.keyword),
        sample,
      ]),
    );
    const attemptedSamples = sampleTargets.map(
      (row): KeywordSerpSampleResult => {
        const returned = returnedByKeyword.get(
          keywordVolumeKey(row.candidate.keyword),
        );
        if (returned === undefined) {
          return {
            keyword: row.candidate.keyword,
            status: "unavailable",
            failureReason: "provider_unavailable",
            observedAt: null,
            results: [],
            pageItemTypes: null,
            aiOverview: null,
            communityItems: null,
          };
        }
        // The optional branch is the ten-minute compatibility window for an
        // injected legacy producer. Current production outcomes always carry
        // the status explicitly.
        const status = returned.status ?? "complete";
        return status === "complete"
          ? {
              ...returned,
              keyword: row.candidate.keyword,
              status,
              failureReason: null,
              observedAt: returned.observedAt ?? runObservedAt,
            }
          : {
              ...returned,
              keyword: row.candidate.keyword,
              status,
              failureReason: returned.failureReason ?? "provider_unavailable",
              observedAt: null,
              results: [],
            };
      },
    );
    const completeSamples = attemptedSamples.filter(
      (sample) => sample.status === "complete",
    );
    serpSamplingDurationMs =
      dependencies.now().getTime() - serpSamplingStartedAt;
    costSerpSampled = completeSamples.length;
    if (completeSamples.length < attemptedSamples.length) {
      // The one line that tells a budget gap apart from a provider outage.
      // The per-row reasons carry the same facts into the payload, but the
      // payload leaves with the visitor: when a run comes up short, this
      // histogram is what an operator has. The 2026-08-21 partial run gave
      // exactly one number — 46 rows short — and no way to tell whether the
      // fix was more throughput or fewer requests, which are opposites.
      const failureCounts: Partial<
        Record<KeywordOpportunitySerpFailureReason, number>
      > = {};
      for (const sample of attemptedSamples) {
        if (sample.status === "complete") continue;
        const reason = sample.failureReason ?? "provider_unavailable";
        failureCounts[reason] = (failureCounts[reason] ?? 0) + 1;
      }
      serpFailureReasons = failureCounts;
      console.info(
        JSON.stringify({
          tool: "keyword_opportunity",
          stage: "serp_sample",
          planned: attemptedSamples.length,
          complete: completeSamples.length,
          failures: failureCounts,
        }),
      );
    }
    if (attemptedSamples.length > 0 && completeSamples.length === 0) {
      unavailableStages.push(KEYWORD_STAGE_SERP_SAMPLE);
    } else if (completeSamples.length < attemptedSamples.length) {
      unavailableStages.push(KEYWORD_STAGE_SERP_SAMPLE_PARTIAL);
    }

    const interpretationInputs: readonly KeywordSerpInterpretationInput[] =
      completeSamples.map((sample) => ({
        keyword: sample.keyword,
        observedAt: sample.observedAt ?? runObservedAt,
        organicResults: sample.results.map((result) => ({
          position: result.position,
          title: result.title ?? null,
          url: result.url ?? null,
        })),
        aiOverviewMarkdown: sample.aiOverview?.markdown ?? null,
      }));
    let returnedInterpretations: readonly KeywordSerpInterpretation[] = [];
    if (
      interpretationInputs.length > 0 &&
      dependencies.interpretSerpEvidence !== undefined
    ) {
      const interpretationStartedAt = dependencies.now().getTime();
      try {
        returnedInterpretations =
          await dependencies.interpretSerpEvidence(interpretationInputs);
      } catch (error) {
        console.error(
          JSON.stringify({
            tool: "keyword_opportunity",
            stage: "serp_interpretation",
            failureReason:
              error instanceof KeywordLlmError
                ? error.reason
                : "interpretation_unavailable",
            }),
        );
      } finally {
        serpInterpretationDurationMs =
          dependencies.now().getTime() - interpretationStartedAt;
      }
    }
    const completeInterpretationKeys = new Set(
      interpretationInputs.map((input) => keywordVolumeKey(input.keyword)),
    );
    const interpretationsByKeyword = new Map<
      string,
      KeywordSerpInterpretation | null
    >();
    for (const interpretation of returnedInterpretations) {
      const key = keywordVolumeKey(interpretation.keyword);
      if (key === "" || !completeInterpretationKeys.has(key)) continue;
      if (interpretationsByKeyword.has(key)) {
        interpretationsByKeyword.set(key, null);
      } else {
        interpretationsByKeyword.set(key, interpretation);
      }
    }

    const organicDomains = [
      ...new Set(
        completeSamples.flatMap((sample) =>
          sample.results.map((result) => result.domain.trim().toLowerCase()),
        ),
      ),
    ].filter((domain) => domain !== "");
    const trafficDomains = [
      ...new Set(
        organicDomains
          .map(normalizeTrafficDomain)
          .filter((domain): domain is string => domain !== null),
      ),
    ];
    const registrationDomains = [
      ...new Set(
        organicDomains
          .map(normalizeRdapDomain)
          .filter((domain): domain is string => domain !== null),
      ),
    ];
    const siteDomain = normalizedSiteDomain(token.siteUrl);
    const rankTargets = [...organicDomains];
    if (siteDomain !== null && !rankTargets.includes(siteDomain)) {
      rankTargets.push(siteDomain);
    }

    let domainRanks: ReadonlyMap<string, number> | null = null;
    let domainTraffic: ReadonlyMap<string, number | null> | null = null;
    let domainRegistrations: ReadonlyMap<
      string,
      DomainRegistrationEvidence
    > | null = null;
    const domainEnrichmentStartedAt = dependencies.now().getTime();
    // The enrichments are optional, unbounded, and last. RDAP alone resolves
    // one entry per organic domain — several hundred after de-duplication — at
    // ten in flight, so its worst case is dozens of rounds, not the single
    // round `Promise.all` makes it look like. Past the response deadline the
    // platform kills the function outright: no envelope, no cost line, and the
    // whole report lost. A null enrichment is already how this handler says
    // "not available", so running out of budget degrades the same way a
    // provider failure does.
    const rawEnrichmentBudgetMs =
      dependencies.responseDeadlineAt === undefined
        ? null
        : dependencies.responseDeadlineAt - dependencies.now().getTime();
    // Fail closed on a non-finite mark rather than handing `setTimeout` an
    // Infinity it silently clamps to a near-zero delay. Production derives both
    // marks from one `Date.now()`, but this is an injected seam.
    const enrichmentBudgetMs =
      rawEnrichmentBudgetMs === null || Number.isFinite(rawEnrichmentBudgetMs)
        ? rawEnrichmentBudgetMs
        : 0;
    const enrichmentAffordable =
      enrichmentBudgetMs === null ||
      enrichmentBudgetMs >= MIN_KEYWORD_ENRICHMENT_MS;
    // Whether there is any enrichment to do at all, independent of budget. The
    // two are logged apart on purpose: saying the budget suppressed a wave that
    // had no domains to resolve would put deadline pressure in the telemetry
    // that was never there.
    const enrichmentHasWork =
      completeSamples.length > 0 && organicDomains.length > 0;
    if (enrichmentHasWork && !enrichmentAffordable) {
      console.error(
        JSON.stringify({
          tool: "keyword_opportunity",
          stage: "domain_enrichment",
          reason: "budget_exhausted",
        }),
      );
    }
    if (enrichmentHasWork && enrichmentAffordable) {
      // One deadline, applied per resolver rather than to the wave as a whole.
      // Racing the aggregate would let the slowest — RDAP, by construction —
      // discard rank and traffic maps that had already resolved, which is worse
      // than the per-resolver failure isolation this wave started with.
      let expire = (): void => {};
      const expired: Promise<null> =
        enrichmentBudgetMs === null
          ? new Promise<null>(() => {})
          : new Promise<null>((resolve) => {
              const timer = setTimeout(() => {
                resolve(null);
              }, enrichmentBudgetMs);
              expire = () => {
                clearTimeout(timer);
              };
            });
      let expiredAny = false;
      const bounded = async <T>(
        resolver: Promise<T | null>,
      ): Promise<T | null> => {
        const settled = await Promise.race([resolver, expired]);
        if (settled === null) expiredAny = true;
        return settled;
      };
      const [ranks, traffic, registrations] = await Promise.all([
        bounded(
          dependencies.resolveDomainRanks(rankTargets).catch(() => {
            console.error(
              JSON.stringify({
                tool: "keyword_opportunity",
                stage: "domain_rank",
                reason: "read_failed",
              }),
            );
            return null;
          }),
        ),
        bounded(
          dependencies
            .resolveDomainTraffic({
              domains: trafficDomains,
              marketCode: token.marketCode,
            })
            .catch(() => {
              console.error(
                JSON.stringify({
                  tool: "keyword_opportunity",
                  stage: "domain_traffic",
                  reason: "read_failed",
                }),
              );
              return null;
            }),
        ),
        bounded(
          dependencies
            .resolveDomainRegistrations(registrationDomains)
            .catch(() => {
              console.error(
                JSON.stringify({
                  tool: "keyword_opportunity",
                  stage: "domain_registration",
                  reason: "read_failed",
                }),
              );
              return null;
            }),
        ),
      ]);
      // Stop the clock the moment nothing is waiting on it. Left scheduled it
      // would hold its closure for the rest of the budget on a warm instance,
      // once per request.
      expire();
      if (expiredAny) {
        console.error(
          JSON.stringify({
            tool: "keyword_opportunity",
            stage: "domain_enrichment",
            reason: "budget_expired",
          }),
        );
      }
      // Whatever did land is kept. Abandoning the wait does not cancel the
      // provider work, but the function is ending anyway, and an envelope
      // carrying the ranks that did resolve beats no envelope at all.
      domainRanks = ranks;
      domainTraffic = traffic;
      domainRegistrations = registrations;
    }
    const siteDomainRank =
      siteDomain === null ? null : (domainRanks?.get(siteDomain) ?? null);
    domainEnrichmentDurationMs =
      enrichmentHasWork && enrichmentAffordable
        ? dependencies.now().getTime() - domainEnrichmentStartedAt
        : enrichmentHasWork
          ? 0
          : null;
    const siteTrafficThreshold = keywordSiteTrafficThreshold(siteDomainRank);
    const samplesByKeyword = new Map(
      attemptedSamples.map((sample) => [
        keywordVolumeKey(sample.keyword),
        sample,
      ]),
    );

    const observations: KeywordOpportunityObservationV3[] = priced.map((row) => {
      const attempted = samplesByKeyword.get(
        keywordVolumeKey(row.candidate.keyword),
      );
      const sample: KeywordSerpSampleResult = attempted ?? {
        keyword: row.candidate.keyword,
        status: "unavailable",
        failureReason: null,
        observedAt: null,
        results: [],
        pageItemTypes: null,
        aiOverview: null,
        communityItems: null,
      };
      const enriched = buildKeywordSignalEvidence({
        sample,
        observedAt: runObservedAt,
        siteDomainRank,
        domainTraffic,
        domainRegistrations,
        marketCode: token.marketCode,
        languageCode: token.languageCode,
      });
      const interpretation = interpretationsByKeyword.get(
        keywordVolumeKey(row.candidate.keyword),
      );
      const availableInterpretation =
        interpretation?.availability === "available" ? interpretation : null;
      const serpIntent =
        availableInterpretation === null
          ? null
          : {
              intent: availableInterpretation.intent,
              source: "serp_top_ten_interpretation" as const,
              observedAt: sample.observedAt ?? runObservedAt,
              modelId: availableInterpretation.modelId,
              promptVersion: availableInterpretation.promptVersion,
            };
      const aiOverview =
        availableInterpretation !== null
          ? {
              ...enriched.aiOverview,
              answerAssessment: availableInterpretation.aiOverviewAssessment,
              reason: availableInterpretation.reason,
              modelId: availableInterpretation.modelId,
              promptVersion: availableInterpretation.promptVersion,
            }
          : enriched.aiOverview.availability === "observed" &&
              enriched.aiOverview.markdown !== null
            ? {
                ...enriched.aiOverview,
                answerAssessment: "unavailable" as const,
                reason: "interpretation_unavailable",
                modelId: null,
                promptVersion: null,
              }
            : enriched.aiOverview;
      const serp =
        sample.status === "complete"
          ? {
              ...judgeKeywordWinnability(
                {
                  results: sample.results,
                  domainRanks: domainRanks ?? new Map(),
                  pageItemTypes: sample.pageItemTypes,
                },
                siteDomainRank,
              ),
              status: "complete" as const,
              failureReason: null,
              observedAt: sample.observedAt ?? runObservedAt,
              organicResults: sample.results.map((result) => ({
                position: result.position,
                domain: result.domain,
                title: result.title ?? null,
                url: result.url ?? null,
              })),
            }
          : {
              ...KEYWORD_OPPORTUNITY_UNSAMPLED,
              status: "unavailable" as const,
              failureReason: sample.failureReason ?? null,
              observedAt: null,
              organicResults: [],
            };
      return {
        keyword: row.candidate.keyword,
        lane: row.candidate.questionForm ? "geo" : "seo",
        discoveryBasis: row.candidate.discoveryBasis,
        questionForm: row.candidate.questionForm,
        propositionIndex: row.candidate.propositionIndex,
        validation: row.validation,
        serp,
        serpIntent,
        signals: enriched.signals,
        aiOverview,
        coverage: row.coverage.state,
        supportingPage: row.coverage.supportingPage,
      };
    });

    const context: KeywordOpportunityContext = {
      siteUrl: token.siteUrl,
      pagesFetched: token.pagesFetched,
      productPagesFetched: token.productPagesFetched,
      ...(token.selection === undefined ? {} : { selection: token.selection }),
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
      serpPlanned: attemptedSamples.length,
      serpFailureReasons,
      thresholds: {
        siteDomainRank,
        lowOrganicTrafficThreshold: siteTrafficThreshold,
      },
      durationsMs: {
        total: dependencies.now().getTime() - runStartedAt,
        coverage: coverageDurationMs,
        serpSampling: serpSamplingDurationMs,
        serpInterpretation: serpInterpretationDurationMs,
        domainEnrichment: domainEnrichmentDurationMs,
      },
      completedAt: runObservedAt,
    });

    reportProduced = true;
    return json({ data: payload }, 200);
  } catch (error) {
    if (error instanceof KeywordLlmError) {
      console.error(
        JSON.stringify({
          tool: "keyword_opportunity",
          stage: "expand_candidates",
          failureReason: error.reason,
        }),
      );
      return json(createPublicToolError(error.code), 502);
    }
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
    // One record for every admitted stage-two run, including failures after a
    // provider response or model reply already incurred cost. User-credit
    // state is deliberately absent: this is provider/LLM observability only.
    reportKeywordRunCost({
      costs: dependencies.costs,
      candidateCount: costCandidateCount,
      serpSampled: costSerpSampled,
      reportProduced,
      llm: dependencies.llmUsage?.(),
    });
  }
}

/**
 * Everything that does not depend on this request's access token.
 *
 * The token-bound reader is built by the route, inside the gate, for the same
 * reason the sibling tools build theirs there: a reader constructed at module
 * scope would outlive the grant it was made from.
 */
export const DEFAULT_KEYWORD_OPPORTUNITY_DEPENDENCIES: Pick<
  KeywordOpportunityDependencies,
  "readIdentity" | "resolveGrant" | "openCrawlGate" | "openGscGate" | "now"
> = {
  readIdentity: async () => {
    const sub = identitySubFrom((await cookies()).get("gg_id")?.value);
    return sub === null ? null : { sub };
  },
  resolveGrant: resolveTrafficDropGrant,
  openCrawlGate: (clientIp, siteUrl) => openCrawlGate(clientIp, siteUrl),
  openGscGate: (clientIp) => openGscGate(clientIp),
  now: () => new Date(),
};
