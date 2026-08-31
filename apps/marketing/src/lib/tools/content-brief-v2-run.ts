// @input -- a caller-admitted v2 request and scoped source callbacks
// @output -- a self-checked whole v2 brief using the exact model-visible evidence
// @pos -- Marketing generation orchestration, never authentication or admission
import { buildSerpObservations, planCrawlTargets } from "@sf/public-tools/content-brief/assemble";
import { CRAWL_DEADLINE_MS, ENVELOPE_MS, GSC_DEADLINE_MS, RUN_BUDGET_MS, SERP_DEADLINE_MS, SERP_DEPTH } from "@sf/public-tools/content-brief/constants";
import type { ProfileFact } from "@sf/public-tools/content-brief/contract";
import { hostKey } from "@sf/public-tools/content-brief/host";
import { fingerprintBriefV2, parseContentBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { CONTENT_BRIEF_V2_SCHEMA, type ResearchBundle } from "@sf/public-tools/content-brief/v2-contract";
import { parseBriefV2Context } from "@sf/public-tools/content-brief/v2-generation";
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
}
export interface ContentBriefV2RunInput {
  readonly input: BriefV2Input;
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
  return { facts: [], snapshot: null, read: unavailable("profile", reason, attempted) };
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
  const plan = planCrawlTargets(buildSerpObservations(serp.rows), hostKey);
  const prefailed: ContentBriefV2CrawlFailure[] = [];
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
    if (ownUrls.has(normalized)) continue;
    if (input.gsc !== undefined && keywordCoverageProperty(target.url, [input.gsc.property]) === input.gsc.property) continue;
    const competitor = { id: target.serp_id.replace(/^S/u, "C"), role: "competitor" as const, url: target.url };
    attemptedCompetitors.push(competitor);
    competitorTargets.push(competitor);
  }
  const ownedTargets = gsc.candidates.map((candidate) => ({ id: candidate.id, role: "owned" as const, url: candidate.url }));
  const targets: ContentBriefV2CrawlTarget[] = [
    ...attemptedCompetitors,
    ...ownedTargets,
  ];
  const crawlTargets: ContentBriefV2CrawlTarget[] = [
    ...competitorTargets,
    ...ownedTargets,
  ];
  const fetched = crawlTargets.length === 0 ? { observed: [], failed: [] } : await lane(
    () => (dependencies.crawl ?? crawlContentBriefV2Targets)({ targets: crawlTargets, language: keyword.language, deadlineAt: clock.deadlineAt }, { now: clock.now }), CRAWL_DEADLINE_MS, clock,
    (reason): ContentBriefV2CrawlResult => ({ observed: [], failed: crawlTargets.map((target) => ({ id: target.id, url: target.url, reason })) }),
  );
  const redirectedOwned = fetched.observed.filter((page) => page.role === "competitor" &&
    (ownUrls.has(urlKey(page.final_url) ?? "") || (input.gsc !== undefined && keywordCoverageProperty(page.final_url, [input.gsc.property]) === input.gsc.property)));
  const redirectedIds = new Set(redirectedOwned.map((page) => page.id));
  const crawl: ContentBriefV2CrawlResult = {
    observed: fetched.observed.filter((page) => !redirectedIds.has(page.id)),
    failed: [...prefailed, ...fetched.failed, ...redirectedOwned.map((page): ContentBriefV2CrawlFailure => ({ id: page.id, url: page.url, reason: "insufficient_evidence" }))],
  };
  const candidates = gsc.candidates.map((candidate): OwnedCandidate => ({ ...candidate, read: crawl.observed.some((page) => page.id === candidate.id) ? "observed"
    : crawl.failed.some((page) => page.id === candidate.id && page.reason === "redirected") ? "redirected" : "unavailable" }));
  const paa = serp.peopleAlsoAsk;
  const research = buildResearchBundle(crawl.observed, paa !== undefined && paa.status !== "unavailable" ? paa.items.map((item, index) => ({ id: `A${index + 1}`, question: item.question, seed_question: item.seedQuestion })) : []);
  if (!research.ok) throw new ContentBriefV2RunError();
  const context: BriefV2Context = { input: keyword, research: research.value, facts: profile.facts, profile_snapshot: profile.snapshot, gsc: gsc.gsc, candidates };
  if (!parseBriefV2Context(context).ok) throw new ContentBriefV2RunError();
  // The runner owns the single provider attempt and its usage. An uncooperative
  // injected runner must not hang; without its receipt we cannot invent usage.
  // Leave 100 ms for the client's own timeout receipt to settle before the
  // outer watchdog. Provider work stays <=30 s and assembly keeps its full 5 s.
  const settlementMs = 100;
  const llmBudget = remaining(clock, CONTENT_BRIEF_V2_LLM_DEADLINE_MS + settlementMs);
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
    schema: CONTENT_BRIEF_V2_SCHEMA, context: packed, generated: llm.output,
    run: { run_id: input.runId, collected_at: new Date(input.startedAt).toISOString(), elapsed_ms: Math.max(0, clock.now() - input.startedAt), budget_ms: RUN_BUDGET_MS, reads, llm: llm.reads, prompt_bytes: llm.prompt_bytes, serp_cost_usd: serp.costUsd, fingerprint: "" },
  };
  const sealed = { ...brief, run: { ...brief.run, fingerprint: await fingerprintBriefV2(brief) } };
  const checked = await parseContentBriefV2(sealed);
  if (!checked.ok) throw new ContentBriefV2RunError();
  return checked.value;
}
