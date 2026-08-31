// @input  -- the knowledge-base store, the shared quota, the sampling provider and the assembly model
// @output -- the dependency set the two GEO Brief routes run with
// @pos    -- the wiring seam; it turns store and provider states into HTTP-shaped ones

import { authenticateAccountRequest } from "../account-websites/route-http.ts";
import { createGeoProviderClient } from "../agents/geo-provider.ts";
import {
  geoCitationDomain,
  isGeoTargetCitation,
  normalizeGeoCitationUrl,
  normalizeGeoHost,
} from "../agents/geo-url.ts";
import { consumePublicToolQuota } from "../tools/shared-rate-limit.ts";
import {
  GEO_BRIEF_DAILY_WINDOW_SECONDS,
  GEO_BRIEF_RUNS_PER_DAY,
  type GeoBriefCitedDomain,
} from "./brief-contract.ts";
import { runGeoBriefLlm, resolveGeoBriefLlmConfig } from "./brief-llm.ts";
import type {
  BriefFrozenChoice,
  BriefFrozenRead,
  BriefAssemblyFailureEvent,
  BriefHandlerDependencies,
  BriefSampleOutcome,
  BriefStoreOutcome,
} from "./brief-handler.ts";
import { readFrozenGeoKb } from "./kb-store.ts";
import { listFrozenGeoKbVersions } from "./kb-history.ts";
import { DEFAULT_SHARED_BRIEF_DEPENDENCIES } from "./brief-shared-deps.ts";

export { handleBriefLoad, handleBriefRun } from "./brief-handler.ts";

/** The model the question is put to. The same one the visibility tool uses. */
const BRIEF_SAMPLE_MODEL = "gpt-5-2025-08-07";

/** Cited URLs kept per domain. Evidence, not a link dump. */
const MAX_URLS_PER_DOMAIN = 3;

/**
 * Every frozen version, with the questions it asks.
 *
 * The questions travel with the choice because the visitor picks one before
 * anything is spent, and a page that had to fetch them separately would either
 * make a second round trip per selection or guess.
 */
export async function listFrozenVersions(
  userId: string,
  readHistory: typeof listFrozenGeoKbVersions = listFrozenGeoKbVersions,
): Promise<BriefStoreOutcome<readonly BriefFrozenChoice[]>> {
  const list = await readHistory({ userId });
  if (list.kind !== "ok") return { kind: "unavailable", reason: "store unavailable" };
  return { kind: "ok", value: list.value.map(({ host, snapshot }) => ({ kbId: snapshot.kbId, host, snapshotId: snapshot.snapshotId, revision: snapshot.revision, frozenAt: snapshot.frozenAt, questions: snapshot.questionSet.questions.map(question => ({ id: question.id, text: question.text, layer: question.layer, roleId: question.roleId })) })) };
}

async function readFrozen(input: {
  readonly userId: string;
  readonly kbId: string;
  readonly revision: number;
}): Promise<BriefStoreOutcome<BriefFrozenRead>> {
  const frozen = await readFrozenGeoKb(input);
  if (frozen.kind === "missing") return { kind: "not_found" };
  if (frozen.kind !== "ok") {
    return { kind: "unavailable", reason: "store unavailable" };
  }
  return {
    kind: "ok",
    value: {
      payload: frozen.value.payload,
      snapshotId: frozen.value.snapshotId,
      revision: frozen.value.revision,
      questions: frozen.value.questionSet.questions,
    },
  };
}

/**
 * The safety valve.
 *
 * Not a budget - the Owner lifted that - but one brief is a paid provider call
 * and a model call, and a loop that generates them is still a loop. Twenty a
 * day is far above deliberate use and far below anything that runs away.
 */
async function consumeDailyRun(userId: string): Promise<boolean> {
  const outcome = await consumePublicToolQuota(
    `geo-brief:user:${userId}`,
    GEO_BRIEF_RUNS_PER_DAY,
    GEO_BRIEF_DAILY_WINDOW_SECONDS,
  );
  return outcome.kind === "allowed";
}

/**
 * Both halves, or neither.
 *
 * A deployment with sampling credentials and no assembly model would still
 * return a brief - the fact table and the observed subtopics survive - and it
 * would look like a brief whose question simply needed no outline. Refusing up
 * front is the difference between a tool that is off and a tool that is quietly
 * worse than it looks.
 */
function providerConfigured(): boolean {
  const sampling =
    (process.env["DATAFORSEO_LOGIN"] ?? "") !== "" &&
    (process.env["DATAFORSEO_PASSWORD"] ?? "") !== "";
  return sampling && resolveGeoBriefLlmConfig() !== null;
}

/**
 * Which domains that answer reached for, and whether any of them is the site.
 *
 * Deduplicated per domain and bounded per domain, because the brief shows this
 * as "who currently answers this question" and a list of forty links from one
 * publisher answers nothing.
 */
function readCitedDomains(
  citations: readonly { readonly url: string }[],
  targetHost: string,
  competitorHosts: ReadonlySet<string>,
): readonly GeoBriefCitedDomain[] {
  const byDomain = new Map<string, { urls: string[] }>();
  for (const citation of citations) {
    const url = normalizeGeoCitationUrl(citation.url);
    if (url === null) continue;
    const domain = geoCitationDomain(url);
    if (domain === null) continue;
    const kept = byDomain.get(domain);
    if (kept === undefined) {
      byDomain.set(domain, { urls: [url] });
      continue;
    }
    if (kept.urls.length >= MAX_URLS_PER_DOMAIN || kept.urls.includes(url)) {
      continue;
    }
    kept.urls.push(url);
  }

  return [...byDomain.entries()].map(([domain, entry]) => ({
    domain,
    // The same target test the visibility tool uses, on the same canonical
    // host, so the two tools cannot disagree about whose page a link is.
    isOwn: entry.urls.some((url) => isGeoTargetCitation(url, targetHost)),
    isCompetitor: competitorHosts.has(domain),
    urls: entry.urls,
  }));
}

/**
 * Ask the question once.
 *
 * One call, never retried. The same rule the visibility tool arrived at: a
 * rejected fetch cannot prove the request did not arrive, and a second attempt
 * buys a second charge rather than a second opinion. A failed sample is a run
 * limit on the brief, not an error the visitor sees instead of their brief.
 */
async function sample(input: {
  readonly question: string;
  readonly marketCode: string;
  readonly targetHost: string;
  readonly competitors: readonly {
    readonly domain: string;
    readonly confirmed: boolean;
  }[];
}): Promise<BriefSampleOutcome> {
  const competitorHosts = new Set<string>();
  for (const entry of input.competitors) {
    if (!entry.confirmed || entry.domain.length === 0) continue;
    const host = normalizeGeoHost(entry.domain);
    if (host !== null) competitorHosts.add(host);
  }

  try {
    const client = createGeoProviderClient();
    const observation = await client.observe({
      prompt: input.question,
      model: BRIEF_SAMPLE_MODEL,
      marketCode: input.marketCode,
    });
    if (observation.answerText.trim().length === 0) {
      return { kind: "unavailable" };
    }
    return {
      kind: "ok",
      answerText: observation.answerText,
      citedDomains: observation.citationsComplete
        ? readCitedDomains(
            observation.citations,
            input.targetHost,
            competitorHosts,
          )
        : [],
    };
  } catch {
    return { kind: "unavailable" };
  }
}

function reportAssemblyFailure(event: BriefAssemblyFailureEvent): void {
  console.warn(JSON.stringify(event));
}

export const DEFAULT_BRIEF_HANDLER_DEPENDENCIES: BriefHandlerDependencies = {
  shared: DEFAULT_SHARED_BRIEF_DEPENDENCIES,
  authenticate: authenticateAccountRequest,
  listFrozen: listFrozenVersions,
  readFrozen,
  consumeDailyRun,
  providerConfigured,
  sample,
  assemble: runGeoBriefLlm,
  reportAssemblyFailure,
  now: Date.now,
};
