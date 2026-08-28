// @input  -- one frozen question, one sample index, the confirmed brand and rival names, and a paid provider
// @output -- one judged VisibilitySample per call, and a bounded runner for a batch of them
// @pos    -- the only place an AI visibility answer becomes a reportable observation

/**
 * Why this sits beside the GEO Agent's sampler instead of reusing it.
 *
 * `lib/agents/geo-sampling.ts` produces `GeoSampleV3`, a record with a tri-state
 * for every dimension it measures. This tool's frozen record is
 * {@link VisibilitySample}, which carries booleans, and the two cannot be
 * mapped onto each other without inventing states one of them does not have.
 * What IS shared is every judgement primitive: the alias matcher, the URL
 * canonicalizer, the target-citation rule and the provider transport are all
 * imported from there rather than rewritten, because a second `includes()` in
 * this file is how the two tools would start disagreeing about whether the same
 * answer named the same brand.
 */

import {
  findGeoAliasMatch,
  geoMentionSnippet,
  normalizeAliasForMatch,
  GEO_MAX_MENTION_SNIPPET_CODE_POINTS,
  type GeoAliasMatch,
} from "../agents/geo-alias-match.ts";
import {
  codePointLength,
  hasLoneSurrogate,
  normalizeGeoText,
} from "../agents/geo-canonical.ts";
import {
  createGeoProviderClient,
  GeoProviderError,
  type GeoProviderClient,
  type GeoProviderFailureReason,
  type GeoProviderObservation,
} from "../agents/geo-provider.ts";
import {
  geoCitationDomain,
  isGeoTargetCitation,
  normalizeGeoCitationUrl,
} from "../agents/geo-url.ts";
import type { GeoKbCompetitor } from "./kb-contract.ts";
import type { GeoQuestion } from "./kb-questions.ts";
import {
  type VisibilitySample,
  VISIBILITY_MAX_SAMPLE_CITATION_URLS,
  type VisibilitySampleStatus,
} from "./visibility-contract.ts";

/**
 * How many times one planned sample may be sent again.
 *
 * Zero. This started at one, for "the request never left" - the transport
 * reports that as `network_error`, and a request that never left cannot have
 * been billed. The premise is false: a rejected `fetch` says the client did not
 * receive a complete response, not that the POST failed to arrive. A request
 * delivered and billed whose connection drops before the response headers
 * arrives on exactly the same branch, and retrying it buys a second charge for
 * one planned sample - usually without even recording the first, since the
 * first response never came back to read a price from.
 *
 * Retrying a paid POST is only safe with an idempotency key the provider
 * honours, or a fence that can prove the call did not happen. Neither exists
 * here, so the sample is recorded as unobserved and the run reports one fewer
 * answer. An under-reported denominator is visible; a duplicate charge is not.
 */
export const VISIBILITY_MAX_UNSENT_RETRIES = 0;

export interface VisibilitySampleInput {
  /** The question as it was frozen. Its text is sent verbatim; its id labels the sample. */
  readonly question: GeoQuestion;
  /** 1-based: the k-th independent sample of this question, not a retry counter. */
  readonly sampleIndex: number;
  /** Canonical host of the site under test, as `normalizeGeoHost` produces it. */
  readonly targetHost: string;
  readonly officialName: string;
  readonly aliases: readonly string[];
  /**
   * The knowledge base's competitors, confirmed and unconfirmed alike.
   *
   * Filtered here rather than by the caller. An unconfirmed brand name is a
   * guess about what a rival is called, and a guess that reaches this function
   * becomes a rival the report says was named in someone's answer.
   */
  readonly competitors: readonly GeoKbCompetitor[];
}

export interface VisibilitySamplingDependencies {
  readonly model: string;
  readonly marketCode: string;
  /** Injected offline by tests; production omits it and gets the DataForSEO client. */
  readonly provider?: GeoProviderClient | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Add one billed amount to a sample's running cost.
 *
 * Null stays null rather than becoming zero: an unpriced call still happened,
 * and a zero there reads as "measured, and it was free". A price that is not a
 * finite non-negative number is treated as no price at all, because one NaN
 * would make the sample's cost — and every total built from it — NaN.
 */
function addCost(total: number | null, cost: number | null): number | null {
  if (cost === null || !Number.isFinite(cost) || cost < 0) return total;
  return (total ?? 0) + cost;
}

/**
 * The failure class as one of the four statuses the record has room for.
 *
 * `blocked` is reserved for the provider refusing to serve us at all — bad
 * credentials, no credentials, a rate limit. Those say nothing about the answer
 * and everything about the account, and folding them into `error` would hide a
 * misconfigured key inside a pile of ordinary failures.
 */
function statusForReason(
  reason: GeoProviderFailureReason,
): VisibilitySampleStatus {
  switch (reason) {
    case "timeout":
      return "timeout";
    case "not_configured":
    case "auth_failed":
    case "rate_limited":
      return "blocked";
    case "network_error":
    case "server_error":
    case "bad_request":
    case "invalid_response":
      return "error";
    default:
      // A reason this file has not seen is a failure, not a success.
      return "error";
  }
}

/**
 * The record for a planned sample that produced no usable observation.
 *
 * `webSearchPerformed` is null, never false: a call that produced no answer
 * produced no evidence that a search did not run either, and a fabricated
 * `false` would enter the run as an observation.
 *
 * The booleans below are false because the frozen record has no third state for
 * them. They are inert by construction — every rate in the report divides by a
 * count of samples whose status is `ok`, so a non-ok sample's `mentioned` is
 * never read as "we looked and the brand was absent". Any consumer that starts
 * counting these fields without first filtering on status will be counting
 * placeholders, which is the one way this shape can be made to lie.
 */
function unobservedSample(
  input: VisibilitySampleInput,
  status: VisibilitySampleStatus,
  costUsd: number | null,
): VisibilitySample {
  return {
    questionId: input.question.id,
    sampleIndex: input.sampleIndex,
    status,
    webSearchPerformed: null,
    mentioned: false,
    // Not `false`: nothing was read, so "did not cite" would be a claim about
    // an answer that does not exist.
    cited: null,
    citedDomains: [],
    citedUrls: [],
    competitorsMentioned: [],
    excerpt: null,
    costUsd,
    observedAt: null,
  };
}

interface CitationReading {
  /** Canonical URLs, deduplicated within this one answer, bounded. */
  readonly urls: readonly string[];
  /** Canonical hosts, deduplicated within this one answer, in first-cited order. */
  readonly domains: readonly string[];
  readonly citedTarget: boolean;
}

/**
 * Read the answer's citations, or say the list could not be read.
 *
 * Null when the provider itself reported an incomplete extraction, and null
 * when a URL that reached here will not canonicalize. Both are the same claim:
 * this answer's citations are unknown. The alternative — keeping the readable
 * half — publishes "cited nobody" or "cited only others" about an answer whose
 * citation list we failed to read, and the citation rate is the single number
 * this tool exists to produce.
 */
function readCitations(
  observation: GeoProviderObservation,
  targetHost: string,
): CitationReading | null {
  if (!observation.citationsComplete) return null;

  const domains: string[] = [];
  const urls: string[] = [];
  const seenUrls = new Set<string>();
  const seen = new Set<string>();
  let citedTarget = false;

  for (const citation of observation.citations) {
    // Re-canonicalized rather than trusted: the same rule the transport applied,
    // applied again by the module that draws the conclusion, so a change on
    // either side shows up as an unreadable list instead of as a host that
    // silently stops matching the site under test.
    const url = normalizeGeoCitationUrl(citation.url);
    if (url === null) return null;
    const domain = geoCitationDomain(url);
    if (domain === null) return null;
    if (isGeoTargetCitation(url, targetHost)) citedTarget = true;
    if (
      !seenUrls.has(url) &&
      urls.length < VISIBILITY_MAX_SAMPLE_CITATION_URLS
    ) {
      seenUrls.add(url);
      urls.push(url);
    }
    // One answer citing three pages of one host is one cited domain. The report
    // counts answers per domain, not links, so counting links here would let a
    // single answer look like a pattern.
    if (!seen.has(domain)) {
      seen.add(domain);
      domains.push(domain);
    }
  }

  return { urls, domains, citedTarget };
}

/**
 * Confirmed rivals this answer named, by the same whole-word rule the brand uses.
 *
 * One name per matcher call so the returned string is the rival that matched
 * rather than whichever alias the matcher happened to prefer. Names that
 * normalize identically are one rival: the matcher cannot tell them apart, so
 * reporting both would double-count one mention.
 *
 * Names shorter than the matcher's minimum token length are silently unmatched.
 * That is the matcher's rule, inherited on purpose — a two-letter rival matches
 * every acronym in every answer, and a rival count built on that is noise.
 */
function mentionedCompetitors(
  answerText: string,
  competitors: readonly GeoKbCompetitor[],
): readonly string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const competitor of competitors) {
    if (!competitor.confirmed) continue;
    const brandName = competitor.brandName.trim();
    if (brandName.length === 0) continue;
    const key = normalizeAliasForMatch(brandName);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    candidates.push(brandName);
  }

  return candidates.filter(
    (brandName) => findGeoAliasMatch(answerText, [brandName]) !== null,
  );
}

/**
 * The sentence the brand was named in, bounded, or nothing.
 *
 * Null for a short answer is the snippet writer's rule, not an oversight: an
 * excerpt that reproduces essentially the whole answer is a third party's prose
 * in our report wearing the word "snippet". The mention itself is still
 * recorded, so nothing is lost but the quotation.
 *
 * Whitespace is folded because the report renders this in one line, and an
 * unpaired surrogate drops the excerpt entirely — it cannot arrive from a
 * keyboard, it survives serialization differently on each side, and repairing
 * it would show text the model never wrote.
 */
function boundedExcerpt(
  answerText: string,
  match: GeoAliasMatch,
): string | null {
  const snippet = geoMentionSnippet(answerText, match);
  if (snippet === null) return null;
  const normalized = normalizeGeoText(snippet);
  if (normalized.length === 0) return null;
  if (hasLoneSurrogate(normalized)) return null;
  // Re-checked across the module boundary that publishes the bound. The snippet
  // writer already applies it; this keeps a change over there from quietly
  // widening the promise this report makes about how much of an answer it keeps.
  if (codePointLength(normalized) > GEO_MAX_MENTION_SNIPPET_CODE_POINTS) {
    return null;
  }
  return normalized;
}

/**
 * Turn one observed answer into one judged sample.
 *
 * Nothing here branches on the question's mode. A `demand` question is judged
 * exactly like a `retrieval` one — its citations are counted and reported —
 * because the ruling is that demand citations are REPORTED and merely kept out
 * of the citation denominator. Zeroing them here would destroy the number the
 * ruling says to publish, and the denominator is not this function's to choose:
 * it belongs to whatever builds {@link VisibilityMetrics}, which is the only
 * place that can see all the samples at once.
 *
 * An unreadable citation list no longer discards the sample. It used to: the
 * record had no state for "cited: unknown", so a malformed URL anywhere in the
 * list rewrote an answered, brand-mentioning sample into `status: "error"` and
 * removed it from the mention denominator as well. One answer in five failing
 * to parse its citations turned a real 1/5 mention rate into 0/4. The record
 * now carries `cited: null`, and the two observations stay independent: the
 * mention is counted, the citation is not, and the count of unreadable lists is
 * reported beside the citation rate.
 */
export function judgeVisibilitySample(
  input: VisibilitySampleInput,
  observation: GeoProviderObservation,
  costUsd: number | null,
): VisibilitySample {
  const citations = readCitations(observation, input.targetHost);

  // The official name first: it is the name the report prints, and the matcher
  // breaks a same-offset tie by length rather than by order, so listing it
  // first costs nothing and makes the intent readable.
  const brandNames = [input.officialName, ...input.aliases].filter(
    (name) => name.trim().length > 0,
  );
  // Read from the answer prose only. The provider's `answerText` is the message
  // text, so a brand that appears solely inside a citation URL is a citation and
  // not a mention — one of them says the model knows the name, the other says it
  // found the page, and collapsing them would let a single link manufacture
  // both.
  const match = findGeoAliasMatch(observation.answerText, brandNames);

  return {
    questionId: input.question.id,
    sampleIndex: input.sampleIndex,
    status: "ok",
    webSearchPerformed: observation.webSearchPerformed,
    mentioned: match !== null,
    cited: citations === null ? null : citations.citedTarget,
    citedDomains: citations === null ? [] : citations.domains,
    citedUrls: citations === null ? [] : citations.urls,
    competitorsMentioned: mentionedCompetitors(
      observation.answerText,
      input.competitors,
    ),
    excerpt: match === null ? null : boundedExcerpt(observation.answerText, match),
    costUsd,
    observedAt: observation.observedAt,
  };
}

/**
 * Observe one question once, and judge what came back.
 *
 * Never throws: every planned sample resolves to a record, so one bad call
 * cannot discard the paid answers beside it. The cost travels with the record
 * even when the call failed, because the provider bills for some failures and a
 * run that dropped those charges would under-report what it spent.
 */
export async function observeVisibilitySample(
  input: VisibilitySampleInput,
  dependencies: VisibilitySamplingDependencies,
): Promise<VisibilitySample> {
  const provider = dependencies.provider ?? createGeoProviderClient();
  let billed: number | null = null;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const observation = await provider.observe(
        {
          prompt: input.question.text,
          model: dependencies.model,
          marketCode: dependencies.marketCode,
        },
        dependencies.signal,
      );
      billed = addCost(billed, observation.costUsd);
      return judgeVisibilitySample(input, observation, billed);
    } catch (error) {
      if (!(error instanceof GeoProviderError)) {
        // A throw from somewhere other than the transport carries no price and
        // no reason we can classify; it is still a sample that did not happen.
        return unobservedSample(input, "error", billed);
      }
      billed = addCost(billed, error.costUsd);

      // No transport failure is retried. See VISIBILITY_MAX_UNSENT_RETRIES:
      // a rejected fetch cannot distinguish "never sent" from "sent, billed,
      // and the response was lost", and only one of those is free to repeat.
      // The loop is kept so the constant remains the single place that decides.
      const retryable =
        error.reason === "network_error" &&
        attempt < VISIBILITY_MAX_UNSENT_RETRIES &&
        dependencies.signal?.aborted !== true;
      if (retryable) continue;

      return unobservedSample(input, statusForReason(error.reason), billed);
    }
  }
}
