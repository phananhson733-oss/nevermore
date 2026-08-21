// @input  -- authenticated POST carrying the sealed context token from stage one
// @output -- the keyword opportunity envelope, or a stable error envelope
// @pos    -- thin Next.js boundary over stage two of the keyword map handler
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { extractClientIp } from "@/lib/rate-limit";
import { crawlSiteContextProfile } from "@sf/sources/crawl-context-profile";
import { toKeywordContextCrawl } from "@/lib/tools/keyword-context-crawl";
import {
  DEFAULT_KEYWORD_OPPORTUNITY_DEPENDENCIES,
  handleKeywordOpportunitiesRequest,
} from "@/lib/tools/keyword-opportunity-handler";
import { createKeywordLlmSeams } from "@/lib/tools/keyword-prompts";
import { createKeywordLlmUsageSink } from "@/lib/tools/keyword-llm-usage-sink";
import { createKeywordCostAccumulator } from "@/lib/tools/keyword-cost-guard";
import { createKeywordCoverageReader } from "@/lib/tools/keyword-coverage-reader";
import { createKeywordProviderSeams } from "@/lib/tools/keyword-providers";

export const runtime = "nodejs";
/**
 * The paid half: candidate expansion, batched pricing, all-candidate SERP
 * evidence, domain enrichments, and optional bounded interpretation. The route
 * keeps the platform ceiling while each dependency owns its tighter deadline.
 */
export const maxDuration = 300;

/**
 * When the optional interpretation lane must stop spending the route's budget.
 *
 * The lane it bounds is the one whose call count scales with the candidate cap
 * — 150 candidates is 15 chunked model calls — so it is the one that reaches
 * the ceiling first; a 2026-08-21 production run did, and was killed with no
 * envelope and no cost line after the visitor had waited five minutes. What
 * separates this from the mark below is the enrichment wave that follows it.
 */
const KEYWORD_INTERPRETATION_DEADLINE_MS = 240_000;

/**
 * When the route must be assembling its answer rather than fetching more.
 *
 * Twenty seconds short of the platform ceiling, which covers building the
 * observations and serializing them. Past the ceiling there is no response to
 * degrade — the function is killed mid-flight — so the trailing optional work
 * is bounded against this mark rather than trusted to finish. It is deliberately
 * a second, later mark: an offset from the interpretation deadline alone would
 * still let the stages before interpretation push the enrichments past 300s.
 */
const KEYWORD_RESPONSE_DEADLINE_MS = 280_000;

export async function POST(request: Request): Promise<Response> {
  // One instant, both marks. Taken at the top because a deadline belongs to the
  // request: whatever the earlier stages spend is already gone by the time the
  // later ones read it, which is the whole point of an absolute mark over a
  // per-stage budget.
  const startedAt = Date.now();
  const deadlineAt = startedAt + KEYWORD_INTERPRETATION_DEADLINE_MS;
  const responseDeadlineAt = startedAt + KEYWORD_RESPONSE_DEADLINE_MS;
  // One accumulator per request, shared between provider adapters that book
  // actual spend and the handler that reports it. Initial v2 does not call the
  // accumulator's legacy admission helpers or the account-wide daily breaker.
  const costs = createKeywordCostAccumulator();
  // Counted, not just offered: `onUsage` existed from the start and both
  // routes passed an empty object, so every run reported zero model calls.
  const llmUsage = createKeywordLlmUsageSink();
  const llm = createKeywordLlmSeams({ onUsage: llmUsage.add, deadlineAt });

  return handleKeywordOpportunitiesRequest(request, {
    ...DEFAULT_KEYWORD_OPPORTUNITY_DEPENDENCIES,
    costs,
    crawlContext: async (siteUrl) =>
      toKeywordContextCrawl(await crawlSiteContextProfile(siteUrl)),
    extractPropositions: llm.extractPropositions,
    expandCandidates: llm.expandCandidates,
    interpretSerpEvidence: llm.interpretSerpEvidence,
    ...createKeywordProviderSeams({ costs }),
    // Built here, from the token the handler resolved inside the gate.
    readCoverageQueries: createKeywordCoverageReader({}),
    extractClientIp,
    llmUsage: llmUsage.total,
    responseDeadlineAt,
  });
}
