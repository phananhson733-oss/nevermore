// @input  -- authenticated POST naming a site, a market and optional seed terms
// @output -- the positioning read off that site plus a sealed carry-over token
// @pos    -- thin Next.js boundary over stage one of the keyword map handler
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { extractClientIp } from "@/lib/rate-limit";
import { crawlSiteContextProfile } from "@sf/sources/crawl-context-profile";
import { toKeywordContextCrawl } from "@/lib/tools/keyword-context-crawl";
import {
  DEFAULT_KEYWORD_OPPORTUNITY_DEPENDENCIES,
  handleKeywordContextRequest,
} from "@/lib/tools/keyword-opportunity-handler";
import { createKeywordLlmSeams } from "@/lib/tools/keyword-prompts";
import { createKeywordLlmUsageSink } from "@/lib/tools/keyword-llm-usage-sink";
import { createKeywordCostAccumulator } from "@/lib/tools/keyword-cost-guard";
import { createKeywordCoverageReader } from "@/lib/tools/keyword-coverage-reader";
import { createKeywordProviderSeams } from "@/lib/tools/keyword-providers";

export const runtime = "nodejs";
/**
 * Sized to the worst case the code below actually permits, not the typical
 * run: a 60s crawl budget (`CONTEXT_PROFILE_CRAWL_BUDGET.maxWallClockMs`) and
 * then up to two 45s model attempts (`KEYWORD_LLM_TIMEOUT_MS` x
 * `MAX_KEYWORD_LLM_ATTEMPTS`, the retry an empty reply is allowed) is 150s,
 * which the previous 120 could not hold. That gap defeated the point of the
 * ceiling: a request over it is killed by the platform mid-flight, so the
 * visitor gets an opaque timeout instead of the error envelope this handler
 * builds, and the failure-reason and cost lines never reach the log at all.
 * 180 clears the arithmetic with room for sealing and serialization.
 */
export const maxDuration = 180;

export async function POST(request: Request): Promise<Response> {
  // Stage one spends no provider money, but the accumulator is still built per
  // request: the dependency shape is shared with stage two, and a module-scope
  // one would carry another visitor's spend into this run's report.
  const costs = createKeywordCostAccumulator();
  // Counted, not just offered: `onUsage` existed from the start and both
  // routes passed an empty object, so every run reported zero model calls.
  const llmUsage = createKeywordLlmUsageSink();
  const llm = createKeywordLlmSeams({ onUsage: llmUsage.add });

  const response = await handleKeywordContextRequest(request, {
    ...DEFAULT_KEYWORD_OPPORTUNITY_DEPENDENCIES,
    costs,
    crawlContext: async (siteUrl) =>
      toKeywordContextCrawl(await crawlSiteContextProfile(siteUrl)),
    extractPropositions: llm.extractPropositions,
    expandCandidates: llm.expandCandidates,
    ...createKeywordProviderSeams({ costs }),
    readCoverageQueries: createKeywordCoverageReader({}),
    extractClientIp,
  });

  // Stage one has no cost report to hang this on — it spends no provider
  // money — but it does make a model call, so it is where half this tool's
  // retries happen. Logged on failures too: a run that burned its output
  // budget and returned nothing is the one worth seeing.
  console.info(
    JSON.stringify({
      tool: "keyword_opportunity",
      stage: "context",
      status: response.status,
      llm: llmUsage.total(),
    }),
  );
  return response;
}
