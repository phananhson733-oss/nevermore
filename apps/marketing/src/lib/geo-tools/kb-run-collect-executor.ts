// @input  -- the owner's saved draft, the website evidence observation library and the shared gated reader
// @output -- one observation per collection operation, appended to the library, and the ledger outcome for it
// @pos    -- the collection half of the run seam: it performs work, so every fetch goes through the injected reader

/**
 * The producer and the executor for a run's collection operations.
 *
 * The single-run route owns the ledger and the orchestration; it deliberately
 * owns no work. This file registers the half that does: which pages an update
 * observes, and what performing one of those observations means.
 *
 * Both halves are built from the same plan on purpose. If the seed came from
 * one derivation and the executor resolved keys through another, a resumed run
 * would carry rows whose keys nothing could answer, and the honest outcome for
 * an unanswerable key -- permanent failure -- would start being reported for
 * work that was simply planned differently.
 *
 * Three rules this file exists to hold:
 *
 *  - **Reuse before spending.** A target whose newest observation is inside its
 *    TTL is not fetched: no traffic reaches the site, no crawl allowance is
 *    spent, and the stored row is the operation's result. Time is the only
 *    criterion (see `kb-evidence-observations.ts` for why comparing bodies
 *    would rewrite the past).
 *  - **A gate refusal is never an observation.** `rate_limited` says something
 *    about our own quota, not about the target. Storing it would suppress the
 *    real fetch for a whole TTL, so it is reported as retryable and written
 *    nowhere.
 *  - **A fetch we cannot file is unresolved, not retryable.** The page was
 *    read; the allowance was spent. Calling that retryable would spend it
 *    again on the strength of not knowing.
 */

import { createHash } from "node:crypto";

import {
  isObservationFresh,
  geoEvidenceTtlMs,
  readLatestObservation,
  recordObservation,
  type GeoEvidenceObservation,
  type GeoEvidenceObservationAppend,
  type GeoEvidenceObservationSelector,
  type GeoEvidenceStoreResult,
  type GeoEvidenceStructured,
  type GeoEvidenceUnavailableReason,
} from "./kb-evidence-observations.ts";
import { planGeoEvidenceReuse } from "./kb-evidence-reuse.ts";
import { createGeoKnowledgeResourceReader } from "./kb-enrichment-deps.ts";
import type { GeoKnowledgeEvidenceReadResource } from "./kb-knowledge-evidence.ts";
import { GEO_KNOWLEDGE_LIMITS } from "./kb-knowledge-shape.ts";
import { readGeoOffsitePageSignals } from "./kb-offsite-verification.ts";
import type { GeoKbStoreResult } from "./kb-store.ts";
import {
  geoVersionedPayloadIdentity,
  readVersionedGeoKnowledgeBase,
  type VersionedGeoKbDetails,
} from "./kb-versioned-read.ts";
import { findAccountWebsiteByUrl } from "../account-websites/store.ts";
import type {
  GeoRunExecutor,
  GeoRunProbeOutcome,
  GeoRunStartOutcome,
} from "./kb-run-advance.ts";
import type { GeoRunOperationSeed } from "./kb-run-ledger.ts";
import {
  geoRunUpdateSeeds,
  planGeoRunCollection,
  type GeoRunCollectTarget,
} from "./kb-run-collect.ts";

/** What the route may do with a knowledge base it was asked to update. */
export type GeoRunSeedOutcome =
  | { readonly kind: "ready"; readonly seed: readonly GeoRunOperationSeed[] }
  | { readonly kind: "missing" | "invalid_input" | "unavailable" };

export interface GeoRunCollectSources {
  readonly readDetails: (input: {
    readonly userId: string;
    readonly kbId: string;
  }) => Promise<
    GeoKbStoreResult<Pick<VersionedGeoKbDetails, "kbId" | "draft">>
  >;
  /** The observation library is keyed by website, and the knowledge base carries no website id yet. */
  readonly resolveWebsiteId: (input: {
    readonly userId: string;
    readonly targetUrl: string;
  }) => Promise<
    | { readonly kind: "ok"; readonly websiteId: string }
    | { readonly kind: "missing" | "unavailable" }
  >;
  readonly readLatestObservation: (
    input: GeoEvidenceObservationSelector,
  ) => Promise<GeoEvidenceStoreResult<GeoEvidenceObservation | null>>;
  readonly recordObservation: (
    input: GeoEvidenceObservationAppend,
  ) => Promise<GeoEvidenceStoreResult<GeoEvidenceObservation>>;
  /** Built per operation: the reader memoises its crawl-gate admission per host. */
  readonly createReader: (
    clientKey: string,
  ) => GeoKnowledgeEvidenceReadResource;
  readonly now: () => Date;
}

export interface GeoRunCollectRuntime {
  /**
   * The WHOLE update's seed, not just this executor's half.
   *
   * The seed is derived from the same load that decides "there is nothing here
   * that may be read", and that decision governs the model step too: a draft
   * naming a site nothing may fetch must not buy a synthesis about it. Keeping
   * the two in one function is what makes that one decision instead of two
   * that can drift.
   *
   * The executor beside it performs the collection half only; the model half is
   * registered in `kb-run-runtime.ts`, which composes the two by kind.
   */
  readonly seedOperations: (input: {
    readonly userId: string;
    readonly kbId: string;
  }) => Promise<GeoRunSeedOutcome>;
  readonly executor: GeoRunExecutor;
}

/** One page read, bounded the same way the reader clamps its own timeout. */
const PAGE_TIMEOUT_MS = 8_000;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isHtml(contentType: string): boolean {
  const type =
    contentType.toLocaleLowerCase("en").split(";", 1)[0]?.trim() ?? "";
  return type === "text/html" || type === "application/xhtml+xml";
}

/**
 * Bound a string by UTF-16 length without ever splitting a surrogate pair.
 *
 * The page readers bound by code points and the ledger's validator counts
 * UTF-16 units, so an excerpt of astral characters can pass one and be refused
 * by the other -- which arrives as "this observation is invalid" after the
 * fetch has already been paid for.
 */
function boundStored(value: string, max: number): string {
  if (value.length <= max) return value;
  let bounded = "";
  for (const point of value) {
    if (bounded.length + point.length > max) break;
    bounded += point;
  }
  return bounded;
}

function boundedNames(values: readonly string[]): readonly string[] {
  return values
    .map((value) => boundStored(value, 200))
    .filter((value) => value !== "")
    .slice(0, 32);
}

/**
 * What of a page is worth keeping as an observation.
 *
 * Excerpts are the quotable evidence; authorship is the R11 signal (who wrote
 * it, who reviewed it, when) that the evidence module reads. Nothing here is
 * judged or scored: an absent byline is recorded as an absent byline.
 */
function observedStructure(
  signals: ReturnType<typeof readGeoOffsitePageSignals>,
): {
  readonly excerpts: readonly string[];
  readonly structured: GeoEvidenceStructured;
} {
  const excerpts = signals.excerpts
    .map((excerpt) =>
      boundStored(excerpt, GEO_KNOWLEDGE_LIMITS.excerptCodePoints),
    )
    .filter((excerpt) => excerpt !== "")
    .slice(0, GEO_KNOWLEDGE_LIMITS.excerptsPerSource);
  const authors = boundedNames(signals.byline.authors);
  const reviewers = boundedNames(signals.byline.reviewers);
  const datePublished =
    signals.byline.datePublished === null
      ? null
      : boundStored(signals.byline.datePublished, 64);
  const hasAuthorship =
    authors.length > 0 || reviewers.length > 0 || datePublished !== null;
  return {
    excerpts,
    structured: hasAuthorship
      ? {
          authorship: {
            authors: [...authors],
            reviewers: [...reviewers],
            datePublished,
          },
        }
      : {},
  };
}

/**
 * The reader's vocabulary, mapped onto the one the library will store.
 *
 * `rate_limited` is absent on purpose and handled before this is reached: it is
 * the one outcome that is about us rather than about the target.
 */
function storableReason(reason: string): GeoEvidenceUnavailableReason {
  switch (reason) {
    case "not_found":
    case "not_published":
    case "fetch_failed":
    case "blocked":
    case "timeout":
    case "partial_body":
    case "insufficient_evidence":
      return reason;
    default:
      return "invalid_response";
  }
}

function targetsFor(
  payload: VersionedGeoKbDetails["draft"],
): readonly GeoRunCollectTarget[] {
  if (payload === null) return [];
  const identity = geoVersionedPayloadIdentity(payload.payload);
  return planGeoRunCollection({
    targetUrl: identity.targetUrl,
    competitors: identity.competitors,
  });
}

export function createGeoRunCollectRuntime(
  sources: GeoRunCollectSources,
): GeoRunCollectRuntime {
  /**
   * The plan, re-derived from the stored draft.
   *
   * Deliberately re-read rather than cached across invocations: every advance
   * of a run is its own request, and the draft is what says what this update
   * is about.
   */
  const load = async (input: {
    readonly userId: string;
    readonly kbId: string;
  }): Promise<
    | { readonly kind: "ok"; readonly targets: readonly GeoRunCollectTarget[] }
    | { readonly kind: "missing" | "invalid_input" | "unavailable" }
  > => {
    const read = await sources
      .readDetails(input)
      .catch(() => ({ kind: "unavailable" as const }));
    if (read.kind === "missing") return { kind: "missing" };
    if (read.kind !== "ok") return { kind: "unavailable" };
    if (read.value.kbId !== input.kbId) return { kind: "unavailable" };
    if (read.value.draft === null) return { kind: "missing" };
    let targets: readonly GeoRunCollectTarget[];
    try {
      targets = targetsFor(read.value.draft);
    } catch {
      return { kind: "invalid_input" };
    }
    // An empty plan is not an update with nothing to do; it is a draft naming
    // a site nothing may read. Reporting it as a finished run would say the
    // knowledge base was refreshed.
    if (targets.length === 0) return { kind: "invalid_input" };
    return { kind: "ok", targets };
  };

  const seedOperations = async (input: {
    readonly userId: string;
    readonly kbId: string;
  }): Promise<GeoRunSeedOutcome> => {
    const loaded = await load(input);
    return loaded.kind === "ok"
      ? { kind: "ready", seed: geoRunUpdateSeeds(loaded.targets) }
      : loaded;
  };

  const resolve = async (
    context: { readonly userId: string; readonly kbId: string },
    key: string,
  ): Promise<
    | {
        readonly kind: "ok";
        readonly target: GeoRunCollectTarget;
        readonly websiteId: string;
      }
    | { readonly kind: "missing" | "unavailable" }
  > => {
    const loaded = await load(context);
    if (loaded.kind === "missing" || loaded.kind === "invalid_input")
      return { kind: "missing" };
    if (loaded.kind !== "ok") return { kind: "unavailable" };
    const target = loaded.targets.find((candidate) => candidate.key === key);
    if (target === undefined) return { kind: "missing" };
    // Every observation belongs to the owner's own website, competitor pages
    // included: the library is the record of what THIS site's update looked at.
    // Resolving by the competitor's URL would file a rival's page under a
    // website this owner may not even have.
    const own = loaded.targets.find((candidate) => candidate.scope === "own");
    if (own === undefined) return { kind: "missing" };
    const website = await sources
      .resolveWebsiteId({ userId: context.userId, targetUrl: own.url })
      .catch(() => ({ kind: "unavailable" as const }));
    if (website.kind !== "ok")
      return { kind: website.kind === "missing" ? "missing" : "unavailable" };
    return { kind: "ok", target, websiteId: website.websiteId };
  };

  const selector = (
    userId: string,
    websiteId: string,
    target: GeoRunCollectTarget,
  ): GeoEvidenceObservationSelector => ({
    userId,
    websiteId,
    kind: target.kind,
    url: target.url,
  });

  const start = async (
    operation: { readonly key: string; readonly kind: string },
    context: { readonly userId: string; readonly kbId: string },
  ): Promise<GeoRunStartOutcome> => {
    // A kind nothing here produces is recorded as unsupported rather than
    // retried or reported as done, so a run holding one finishes and says so.
    if (operation.kind !== "fetch")
      return { kind: "failed_permanent", reason: "unsupported" };
    const resolved = await resolve(context, operation.key);
    if (resolved.kind === "missing")
      return { kind: "failed_permanent", reason: "not_found" };
    if (resolved.kind !== "ok")
      return { kind: "failed_retryable", reason: "store_unavailable" };
    const { target, websiteId } = resolved;

    const latest = await sources
      .readLatestObservation(selector(context.userId, websiteId, target))
      .catch(() => ({ kind: "unavailable" as const }));
    if (latest.kind === "missing")
      return { kind: "failed_permanent", reason: "not_found" };
    if (latest.kind !== "ok")
      return { kind: "failed_retryable", reason: "store_unavailable" };

    const plan = planGeoEvidenceReuse({
      targets: [
        { kind: target.kind, url: target.url, gateKey: target.gateKey },
      ],
      observations: latest.value === null ? [] : [latest.value],
      now: sources.now(),
    });
    const entry = plan.entries[0];
    if (entry === undefined)
      return { kind: "failed_permanent", reason: "not_found" };
    // Fresh enough: the library already holds this observation, so the
    // operation is done without a request leaving this process.
    if (entry.decision === "reuse" && entry.reused !== null) {
      return { kind: "succeeded", resultRef: entry.reused.observationId };
    }

    const read = await sources.createReader(context.userId)({
      url: target.url,
      expected: "html",
      timeoutMs: PAGE_TIMEOUT_MS,
    });
    const observedAt =
      read.kind === "ok" ? read.observedAt : sources.now().toISOString();
    let status: GeoEvidenceObservationAppend["status"];
    if (read.kind !== "ok") {
      // Our own gate said no. Nothing about the site was observed, and writing
      // a row would suppress the real fetch for the rest of the TTL.
      if (read.reason === "rate_limited")
        return { kind: "failed_retryable", reason: "rate_limited" };
      status = { kind: "unavailable", reason: storableReason(read.reason) };
    } else if (!isHtml(read.contentType)) {
      status = { kind: "unavailable", reason: "invalid_response" };
    } else {
      const observed = observedStructure(
        readGeoOffsitePageSignals(read.body, target.url),
      );
      // A page with nothing quotable supports no claim. It was still reached,
      // and "reached and unusable" is a different fact from "never looked".
      status =
        observed.excerpts.length === 0
          ? { kind: "unavailable", reason: "insufficient_evidence" }
          : {
              kind: "ok",
              bodyHash: sha256(read.body),
              excerpts: observed.excerpts,
              structured: observed.structured,
            };
    }

    const written = await sources
      .recordObservation({
        ...selector(context.userId, websiteId, target),
        observedAt,
        status,
      })
      .catch(() => ({ kind: "unavailable" as const }));
    if (written.kind === "ok")
      return { kind: "succeeded", resultRef: written.value.observationId };
    if (written.kind === "missing")
      return { kind: "failed_permanent", reason: "not_found" };
    // The row we built is one this ledger refuses; building it again produces
    // the same one, and the fetch behind it has already been spent.
    if (written.kind === "invalid")
      return { kind: "failed_permanent", reason: "invalid_output" };
    // We looked, and we cannot say whether the library kept it. Not a retry.
    return { kind: "outcome_unknown" };
  };

  const probe = async (
    operation: {
      readonly key: string;
      readonly kind: string;
      readonly state: string;
    },
    context: { readonly userId: string; readonly kbId: string },
  ): Promise<GeoRunProbeOutcome> => {
    if (operation.kind !== "fetch") return { kind: "unresolved" };
    // The dispatch mark is written before the request leaves, so a row still
    // reading `claimed` provably sent nothing. That is the only state in which
    // "nothing was dispatched" is a fact rather than a hope.
    if (operation.state === "claimed") return { kind: "not_dispatched" };
    const resolved = await resolve(context, operation.key);
    if (resolved.kind !== "ok") return { kind: "unresolved" };
    const latest = await sources
      .readLatestObservation(
        selector(context.userId, resolved.websiteId, resolved.target),
      )
      .catch(() => ({ kind: "unavailable" as const }));
    if (latest.kind !== "ok" || latest.value === null)
      return { kind: "unresolved" };
    // Only a row this operation could have produced settles it. An expired one
    // is the row the fetch was meant to supersede, and reporting it as this
    // operation's result would date the update by an observation it replaced.
    return isObservationFresh(
      latest.value,
      sources.now(),
      geoEvidenceTtlMs(resolved.target.kind),
    )
      ? { kind: "succeeded", resultRef: latest.value.observationId }
      : { kind: "unresolved" };
  };

  return {
    seedOperations,
    executor: {
      start: async (operation, runContext) =>
        await start(operation, runContext),
      probe: async (operation, runContext) =>
        await probe(operation, runContext),
    },
  };
}

/**
 * The real sources.
 *
 * `findAccountWebsiteByUrl` is how a knowledge base reaches its website today:
 * the two registries are still joined by canonical site key rather than by a
 * foreign key (design D10), so the target URL is the only bridge there is.
 */
export const DEFAULT_GEO_RUN_COLLECT_SOURCES: GeoRunCollectSources = {
  readDetails: async (input) => await readVersionedGeoKnowledgeBase(input),
  resolveWebsiteId: async (input) => {
    const found = await findAccountWebsiteByUrl(input.userId, input.targetUrl);
    if (found.kind === "missing") return { kind: "missing" };
    if (found.kind !== "ok") return { kind: "unavailable" };
    return { kind: "ok", websiteId: found.value.website.websiteId };
  },
  readLatestObservation: async (input) => await readLatestObservation(input),
  recordObservation: async (input) => await recordObservation(input),
  createReader: (clientKey) => createGeoKnowledgeResourceReader(clientKey),
  now: () => new Date(),
};
