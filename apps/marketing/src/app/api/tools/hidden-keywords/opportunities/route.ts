// @input  -- authenticated stage-two POST, legacy synchronous or versioned durable start
// @output -- a legacy result, a sealed Workflow run pointer, or a stable error envelope
// @pos    -- protocol-negotiating Next.js boundary for the paid half of the keyword map
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
import {
  handleKeywordWorkflowStartRequest,
  readKeywordIdentity,
} from "@/lib/tools/keyword-workflow-handler";
import { KEYWORD_WORKFLOW_VERSION } from "@/lib/tools/keyword-workflow-contract";
import { keywordOpportunityWorkflow } from "@/lib/tools/keyword-opportunity-workflow";
import { openGscGate } from "@/lib/tools/gsc-gate";
import { resolveTrafficDropGrant } from "@/lib/tools/traffic-drop-session";
import { start } from "workflow/api";

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
  if (
    request.headers.get("X-Keyword-Workflow-Version") ===
    KEYWORD_WORKFLOW_VERSION
  ) {
    return handleKeywordWorkflowStartRequest(request, {
      readIdentity: readKeywordIdentity,
      openGscGate,
      resolveGrant: resolveTrafficDropGrant,
      startWorkflow: async (input) => {
        const run = await start(keywordOpportunityWorkflow, [input]);
        return { runId: run.runId };
      },
      extractClientIp,
      now: Date.now,
    });
  }

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
    // Sampling shares the interpretation mark rather than getting one of its
    // own. It runs first and it is the SERP facts the report is built from, so
    // when the two cannot both fit, sampling is the one that should have the
    // budget — interpretation degrading every chunk is already its contract.
    ...createKeywordProviderSeams({ costs, deadlineAt }),
    // Built here, from the token the handler resolved inside the gate.
    readCoverageQueries: createKeywordCoverageReader({ deadlineAt }),
    extractClientIp,
    llmUsage: llmUsage.total,
    responseDeadlineAt,
  });
}
