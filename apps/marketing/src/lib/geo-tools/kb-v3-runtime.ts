// @input -- verified Marketing auth and the existing owner-scoped GEO/Profile stores
// @output -- real dependencies for the four v3 routes: draft creation, review, publish and the competitor gestures
// @pos -- runtime wiring only; no config reads or network work during import
import { getServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { findAccountWebsiteByUrl } from "../account-websites/store.ts";
import { consumePublicToolQuota } from "../tools/shared-rate-limit.ts";
import { DEFAULT_GEO_KB_GENERATION_STORE, type GeoKbGenerationStore } from "./kb-generation-store.ts";
import { readVersionedGeoKnowledgeBase } from "./kb-versioned-read.ts";
import { publishGeoKbV3, readGeoKbGenerationSummaryV3, saveGeoKbDraftV3 } from "./kb-v3-store.ts";
import type { GeoKbV3DraftCreateDependencies, GeoKbV3ProfileRead } from "./kb-v3-draft-create.ts";
import type { GeoKbV3PublishDependencies } from "./kb-v3-publish-handler.ts";
import type { GeoKbV3ReviewDependencies } from "./kb-v3-review-handler.ts";
import type { GeoKbV3CompetitorDependencies } from "./kb-v3-competitor-handler.ts";
import {
  DEFAULT_GEO_KB_V3_COMPETITOR_IDENTITY_CACHE,
  identifyGeoKbV3Competitor,
  type GeoKbV3CompetitorIdentityDependencies,
} from "./kb-v3-competitor-identity.ts";
import { createGeoKnowledgeResourceReader } from "./kb-enrichment-deps.ts";
import { readGeoKbRun } from "./kb-run-store.ts";

export interface GeoKbV3RuntimeDependencies {
  readonly authenticate: typeof getServerAuthenticatedUser;
  readonly readDetails: typeof readVersionedGeoKnowledgeBase;
  readonly saveDraft: typeof saveGeoKbDraftV3;
  readonly readGeneration: typeof readGeoKbGenerationSummaryV3;
  readonly publish: typeof publishGeoKbV3;
  readonly generationStore: GeoKbGenerationStore;
  readonly quota: typeof consumePublicToolQuota;
  /** The confirmed Website Profile a new v3 draft references, found by site. */
  readonly readProfile: typeof findAccountWebsiteByUrl;
  readonly newCandidateId: () => string;
  /**
   * The gated, SSRF-safe reader the competitor lookup reads a homepage with,
   * built per owner: the same constructor and the same client key the run's
   * collect step uses, so the admission it opens is charged to that owner's
   * own hourly allowance.
   */
  readonly createCompetitorReader: typeof createGeoKnowledgeResourceReader;
  /** The shared 24 h identity cache, so two owners naming one rival read it once. */
  readonly competitorIdentityCache: Pick<GeoKbV3CompetitorIdentityDependencies, "readCache" | "writeCache">;
  /** The run ledger, read for the competitor route only: an open run holds the hash that route would move. */
  readonly readRun: typeof readGeoKbRun;
  readonly now: () => Date;
}

const DEFAULT: GeoKbV3RuntimeDependencies = {
  authenticate: getServerAuthenticatedUser,
  readDetails: readVersionedGeoKnowledgeBase,
  saveDraft: saveGeoKbDraftV3,
  readGeneration: readGeoKbGenerationSummaryV3,
  publish: publishGeoKbV3,
  generationStore: DEFAULT_GEO_KB_GENERATION_STORE,
  quota: consumePublicToolQuota,
  readProfile: findAccountWebsiteByUrl,
  newCandidateId: () => crypto.randomUUID(),
  createCompetitorReader: createGeoKnowledgeResourceReader,
  competitorIdentityCache: DEFAULT_GEO_KB_V3_COMPETITOR_IDENTITY_CACHE,
  readRun: readGeoKbRun,
  now: () => new Date(),
};

export interface GeoKbV3Runtime {
  readonly draft: GeoKbV3DraftCreateDependencies;
  readonly review: GeoKbV3ReviewDependencies;
  readonly publish: GeoKbV3PublishDependencies;
  readonly competitors: GeoKbV3CompetitorDependencies;
}

export function createGeoKbV3Runtime(overrides: Partial<GeoKbV3RuntimeDependencies> = {}): GeoKbV3Runtime {
  const dependencies = { ...DEFAULT, ...overrides };
  /**
   * One kind failing to read must not mask another kind that is known to be
   * running: an outage is the weaker answer, so it is reported only once every
   * kind has been asked and none of them said yes.
   */
  const generationRunning = async (userId: string, kbId: string): Promise<boolean | "unavailable"> => {
    let unavailable = false;
    for (const kind of ["roles", "questions", "knowledge_pack"] as const) {
      const read = await dependencies.generationStore.readLatest({ userId, kbId, kind });
      if (read.kind !== "ok") { unavailable = true; continue; }
      if (read.generation !== null && read.generation.state === "dispatched") return true;
    }
    return unavailable ? "unavailable" : false;
  };
  const bucket = async (buckets: readonly (readonly [string, number])[]): Promise<"allowed" | "limited" | "unavailable"> => {
    for (const [name, limit] of buckets) {
      const result = await dependencies.quota(name, limit, 3600).catch(() => ({ kind: "unavailable" as const }));
      if (result.kind !== "allowed") return result.kind === "limited" ? "limited" : "unavailable";
    }
    return "allowed";
  };
  const shared = {
    authenticate: dependencies.authenticate,
    readDetails: (input: { readonly userId: string; readonly kbId: string }) => dependencies.readDetails(input),
    saveDraft: dependencies.saveDraft,
    generationRunning,
    now: dependencies.now,
  };
  /**
   * The Profile read, narrowed to the four outcomes the creator distinguishes.
   * `profile_not_confirmed` is the store's way of saying "a website exists but
   * nobody has confirmed a Profile revision", which is a different remedy from
   * "no website", so the two do not collapse into one refusal.
   */
  const readProfile: GeoKbV3DraftCreateDependencies["readProfile"] = async (input) => {
    const read = await dependencies.readProfile(input.userId, input.url).catch(() => ({ kind: "unavailable" as const }));
    if (read.kind === "ok") {
      return {
        kind: "ok",
        canonicalSiteKey: read.value.website.canonicalSiteKey,
        reference: read.value.reference,
        profile: read.value.profile,
      } satisfies GeoKbV3ProfileRead;
    }
    if (read.kind === "missing") return { kind: "missing" };
    if (read.kind === "invalid") {
      return read.code === "profile_not_confirmed" ? { kind: "unconfirmed" } : { kind: "missing" };
    }
    return { kind: "unavailable" };
  };
  /**
   * No collection is wired here, and that is the point.
   *
   * This route used to build a knowledge resource reader and collect the site
   * so the created draft could name an evidence digest. That spent one of the
   * four hourly crawl admissions a site has -- shared with the Profile scan,
   * seo-audit and internal-link-audit -- without consulting
   * `readLatestObservation` or writing `recordObservation`, so the run's own
   * collect step (`kb-run-collect-executor.ts`, which does both) got no reuse
   * credit and re-fetched the same pages. See the note in
   * `kb-v3-draft-create.ts` for why the value it bought could not be verified
   * either. Collection belongs to the run's collect step, which has the
   * observation library, the reuse plan and a per-operation ledger; this step
   * has none of the three.
   */
  return {
    draft: {
      authenticate: shared.authenticate,
      readDetails: (input: { readonly userId: string; readonly kbId: string }) => dependencies.readDetails(input),
      readProfile,
      saveDraft: shared.saveDraft,
      generationRunning,
      // Not the crawl gate's number any more, because this route no longer
      // crawls. A create succeeds at most once per knowledge base -- every
      // later one is refused as `draft_exists` -- so a handful an hour is
      // already far more than a person needs and is a fuse against a client
      // that will not stop asking.
      consumeQuota: (userId, kbId) => bucket([[`geo-kb-v3:draft:owner:${userId}`, 20], [`geo-kb-v3:draft:kb:${kbId}`, 4]]),
    },
    review: {
      ...shared,
      // Generous for a person clicking through a review (each gesture is behind
      // a 900 ms pause and several batch into one write), tight for a loop.
      consumeQuota: (userId, kbId) => bucket([[`geo-kb-v3:review:owner:${userId}`, 1200], [`geo-kb-v3:review:kb:${kbId}`, 600]]),
    },
    publish: {
      ...shared,
      readGeneration: dependencies.readGeneration,
      publish: dependencies.publish,
      newCandidateId: dependencies.newCandidateId,
      // Publishing is free but it writes a version and a draft. A person
      // publishes a handful of times an hour; a stuck client does not.
      consumeQuota: (userId, kbId) => bucket([[`geo-kb-v3:publish:owner:${userId}`, 60], [`geo-kb-v3:publish:kb:${kbId}`, 30]]),
    },
    competitors: {
      ...shared,
      /**
       * Wider than the shared reading on purpose. A review write leaves the
       * locked input alone, so for it "running" means a model request is out.
       * A competitor gesture moves the hash, and a run stopped between its paid
       * step and its assembly -- tab closed, lease lapsed -- holds a succeeded
       * record bound to that hash with nothing dispatched; the shared reading
       * says "no" and the gesture would strand it. So here an open run counts,
       * and a ledger that cannot answer is an outage rather than a no, unless
       * the generation store has already said yes on its own.
       */
      generationRunning: async (userId, kbId) => {
        const generation = await generationRunning(userId, kbId);
        if (generation === true) return true;
        const run = await dependencies.readRun({ userId, kbId, runId: null }).catch(() => ({ kind: "unavailable" as const }));
        if (run.kind === "found") return run.run.state === "running" ? true : generation;
        return run.kind === "none" ? generation : "unavailable";
      },
      // A reader per read, not per runtime: the reader memoises its crawl
      // admission per host for its own lifetime, and a long-lived one would
      // let a second lookup of the same rival ride an admission opened an
      // hour ago by somebody else's request. Built only when the cache has
      // not already answered, which is the common case for a shared rival.
      identify: ({ userId, domain }) => identifyGeoKbV3Competitor(domain, {
        read: (input) => dependencies.createCompetitorReader(userId)(input),
        readCache: dependencies.competitorIdentityCache.readCache,
        writeCache: dependencies.competitorIdentityCache.writeCache,
        now: dependencies.now,
      }),
      // A draft names at most five rivals and a person confirms each once;
      // the lookups behind the rows are bounded harder by the crawl gate.
      consumeQuota: (userId, kbId) => bucket([[`geo-kb-v3:competitors:owner:${userId}`, 120], [`geo-kb-v3:competitors:kb:${kbId}`, 60]]),
    },
  };
}

export const DEFAULT_GEO_KB_V3_RUNTIME = createGeoKbV3Runtime();
