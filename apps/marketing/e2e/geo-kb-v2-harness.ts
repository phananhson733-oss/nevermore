// Local browser transport only. All account, SQL and provider results are
// synthetic; real handlers/parsers/consumer verification are retained.
import { expect, type BrowserContext, type Request as BrowserRequest, type Route } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { handleWebsiteGeoLoad } from "../src/lib/account-websites/geo-route.ts";
import { parseMarketingWebsiteProfile } from "../src/lib/account-websites/contracts.ts";
import { handleVisibilityLoad, handleVisibilityStart, handleVisibilityStatus, type VisibilityHandlerDependencies } from "../src/lib/geo-tools/visibility-handler.ts";
import { countGeoCitationQuestions } from "../src/lib/geo-tools/kb-consumer-projection.ts";
import { runSharedBrief, type SharedBriefHandlerDependencies } from "../src/lib/geo-tools/brief-shared-handler.ts";
import { sharedGeoModelSources } from "../src/lib/geo-tools/brief-shared.ts";
import { resolveSharedBriefRunEvidence } from "../src/lib/geo-tools/brief-shared-deps.ts";
import { resolveOwnedVisibilityGap } from "../src/lib/geo-tools/owned-gap.ts";
import { verifyOwnedGeoBrief, type GeoBriefReferenceDependencies } from "../src/lib/geo-tools/brief-reference.ts";
import { handleContentDraftRunRequest, type ContentDraftHandlerDependencies } from "../src/lib/tools/content-draft-handler.ts";
import { sectionEvidenceFor } from "@sf/public-tools/content-brief/parse-draft";
import { validateSectionOutput } from "@sf/public-tools/content-brief/validate-section";
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import type { VisibilityEngine, VisibilityReportV2 } from "../src/lib/geo-tools/visibility-v2-contract.ts";
import { injectVisibilityAuthFixture, injectDraftAuthFixture } from "./geo-chain-harness.ts";
import { GEO_V2_USER, GEO_V2_NOW, GEO_V2_VISIBILITY_RUN, hydrateSafeOfflineVisibilityHtml, runOfflineV2Visibility, type GeoKbV2Fixture } from "./geo-kb-v2-fixtures.ts";

const allowedExternal = new Set(["accounts.google.com", "www.googletagmanager.com", "www.google-analytics.com"]);
const requestFor = (request: BrowserRequest) => new Request(request.url(), { method: request.method(), headers: request.headers(), ...(request.method() === "GET" ? {} : { body: request.postData() ?? "{}" }) });
async function respond(route: Route, response: Response) { await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() }); }
function hydrateSafeVisibilityFixture(html: string, locale: "en" | "zh"): string {
  // Playwright rewrites imported JSX as component-test descriptors. Render the
  // exact source component in an isolated raw tsx process, with no credentials.
  const script = `import {renderOfflineVisibilityInitial as render} from ${JSON.stringify(new URL("./geo-kb-v2-fixtures.ts", import.meta.url).href)}; console.log(JSON.stringify(Object.fromEntries(["authenticated","unauthenticated","unavailable"].map(state=>[state,render(${JSON.stringify(locale)},state)]))));`;
  const markup: Record<string, unknown> = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: new URL("../", import.meta.url), env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 }));
  if (typeof markup.authenticated !== "string" || typeof markup.unauthenticated !== "string" || typeof markup.unavailable !== "string") throw new Error("Invalid offline Visibility SSR render");
  return hydrateSafeOfflineVisibilityHtml(html, { authenticated: markup.authenticated, unauthenticated: markup.unauthenticated, unavailable: markup.unavailable });
}
export interface GeoKbV2Guard {
  readonly requests: { id: string; body: unknown }[]; readonly unexpected: string[]; readonly blockedExternal: string[];
  readonly expectedNetworkDrops: string[]; readonly consoleErrors: string[]; readonly pageErrors: string[];
  readonly authorityChecks: { snapshotId: string; accepted: boolean }[]; readonly authFixturePages: string[];
  visibilityCalls: number; briefCalls: number; draftCalls: number;
  dropNextGenerationResponse(kind: "roles" | "prepare"): void;
  readonly report: VisibilityReportV2 | null;
}
export async function installGeoKbV2Guard(context: BrowserContext, baseURL: string, fixture: GeoKbV2Fixture): Promise<GeoKbV2Guard> {
  const origin = new URL(baseURL).origin;
  if (new URL(origin).hostname !== "127.0.0.1") throw new Error("V2 fixture requires a loopback app");
  let dropped: "roles" | "prepare" | null = null, report: VisibilityReportV2 | null = null, brief: GeoContentBrief | null = null;
  const guard: GeoKbV2Guard = { requests: [], unexpected: [], blockedExternal: [], expectedNetworkDrops: [], consoleErrors: [], pageErrors: [], authorityChecks: [], authFixturePages: [], visibilityCalls: 0, briefCalls: 0, draftCalls: 0,
    dropNextGenerationResponse(kind) { dropped = kind; }, get report() { return report; } };
  const recordPage = (page: import("@playwright/test").Page) => {
    page.on("pageerror", error => guard.pageErrors.push(error.message));
    page.on("console", message => {
      if (message.type() !== "error") return;
      if (message.text().includes("net::ERR_BLOCKED_BY_CLIENT")) return;
      if (message.text().includes("net::ERR_FAILED") && guard.expectedNetworkDrops.includes(message.location().url)) return;
      guard.consoleErrors.push(message.text());
    });
  };
  context.pages().forEach(recordPage); context.on("page", recordPage);
  await context.addInitScript(() => { localStorage.setItem("gengrowth_consent", JSON.stringify({ consent_version: "1.0", necessary: true, analytics: false, marketing: false, updated_at: "2026-08-31T03:00:00.000Z" })); });
  const auth = async () => ({ ok: true as const, userId: GEO_V2_USER });
  let start: { engines: readonly VisibilityEngine[]; samplesPerQuestion: number } | null = null;
  const visibility: VisibilityHandlerDependencies = { authenticate: auth, consumeDailyRun: async () => true, providerConfigured: () => true, now: Date.now,
    listFrozen: async userId => { const frozen = fixture.currentFrozen; return { kind: "ok", value: userId !== GEO_V2_USER || frozen === null ? [] : [{ kbId: frozen.kbId, snapshotId: frozen.snapshotId, host: "geo-chain.test", revision: frozen.revision, frozenAt: frozen.frozenAt, questionCount: frozen.questionCount, retrievalCount: countGeoCitationQuestions(frozen.questionSet), language: frozen.questionSet.language, marketCode: frozen.questionSet.country }] }; },
    startRun: async () => { if (!start) throw new Error("Missing actual visibility selection"); report = await runOfflineV2Visibility(fixture, start.engines, start.samplesPerQuestion); guard.visibilityCalls += report.manifest.calls; return { runId: GEO_V2_VISIBILITY_RUN }; },
    readRun: async runId => runId === GEO_V2_VISIBILITY_RUN && report ? { kind: "completed", report } : { kind: "missing" },
  };
  const readRun: GeoBriefReferenceDependencies["readRun"] = async input => input.userId === GEO_V2_USER && input.runId === GEO_V2_VISIBILITY_RUN && report ? { kind: "ok", value: { provenance: "server_owned", report, runId: input.runId, createdAt: GEO_V2_NOW } } : { kind: "missing" };
  const shared: SharedBriefHandlerDependencies = {
    readFrozen: async input => { const value = await fixture.readComplete(input); return value.kind === "ok" ? { kind: "ok", value: value.value.snapshot } : { kind: "not_found" }; },
    readContext: async input => { const value = await fixture.readComplete(input); return value.kind === "ok" ? { kind: "ok", value: value.value.context } : { kind: "unavailable", reason: "offline_context_missing" }; },
    readRunEvidence: input => resolveSharedBriefRunEvidence(input, { resolveGap: selector => resolveOwnedVisibilityGap(selector, { readRun }) }),
    configured: () => true, runId: () => "offline-v2-brief",
    assemble: async basis => { guard.briefCalls++; return { ok: true, outline: [{ id: "O1", h2: "Direct answer and evidence", h3: [], answers: basis.must_answer.items.map(item => item.id), provenance: { method: "model", derived_from: sharedGeoModelSources(basis) } }] }; },
  };
  const reference: GeoBriefReferenceDependencies = { readFrozen: async input => { const value = await fixture.readComplete(input); return value.kind === "ok" ? { kind: "ok", value: value.value.snapshot } : { kind: "missing" }; },
    readContext: async input => { const value = await fixture.readComplete(input); return value.kind === "ok" ? { kind: "ok", value: value.value.context } : { kind: "unavailable" }; }, readRun, readRunEvidence: shared.readRunEvidence };
  const draft: ContentDraftHandlerDependencies = {
    generateSectionV2: async () => { throw new Error("Unexpected SEO generation"); }, runCoverageV2: async () => { throw new Error("Unexpected SEO coverage"); },
    getServerAuthenticatedUser: fixture.authenticate, readJson: async request => ({ ok: true, value: await request.json() }), extractClientIp: () => "203.0.113.19", acquireSlot: () => ({ acquired: true, release: () => undefined }), consumeQuota: async () => ({ kind: "allowed", hits: 1 }),
    verifyGeoBrief: async (value, userId) => { const accepted = await verifyOwnedGeoBrief(value, userId, reference); guard.authorityChecks.push({ snapshotId: value.geo_origin.kb_ref.snapshot_id, accepted }); return accepted; },
    generateSection: async input => {
      guard.draftCalls++; if (!brief) throw new Error("No server-bound Brief");
      expect(input.pages).toEqual([]); expect(input.facts).toEqual([]);
      expect(input.geo?.facts.map(fact => fact.text)).toEqual(["The product supports three seats."]);
      const fact = input.geo?.facts[0]; if (!fact) throw new Error("Missing admitted fact");
      const checked = validateSectionOutput({ paragraphs: [{ sentences: [{ text: fact.text, claim: "bound", evidence_refs: [fact.id] }] }] }, sectionEvidenceFor(brief, input.section.id, input.settings));
      if (!checked.ok) throw new Error(checked.rule);
      return { status: "ok", fail_reason: null, paragraphs: checked.paragraphs, word_count: checked.word_count, attempts: 1, model_id: "offline-draft", temperature_requested: 0.4, temperature_effective: null, input_tokens: 0, output_tokens: 0 };
    },
    runCoverage: async input => ({ items: input.questions.map(question => ({ question_id: question.id, status: "covered", covered_in: input.sections[0]!.id, gap: null })), reads: { status: "complete", calls: 1, model_id: "offline-coverage", temperature_requested: 0, temperature_effective: null, input_tokens: 0, output_tokens: 0 } }),
    now: Date.now, runId: () => "offline-v2-draft", emit: () => undefined,
  };
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { guard.blockedExternal.push(request.url()); if (!allowedExternal.has(url.hostname)) guard.unexpected.push(`external ${request.url()}`); await route.abort("blockedbyclient"); return; }
    if (!url.pathname.startsWith("/api/")) {
      if (request.resourceType() === "document" && /\/(?:en\/|zh\/)?tools\/(ai-visibility-check|content-draft)$/u.test(url.pathname)) {
        const response = await route.fetch(), html = await response.text(); guard.authFixturePages.push(url.pathname);
        await route.fulfill({ response, body: url.pathname.endsWith("ai-visibility-check") ? injectVisibilityAuthFixture(hydrateSafeVisibilityFixture(html, url.pathname.startsWith("/zh/") ? "zh" : "en")) : injectDraftAuthFixture(html) }); return;
      }
      await route.continue(); return;
    }
    const id = `${request.method()} ${url.pathname}`, body: unknown = request.method() === "GET" ? null : request.postDataJSON();
    guard.requests.push({ id, body }); const incoming = requestFor(request);
    if (id === "GET /api/auth/session") { await respond(route, Response.json({ signedIn: true })); return; }
    if (id === "GET /api/auth/profile") { await respond(route, Response.json({ data: { displayName: "Offline QA", email: "qa@example.test", avatarUrl: null } })); return; }
    if (id === "GET /api/auth/one-tap/nonce") { await route.abort("blockedbyclient"); return; }
    if (id === "GET /api/credits/balance") { await respond(route, Response.json({ data: { balance: { permanent: 100, daily: 0, total: 100 }, mode: "welfare", dailyGrant: { grantedToday: true, amount: 0, welfareRemaining: 100, welfareCap: 100 }, referral: { code: "offline", rewardedCount: 0, cap: 0 } } })); return; }
    if (id === "GET /api/credits/ledger") { await respond(route, Response.json({ data: { entries: [], nextCursor: null } })); return; }
    if (id === "GET /api/account/websites") { await respond(route, Response.json({ data: { websites: [fixture.website] } })); return; }
    const websitePath = `/api/account/websites/${fixture.website.websiteId}`;
    if (id === `GET ${websitePath}`) { await respond(route, Response.json({ data: { website: fixture.website } })); return; }
    if (id === `PATCH ${websitePath}` && body !== null && typeof body === "object" && "intent" in body && body.intent === "save_profile" && "profile" in body) { await respond(route, Response.json({ data: { website: fixture.saveProfile(parseMarketingWebsiteProfile(body.profile)) } })); return; }
    if (id === `POST ${websitePath}/confirm`) { await respond(route, Response.json({ data: { website: fixture.confirmProfile() } })); return; }
    if (id === `POST ${websitePath}/geo`) { await respond(route, await handleWebsiteGeoLoad(incoming, fixture.website.websiteId, { authenticate: auth, readWebsite: fixture.readWebsite, loadKnowledgeBase: fixture.runtime.loadEditor })); return; }
    if (request.method() === "POST" && url.pathname.startsWith("/api/tools/geo-knowledge-base/v2/")) {
      const path = url.pathname.slice("/api/tools/geo-knowledge-base/v2/".length), response = await fixture.dispatch(path, incoming);
      if (dropped === path) { dropped = null; guard.expectedNetworkDrops.push(request.url()); await route.abort("failed"); return; }
      await respond(route, response); return;
    }
    if (id === "POST /api/tools/ai-visibility-check/load") { await respond(route, await handleVisibilityLoad(incoming, visibility)); return; }
    if (id === "POST /api/tools/ai-visibility-check/run") { start = body as typeof start; await respond(route, await handleVisibilityStart(incoming, visibility)); return; }
    if (id === "POST /api/tools/ai-visibility-check/run/status") { await respond(route, await handleVisibilityStatus(incoming, visibility)); return; }
    if (id === "POST /api/tools/geo-brief/load") { const frozen = fixture.currentFrozen; await respond(route, Response.json({ data: { choices: frozen === null ? [] : [{ kbId: frozen.kbId, snapshotId: frozen.snapshotId, revision: frozen.revision, host: "geo-chain.test", frozenAt: frozen.frozenAt, questions: frozen.questionSet.questions }], runsPerDay: 20, providerConfigured: true } })); return; }
    if (id === "POST /api/tools/geo-brief/run") { const response = await runSharedBrief(GEO_V2_USER, body, shared, async () => true, Date.now); const parsed = await response.clone().json() as { data?: { brief: GeoContentBrief } }; brief = parsed.data?.brief ?? null; await respond(route, response); return; }
    if (id === "POST /api/tools/content-draft/run") { await respond(route, await handleContentDraftRunRequest(incoming, draft)); return; }
    guard.unexpected.push(id); await route.abort("blockedbyclient");
  });
  return guard;
}
