import { type BrowserContext, type Request as BrowserRequest, type Route } from "@playwright/test";
import { handleVisibilityContext } from "../src/lib/geo-tools/visibility-context-handler.ts";
import { listVisibilityHistory, readVisibilityHistory } from "../src/lib/geo-tools/visibility-history.ts";
import { handleVisibilityLoad, handleVisibilityStart, handleVisibilityStatus, type VisibilityHandlerDependencies } from "../src/lib/geo-tools/visibility-handler.ts";
import { GEO_CHAIN_RUN, GEO_CHAIN_USER } from "./geo-chain-fixtures.ts";
import { injectVisibilityAuthFixture } from "./geo-chain-harness.ts";
import { visibilityHistoryRow, type VisibilityArtifactFixture } from "./ai-visibility-artifact-fixtures.ts";

const SHELL = new Set(["GET /api/auth/profile", "GET /api/auth/one-tap/nonce", "GET /api/credits/balance", "GET /api/credits/ledger"]);
const EXPECTED_EXTERNAL = new Set(["accounts.google.com", "www.googletagmanager.com", "www.google-analytics.com"]);
export interface VisibilityArtifactGuard {
  requests: { id: string; body: unknown; query: string }[];
  unexpected: string[];
  blockedExternal: string[];
  authFixturePages: string[];
  localeErrors: string[];
  starts: number;
  quotaCalls: number;
}
function incoming(request: BrowserRequest): Request {
  return new Request(request.url(), { method: request.method(), headers: request.headers(),
    ...(request.method() === "GET" ? {} : { body: request.postData() ?? "{}" }) });
}
async function respond(route: Route, response: Response): Promise<void> {
  await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
}
export async function installVisibilityArtifactGuard(context: BrowserContext, baseURL: string, fixture: VisibilityArtifactFixture) {
  const origin = new URL(baseURL).origin;
  const guard: VisibilityArtifactGuard = { requests: [], unexpected: [], blockedExternal: [], authFixturePages: [], localeErrors: [], starts: 0, quotaCalls: 0 };
  const observeConsole = (page: import("@playwright/test").Page) => page.on("console", message => {
    if (/MISSING_MESSAGE|FORMATTING_ERROR|INVALID_MESSAGE/u.test(message.text())) {
      const error = message.text().split("\n")[0]!;
      if (!guard.localeErrors.includes(error)) guard.localeErrors.push(error);
    }
  });
  context.pages().forEach(observeConsole); context.on("page", observeConsole);
  let selected: { engines: ("chatgpt" | "perplexity")[]; samplesPerQuestion: number } | null = null;
  const visibility: VisibilityHandlerDependencies = {
    authenticate: fixture.chain.auth, providerConfigured: () => true, now: Date.now,
    consumeDailyRun: async () => { guard.quotaCalls += 1; return true; },
    listFrozen: async userId => ({ kind: "ok", value: userId !== GEO_CHAIN_USER ? [] : [{
      kbId: fixture.chain.frozen.kbId, snapshotId: fixture.chain.frozen.snapshotId, host: fixture.chain.website.host,
      revision: fixture.chain.frozen.revision, frozenAt: fixture.chain.frozen.frozenAt,
      questionCount: fixture.chain.frozen.questionCount,
      retrievalCount: fixture.chain.frozen.questionSet.questions.filter(question => question.mode === "retrieval").length,
      language: "en", marketCode: "US" }] }),
    startRun: async () => {
      if (!selected) throw new Error("No explicit local selection");
      guard.starts += 1;
      await fixture.chain.run(selected.engines, selected.samplesPerQuestion);
      return { runId: GEO_CHAIN_RUN };
    },
    readRun: async runId => runId === GEO_CHAIN_RUN && fixture.chain.report
      ? { kind: "completed", report: fixture.chain.report } : { kind: "missing" },
  };
  const history = { ...fixture.historyDependencies,
    listRuns: async (selector: Parameters<typeof fixture.historyDependencies.listRuns>[0]) => {
      const result = await fixture.historyDependencies.listRuns(selector);
      return guard.starts > 0 && selector.version === "v2" && result.kind === "ok" && Array.isArray(result.data)
        ? { kind: "ok" as const, data: [visibilityHistoryRow(fixture.chain.report!), ...result.data] } : result;
    },
    readRun: async (selector: Parameters<typeof fixture.historyDependencies.readRun>[0]) => guard.starts > 0 && selector.runId === GEO_CHAIN_RUN && selector.version === "v2"
      ? { kind: "ok" as const, data: visibilityHistoryRow(fixture.chain.report!) } : fixture.historyDependencies.readRun(selector),
  };
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) {
      guard.blockedExternal.push(request.url());
      if (!EXPECTED_EXTERNAL.has(url.hostname)) guard.unexpected.push(`external ${request.url()}`);
      await route.abort("blockedbyclient"); return;
    }
    if (!url.pathname.startsWith("/api/")) {
      if (/\/(?:en\/|zh\/)?tools\/ai-visibility-check$/.test(url.pathname) && request.resourceType() === "document") {
        const response = await route.fetch();
        guard.authFixturePages.push(url.pathname + url.search);
        await route.fulfill({ response, body: injectVisibilityAuthFixture(await response.text()) }); return;
      }
      await route.continue(); return;
    }
    const id = `${request.method()} ${url.pathname}`;
    const body: unknown = request.method() === "GET" ? null : request.postDataJSON();
    guard.requests.push({ id, body, query: url.search });
    if (id === "GET /api/auth/session") { await respond(route, Response.json({ signedIn: true })); return; }
    if (id === "POST /api/consent") {
      const categories = (body as { categories: unknown }).categories;
      if (JSON.stringify(categories) !== JSON.stringify([{ category: "necessary", status: "accepted" }, { category: "analytics", status: "rejected" }, { category: "marketing", status: "rejected" }])) throw new Error("Screenshot consent must only accept necessary cookies");
      await respond(route, Response.json({ data: { recorded: false, reason: "consent_store_unavailable" } }, { status: 202 })); return;
    }
    if (id === "GET /api/tools/ai-visibility-check/context") { await respond(route, await handleVisibilityContext(incoming(request), fixture.contextDependencies)); return; }
    if (id === "POST /api/tools/ai-visibility-check/load") { await respond(route, await handleVisibilityLoad(incoming(request), visibility)); return; }
    if (id === "POST /api/tools/ai-visibility-check/history") {
      if (JSON.stringify(body) !== "{}") throw new Error("History list must not submit source data");
      const result = await listVisibilityHistory({ userId: GEO_CHAIN_USER }, history);
      await respond(route, result.kind === "ok" ? Response.json({ data: result.value }) : Response.json({ error: { code: "store_unavailable" } }, { status: 503 })); return;
    }
    if (id === "POST /api/tools/ai-visibility-check/history/read") {
      const { runId, ...extra } = body as { runId: string };
      if (typeof runId !== "string" || Object.keys(extra).length) throw new Error("History read may only submit a run identity");
      const result = await readVisibilityHistory({ userId: GEO_CHAIN_USER, runId }, history);
      await respond(route, result.kind === "ok" ? Response.json({ data: result.value }) : Response.json({ error: { code: result.kind === "missing" ? "not_found" : "store_unavailable" } }, { status: result.kind === "missing" ? 404 : 503 })); return;
    }
    if (id === "POST /api/tools/ai-visibility-check/run") { selected = body as typeof selected; await respond(route, await handleVisibilityStart(incoming(request), visibility)); return; }
    if (id === "POST /api/tools/ai-visibility-check/run/status") { await respond(route, await handleVisibilityStatus(incoming(request), visibility)); return; }
    if (!SHELL.has(id)) guard.unexpected.push(id);
    await route.abort("blockedbyclient");
  });
  return guard;
}
