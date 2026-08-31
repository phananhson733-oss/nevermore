// @input -- one frozen V2 engine slot and an optional offline provider transport
// @output -- one observed sample, with actual model/task and ranked-list evidence
// @pos -- server-only paid seam, kept out of the browser's pure report/import graph
import { createGeoProviderClient, type GeoProviderClient, type GeoProviderObservation } from "../agents/geo-provider.ts";
import { containsGeoAlias } from "../agents/geo-alias-match.ts";
import { codePointLength, normalizeGeoText, sliceCodePoints } from "../agents/geo-canonical.ts";
import { normalizeGeoCitationUrl, normalizeGeoHost } from "../agents/geo-url.ts";
import { geoBriefSubtopicEvidence } from "./brief-subtopics.ts";
import { observeVisibilitySample } from "./visibility-sampling.ts";
import { VISIBILITY_ENGINE_CONFIG } from "./visibility-engines.ts";
import { readVisibilityListPosition, visibilityTrackedRivals } from "./visibility-v2.ts";
import type { VisibilityContextV2, VisibilityPlanItemV2, VisibilitySampleV2 } from "./visibility-v2-contract.ts";

export async function observeVisibilityV2(context: VisibilityContextV2, item: VisibilityPlanItemV2, dependencies: { readonly provider?: GeoProviderClient; readonly signal?: AbortSignal } = {}): Promise<VisibilitySampleV2> {
  const provider = dependencies.provider ?? createGeoProviderClient();
  const config = VISIBILITY_ENGINE_CONFIG[item.engine];
  const captured: { value: GeoProviderObservation | null } = { value: null };
  const result = await observeVisibilitySample({ ...context, question: item.question, sampleIndex: item.sampleIndex }, {
    model: config.modelRequested,
    marketCode: context.marketCode,
    signal: dependencies.signal,
    provider: { observe: async (request, signal) => {
      const observation = await provider.observe({ ...request, engine: item.engine }, signal);
      captured.value = observation;
      return observation;
    } },
  });
  const observed = result.status === "ok" ? captured.value : null;
  const answer = observed === null ? null : normalizeGeoText(observed.answerText);
  const topics = observed === null ? null : geoBriefSubtopicEvidence(observed.answerText);
  const rivals = visibilityTrackedRivals(context);
  const allUrls = observed === null || result.cited === null ? [] : [...new Set(observed.citations.flatMap((citation) => {
    const url = normalizeGeoCitationUrl(citation.url);
    return url === null ? [] : [url];
  }))];
  const own = result.cited === true ? allUrls.find((url) => normalizeGeoHost(url) === context.targetHost) : undefined;
  const citedUrls = own === undefined ? result.citedUrls : [own, ...allUrls.filter((url) => url !== own)].slice(0, 10);
  return { ...result, engine: item.engine, slotId: item.slotId, modelRequested: config.modelRequested,
    competitorsMentioned: observed === null ? [] : rivals.filter((rival) => containsGeoAlias(observed.answerText, rival.names)).map((rival) => rival.brandName),
    modelObserved: observed?.modelObserved ?? null,
    providerTaskId: observed?.providerTaskId ?? null,
    listPosition: observed === null ? null : readVisibilityListPosition(observed.answerText, [context.officialName, ...context.aliases]),
    answerExcerpt: answer === null ? null : sliceCodePoints(answer, 300).trimEnd(),
    answerExcerptTruncated: answer === null ? null : codePointLength(answer) > 300,
    subtopics: topics?.items ?? null,
    subtopicsOmitted: topics?.omittedCount ?? null,
    competitorPositions: observed === null ? null : rivals.flatMap((rival) => {
      const position = readVisibilityListPosition(observed.answerText, rival.names);
      return position === null ? [] : [{ brandName: rival.brandName, position }];
    }),
    citedUrls,
    citedDomainsOmitted: result.cited === null ? null : 0,
    citedUrlsOmitted: result.cited === null ? null : Math.max(0, allUrls.length - citedUrls.length),
    excerptOmitted: false,
  };
}
