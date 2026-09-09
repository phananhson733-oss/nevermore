// @input -- a caller-admitted v2 request and scoped source callbacks
// @output -- a self-checked whole v2 brief using the exact model-visible evidence
// @pos -- Marketing generation orchestration, never authentication or admission
import { buildSerpObservations, planCrawlTargets } from "@sf/public-tools/content-brief/assemble";
import {
  BRIEF_MAX_ATTEMPTS, BRIEF_V2_OWNED_CANDIDATES_MAX, CRAWL_DEADLINE_MS, ENVELOPE_MS, GSC_DEADLINE_MS,
  RUN_BUDGET_MS, SERP_DEADLINE_MS, SERP_DEPTH,
} from "@sf/public-tools/content-brief/constants";
import type { ProfileFact } from "@sf/public-tools/content-brief/contract";
import { hostKey } from "@sf/public-tools/content-brief/host";
import { fingerprintBriefV2, parseContentBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { CONTENT_BRIEF_V2_SCHEMA, CONTENT_BRIEF_V3_SCHEMA, type ResearchBundle } from "@sf/public-tools/content-brief/v2-contract";
import { briefV2PageKey, parseBriefV2Context } from "@sf/public-tools/content-brief/v2-generation";
import type { BriefV2Context, BriefV2Gsc, BriefV2Input, BriefV2Read, ContentBriefV2, OwnedCandidate } from "@sf/public-tools/content-brief/v2-generation-contract";
import { buildResearchBundle } from "@sf/public-tools/content-brief/v2-research";
import { keywordCoverageProperty } from "@sf/public-tools/keyword-opportunity";
import { readContentBriefSerp, type ContentBriefSerpResult } from "./content-brief-serp.ts";
import {
  crawlContentBriefV2Targets,
  isContentBriefV2CrawlUrl,
  type ContentBriefV2CrawlFailure,
  type ContentBriefV2CrawlResult,
  type ContentBriefV2CrawlTarget,
} from "./content-brief-v2-crawl.ts";
import { CONTENT_BRIEF_V2_LLM_DEADLINE_MS, runContentBriefV2Llm, type ContentBriefV2LlmResult } from "./content-brief-v2-llm.ts";

export interface ContentBriefV2ReadBudget {
  readonly signal: AbortSignal;
  /** This lane's deadline, already reserving the run's assembly headroom. */
  readonly deadlineAt: number;
}
export interface ContentBriefV2GscLane {
  readonly gsc: BriefV2Gsc;
  readonly candidates: readonly OwnedCandidate[];
}
export interface ContentBriefV2ProfileLane {
  readonly facts: readonly ProfileFact[];
  readonly snapshot: BriefV2Context["profile_snapshot"];
  readonly read: BriefV2Read;
  /**
   * The confirmed profile's own host, when one was read.
   *
   * Ownership is otherwise known only through the Search Console property, so
   * without Search Console a page of the visitor's own site that ranks for the
   * keyword was counted as a competitor and the brief reported the visitor's
   * own coverage back to them as the competition. This is not serialized: it
   * decides which SERP rows are competitors, nothing else.
   *
   * Required and nullable, not optional and nullable: "no profile host" has one
   * spelling, so a lane that forgot to resolve one cannot pass for a lane that
   * looked and found none.
   */
  readonly host: string | null;
}
export interface ContentBriefV2RunInput {
  readonly input: BriefV2Input;
  /** Explicit negotiation preserves the byte-identical historical v2 shape. */
  readonly responseSchema?: typeof CONTENT_BRIEF_V2_SCHEMA | typeof CONTENT_BRIEF_V3_SCHEMA;
  readonly runId: string;
  readonly startedAt: number;
  readonly deadlineAt: number;
  /** The caller has already authorized this exact property and its Google subject. */
  readonly gsc?: {
    readonly property: string;
    readonly window: NonNullable<BriefV2Gsc["window"]>;
    readonly read: (budget: ContentBriefV2ReadBudget) => Promise<ContentBriefV2GscLane>;
  };
  /** The caller resolves an exact user-owned profile snapshot, never a mutable fallback. */
  readonly profile?: { readonly read: (budget: ContentBriefV2ReadBudget) => Promise<ContentBriefV2ProfileLane> };
}
export interface ContentBriefV2RunDependencies {
  readonly readSerp?: typeof readContentBriefSerp;
  readonly crawl?: typeof crawlContentBriefV2Targets;
  readonly runLlm?: typeof runContentBriefV2Llm;
  readonly now?: () => number;
}

/** No raw provider text, user data or internal exception escapes the caller boundary. */
export class ContentBriefV2RunError extends Error {
  readonly code = "brief_unavailable";
  constructor() { super("content brief generation unavailable"); this.name = "ContentBriefV2RunError"; }
}

interface Clock { readonly now: () => number; readonly deadlineAt: number }
type Failure = "timeout" | "provider_error";
function remaining(clock: Clock, max: number): number {
  return Math.max(0, Math.min(max, Math.floor(clock.deadlineAt - clock.now() - ENVELOPE_MS)));
}

/** Abort cooperative readers and detach uncooperative ones, consuming late rejections. */
function lane<T>(
  work: (budget: ContentBriefV2ReadBudget) => Promise<T>, max: number, clock: Clock,
  failed: (reason: Failure, started: boolean) => T,
): Promise<T> {
  const duration = remaining(clock, max);
  if (!Number.isFinite(duration) || duration <= 0) return Promise.resolve(failed("timeout", false));
  const controller = new AbortController();
  const deadlineAt = clock.now() + duration;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T): void => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { controller.abort(); finish(failed("timeout", true)); }, duration);
    void Promise.resolve().then(() => work({ signal: controller.signal, deadlineAt })).then(
      (value) => finish(clock.now() >= deadlineAt ? failed("timeout", true) : value),
      () => finish(failed(controller.signal.aborted ? "timeout" : "provider_error", true)),
    );
  });
}

const notRequestedGsc = (): ContentBriefV2GscLane => ({
  gsc: { status: "unavailable", property: null, window: null, reason: "not_requested", matches: [], omitted_matches: 0 }, candidates: [],
});
function unavailable(source: BriefV2Read["source"], reason: NonNullable<BriefV2Read["reason"]>, attempted: number | null): BriefV2Read {
  return { source, status: "unavailable", attempted, retained: null, reason };
}
function emptyProfile(reason: NonNullable<BriefV2Read["reason"]>, attempted: number | null): ContentBriefV2ProfileLane {
  return { facts: [], snapshot: null, host: null, read: unavailable("profile", reason, attempted) };
}
function emptySerp(reason: Failure, started: boolean): ContentBriefSerpResult {
  return { rows: [], reads: { status: "unavailable", reason, attempted: started ? SERP_DEPTH : 0 }, costUsd: null, itemTypes: null, peopleAlsoAsk: { status: "unavailable", reason } };
}
function urlKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
/**
 * Why a ranked page outranks a ledger page.
 *
 * A page of the visitor's own property that Google already places in this
 * keyword's top ten is the strongest first-party evidence available: it is the
 * page competing for this exact query today. Before this merge such a page was
 * dropped on sight — it could not be a competitor, because it belongs to the
 * property, and nothing promoted it to an owned candidate — so the brief
 * advised rewriting some other page while the ranking one went unread.
 *
 * The three-slot ceiling belongs to the contract, so a ranked page displaces a
 * Search Console candidate rather than widening the set.
 */
function mergeOwnedCandidates(
  fromGsc: readonly OwnedCandidate[], ranked: readonly string[], matches: BriefV2Gsc["matches"],
): OwnedCandidate[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const url of [...ranked, ...fromGsc.map((candidate) => candidate.url)]) {
    const identity = briefV2PageKey(url);
    if (identity === null || seen.has(identity)) continue;
    seen.add(identity);
    urls.push(url);
    if (urls.length === BRIEF_V2_OWNED_CANDIDATES_MAX) break;
  }
  return urls.map((url, index): OwnedCandidate => ({
    id: `T${index + 1}`,
    url,
    match_refs: matches.filter((match) => briefV2PageKey(match.page) === briefV2PageKey(url)).map((match) => match.id),
    read: "unavailable",
  }));
}

function researchRead(
  source: "competitors" | "owned_pages", targets: readonly ContentBriefV2CrawlTarget[], research: ResearchBundle,
  crawl: ContentBriefV2CrawlResult, upstreamReason: BriefV2Read["reason"],
): BriefV2Read {
  const role = source === "competitors" ? "competitor" : "owned";
  const attempted = targets.filter((target) => target.role === role);
  const observed = research.pages.filter((page) => page.role === role);
  const failed = crawl.failed.filter((item) => attempted.some((target) => target.id === item.id));
  if (observed.length === 0 && (failed.length > 0 || upstreamReason !== null || source === "competitors")) {
    const reason = upstreamReason ?? (failed.length > 0 && failed.every((item) => item.reason === "timeout") ? "timeout"
      : failed.some((item) => item.reason === "provider_error") ? "provider_error" : "insufficient_evidence");
    return unavailable(source, reason, attempted.length);
  }
  const partial = failed.length > 0 || observed.some((page) => !page.body_complete || page.research.omitted_segments > 0 || page.research.segments.some((segment) => segment.truncated));
  return { source, status: partial ? "partial" : "complete", attempted: attempted.length, retained: observed.length, reason: null };
}
function serpRead(serp: ContentBriefSerpResult): BriefV2Read {
  const read = serp.reads;
  if (read.status === "unavailable") {
    const reason = read.reason === "timeout" || read.reason === "provider_error" ? read.reason : "insufficient_evidence";
    return unavailable("serp", reason, read.attempted);
  }
  return { source: "serp", status: read.status, attempted: read.requested, retained: read.returned, reason: null };
}
function paaRead(serp: ContentBriefSerpResult, research: ResearchBundle): BriefV2Read {
  const paa = serp.peopleAlsoAsk;
  if (paa === undefined || paa.status === "unavailable") {
    const reason = paa?.reason === "timeout" || paa?.reason === "provider_error" ? paa.reason : "insufficient_evidence";
    return unavailable("paa", reason, null);
  }
  return { source: "paa", status: paa.status === "partial" || research.budget.paa_omitted > 0 ? "partial" : "complete",
    attempted: paa.items.length + paa.unreadableItems + paa.truncatedItems, retained: research.paa.length, reason: null };
}

/** Requires completed caller admission; there is no authentication, quota bypass or hidden retry here. */
export async function runContentBriefV2(input: ContentBriefV2RunInput, dependencies: ContentBriefV2RunDependencies = {}): Promise<ContentBriefV2> {
  if (!Number.isSafeInteger(input.startedAt) || !Number.isSafeInteger(input.deadlineAt) || input.deadlineAt - input.startedAt !== RUN_BUDGET_MS ||
      !Number.isFinite(new Date(input.startedAt).getTime())) throw new RangeError("invalid brief run clock");
  if (typeof input.runId !== "string" || input.runId.length === 0 || input.runId.length > 128) throw new ContentBriefV2RunError();
  const clock = { now: dependencies.now ?? Date.now, deadlineAt: input.deadlineAt };
  const emptyResearch = buildResearchBundle([], []);
  if (!emptyResearch.ok) throw new ContentBriefV2RunError();
  const checkedInput = parseBriefV2Context({ input: input.input, research: emptyResearch.value, facts: [], profile_snapshot: null, ...notRequestedGsc() });
  if (!checkedInput.ok) throw new ContentBriefV2RunError();
  const keyword = checkedInput.value.input;
  const serpPromise = lane(({ signal }) => (dependencies.readSerp ?? readContentBriefSerp)({ keyword: keyword.primary, market: keyword.market, language: keyword.language, signal, includePeopleAlsoAsk: true }), SERP_DEADLINE_MS, clock, emptySerp);
  const gscPromise = input.gsc === undefined ? Promise.resolve(notRequestedGsc()) : lane(input.gsc.read, GSC_DEADLINE_MS, clock, (reason): ContentBriefV2GscLane => ({
    gsc: { status: "unavailable", property: input.gsc!.property, window: input.gsc!.window, reason, matches: [], omitted_matches: 0 }, candidates: [],
  }));
  const profilePromise = input.profile === undefined ? Promise.resolve(emptyProfile("not_requested", 0))
    : lane(input.profile.read, CRAWL_DEADLINE_MS, clock, (reason, started) => emptyProfile(reason, started ? null : 0));
  const [serp, gsc, profile] = await Promise.all([serpPromise, gscPromise, profilePromise]);
  if (input.gsc !== undefined && (gsc.gsc.property !== input.gsc.property ||
      gsc.gsc.window?.start !== input.gsc.window.start || gsc.gsc.window.end !== input.gsc.window.end ||
      gsc.gsc.window.lookback_days !== input.gsc.window.lookback_days)) throw new ContentBriefV2RunError();
  const ownUrls = new Set(gsc.candidates.map((candidate) => urlKey(candidate.url)).filter((url): url is string => url !== null));
  const profileHost = profile.host === null ? null : hostKey(profile.host);
  const plan = planCrawlTargets(buildSerpObservations(serp.rows), hostKey);
  const prefailed: ContentBriefV2CrawlFailure[] = [];
  const rankedOwned: string[] = [];
  const attemptedCompetitors: ContentBriefV2CrawlTarget[] = [];
  const competitorTargets: ContentBriefV2CrawlTarget[] = [];
  for (const target of plan.targets) {
    const normalized = isContentBriefV2CrawlUrl(target.url) ? urlKey(target.url) : null;
    if (normalized === null) {
      const failed = { id: target.serp_id.replace(/^S/u, "C"), role: "competitor" as const, url: target.url };
      attemptedCompetitors.push(failed);
      prefailed.push({ id: failed.id, url: failed.url, reason: "provider_error" });
      continue;
    }
    // A page that is already a candidate AND ranks for the keyword is the
    // strongest owned evidence of all, so it joins the ranked list rather than
    // keeping whatever position the Search Console ledger gave it; the merge
    // deduplicates, so it does not take two slots.
    if (ownUrls.has(normalized)) {
      rankedOwned.push(target.url);
      continue;
    }
    if (input.gsc !== undefined && keywordCoverageProperty(target.url, [input.gsc.property]) === input.gsc.property) {
      rankedOwned.push(target.url);
      continue;
    }
    // Owned but unrepresentable: a candidate needs a Search Console property to
    // be scoped against, so this page can be kept out of the competition but not
    // offered as the visitor's own. Silence beats calling it a competitor.
    if (profileHost !== null && hostKey(target.url) === profileHost) continue;
    const competitor = { id: target.serp_id.replace(/^S/u, "C"), role: "competitor" as const, url: target.url };
    attemptedCompetitors.push(competitor);
    competitorTargets.push(competitor);
  }
  const ownedCandidates = mergeOwnedCandidates(gsc.candidates, rankedOwned, gsc.gsc.matches);
  const ownedTargets = ownedCandidates.map((candidate) => ({ id: candidate.id, role: "owned" as const, url: candidate.url }));
  const targets: ContentBriefV2CrawlTarget[] = [
    ...attemptedCompetitors,
    ...ownedTargets,
  ];
  const crawlTargets: ContentBriefV2CrawlTarget[] = [
    ...competitorTargets,
    ...ownedTargets,
  ];
  const fetched = crawlTargets.length === 0 ? { observed: [], failed: [] } : await lane(
    () => (dependencies.crawl ?? crawlContentBriefV2Targets)({ targets: crawlTargets, language: keyword.language, keywords: [keyword.primary, ...keyword.supporting], deadlineAt: clock.deadlineAt }, { now: clock.now }), CRAWL_DEADLINE_MS, clock,
    (reason): ContentBriefV2CrawlResult => ({ observed: [], failed: crawlTargets.map((target) => ({ id: target.id, url: target.url, reason })) }),
  );
  // Redirects are checked again after the fetch, because a foreign URL can
  // deliver the visitor's own article. The profile host counts here for the
  // same reason it counts at planning time: without Search Console it is the
  // only thing that knows whose page this is.
  const redirectedOwned = fetched.observed.filter((page) => page.role === "competitor" &&
    (ownUrls.has(urlKey(page.final_url) ?? "") ||
      (input.gsc !== undefined && keywordCoverageProperty(page.final_url, [input.gsc.property]) === input.gsc.property) ||
      (profileHost !== null && hostKey(page.final_url) === profileHost)));
  const redirectedIds = new Set(redirectedOwned.map((page) => page.id));
  const crawl: ContentBriefV2CrawlResult = {
    observed: fetched.observed.filter((page) => !redirectedIds.has(page.id)),
    failed: [...prefailed, ...fetched.failed, ...redirectedOwned.map((page): ContentBriefV2CrawlFailure => ({ id: page.id, url: page.url, reason: "insufficient_evidence" }))],
  };
  const candidates = ownedCandidates.map((candidate): OwnedCandidate => ({ ...candidate, read: crawl.observed.some((page) => page.id === candidate.id) ? "observed"
    : crawl.failed.some((page) => page.id === candidate.id && page.reason === "redirected") ? "redirected" : "unavailable" }));
  const paa = serp.peopleAlsoAsk;
  const research = buildResearchBundle(crawl.observed, paa !== undefined && paa.status !== "unavailable" ? paa.items.map((item, index) => ({ id: `A${index + 1}`, question: item.question, seed_question: item.seedQuestion })) : []);
  if (!research.ok) throw new ContentBriefV2RunError();
  const context: BriefV2Context = {
    input: keyword, research: research.value, facts: profile.facts, profile_snapshot: profile.snapshot, gsc: gsc.gsc, candidates,
    ...(input.responseSchema === CONTENT_BRIEF_V3_SCHEMA ? { serp: { rows: buildSerpObservations(serp.rows), read: serp.reads } } : {}),
  };
  if (!parseBriefV2Context(context).ok) throw new ContentBriefV2RunError();
  // The runner owns the provider attempts and their usage. An uncooperative
  // injected runner must not hang; without its receipt we cannot invent usage.
  // Leave 100 ms for the client's own timeout receipt to settle before the
  // outer watchdog. Each provider call stays <=30 s and assembly keeps its
  // full 5 s, because remaining() clamps this to the run budget either way.
  //
  // The ceiling counts every attempt the runner may make, not one. Sized for a
  // single call it cut the lane at 30.1 s, so a run whose first reply was
  // rejected at 20 s and repaired at 35 s -- both calls inside their own
  // deadlines and inside the 45 s budget -- threw the whole run away at 30.1 s
  // and lost both usage receipts with it. The watchdog is here for a runner
  // that never answers, not for one that answers twice.
  const settlementMs = 100;
  const llmBudget = remaining(clock, BRIEF_MAX_ATTEMPTS * CONTENT_BRIEF_V2_LLM_DEADLINE_MS + settlementMs);
  const llm: ContentBriefV2LlmResult | null = llmBudget <= settlementMs
    ? { context, output: null, reads: { status: "unavailable", reason: "timeout", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null }, prompt_bytes: 0 }
    : await lane(() => (dependencies.runLlm ?? runContentBriefV2Llm)({ context, deadlineAt: clock.deadlineAt - settlementMs }, { now: clock.now }), llmBudget, clock, () => null);
  if (llm === null) throw new ContentBriefV2RunError();
  const packed = llm.context;
  const reads: BriefV2Read[] = [
    serpRead(serp), paaRead(serp, packed.research),
    researchRead("competitors", targets, packed.research, crawl, serp.reads.status === "unavailable" ? serpRead(serp).reason : null),
    researchRead("owned_pages", targets, packed.research, crawl, gsc.gsc.status === "unavailable" ? gsc.gsc.reason : null),
    packed.gsc.status === "unavailable" ? unavailable("gsc", packed.gsc.reason!, input.gsc === undefined ? 0 : null)
      : { source: "gsc", status: packed.gsc.status, attempted: packed.gsc.matches.length + packed.gsc.omitted_matches, retained: packed.gsc.matches.length, reason: null },
    profile.read,
  ];
  const brief: ContentBriefV2 = {
    schema: input.responseSchema ?? CONTENT_BRIEF_V2_SCHEMA, context: packed, generated: llm.output,
    run: { run_id: input.runId, collected_at: new Date(input.startedAt).toISOString(), elapsed_ms: Math.max(0, clock.now() - input.startedAt), budget_ms: RUN_BUDGET_MS, reads, llm: llm.reads, prompt_bytes: llm.prompt_bytes, serp_cost_usd: serp.costUsd, fingerprint: "" },
  };
  const sealed = { ...brief, run: { ...brief.run, fingerprint: await fingerprintBriefV2(brief) } };
  const checked = await parseContentBriefV2(sealed);
  if (!checked.ok) throw new ContentBriefV2RunError();
  return checked.value;
}
