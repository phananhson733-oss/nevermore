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
  const llm = createKeywordLlmSeams({});

  return handleKeywordContextRequest(request, {
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
}
