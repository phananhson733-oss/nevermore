import { expect, type BrowserContext, type Request as BrowserRequest, type Route } from "@playwright/test";
import { handleWebsiteGeoLoad } from "../src/lib/account-websites/geo-route.ts";
import { handleGeoKbFreeze, handleGeoKbLoad, handleGeoKbSaveDraft } from "../src/lib/geo-tools/kb-handler.ts";
import { handleVisibilityLoad, handleVisibilityStart, handleVisibilityStatus, type VisibilityHandlerDependencies } from "../src/lib/geo-tools/visibility-handler.ts";
import { runSharedBrief } from "../src/lib/geo-tools/brief-shared-handler.ts";
import { handleBriefLoad, type BriefHandlerDependencies } from "../src/lib/geo-tools/brief-handler.ts";
import { projectBriefFrozenChoice } from "../src/lib/geo-tools/brief-load-projection.ts";
import { handleContentDraftRunRequest, type ContentDraftHandlerDependencies } from "../src/lib/tools/content-draft-handler.ts";
import { handleCitabilityRequest, type CitabilityHandlerDependencies } from "../src/lib/geo-tools/citability-handler.ts";
import { normalizeSeoAuditUrl } from "@sf/public-tools";
import { sectionEvidenceFor } from "@sf/public-tools/content-brief/parse-draft";
import { validateSectionOutput } from "@sf/public-tools/content-brief/validate-section";
import { verifyOwnedGeoBrief } from "../src/lib/geo-tools/brief-reference.ts";
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { GEO_CHAIN_NOW, GEO_CHAIN_RUN, GEO_CHAIN_USER, type GeoChainFixture } from "./geo-chain-fixtures.ts";

const SHELL = new Set(["GET /api/auth/profile", "GET /api/auth/one-tap/nonce", "GET /api/credits/balance", "GET /api/credits/ledger"]);
const EXPECTED_BLOCKED_EXTERNAL = new Set(["accounts.google.com", "www.googletagmanager.com", "www.google-analytics.com"]);
function serverRequest(request: BrowserRequest): Request {
  return new Request(request.url(), { method: request.method(), headers: request.headers(),
    ...(request.method() === "GET" ? {} : { body: request.postData() ?? "{}" }) });
}
async function respond(route: Route, response: Response): Promise<void> {
  await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
}

/** TEST-ONLY SSR auth fixture. No server/auth source changes, cookies or sessions.
 * The isolated Next server has no Supabase credentials. Replace exactly the
 * identified client prop, not a global auth string or markup.
 * This is explicitly NOT login E2E; real auth/owner gates have separate tests. */
function injectLocalAuthFixture(html: string, componentName: "AiVisibilityCheck" | "ContentDraftTool" | "GeoKnowledgeBase"): string {
  const scripts = [...html.matchAll(/<script([^>]*)>self\.__next_f\.push\((\[[\s\S]*?)\)<\/script>/g)];
  const decoded = scripts.map(match => {
    try { return { match, value: JSON.parse(match[2]!) as unknown[] }; } catch { throw new Error("Unrecognized local Next Flight envelope"); }
  });
  const stream = decoded.flatMap(item => typeof item.value[1] === "string" ? [item.value[1]] : []).join("");
  const modules = [...stream.matchAll(new RegExp(`(?:^|\\n)([a-z\\d]+):I\\[[^\\n]*,"${componentName}"\\]`, "g"))];
  if (modules.length !== 1) throw new Error(`Expected exactly one ${componentName} Flight module, got ${modules.length}`);
  const moduleId = modules[0]![1]!;
  const escapedId = moduleId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const props = componentName === "AiVisibilityCheck"
    ? '"authentication":"(?:unavailable|unauthenticated)","locale":"(?:en|zh)"'
    : componentName === "GeoKnowledgeBase" ? '"locale":"(?:en|zh)","signedIn":false'
    : '"locale":"(?:en|zh)","authenticated":false';
  const component = new RegExp(`\\["\\$","\\$L${escapedId}",null,\\{${props}\\}\\]`, "g");
  if ([...stream.matchAll(component)].length !== 1) throw new Error(`Expected exactly one signed-out ${componentName} client prop`);
  let changed = 0;
  for (const item of decoded) {
    if (typeof item.value[1] !== "string") continue;
    const next = item.value[1].replace(component, value => {
      changed += 1;
      return componentName === "AiVisibilityCheck"
        ? value.replace(/"authentication":"(?:unavailable|unauthenticated)"/, '"authentication":"authenticated"')
        : componentName === "GeoKnowledgeBase" ? value.replace('"signedIn":false', '"signedIn":true')
        : value.replace('"authenticated":false', '"authenticated":true');
    });
    if (next === item.value[1]) continue;
    const value = [...item.value]; value[1] = next;
    const replacement = `<script${item.match[1]}>self.__next_f.push(${JSON.stringify(value).replaceAll("<", "\\u003c")})</script>`;
    html = html.replace(item.match[0], replacement);
  }
  if (changed !== 1) throw new Error(`${componentName} auth fixture changed ${changed} components`);
  return html;
}
export const injectVisibilityAuthFixture = (html: string): string => injectLocalAuthFixture(html, "AiVisibilityCheck");
export const injectDraftAuthFixture = (html: string): string => injectLocalAuthFixture(html, "ContentDraftTool");
export const injectKnowledgeBaseAuthFixture = (html: string): string => injectLocalAuthFixture(html, "GeoKnowledgeBase");

export interface GeoChainGuard {
  readonly requests: { id: string; body: unknown }[];
  readonly unexpected: string[];
  readonly blockedExternal: string[];
  readonly drafts: GeoContentBrief[];
  readonly briefs: GeoContentBrief[];
  readonly clipboard: string[];
  readonly ssrAuthFixtures: string[];
  readonly authorityChecks: { userId: string; snapshotId: string; accepted: boolean }[];
}

export async function installGeoChainGuard(context: BrowserContext, baseURL: string, fixture: GeoChainFixture): Promise<GeoChainGuard> {
  const origin = new URL(baseURL).origin;
  const guard: GeoChainGuard = { requests: [], unexpected: [], blockedExternal: [], drafts: [], briefs: [], clipboard: [], ssrAuthFixtures: [], authorityChecks: [] };
  await context.exposeBinding("__geoChainClipboard", (_source, text: string) => { guard.clipboard.push(text); });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => {
      await (window as unknown as { __geoChainClipboard(value: string): Promise<void> }).__geoChainClipboard(value);
    } } });
  });
  let lastBrief: GeoContentBrief | null = null;
  let draftCounter = 0;
  let lastStart: { engines: ("chatgpt" | "perplexity")[]; samplesPerQuestion: number } | null = null;
  const visibility: VisibilityHandlerDependencies = {
    authenticate: fixture.auth, providerConfigured: () => true, consumeDailyRun: async () => true, now: Date.now,
    listFrozen: async userId => ({ kind: "ok", value: userId !== GEO_CHAIN_USER || fixture.view().frozen === null ? [] : [{ kbId: fixture.frozen.kbId,
      snapshotId: fixture.frozen.snapshotId, host: fixture.website.host, revision: 1, frozenAt: fixture.frozen.frozenAt,
      questionCount: fixture.frozen.questionCount, retrievalCount: fixture.frozen.questionSet.questions.filter(q => q.mode === "retrieval").length,
      language: "en", marketCode: "US" }] }),
    startRun: async () => { if (!lastStart) throw new Error("Missing client selection"); await fixture.run(lastStart.engines, lastStart.samplesPerQuestion); return { runId: GEO_CHAIN_RUN }; },
    readRun: async runId => runId === GEO_CHAIN_RUN && fixture.report !== null ? { kind: "completed", report: fixture.report } : { kind: "missing" },
  };
  const briefLoad: BriefHandlerDependencies = {
    authenticate: fixture.auth, shared: fixture.shared, providerConfigured: () => true, now: Date.now,
    listFrozen: async userId => ({ kind: "ok", value: userId === GEO_CHAIN_USER && fixture.view().frozen !== null
      ? [projectBriefFrozenChoice(fixture.frozen, fixture.website.host)] : [] }),
    readFrozen: async () => { throw new Error("Brief load must use the exact shared snapshot reader"); },
    consumeDailyRun: async () => { throw new Error("Brief load must not consume a generation allowance"); },
    sample: async () => { throw new Error("Brief load must not sample a provider"); },
    assemble: async () => { throw new Error("Brief load must not assemble a Brief"); },
    reportAssemblyFailure: () => { throw new Error("Brief load must not attempt assembly"); },
  };
  const draft: ContentDraftHandlerDependencies = {
    generateSectionV2: async () => { throw new Error("GEO fixture must not call SEO v2 generation"); },
    runCoverageV2: async () => { throw new Error("GEO fixture must not call SEO v2 coverage"); },
    getServerAuthenticatedUser: async () => ({ status: "authenticated", userId: GEO_CHAIN_USER, email: null, avatarUrl: null }),
    verifyGeoBrief: async (brief, userId) => {
      const accepted = await verifyOwnedGeoBrief(brief, userId, fixture.referenceDependencies);
      guard.authorityChecks.push({ userId, snapshotId: brief.geo_origin.kb_ref.snapshot_id, accepted });
      return accepted;
    },
    readJson: async request => ({ ok: true, value: await request.json() }), extractClientIp: () => "203.0.113.9",
    acquireSlot: () => ({ acquired: true, release: () => undefined }), consumeQuota: async () => ({ kind: "allowed", hits: 1 }),
    generateSection: async input => {
      if (!lastBrief) throw new Error("No authenticated fixture Brief");
      expect(input.pages).toEqual([]); expect(input.facts).toEqual([]);
      expect(JSON.stringify(input.geo?.facts)).not.toContain("Compare the supported team size");
      const fact = input.geo?.facts[0];
      const sentence = fact ? { text: fact.text, claim: "bound" as const, evidence_refs: [fact.id] }
        : { text: "Evidence is needed before adding product facts or comparisons.", claim: "gap" as const, evidence_refs: [] };
      const checked = validateSectionOutput({ paragraphs: [{ sentences: [sentence] }] }, sectionEvidenceFor(lastBrief, input.section.id, input.settings));
      if (!checked.ok) throw new Error(checked.rule);
      return { status: "ok", fail_reason: null, paragraphs: checked.paragraphs, word_count: checked.word_count, attempts: 1,
        model_id: "offline-draft", temperature_requested: 0.4, temperature_effective: null, input_tokens: 0, output_tokens: 0 };
    },
    runCoverage: async input => ({ items: input.questions.map(question => ({ question_id: question.id, status: "covered", covered_in: input.sections[0]!.id, gap: null })),
      reads: { status: "complete", calls: 1, model_id: "offline-coverage", temperature_requested: 0, temperature_effective: null, input_tokens: 0, output_tokens: 0 } }),
    now: Date.now, runId: () => `offline-draft-${++draftCounter}`, emit: () => undefined,
  };
  const citability: CitabilityHandlerDependencies = {
    normalizeUrl: normalizeSeoAuditUrl, extractClientIp: () => "203.0.113.9", isSignedIn: async () => false,
    openGate: async () => ({ ok: true, release: () => undefined }), chargeTarget: async () => ({ ok: true }),
    now: () => new Date(GEO_CHAIN_NOW), renderPage: fixture.renderPage,
    fetchResource: async (url) => {
      const raw = await fixture.fetchResource(url);
      if (raw.kind === "error") return { kind: "error", code: raw.code };
      return { kind: "ok", body: raw.body, status: raw.finalStatus, finalUrl: raw.finalUrl, contentType: raw.contentType, bodyComplete: raw.bodyComplete };
    },
  };
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      guard.blockedExternal.push(request.url());
      if (!EXPECTED_BLOCKED_EXTERNAL.has(url.hostname)) guard.unexpected.push(`external ${request.url()}`);
      await route.abort("blockedbyclient"); return;
    }
    if (!url.pathname.startsWith("/api/")) {
      if (/\/(?:en\/|zh\/)?tools\/geo-knowledge-base$/.test(url.pathname) && request.resourceType() === "document") {
        const response = await route.fetch();
        const html = injectKnowledgeBaseAuthFixture(await response.text());
        guard.ssrAuthFixtures.push(url.pathname);
        await route.fulfill({ response, body: html }); return;
      }
      if (/\/(?:en\/|zh\/)?tools\/ai-visibility-check$/.test(url.pathname) && request.resourceType() === "document") {
        const response = await route.fetch();
        const html = injectVisibilityAuthFixture(await response.text());
        guard.ssrAuthFixtures.push(url.pathname);
        await route.fulfill({ response, body: html }); return;
      }
      if (/\/(?:en\/|zh\/)?tools\/content-draft$/.test(url.pathname) && request.resourceType() === "document") {
        const response = await route.fetch();
        const html = injectDraftAuthFixture(await response.text());
        guard.ssrAuthFixtures.push(url.pathname);
        await route.fulfill({ response, body: html }); return;
      }
      await route.continue(); return;
    }
    const id = `${request.method()} ${url.pathname}`;
    const body: unknown = request.method() === "GET" ? null : request.postDataJSON();
    guard.requests.push({ id, body });
    const incoming = serverRequest(request);
    if (id === "GET /api/auth/session") { await respond(route, Response.json({ signedIn: true })); return; }
    // The visible Necessary Only action may persist a local browser preference,
    // but this fixture never records consent in a remote account/store.
    if (id === "POST /api/consent") { await respond(route, Response.json({ data: { recorded: false, reason: "persistence_not_configured" } }, { status: 202 })); return; }
    if (id === "GET /api/account/websites") { await respond(route, Response.json({ data: { websites: [fixture.website] } })); return; }
    if (id === `GET /api/account/websites/${fixture.website.websiteId}`) { await respond(route, Response.json({ data: { website: fixture.website } })); return; }
    if (id === `POST /api/account/websites/${fixture.website.websiteId}/geo`) {
      await respond(route, await handleWebsiteGeoLoad(incoming, fixture.website.websiteId, { authenticate: fixture.auth,
        readWebsite: async (userId, websiteId) => userId === GEO_CHAIN_USER && websiteId === fixture.website.websiteId ? { kind: "ok", value: fixture.website } : { kind: "missing" }, loadKnowledgeBase: fixture.kbDependencies.loadKnowledgeBase })); return;
    }
    if (id === "POST /api/tools/geo-knowledge-base/load") { await respond(route, await handleGeoKbLoad(incoming, fixture.kbDependencies)); return; }
    if (id === "POST /api/tools/geo-knowledge-base/draft") { await respond(route, await handleGeoKbSaveDraft(incoming, fixture.kbDependencies)); return; }
    if (id === "POST /api/tools/geo-knowledge-base/freeze") { await respond(route, await handleGeoKbFreeze(incoming, fixture.kbDependencies)); return; }
    if (id === "POST /api/tools/geo-knowledge-base/load") { await respond(route, await handleGeoKbLoad(incoming, fixture.kbDependencies)); return; }
    if (id === "POST /api/tools/geo-knowledge-base/draft") { await respond(route, await handleGeoKbSaveDraft(incoming, fixture.kbDependencies)); return; }
    if (id === "POST /api/tools/ai-visibility-check/load") { await respond(route, await handleVisibilityLoad(incoming, visibility)); return; }
    if (id === "POST /api/tools/ai-visibility-check/run") { lastStart = body as typeof lastStart; await respond(route, await handleVisibilityStart(incoming, visibility)); return; }
    if (id === "POST /api/tools/ai-visibility-check/run/status") { await respond(route, await handleVisibilityStatus(incoming, visibility)); return; }
    if (id === "POST /api/tools/geo-brief/load") { await respond(route, await handleBriefLoad(incoming, briefLoad)); return; }
    if (id === "POST /api/tools/geo-brief/run") {
      const response = await runSharedBrief(GEO_CHAIN_USER, body, fixture.shared, async () => true, Date.now);
      const parsed = await response.clone().json() as { data?: { brief: GeoContentBrief } };
      lastBrief = parsed.data?.brief ?? null;
      if (lastBrief) guard.briefs.push(lastBrief);
      await respond(route, response); return;
    }
    if (id === "POST /api/tools/content-draft/run") {
      lastBrief = (body as { brief: GeoContentBrief }).brief;
      guard.drafts.push(lastBrief);
      // The actual handler must verify ownership before the offline generator
      // reads this submitted Brief, including historical JSON imports.
      await respond(route, await handleContentDraftRunRequest(incoming, draft)); return;
    }
    if (id === "POST /api/tools/page-citability-check") { await respond(route, await handleCitabilityRequest(incoming, citability)); return; }
    if (!SHELL.has(id)) guard.unexpected.push(id);
    await route.abort("blockedbyclient");
  });
  return guard;
}
