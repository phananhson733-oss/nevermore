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
 * The crawl owns most of this: a 60s page budget plus one model call to read
 * the positioning off what came back. 120 leaves room for both and still
 * returns an envelope the surface can render rather than a platform timeout.
 */
export const maxDuration = 120;

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
