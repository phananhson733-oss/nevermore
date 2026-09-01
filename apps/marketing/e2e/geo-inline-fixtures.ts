// Offline browser-only account/store state. Real Profile copy/context builders
// remain in use, but these objects are neither authenticated nor production data.
import { createHash } from "node:crypto";
import { canonicalProfileJson, type MarketingWebsiteProfileV1, type WebsiteDetails, type WebsiteProfileReferenceV1 } from "../src/lib/account-websites/contracts.ts";
import { emptyGeoKbPayload, type GeoKbPayload, type GeoKbValue } from "../src/lib/geo-tools/kb-contract.ts";
import { createGeoProfileCopy } from "../src/lib/geo-tools/kb-profile-copy.ts";
import { inheritedProfileFromCopy } from "../src/lib/geo-tools/kb-profile-copy-server.ts";
import { geoKbDigest } from "../src/lib/geo-tools/kb-digest.ts";
import { buildGeoSnapshotContext } from "../src/lib/geo-tools/snapshot-context.ts";
import type { GeoKbHandlerDependencies, GeoKbView } from "../src/lib/geo-tools/kb-handler.ts";
import { createGeoChainFixture, GEO_CHAIN_NOW, GEO_CHAIN_USER, type GeoChainFixture } from "./geo-chain-fixtures.ts";

const KB_ID = "73b6ec1c-9dd0-4f7c-853c-28135b5142a2";
const hash = (profile: MarketingWebsiteProfileV1) => createHash("sha256").update(canonicalProfileJson(profile)).digest("hex");
function reference(website: WebsiteDetails): WebsiteProfileReferenceV1 {
  const { confirmedAt: _confirmed, profile: _profile, ...value } = website.currentConfirmedSnapshot!;
  return value;
}

/** Initial read is bounded to an already confirmed fixture Website. */
export function inlineViewForWebsite(website: WebsiteDetails): GeoKbView {
  const snapshot = website.currentConfirmedSnapshot;
  if (snapshot === null) throw new Error("Inline GEO fixture requires a confirmed Profile");
  const profile = snapshot.profile;
  return { kbId: KB_ID, origin: website.origin, host: website.host, draftVersion: 0, frozen: null, importAvailable: true,
    profile: { reference: reference(website), productName: profile.productName, oneLinePositioning: profile.oneLinePositioning,
      coreFeatures: profile.coreFeatures, market: { country: profile.country, language: profile.locale }, fullProfile: profile },
    payload: { ...emptyGeoKbPayload(website.origin), officialName: profile.productName, aliases: [profile.productName],
      categoryTerms: profile.categories, market: { country: profile.country, language: profile.locale },
      profileCopy: createGeoProfileCopy(reference(website), profile) } };
}

export function createInlineGeoFixture() {
  const base = createGeoChainFixture("A");
  const profile: MarketingWebsiteProfileV1 = { ...base.profile.fullProfile,
    valueProposition: "Keep decisions tied to evidence", categories: ["Profile analytics category"], businessModel: "Subscription",
    primaryCta: "Start a report", trustSignals: ["Documented methodology"], firstOutcome: "See one verified report",
    primaryIcp: "Growing analytics teams", buyer: "Analytics lead", user: "Working analyst", triggerPain: "Manual report reviews",
    icpInterests: ["Evidence quality"], icpPain: "Dispersed metrics", icpBehavior: "Compare source methods", icpPositioning: "Evidence-first teams",
    jtbd: "Make a defensible decision", useCases: ["Weekly reporting"], outcomes: ["Traceable findings"], barriers: ["Incomplete sources"],
    qualificationSignals: ["Has a reporting workflow"], disqualifiers: ["Needs an unsupported language"], directCompetitors: ["rival.example"],
    indirectAlternatives: ["spreadsheets.example"], excludedAlternatives: ["unrelated.example"],
    fieldProvenance: [{ path: "/valueProposition", derivation: "inferred", confidence: "medium", source: "public_page", limitation: "Offline fixture inference only",
      observedAt: GEO_CHAIN_NOW, evidenceUrls: ["https://geo-chain.test/about"] }] };
  const initialReference = { ...base.profile.reference, profileHash: hash(profile) };
  let website: WebsiteDetails = { ...base.website, confirmedAt: GEO_CHAIN_NOW,
    draft: { ...base.website.draft!, profile, profileHash: initialReference.profileHash },
    currentConfirmedSnapshot: { ...initialReference, confirmedAt: GEO_CHAIN_NOW, profile } };
  const initialPayload: GeoKbPayload = { ...base.payload, officialName: "Custom Acme matcher", aliases: ["Acme", "Keep custom alias"],
    categoryTerms: ["Keep custom query"], market: { country: "GB", language: "en-gb" },
    profileCopy: createGeoProfileCopy(initialReference, profile) };
  let payload = structuredClone(initialPayload);
  let draftVersion = 7;
  const source = () => {
    const snapshot = website.currentConfirmedSnapshot!;
    return { reference: reference(website), productName: snapshot.profile.productName, oneLinePositioning: snapshot.profile.oneLinePositioning,
      coreFeatures: snapshot.profile.coreFeatures, market: { country: snapshot.profile.country, language: snapshot.profile.locale }, fullProfile: snapshot.profile };
  };
  const built = () => buildGeoSnapshotContext({ kbId: base.frozen.kbId, targetHost: website.host, payload, profile: inheritedProfileFromCopy(payload.profileCopy!), receipt: null });
  const initialContext = built();
  const frozen = { ...base.frozen, payload: structuredClone(payload), contentHash: geoKbDigest(payload as unknown as GeoKbValue),
    questionSet: initialContext.questionSet, questionCount: initialContext.questionSet.questions.length, questionSetHash: initialContext.context.questionSetHash };
  const preview = () => { const { context } = built(); return { skippedLayers: context.skippedLayers, questionSetHash: context.questionSetHash, contentHash: context.contentHash }; };
  const view = (): GeoKbView => ({ kbId: frozen.kbId, origin: website.origin, host: website.host, draftVersion, payload: structuredClone(payload),
    profile: source(), context: preview(), importAvailable: true,
    frozen: { ...frozen, questions: frozen.questionSet.questions, retrievalCount: frozen.questionSet.questions.filter(q => q.mode === "retrieval").length } });
  const savedPayloads: GeoKbPayload[] = [];
  const dependencies: GeoKbHandlerDependencies = { ...base.kbDependencies,
    loadKnowledgeBase: async input => input.userId === GEO_CHAIN_USER && new URL(input.url).origin === website.origin ? { kind: "ok", value: view() } : { kind: "not_found" },
    saveDraft: async input => {
      if (input.userId !== GEO_CHAIN_USER || input.kbId !== frozen.kbId) return { kind: "not_found" };
      if (input.baseVersion !== draftVersion) return { kind: "conflict", draftVersion };
      if (input.expectedProfileReference?.profileHash !== source().reference.profileHash || input.payload.profileCopy?.profileHash !== source().reference.profileHash) return { kind: "context_stale" };
      payload = structuredClone(input.payload); draftVersion += 1; savedPayloads.push(structuredClone(payload));
      return { kind: "ok", value: { draftVersion, updatedAt: GEO_CHAIN_NOW, context: preview() } };
    },
    freeze: async () => { throw new Error("Inline-copy browser cases must not freeze a new fixture version"); },
  };
  const fixture: GeoChainFixture = { ...base, get website() { return website; }, view, kbDependencies: dependencies,
    get providerCalls() { return base.providerCalls; }, get assemblyCalls() { return base.assemblyCalls; }, get report() { return base.report; } };
  return { fixture, initialPayload, frozen, savedPayloads,
    saveProfile(next: MarketingWebsiteProfileV1) {
      website = { ...website, profileState: "unconfirmed_changes", draft: { draftVersion: website.draft!.draftVersion + 1, updatedAt: GEO_CHAIN_NOW, profileHash: hash(next), profile: structuredClone(next) } };
      return website;
    },
    confirmProfile() {
      const next = website.draft!;
      website = { ...website, profileState: "confirmed", confirmedSnapshotId: "25c7f3a6-4a43-4fc9-a4be-727e39248b45", confirmedSnapshotRevision: 2,
        currentConfirmedSnapshot: { ...initialReference, snapshotId: "25c7f3a6-4a43-4fc9-a4be-727e39248b45", snapshotRevision: 2, profileHash: next.profileHash, profile: structuredClone(next.profile), confirmedAt: GEO_CHAIN_NOW } };
      return website;
    } };
}
