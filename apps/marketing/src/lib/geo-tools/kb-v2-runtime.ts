// @input -- verified Marketing auth and the existing owner-scoped GEO/Profile stores
// @output -- real v2 route dependencies and complete editor loading
// @pos -- runtime wiring only; no config reads or network work during import
import { getServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { findAccountWebsiteByUrl, readAccountWebsite } from "../account-websites/store.ts";
import { ensureGeoKnowledgeBase } from "./kb-store.ts";
import { isGeoKbPayloadV3Value, readVersionedGeoKnowledgeBase } from "./kb-versioned-read.ts";
import { GEO_PREPARED_CANDIDATE_V3_SCHEMA } from "./kb-prepared-v3-contract.ts";
import { readCompleteGeoKnowledgeBase } from "./kb-complete-read.ts";
import { readGeoSourceReceiptV2, persistGeoSourceReceiptV2, saveGeoKbDraftV2, DEFAULT_GEO_KB_PREPARED_STORE } from "./kb-prepared-store.ts";
import { DEFAULT_GEO_KB_GENERATION_STORE, type GeoKbGenerationStore } from "./kb-generation-store.ts";
import { createGeoKnowledgeResourceReader, DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES } from "./kb-enrichment-deps.ts";
import { resolveGeoBriefLlmConfig } from "./brief-llm.ts";
import { consumePublicToolQuota } from "../tools/shared-rate-limit.ts";
import type { GeoKbSourceDependencies } from "./kb-source-handler.ts";
import type { GeoKbGenerationHandlerDependencies } from "./kb-generation-handler.ts";
import type { GeoKbPreparedHandlerDependencies } from "./kb-prepared-handler.ts";
import type { GeoKbV2DraftDependencies, GeoKbV2LoadDependencies } from "./kb-v2-draft-handler.ts";
import { createGeoKbEditorLoader, createGeoKbEditorLoaderAny, createGeoKbV3EditorLoader,
  type GeoKbEditorLoaderDependencies, type GeoKbV3EditorLoaderDependencies } from "./kb-editor-loader.ts";
import { createGeoKbGenerationPreparer, creditGeoKnowledgeObservation, validateGeoKbDraftLineage,
  type GeoKbGenerationPreparerDependencies, type GeoKnowledgeEvidenceCollectionInput, type GeoKnowledgeUnavailableReason } from "./kb-generation-preparer.ts";
import { readLatestObservation } from "./kb-evidence-observations.ts";
import { planGeoRunCollection } from "./kb-run-collect.ts";
import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import { profileCopyReference } from "./kb-profile-copy.ts";
import { assertGeoProfileCopyIntegrity } from "./kb-profile-copy-server.ts";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";
import { parseGeoKbFrozenKnowledgeWire } from "../../components/tools/geo-kb-v2-wire.ts";
import { geoGenerationLanguage } from "@sf/public-tools/content-brief/geo-contract";
import { collectGeoKnowledgeEvidenceV1, type GeoKnowledgeEvidenceReadResource, type GeoKnowledgeEvidenceSource } from "./kb-knowledge-evidence.ts";

export interface GeoKbV2RuntimeDependencies {
  readonly authenticate: typeof getServerAuthenticatedUser;
  readonly ensure: typeof ensureGeoKnowledgeBase;
  readonly readDetails: typeof readVersionedGeoKnowledgeBase;
  readonly readProfile: typeof findAccountWebsiteByUrl;
  readonly readWebsite: typeof readAccountWebsite;
  readonly readComplete: typeof readCompleteGeoKnowledgeBase;
  readonly readSource: typeof readGeoSourceReceiptV2;
  readonly persistSource: typeof persistGeoSourceReceiptV2;
  readonly generationStore: GeoKbGenerationStore;
  readonly preparedStore: typeof DEFAULT_GEO_KB_PREPARED_STORE;
  readonly saveDraft: typeof saveGeoKbDraftV2;
  readonly sourceTransports: typeof DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES;
  readonly resolveConfig: typeof resolveGeoBriefLlmConfig;
  readonly quota: typeof consumePublicToolQuota;
  readonly collectKnowledgeEvidence: typeof collectGeoKnowledgeEvidenceV1;
  readonly createKnowledgeResourceReader: typeof createGeoKnowledgeResourceReader;
  /**
   * The website evidence observation library, read side.
   *
   * Present so the knowledge model step can credit what the update's own
   * `fetch` operations already fetched instead of crawling the same pages a
   * second time under no ledger row. Never written from here: an observation is
   * produced by the operation that performed it (`kb-run-collect-executor.ts`),
   * which is what keeps the row and the crawl it paid for in one place.
   */
  readonly readLatestObservation: typeof readLatestObservation;
  readonly now: () => Date;
  readonly validateLineage?: GeoKbV2DraftDependencies["validateLineage"];
}
export interface GeoKbV2Runtime {
  readonly loadEditor: GeoKbV2LoadDependencies["loadEditor"];
  /**
   * The v3 draft loader. It lives beside the v2 one rather than in the v3
   * runtime because the two share `ensure` and `readDetails`, and because
   * `loadEditorAny` -- the entry point a website route uses -- has to be able to
   * fall from one to the other in a single request.
   */
  readonly loadEditorV3: ReturnType<typeof createGeoKbV3EditorLoader>;
  /** Whichever editor this knowledge base holds; the website GEO route's seam. */
  readonly loadEditorAny: ReturnType<typeof createGeoKbEditorLoaderAny>;
  readonly load: GeoKbV2LoadDependencies;
  readonly draft: GeoKbV2DraftDependencies;
  readonly sources: GeoKbSourceDependencies;
  readonly generation: GeoKbGenerationHandlerDependencies;
  readonly prepared: GeoKbPreparedHandlerDependencies;
}
const DEFAULT: GeoKbV2RuntimeDependencies = {
  authenticate: getServerAuthenticatedUser, ensure: ensureGeoKnowledgeBase, readDetails: readVersionedGeoKnowledgeBase,
  readProfile: findAccountWebsiteByUrl, readWebsite: readAccountWebsite, readComplete: readCompleteGeoKnowledgeBase,
  readSource: readGeoSourceReceiptV2, persistSource: persistGeoSourceReceiptV2, generationStore: DEFAULT_GEO_KB_GENERATION_STORE,
  preparedStore: DEFAULT_GEO_KB_PREPARED_STORE, saveDraft: saveGeoKbDraftV2, sourceTransports: DEFAULT_GEO_KB_ENRICHMENT_DEPENDENCIES,
  resolveConfig: resolveGeoBriefLlmConfig, quota: consumePublicToolQuota, collectKnowledgeEvidence: collectGeoKnowledgeEvidenceV1,
  createKnowledgeResourceReader: createGeoKnowledgeResourceReader, readLatestObservation, now: () => new Date(),
};

export function createGeoKbV2Runtime(overrides: Partial<GeoKbV2RuntimeDependencies> = {}): GeoKbV2Runtime {
  const dependencies = { ...DEFAULT, ...overrides };
  const same = (a: unknown, b: unknown) => canonicalGeoV2Text(a) === canonicalGeoV2Text(b);
  const validateCurrentCopy: GeoKbV2DraftDependencies["validateCurrentCopy"] = async input => {
    try { assertGeoProfileCopyIntegrity(input.copy); } catch { return "stale"; }
    const reference = profileCopyReference(input.copy);
    if (input.expectedProfileReference !== undefined && !same(reference, input.expectedProfileReference)) return "stale";
    try {
      const read = await dependencies.readWebsite(input.userId, input.copy.websiteId);
      if (read.kind === "unavailable") return "unavailable";
      if (read.kind !== "ok" || read.value.websiteId !== input.copy.websiteId) return "stale";
      const website = read.value, snapshot = website.currentConfirmedSnapshot;
      if (input.origin !== undefined && normalizeAccountWebsiteUrl(input.origin)?.canonicalSiteKey !== website.canonicalSiteKey) return "stale";
      if (snapshot === null || snapshot.websiteId !== input.copy.websiteId || snapshot.snapshotId !== input.copy.snapshotId
        || String(snapshot.snapshotRevision) !== input.copy.snapshotRevision || snapshot.profileHash !== input.copy.profileHash
        || snapshot.profileSchemaVersion !== input.copy.profile.schemaVersion || !same(snapshot.profile, input.copy.profile)) return "stale";
      return "current";
    } catch { return "unavailable"; }
  };
  const readReceipt: GeoKbGenerationPreparerDependencies["readReceipt"] = async input => {
    const result = await dependencies.readSource(input);
    return result.kind !== "ok" ? { kind: "unavailable" } : result.value === null ? { kind: "missing" } : { kind: "ok", value: result.value };
  };
  const readGeneration: GeoKbGenerationPreparerDependencies["readGeneration"] = async input => {
    const result = await dependencies.generationStore.read(input);
    return result.kind !== "ok" ? { kind: "unavailable" } : result.generation === null ? { kind: "missing" } : { kind: "ok", generation: result.generation };
  };
  const readFrozen: GeoKbEditorLoaderDependencies["readFrozen"] = async input => {
    const result = await dependencies.readComplete(input);
    if (result.kind !== "ok") return { kind: "unavailable" };
    const { snapshot, context, knowledgePack } = result.value;
    // The editor view below is the v2 frozen wire: it requires a question set,
    // a question-set hash and a question count. A v3 version may have none of
    // those, and its card is a separate view, so it is refused rather than
    // rendered as a broken v2 one.
    if (isGeoKbPayloadV3Value(snapshot.payload) || snapshot.questionSet === null || snapshot.questionSetHash === null || snapshot.questionCount === null) return { kind: "unavailable" };
    if (snapshot.payload.schemaVersion === "marketing-geo-kb.v2") {
      if (snapshot.questionSet.schemaVersion !== "marketing-geo-question-set.v2" || context?.schemaVersion !== "marketing-geo-snapshot-context.v2") return { kind: "unavailable" };
      // preparedId is an internal immutable lookup identity; the separately
      // versioned customer pack wire must never expose it.
      const { preparedId: _preparedId, ...wireSnapshot } = snapshot;
      const value = parseGeoKbFrozenKnowledgeWire({ ...wireSnapshot, context,
        wireSchemaVersion: "marketing-geo-kb-frozen-wire.v1", knowledgePack });
      return value === null ? { kind: "unavailable" } : { kind: "ok", value };
    }
    if (snapshot.questionSet.schemaVersion !== "marketing-geo-question-set.v1" || (context !== null && context.schemaVersion !== "marketing-geo-snapshot-context.v1")) return { kind: "unavailable" };
    return { kind: "ok", value: { snapshotId: snapshot.snapshotId, revision: snapshot.revision, frozenAt: snapshot.frozenAt,
      contentHash: snapshot.contentHash, questionSetHash: snapshot.questionSetHash, questionCount: snapshot.questionCount,
      retrievalCount: snapshot.questionSet.questions.filter(question => question.mode === "retrieval").length,
      payload: snapshot.payload, questions: snapshot.questionSet.questions, registryVersion: snapshot.questionSet.registryVersion,
      ...(context === null ? {} : { skippedLayers: context.skippedLayers }),
    } };
  };
  const loadEditor = createGeoKbEditorLoader({ ensure: dependencies.ensure, readDetails: dependencies.readDetails,
    readProfile: async (userId, url) => {
      const read = await dependencies.readProfile(userId, url);
      return read.kind === "ok" ? read : read.kind === "missing" || read.kind === "invalid" ? { kind: read.kind } : { kind: "unavailable" };
    },
    readFrozen, readSource: dependencies.readSource,
    // The v2 editor renders a v1/v2 candidate. A v3 candidate belongs to the v3
    // card, and handing one to this wire would only make it return null.
    readPrepared: async input => {
      const read = await dependencies.preparedStore.readLatest(input);
      if (read.kind !== "ok") return read;
      const candidate = read.value;
      return candidate !== null && candidate.schemaVersion === GEO_PREPARED_CANDIDATE_V3_SCHEMA ? { kind: "unavailable", reason: "prepared_candidate_version_unsupported" } : { kind: "ok", value: candidate };
    },
    readGeneration: dependencies.generationStore.readLatest,
  });
  /**
   * The same immutable complete reader the v2 frozen view goes through, and for
   * the same reason: it is the one that verifies a published version against
   * its context and its prepared candidate before handing it over. A lighter
   * read would return the payload of a version this application would refuse to
   * render anywhere else, and the publish box would then count changes against
   * it. A version that cannot be verified makes the v3 load fail rather than
   * report "no published version", which would be a different claim.
   */
  const readFrozenPayload: GeoKbV3EditorLoaderDependencies["readFrozenPayload"] = async input => {
    const result = await dependencies.readComplete(input);
    return result.kind !== "ok" ? { kind: "unavailable", reason: "frozen_payload_unavailable" } : { kind: "ok", value: result.value.snapshot.payload };
  };
  const loadEditorV3 = createGeoKbV3EditorLoader({ ensure: dependencies.ensure, readDetails: dependencies.readDetails, readFrozenPayload });
  const loadEditorAny = createGeoKbEditorLoaderAny(loadEditor, loadEditorV3);
  /**
   * What the model step already knows, and therefore must not fetch again.
   *
   * The knowledge collector used to crawl on its own: a fresh gated reader, the
   * home page, up to seven pages linked from it, three machine files and up to
   * two pages per confirmed competitor -- up to eighteen requests, none of them
   * named by a ledger row, all of them against the same hourly per-target crawl
   * allowance GEO shares with the Profile scan, seo-audit and
   * internal-link-audit. The update had just fetched several of those pages
   * through operations that DO carry a row.
   *
   * So the plan is re-derived here from `planGeoRunCollection` -- the same
   * function the run seeds from, given the same two inputs -- and only a target
   * that plan contains can be credited. A page the collector would read but the
   * ledger never names (`/robots.txt`, `/sitemap.xml`, `/llms.txt`, and any
   * page linked from the home page) is deliberately NOT credited from here: it
   * is fetched, and stays visible as the extra reading it is. Making those
   * ledger operations means seeding them in `kb-run-collect.ts`, which this file
   * does not own.
   *
   * Every fallback goes to "fetch". A website that cannot be resolved, a store
   * that will not answer, an observation past its TTL or one that cannot be
   * expressed as a valid source all leave the collector doing exactly what it
   * did before. Reuse is only ever claimed for a page this library really holds
   * a live observation of.
   *
   * The one thing it stops rather than credits is a confirmed competitor the
   * plan does not cover; see the loop below for why that is a refusal to look
   * rather than a silent extra crawl.
   */
  const creditObservedTargets = async (input: GeoKnowledgeEvidenceCollectionInput): Promise<{
    readonly sources: readonly GeoKnowledgeEvidenceSource[];
    readonly observedUnavailable: ReadonlyMap<string, GeoKnowledgeUnavailableReason>;
  }> => {
    const sources: GeoKnowledgeEvidenceSource[] = [];
    const observedUnavailable = new Map<string, GeoKnowledgeUnavailableReason>();
    const credited = { sources, observedUnavailable };
    const planned = new Map(planGeoRunCollection({ targetUrl: input.targetUrl,
      competitors: input.confirmedCompetitors.map(competitor => ({ domain: competitor.key, confirmed: true })) })
      .map(target => [target.url, target.kind] as const));
    if (planned.size === 0) return credited;
    // The library is keyed by website, and a knowledge base carries no website
    // id: the target URL is the only bridge, exactly as in the collect executor.
    const profile = await dependencies.readProfile(input.userId, input.targetUrl).catch(() => ({ kind: "unavailable" as const }));
    if (profile.kind !== "ok") return credited;
    const websiteId = profile.value.website.websiteId;
    const now = dependencies.now();
    // The addresses the collector will ask for, written the way IT writes them:
    // the target it was handed, and `https://<key>/` per confirmed competitor.
    // A planned target whose address differs from these is left to the fetch,
    // because a reused source at a different URL would sit beside the fetched
    // page rather than replace it.
    const requests = [
      { kind: "own_page" as const, url: input.targetUrl, competitor: null },
      ...input.confirmedCompetitors.map(competitor => ({ kind: "competitor_page" as const, url: `https://${competitor.key}/`, competitor })),
    ];
    for (const request of requests) {
      if (planned.get(request.url) !== request.kind) {
        /*
         * A confirmed competitor the plan leaves out. `planGeoRunCollection`
         * drops one for exactly two reasons -- its address is not a public site
         * the account layer will read, or its hourly crawl allowance is already
         * spent by a sibling target that differs only by `www.` -- and neither
         * is a reason to read it anyway under no ledger row. It is reported as
         * `not_collected`, which is what happened: this update did not look.
         *
         * Never applied to the site's own page. If that address somehow fails
         * to appear in the plan the fetch has to go ahead, because an update
         * with no evidence about its own subject is refused outright, and
         * turning that into a refusal would be a far worse trade than one
         * extra read.
         */
        if (request.kind === "competitor_page") observedUnavailable.set(request.url, "not_collected");
        continue;
      }
      const read = await dependencies.readLatestObservation({ userId: input.userId, websiteId, kind: request.kind, url: request.url })
        .catch(() => ({ kind: "unavailable" as const }));
      if (read.kind !== "ok") continue;
      const credit = creditGeoKnowledgeObservation({ ...request, observation: read.value, now });
      if (credit.kind === "reuse") sources.push(credit.source);
      else if (credit.kind === "observed_unavailable") observedUnavailable.set(request.url, credit.reason);
    }
    return credited;
  };
  const prepare = createGeoKbGenerationPreparer({
    readDetails: async input => {
      const read = await dependencies.readDetails(input);
      return read.kind === "ok" ? read : read.kind === "missing" ? { kind: "missing" } : { kind: "unavailable" };
    },
    validateCurrentProfileCopy: validateCurrentCopy, readReceipt, readGeneration, resolveConfig: dependencies.resolveConfig,
    collectKnowledgeEvidence: async input => {
      const credited = await creditObservedTargets(input);
      // One reader for the whole collection: it memoises the crawl gate's
      // admission per target, so building a second one would open a second.
      const reader = dependencies.createKnowledgeResourceReader(input.userId, { now: dependencies.now });
      const readResource: GeoKnowledgeEvidenceReadResource = async request => {
        const observed = credited.observedUnavailable.get(request.url);
        return observed === undefined ? await reader(request) : { kind: "unavailable", url: request.url, reason: observed };
      };
      return await dependencies.collectKnowledgeEvidence({ targetUrl: input.targetUrl, competitors: [...input.confirmedCompetitors] }, {
        readResource, reusedSources: [...input.reusedSources, ...credited.sources], now: dependencies.now,
      });
    },
    now: dependencies.now,
  });
  const consumeQuota: GeoKbGenerationHandlerDependencies["consumeQuota"] = async (userId, kbId, kind) => {
    for (const [bucket, limit] of [[`geo-kb-v2:${kind}:owner:${userId}`, 10], [`geo-kb-v2:${kind}:kb:${kbId}`, 4]] as const) {
      const result = await dependencies.quota(bucket, limit, 3600).catch(() => ({ kind: "unavailable" as const }));
      if (result.kind !== "allowed") return result.kind === "limited" ? "limited" : "unavailable";
    }
    return "allowed";
  };
  const sources: GeoKbSourceDependencies = { ...dependencies.sourceTransports, authenticate: dependencies.authenticate,
    readAsset: async input => {
      const read = await dependencies.readDetails(input);
      if (read.kind !== "ok") return { kind: read.kind === "missing" ? "missing" : "unavailable" };
      if (read.value.kbId !== input.kbId) return { kind: "unavailable" };
      const draft = read.value.draft;
      if (draft === null) return { kind: "no_draft" };
      // The v2 source flow reads a v2 draft's Profile copy and target URL. A v3
      // draft keeps neither at the top level and collects its sources through
      // the v3 run, so it is refused here rather than read through a v2 shape.
      if (isGeoKbPayloadV3Value(draft.payload)) return { kind: "unavailable" };
      const payload = draft.payload;
      const site = normalizeAccountWebsiteUrl(read.value.origin);
      if (site === null || normalizeAccountWebsiteUrl(payload.targetUrl)?.host !== site.host) return { kind: "unavailable" };
      return { kind: "ok", value: { kbId: input.kbId, targetHost: site.host, draftVersion: draft.draftVersion, payload,
        profileReference: payload.profileCopy === undefined ? null : profileCopyReference(payload.profileCopy) } };
    }, persistReceipt: dependencies.persistSource,
  };
  const prepared: GeoKbPreparedHandlerDependencies = { authenticate: dependencies.authenticate,
    read: async input => {
      const read = input.candidateId === undefined ? await dependencies.preparedStore.readLatest({ userId: input.userId, kbId: input.kbId }) : await dependencies.preparedStore.read({ userId: input.userId, kbId: input.kbId, candidateId: input.candidateId });
      if (read.kind !== "ok") return { kind: "unavailable" };
      if (read.value === null) return { kind: "missing" };
      // v3 candidates are read and published by the v3 path; this handler
      // serves the v1/v2 candidate contract.
      const candidate = read.value;
      return candidate.schemaVersion === GEO_PREPARED_CANDIDATE_V3_SCHEMA ? { kind: "unavailable" } : { kind: "ok", candidate };
    },
    freeze: async input => {
      const result = await dependencies.preparedStore.freeze(input);
      return result.kind === "ok" ? result : result.kind === "missing" ? { kind: "missing" } : result.kind === "invalid" && result.code === "context_stale" ? { kind: "stale" } : { kind: "unavailable" };
    },
  };
  return { loadEditor, loadEditorV3, loadEditorAny, load: { authenticate: dependencies.authenticate, loadEditor },
    draft: { authenticate: dependencies.authenticate, readDetails: dependencies.readDetails, validateCurrentCopy,
      // One kind failing to read must not mask another kind that is known to
      // be running: an outage is the weaker answer, so it is only reported
      // once every kind has been asked and none of them said yes.
      generationRunning: async (userId, kbId) => {
        let unavailable = false;
        for (const kind of ["roles", "questions", "knowledge_pack"] as const) {
          const read = await dependencies.generationStore.readLatest({ userId, kbId, kind });
          if (read.kind !== "ok") { unavailable = true; continue; }
          if (read.generation !== null && read.generation.state === "dispatched") return true;
        }
        return unavailable ? "unavailable" : false;
      },
      // Generous for typing (a write needs a 900 ms pause), tight for a runaway client.
      consumeQuota: async (userId, kbId) => {
        for (const [bucket, limit] of [[`geo-kb-v2:draft:owner:${userId}`, 1200], [`geo-kb-v2:draft:kb:${kbId}`, 600]] as const) {
          const result = await dependencies.quota(bucket, limit, 3600).catch(() => ({ kind: "unavailable" as const }));
          if (result.kind !== "allowed") return result.kind === "limited" ? "limited" : "unavailable";
        }
        return "allowed";
      },
      validateLineage: dependencies.validateLineage ?? (input => validateGeoKbDraftLineage({ userId: input.userId, kbId: input.kbId, payload: input.payload, ...(input.previousPayload === null ? {} : { previousPayload: input.previousPayload }) }, { readReceipt, readGeneration })),
      saveDraft: dependencies.saveDraft,
      blockers: payload => [
        ...(geoGenerationLanguage(payload.market.language) === null ? ["unsupported_language"] : []),
        ...(payload.roles.some(role => role.review === "pending") ? ["roles_pending"] : []),
        ...(payload.facts.some(fact => fact.review === "pending") ? ["facts_pending"] : []),
      ],
    },
    sources, generation: { authenticate: dependencies.authenticate, prepare, consumeQuota, store: dependencies.generationStore }, prepared,
  };
}
export const DEFAULT_GEO_KB_V2_RUNTIME = createGeoKbV2Runtime();
/**
 * The two narrow loaders. Neither has a caller: the account website GEO route
 * takes `loadGeoKbEditorAny` below, and no other route serves an editor view.
 *
 * They are kept because each answers a narrower question than the entry point
 * does -- but note what standing next to the entry point cost once already.
 * This route was wired to `loadGeoKbEditorV2`, which answers `unavailable` for
 * every v3 draft, and the route turns that into 503; a comment saying which one
 * to pick is what failed to prevent it. What prevents it now is a test that
 * drives the route handler itself and reads the `schemaVersion` off the
 * response body (`app/api/account/websites/[websiteId]/geo/route.test.ts`).
 * Adding a caller for either of these means adding that kind of test with it.
 */
export const loadGeoKbEditorV2 = DEFAULT_GEO_KB_V2_RUNTIME.loadEditor;
export const loadGeoKbEditorV3 = DEFAULT_GEO_KB_V2_RUNTIME.loadEditorV3;
/**
 * The loader a website GEO route depends on: it answers with the v2 editor view
 * for a v1/v2 knowledge base and the v3 review view for a v3 one.
 */
export const loadGeoKbEditorAny = DEFAULT_GEO_KB_V2_RUNTIME.loadEditorAny;
