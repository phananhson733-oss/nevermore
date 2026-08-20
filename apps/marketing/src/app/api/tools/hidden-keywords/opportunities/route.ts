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

export async function POST(request: Request): Promise<Response> {
  // One accumulator per request, shared between provider adapters that book
  // actual spend and the handler that reports it. Initial v2 does not call the
  // accumulator's legacy admission helpers or the account-wide daily breaker.
  const costs = createKeywordCostAccumulator();
  // Counted, not just offered: `onUsage` existed from the start and both
  // routes passed an empty object, so every run reported zero model calls.
  const llmUsage = createKeywordLlmUsageSink();
  const llm = createKeywordLlmSeams({ onUsage: llmUsage.add });

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
  });
}
