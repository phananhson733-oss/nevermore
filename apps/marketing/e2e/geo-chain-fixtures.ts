// Offline-only chain: real frozen-context, sampling, gap and Brief builders.
// Provider, account, store and public-fetch seams below never use a live service.
import { createHash } from "node:crypto";
import type { PublicResourceResult } from "@sf/sources/public-http";
import { canonicalProfileJson, emptyMarketingWebsiteProfile, type WebsiteDetails } from "../src/lib/account-websites/contracts.ts";
import { CONTEXT_KB_ID, CONTEXT_PROFILE, contextPayload, contextReceipt } from "../src/lib/geo-tools/snapshot-context.test-fixtures.ts";
import { buildGeoSnapshotContext } from "../src/lib/geo-tools/snapshot-context.ts";
import { finalizeGeoEnrichmentReport } from "../src/lib/geo-tools/kb-enrichment.ts";
import { geoKbDigest } from "../src/lib/geo-tools/kb-digest.ts";
import type { GeoKbValue } from "../src/lib/geo-tools/kb-contract.ts";
import type { GeoKbFrozenSnapshot } from "../src/lib/geo-tools/kb-store.ts";
import type { GeoKbHandlerDependencies, GeoKbView } from "../src/lib/geo-tools/kb-handler.ts";
import { buildVisibilityPlan, createVisibilityReportV2 } from "../src/lib/geo-tools/visibility-v2.ts";
import { observeVisibilityV2 } from "../src/lib/geo-tools/visibility-sampling-v2.ts";
import { enrichVisibilityReportV2 } from "../src/lib/geo-tools/visibility-enrich.ts";
import type { VisibilityContextV2, VisibilityEngine, VisibilityReportV2 } from "../src/lib/geo-tools/visibility-v2-contract.ts";
import { measureCitabilityRender } from "../src/lib/geo-tools/citability-render.ts";
import type { CitabilityRenderRequest } from "../src/lib/geo-tools/citability-render-contract.ts";
import { resolveOwnedVisibilityGap } from "../src/lib/geo-tools/owned-gap.ts";
import { resolveSharedBriefRunEvidence } from "../src/lib/geo-tools/brief-shared-deps.ts";
import { sharedGeoModelSources } from "../src/lib/geo-tools/brief-shared.ts";
import type { SharedBriefHandlerDependencies } from "../src/lib/geo-tools/brief-shared-handler.ts";
import type { GeoBriefReferenceDependencies } from "../src/lib/geo-tools/brief-reference.ts";
import { createGeoProfileCopy } from "../src/lib/geo-tools/kb-profile-copy.ts";
import { inheritedProfileFromCopy } from "../src/lib/geo-tools/kb-profile-copy-server.ts";

export const GEO_CHAIN_NOW = "2026-08-31T03:00:00.000Z";
export const GEO_CHAIN_USER = "11111111-1111-4111-8111-111111111119";
export const GEO_CHAIN_SNAPSHOT = "11111111-1111-4111-8111-111111111114";
export const GEO_CHAIN_RUN = "11111111-1111-4111-8111-111111111112";
export const GEO_CHAIN_ORIGIN = "https://geo-chain.test";
const GEO_CHAIN_HOST = "geo-chain.test";
export type ChainGap = "A" | "B" | "C" | "D";

function publicResponse(url: string, body: string, contentType = "text/html"): PublicResourceResult {
  return { kind: "ok", requestedUrl: url, finalUrl: url, firstStatus: 200, finalStatus: 200,
    redirectChain: [], body, bytes: Buffer.byteLength(body), bodyComplete: true, contentType, xRobotsTag: null };
}

export function createGeoChainFixture(kind: ChainGap) {
  const fullProfile = { ...emptyMarketingWebsiteProfile(), productName: "Acme", oneLinePositioning: "Analytics for teams",
    coreFeatures: ["Reporting"], country: "US", locale: "en-US" };
  const profileHash = createHash("sha256").update(canonicalProfileJson(fullProfile)).digest("hex");
  const profileCopy = createGeoProfileCopy({ ...CONTEXT_PROFILE.reference, profileHash }, fullProfile);
  const profile = { ...inheritedProfileFromCopy(profileCopy), fullProfile };
  const payload = { ...contextPayload(), targetUrl: GEO_CHAIN_ORIGIN, facts: [{ key: "Seats", value: "The Acme analytics tool supports three seats.",
    reason: "" as const, sourceUrl: `${GEO_CHAIN_ORIGIN}/pricing`, observedAt: "2026-08-30T00:00:00.000Z" }],
    profileCopy };
  const { contentHash: _receiptHash, ...receiptBody } = contextReceipt();
  const receipt = finalizeGeoEnrichmentReport({ ...receiptBody, targetHost: GEO_CHAIN_HOST, profileReference: profile.reference,
    draftHash: geoKbDigest(payload as unknown as GeoKbValue), facts: [], gsc: { ...receiptBody.gsc, property: `sc-domain:${GEO_CHAIN_HOST}` } });
  const { context, questionSet } = buildGeoSnapshotContext({ kbId: CONTEXT_KB_ID, targetHost: GEO_CHAIN_HOST, payload, profile, receipt });
  const frozen: GeoKbFrozenSnapshot = { kbId: CONTEXT_KB_ID, snapshotId: GEO_CHAIN_SNAPSHOT, revision: 1,
    contentHash: context.payloadHash, questionSetHash: context.questionSetHash, frozenAt: "2026-08-31T00:00:00.000Z",
    questionCount: questionSet.questions.length, payload, questionSet };
  const question = questionSet.questions.find(item => item.id === (kind === "D" ? "q04-retrieval.leading_differ" : "q01-retrieval.category_top"))!;
  if (!question) throw new Error("Expected canonical question missing from deterministic registry");
  const preview = { skippedLayers: context.skippedLayers, contentHash: context.contentHash, questionSetHash: context.questionSetHash };
  const frozenSummary = { snapshotId: frozen.snapshotId, revision: frozen.revision, frozenAt: frozen.frozenAt,
    contentHash: frozen.contentHash, questionCount: frozen.questionCount,
    retrievalCount: questionSet.questions.filter(item => item.mode === "retrieval").length,
    questionSetHash: frozen.questionSetHash, registryVersion: questionSet.registryVersion, questions: questionSet.questions,
    skippedLayers: context.skippedLayers, payload: structuredClone(payload) };
  let isFrozen = false;
  let report: VisibilityReportV2 | null = null;
  let providerCalls = 0;
  let assemblyCalls = 0;
  const publicCalls: string[] = [];
  const auth = async () => ({ ok: true as const, userId: GEO_CHAIN_USER });
  const ownsKb = (input: { userId: string; kbId: string }) => input.userId === GEO_CHAIN_USER && input.kbId === frozen.kbId;
  const ownsSnapshot = (input: { userId: string; kbId: string; snapshotId?: string }) => ownsKb(input) && input.snapshotId === frozen.snapshotId;
  const view = (): GeoKbView => ({ kbId: frozen.kbId, origin: GEO_CHAIN_ORIGIN, host: GEO_CHAIN_HOST, draftVersion: 1,
    payload, profile, context: preview, frozen: isFrozen ? frozenSummary : null, importAvailable: true });
  const website: WebsiteDetails = {
    websiteId: profile.reference.websiteId, submittedUrl: `${GEO_CHAIN_ORIGIN}/`, origin: GEO_CHAIN_ORIGIN,
    host: GEO_CHAIN_HOST, canonicalSiteKey: GEO_CHAIN_HOST, displayName: "Acme", isPrimary: true,
    profileState: "confirmed", confirmedSnapshotId: profile.reference.snapshotId,
    confirmedSnapshotRevision: 1, confirmedAt: frozen.frozenAt, createdAt: frozen.frozenAt, updatedAt: frozen.frozenAt,
    draft: { draftVersion: 1, updatedAt: frozen.frozenAt, profileHash, profile: fullProfile },
    currentConfirmedSnapshot: { ...profile.reference, confirmedAt: frozen.frozenAt, profile: fullProfile },
  };
  const kbDependencies: GeoKbHandlerDependencies = {
    authenticate: auth,
    loadKnowledgeBase: async input => input.userId === GEO_CHAIN_USER && new URL(input.url).origin === GEO_CHAIN_ORIGIN ? { kind: "ok", value: view() } : { kind: "not_found" },
    saveDraft: async input => ownsKb(input) ? { kind: "ok", value: { draftVersion: 1, updatedAt: GEO_CHAIN_NOW, context: preview } } : { kind: "not_found" },
    readDraftPayload: async input => ownsKb(input) ? { kind: "ok", value: { payload, draftVersion: 1, questionSet, context } } : { kind: "not_found" },
    freeze: async input => {
      if (!ownsKb(input)) return { kind: "not_found" };
      if (input.baseVersion !== 1 || input.context?.contentHash !== context.contentHash) throw new Error("Wrong frozen identity");
      isFrozen = true;
      return { kind: "ok", value: { ...frozenSummary, reusedExisting: false, context: preview } };
    },
    importFromProfile: async input => ownsKb(input) ? { kind: "ok", value: payload } : { kind: "not_found" },
  };
  const renderPage = async (input: CitabilityRenderRequest) => measureCitabilityRender(input, input.rawHtml, { now: () => new Date(GEO_CHAIN_NOW) });
  const goodBody = `<h1>${questionSet.questions.slice(0, 3).map(item => item.text).join(" ")}</h1><p>The best choice for teams of 5 to 20 people is an analytics tool, because it supports reporting within a defined scope <a href="https://reference.test/source">source</a>. ${"This public guide explains analytics, reviews, current plans, alternatives, and how teams choose tools using directly checkable evidence. ".repeat(6)}</p><table><tr><td>Analytics</td><td>Reporting</td></tr><tr><td>Rival</td><td>Scope</td></tr></table>`;
  const body = kind === "A" ? `<h1>About this company</h1><p>${"Company history and contact information. ".repeat(20)}</p>` : kind === "B" ? "<h1>analytics</h1><p>Short analytics page.</p>" : goodBody;
  const ownHtml = `<!doctype html><html><head><title>Public guide</title><link rel="canonical" href="${GEO_CHAIN_ORIGIN}/"></head><body>${body}</body></html>`;
  const fetchResource = async (url: string): Promise<PublicResourceResult> => {
    publicCalls.push(url);
    if (url.endsWith("/robots.txt")) return publicResponse(url, "User-agent: *\nAllow: /", "text/plain");
    if (url === `${GEO_CHAIN_ORIGIN}/sitemap.xml`) return publicResponse(url, `<urlset><url><loc>${GEO_CHAIN_ORIGIN}/</loc></url></urlset>`, "application/xml");
    if (url === `${GEO_CHAIN_ORIGIN}/`) return publicResponse(url, ownHtml);
    if (url === "https://publisher.test/best-tools") return publicResponse(url, "<html><title>Best analytics tools</title><body><h1>Best analytics tools</h1><ol><li>Rival</li><li>Other</li></ol></body></html>");
    if (url.endsWith("/llms.txt")) return publicResponse(url, "# Public tools", "text/plain");
    throw new Error(`Unplanned offline public fetch: ${url}`);
  };
  async function run(engines: readonly VisibilityEngine[], samplesPerQuestion: number) {
    if (!isFrozen) throw new Error("Visibility started before user froze the asset");
    const visibilityContext: VisibilityContextV2 = { officialName: payload.officialName, aliases: payload.aliases,
      competitors: payload.competitors, targetHost: GEO_CHAIN_HOST, marketCode: "US", language: "en" };
    const plan = buildVisibilityPlan(questionSet.questions, engines, samplesPerQuestion);
    const samples = await Promise.all(plan.map(item => observeVisibilityV2(visibilityContext, item, { provider: { observe: async () => {
      providerCalls += 1;
      const answerText = `${kind === "D" ? "1. Rival\n2. Acme" : "1. Rival\n2. Other"}\n\n## Team size\nCompare the supported team size.\n\n## Reporting scope\nConsider the stated reporting scope.`;
      return { answerText, webSearchPerformed: true, citationsComplete: true, citations: [{ url: "https://publisher.test/best-tools", title: "Best analytics tools",
        annotationText: null, providerOutputItemIndex: 0, sectionIndex: 0, annotationOrdinal: 0, startIndex: null, endIndex: null, spanBasis: "provider_message_section_text" }],
        model: "offline-fixture", modelObserved: "offline-fixture", providerTaskId: `offline-${item.slotId}`, costUsd: 0,
        observedAt: "2026-08-31T02:00:00.000Z" };
    } } })));
    report = await enrichVisibilityReportV2(createVisibilityReportV2({ runId: GEO_CHAIN_RUN, kbId: frozen.kbId,
      snapshotId: frozen.snapshotId, snapshotRevision: frozen.revision, questionSetHash: frozen.questionSetHash,
      startedAt: "2026-08-31T01:00:00.000Z", finishedAt: "2026-08-31T02:00:00.000Z",
      engines, samplesPerQuestion, context: visibilityContext, questions: questionSet.questions, samples }),
    { fetchResource, renderPage, now: () => new Date(GEO_CHAIN_NOW) });
    const selected = report.gaps.find(gap => gap.questionId === question.id);
    if (selected?.kind !== kind) throw new Error(`Offline fixture did not derive ${kind}: ${JSON.stringify(selected)}; limits=${report.limits.join(",")}`);
    return report;
  }
  const readRun: GeoBriefReferenceDependencies["readRun"] = async input => input.userId !== GEO_CHAIN_USER || input.runId !== GEO_CHAIN_RUN || report === null
    ? { kind: "missing" } : { kind: "ok", value: { provenance: "server_owned", report, runId: GEO_CHAIN_RUN, createdAt: GEO_CHAIN_NOW } };
  const shared: SharedBriefHandlerDependencies = {
    readFrozen: async input => isFrozen && ownsSnapshot(input) ? { kind: "ok", value: frozen } : { kind: "not_found" },
    readContext: async input => isFrozen && ownsSnapshot(input) ? { kind: "ok", value: context } : { kind: "not_found" },
    readRunEvidence: async input => {
      if (input.userId !== GEO_CHAIN_USER || input.runId !== GEO_CHAIN_RUN || input.frozen.kbId !== frozen.kbId || input.frozen.snapshotId !== frozen.snapshotId) return { kind: "not_found" };
      return resolveSharedBriefRunEvidence(input, { resolveGap: selector => resolveOwnedVisibilityGap(selector, { readRun }) });
    },
    configured: () => true,
    assemble: async brief => { assemblyCalls += 1; return { ok: true, outline: [{ id: "O1", h2: "Direct answer and scope", h3: [], answers: brief.must_answer.items.map(item => item.id) as [string, ...string[]], provenance: { method: "model", derived_from: sharedGeoModelSources(brief) } }] }; },
    runId: () => "offline-shared-brief",
  };
  const referenceDependencies: GeoBriefReferenceDependencies = {
    readFrozen: async input => isFrozen && ownsSnapshot(input) && input.revision === undefined ? { kind: "ok", value: frozen } : { kind: "missing" },
    readContext: async input => isFrozen && ownsSnapshot(input) ? { kind: "ok", value: context } : { kind: "missing" },
    readRun,
    readRunEvidence: input => shared.readRunEvidence(input),
  };
  return { kind, profile, payload, context, frozen, question, website, view, auth, kbDependencies, shared, referenceDependencies, renderPage, fetchResource,
    run, get report() { return report; }, get providerCalls() { return providerCalls; }, get assemblyCalls() { return assemblyCalls; }, publicCalls };
}
export type GeoChainFixture = ReturnType<typeof createGeoChainFixture>;
