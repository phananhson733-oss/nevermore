// @vitest-environment jsdom
// @input  -- the three visibility endpoints, answered by the real handler, and the real EN catalog
// @output -- proof the form reads what the handler sends, that a queued run is not declared dead,
//            and that an insufficient run prints no verdict and no "0 of 0"
// @pos    -- the seam between apps/marketing's visibility handler and its only client surface

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import enMessages from "../../i18n/messages/en.json";
import {
  handleVisibilityLoad,
  handleVisibilityStart,
  handleVisibilityStatus,
  type VisibilityFrozenChoice,
  type VisibilityHandlerDependencies,
  type VisibilityRunRead,
} from "../../lib/geo-tools/visibility-handler.ts";
import {
  GEO_VISIBILITY_SCHEMA_VERSION,
  VISIBILITY_LIMITS,
  VISIBILITY_RUN_LIMITS,
  type VisibilityProportion,
  type VisibilityReport,
} from "../../lib/geo-tools/visibility-contract.ts";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { VISIBILITY_CONTEXT_SCHEMA, type VisibilityContext } from "../../lib/geo-tools/visibility-context.ts";
import { encodeVisibilityWire } from "../../lib/geo-tools/visibility-wire.ts";
import { AiVisibilityCheck } from "./ai-visibility-check.tsx";
import { visibilityReportFixtureV2 } from "../../lib/geo-tools/visibility-v2.test-fixtures.ts";
import { exportVisibilityJson, parseVisibilityImport } from "../../lib/geo-tools/visibility-export.ts";
import {
  VISIBILITY_RUN_STORAGE_KEY,
  type VisibilityRunPointer,
} from "./ai-visibility-run-pointer.ts";

/**
 * The sealing key this suite runs under.
 *
 * Set here rather than assumed, exactly as `visibility-handler.test.ts` does:
 * the run pointer is a sealed value, and a suite that leaned on the
 * deployment's key would pass on one machine and fail on another.
 */
const PREVIOUS_KEY = process.env["TOKEN_ENCRYPTION_KEY"];

beforeAll(() => {
  process.env["TOKEN_ENCRYPTION_KEY"] = Buffer.alloc(32, 7).toString("hex");
});

afterAll(() => {
  if (PREVIOUS_KEY === undefined) delete process.env["TOKEN_ENCRYPTION_KEY"];
  else process.env["TOKEN_ENCRYPTION_KEY"] = PREVIOUS_KEY;
});

const CHOICE: VisibilityFrozenChoice = {
  kbId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  host: "acme-visibility.test",
  snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
  revision: 2,
  frozenAt: "2026-08-29T09:00:00.000Z",
  questionCount: 15,
  retrievalCount: 13,
};

function proportion(successes: number, trials: number): VisibilityProportion {
  return trials === 0
    ? { successes: 0, trials: 0, point: null, lo: null, hi: null }
    : { successes, trials, point: successes / trials, lo: 0.1, hi: 0.6 };
}

/**
 * One report, shaped by the contract rather than by what the page happens to
 * read: `satisfies` here is what turns a contract change into a failing
 * compile instead of a fixture that quietly stops resembling a run.
 */
function report(
  overrides: {
    readonly status?: VisibilityReport["manifest"]["status"];
    readonly answered?: number;
    readonly comparison?: VisibilityReport["comparison"];
    readonly citationUnknown?: number;
    readonly prompted?: boolean;
    readonly limits?: readonly string[];
  } = {},
): VisibilityReport {
  const answered = overrides.answered ?? 4;
  return {
    manifest: {
      schemaVersion: "marketing-geo-visibility.v1",
      kbId: CHOICE.kbId,
      snapshotId: CHOICE.snapshotId,
      snapshotRevision: CHOICE.revision,
      questionSetHash: "hash-1",
      questionCount: 1,
      samplesPerQuestion: 5,
      marketCode: "us",
      model: "gpt-5-test",
      surface: "dataforseo-chatgpt",
      startedAt: "2026-08-29T10:00:00.000Z",
      finishedAt: "2026-08-29T10:15:00.000Z",
      calls: 5,
      answered,
      successRatio: answered / 5,
      costUsd: 3.4275,
      status: overrides.status ?? "ok",
    },
    metrics: {
      unpromptedMention: proportion(1, answered),
      promptedMention: proportion(1, answered),
      citation: proportion(0, answered),
      questionsMentioned: proportion(1, answered === 0 ? 0 : 1),
      questionsCited: proportion(0, answered === 0 ? 0 : 1),
      questionsAsked: 1,
      questionsAnswered: answered === 0 ? 0 : 1,
      byLayer: [
        {
          layer: "comparison",
          mention: proportion(1, answered),
          citation: proportion(0, answered),
        },
      ],
    },
    questions: [
      {
        questionId: "q-1",
        text: "Which tools compare acme to its rivals?",
        layer: "comparison",
        mode: "retrieval",
        prompted: overrides.prompted ?? false,
        calibrated: true,
        samples: [
          {
            questionId: "q-1",
            sampleIndex: 0,
            status: answered === 0 ? "timeout" : "ok",
            webSearchPerformed: answered === 0 ? null : true,
            mentioned: false,
            cited: answered === 0 ? null : false,
            citedDomains: [],
            citedUrls: [],
            competitorsMentioned: [],
            excerpt: null,
            costUsd: 0.0457,
            observedAt: "2026-08-29T10:05:00.000Z",
          },
        ],
        answered,
        mentioned: answered === 0 ? 0 : 1,
        citationEvaluable: answered,
        cited: 0,
        citationUnknown: overrides.citationUnknown ?? 0,
      },
    ],
    citedDomains: [],
    limits: overrides.limits ?? ["oneSurface"],
    comparison: overrides.comparison ?? null,
  } satisfies VisibilityReport;
}

/* ------------------------------------------------------------------ */
/* The endpoints, answered by the handler the routes actually mount    */
/* ------------------------------------------------------------------ */

interface Server {
  readonly readRun: () => VisibilityRunRead;
  readonly context?: VisibilityContext;
  readonly historyRun?: ReturnType<typeof visibilityReportFixtureV2>;
  readonly providerConfigured?: boolean;
  readonly choices?: readonly VisibilityFrozenChoice[];
}

let server: Server = { readRun: () => ({ kind: "running" }) };
let statusCalls = 0;

function dependencies(): VisibilityHandlerDependencies {
  return {
    authenticate: async () => ({ ok: true, userId: "user-1" }),
    listFrozen: async () => ({
      kind: "ok",
      value: server.choices ?? [CHOICE],
    }),
    consumeDailyRun: async () => true,
    providerConfigured: () => server.providerConfigured !== false,
    startRun: async () => ({ runId: "run-1" }),
    readRun: async () => server.readRun(),
    now: () => Date.now(),
  };
}

/**
 * Rebuild the browser's fetch as the route would receive it.
 *
 * The point of routing through the real handlers is that no field name in this
 * file is written twice. A page that reads `data.versions` while the handler
 * writes `data.choices` typechecks, renders, and is completely broken; only a
 * test that takes the handler's own bytes can see it.
 */

const WEBSITE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3391";
function contextFixture(): VisibilityContext {
  const choices = server.choices ?? [CHOICE];
  const first = choices[0];
  const website = { websiteId: WEBSITE_ID, origin: `https://${CHOICE.host}`, host: CHOICE.host, canonicalSiteKey: CHOICE.host, displayName: "Acme", isPrimary: true, profileState: "not_generated" as const, confirmedSnapshotId: null, confirmedSnapshotRevision: null, confirmedAt: null, createdAt: "2026-08-29T09:00:00.000Z", updatedAt: "2026-08-29T09:00:00.000Z" };
  return { schemaVersion: VISIBILITY_CONTEXT_SCHEMA, websites: [{ website, currentProfile: null, knowledgeBase: first ? { kbId: first.kbId, draftVersion: 1, hasDraft: true } : null, frozen: first ? { snapshotId: first.snapshotId, revision: first.revision, frozenAt: first.frozenAt, contentHash: "a".repeat(64), questionSetHash: "b".repeat(64), registryVersion: "v1", questionCount: first.questionCount, retrievalCount: first.retrievalCount, payload: { ...emptyGeoKbPayload(website.origin), officialName: "Acme", categoryTerms: ["analytics"] }, questions: Array.from({ length: first.questionCount }, (_, i) => ({ id: `q${i}`, text: `Which analytics tool ${i}?`, layer: "discovery" as const, mode: i < first.retrievalCount ? "retrieval" as const : "demand" as const, calibrated: i < first.retrievalCount, roleId: null, templateId: null, requiredEntities: [] })), profileReference: null, profileCompleteness: "legacy_partial", skippedLayers: [] } : null, preparation: { status: first ? "profile_update_available" : "profile_required", profileSync: "legacy_partial", languageWarnings: [] } }, { website: { ...website, websiteId: "3f2504e0-4f89-41d3-9a0c-0305e82c3392", origin: "https://second.example", host: "second.example", canonicalSiteKey: "second.example", displayName: "Second", isPrimary: false }, currentProfile: null, knowledgeBase: null, frozen: null, preparation: { status: "profile_required", profileSync: "missing", languageWarnings: [] } }] };
}

function installFetch(): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/context")) return Response.json(server.context ?? contextFixture());
      if (url.endsWith("/history")) return Response.json({ data: { runs: [], hasMore: false } });
      if (url.endsWith("/history/read")) return server.historyRun ? Response.json({ data: { status: "completed", evidenceAvailability: "recorded", report: encodeVisibilityWire(server.historyRun) } }) : Response.json({ error: { code: "not_found" } }, { status: 404 });
      const request = new Request(`https://gengrowth.ai${url}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://gengrowth.ai",
          "sec-fetch-site": "same-origin",
        },
        body: typeof init?.body === "string" ? init.body : "{}",
      });
      if (url.endsWith("/load")) {
        return handleVisibilityLoad(request, dependencies());
      }
      if (url.endsWith("/run/status")) {
        statusCalls += 1;
        return handleVisibilityStatus(request, dependencies());
      }
      return handleVisibilityStart(request, dependencies());
    },
  ) as unknown as typeof fetch;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const originalFetch = globalThis.fetch;
let root: Root | null = null;
let container: HTMLElement | null = null;
let intlErrors: string[] = [];

function text(): string {
  return container?.textContent ?? "";
}

function copy(path: string): string {
  const parts = path.split(".");
  let node: unknown = enMessages.tools.aiVisibility;
  for (const part of parts) {
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") throw new Error(`no message at ${path}`);
  return node;
}

/**
 * The longest run of literal words in a message.
 *
 * Not "the text up to the first placeholder": several of these messages open
 * with one, and an empty needle makes `not.toContain` pass against anything.
 */
function literal(path: string): string {
  const longest = copy(path)
    .split(/\{[^}]*\}/u)
    .map((part) => part.trim())
    .sort((a, b) => b.length - a.length)[0];
  if (longest === undefined || longest.length < 6) {
    throw new Error(`no usable literal in ${path}`);
  }
  return longest;
}

async function mount(
  authentication: "authenticated" | "unauthenticated" = "authenticated",
): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <NextIntlClientProvider
        locale="en"
        messages={{ tools: { aiVisibility: enMessages.tools.aiVisibility } }}
        onError={(error) => {
          intlErrors.push(error.message);
        }}
        timeZone="UTC"
      >
        <AiVisibilityCheck authentication={authentication} locale="en" />
      </NextIntlClientProvider>,
    );
  });
}

/** Advance the fake clock the way an idle browser would, flushing each await. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function startRun(): Promise<void> {
  const button = [...(container?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent === copy("form.start"),
  );
  if (button === undefined) throw new Error("no start button rendered");
  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  intlErrors = [];
  statusCalls = 0;
  server = { readRun: () => ({ kind: "running" }) };
  installFetch();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

/* ------------------------------------------------------------------ */

describe("loading the frozen versions", () => {
  it("lists every account website and keeps an unprepared site selectable without spending", async () => {
    await mount();
    const siteSelect = container?.querySelector<HTMLSelectElement>("#visibility-website");
    expect(siteSelect?.options).toHaveLength(2);
    expect(siteSelect?.textContent).toContain("second.example");
    await act(async () => { if (siteSelect) { siteSelect.value = "3f2504e0-4f89-41d3-9a0c-0305e82c3392"; siteSelect.dispatchEvent(new Event("change", { bubbles: true })); } });
    expect(container?.querySelector<HTMLSelectElement>("#visibility-version")?.value ?? "").toBe("");
    const start = [...container!.querySelectorAll("button")].find(button => button.textContent === copy("form.start"));
    expect(start?.disabled).toBe(true);
    expect(container?.querySelector('a[href="/account/websites/3f2504e0-4f89-41d3-9a0c-0305e82c3392/geo"]')).not.toBeNull();
  });
  it("blocks a paid run for frozen English questions with non-English terms", async () => {
    const context = contextFixture();
    server = { ...server, context: { ...context, websites: context.websites.map((site, i) => i === 0 ? { ...site, preparation: { ...site.preparation, languageWarnings: ["category_terms_not_english"] } } : site) } };
    await mount();
    const start = [...container!.querySelectorAll("button")].find(button => button.textContent === copy("form.start"));
    expect(start?.disabled).toBe(true);
  });
  it("restores an owned report from its URL without starting a provider call", async () => {
    const value = visibilityReportFixtureV2();
    server = { ...server, historyRun: value };
    window.history.replaceState(null, "", `/?run=${value.manifest.runId}`);
    await mount();
    expect(container?.querySelector('[role="tab"][data-view="result"]')?.getAttribute("aria-selected")).toBe("true");
    const starts = vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/tools/ai-visibility-check/run");
    expect(starts).toHaveLength(0);
  });
  it("shows an explicit error for an unauthorized report URL", async () => {
    window.history.replaceState(null, "", "/?run=deleted-or-foreign");
    await mount();
    expect(container?.querySelector('[data-testid="visibility-history-error"]')).not.toBeNull();
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/tools/ai-visibility-check/run")).toHaveLength(0);
  });

  it("keeps keyboard focus on the selected result tab", async () => {
    server = { readRun: () => ({ kind: "completed", report: report() }) };
    await mount(); await startRun(); await tick(2_000);
    const input = container!.querySelector<HTMLButtonElement>('[data-view="input"]')!;
    await act(async () => input.click()); input.focus();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const result = container!.querySelector<HTMLButtonElement>('[data-view="result"]')!;
    expect(result.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(result);
  });
  it("keeps report identity independent when choosing a different website for the next check", async () => {
    const value = visibilityReportFixtureV2();
    server = { ...server, readRun: () => ({ kind: "completed", report: value }) };
    await mount(); await startRun(); await tick(2_000);
    const input = container!.querySelector<HTMLButtonElement>('[data-view="input"]')!;
    await act(async () => input.click());
    const site = container!.querySelector<HTMLSelectElement>("#visibility-website")!;
    await act(async () => { site.value = "3f2504e0-4f89-41d3-9a0c-0305e82c3392"; site.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => container!.querySelector<HTMLButtonElement>('[data-view="result"]')?.click());
    expect(container!.querySelector('[data-visibility-report] header')?.textContent).toContain("acme.test");
    expect(container!.querySelector('[data-visibility-report] header')?.textContent).not.toContain("second.example");
  });
  it("refreshes source readiness when returning to the tab without starting a check", async () => {
    await mount();
    const context = contextFixture();
    server = { ...server, context: { ...context, websites: context.websites.map((site, i) => i === 0 ? { ...site, preparation: { ...site.preparation, languageWarnings: ["category_terms_not_english"] } } : site) } };
    await act(async () => window.dispatchEvent(new Event("focus")));
    const start = [...container!.querySelectorAll("button")].find(button => button.textContent === copy("form.start"));
    expect(start?.disabled).toBe(true);
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/tools/ai-visibility-check/context")).toHaveLength(2);
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/tools/ai-visibility-check/run")).toHaveLength(0);
  });
  it("rejects a successful history response for a different run identity", async () => {
    server = { ...server, historyRun: visibilityReportFixtureV2() };
    window.history.replaceState(null, "", "/?run=11111111-1111-4111-8111-111111111199");
    await mount();
    expect(container?.querySelector('[data-testid="visibility-history-error"]')).not.toBeNull();
    expect(container?.querySelector('[data-visibility-report]')).toBeNull();
  });
  it("does not attach a frozen source whose question hash differs from the report", async () => {
    server = { readRun: () => ({ kind: "completed", report: report() }) };
    await mount(); await startRun(); await tick(2_000);
    expect(container?.querySelector('#visibility-result-panel [data-testid="visibility-source"]')).toBeNull();
    expect(text()).toContain(copy("workbench.historicalSourceUnavailable"));
  });
  it.each([503, 404])("disables a cached historical input while its refresh is pending and after HTTP %i", async status => {
    const oldContext = contextFixture();
    const latestChoice = { ...CHOICE, snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3393", revision: 3 };
    const latestContext = { ...oldContext, websites: oldContext.websites.map((site, i) => i === 0 ? { ...site, frozen: { ...site.frozen!, snapshotId: latestChoice.snapshotId, revision: 3 } } : site) };
    server = { ...server, choices: [CHOICE, latestChoice], context: latestContext };
    const route = globalThis.fetch;
    let refreshExact = false;
    let completeExact!: (value: Response) => void;
    globalThis.fetch = vi.fn((input, init) => String(input).includes("/context?") ? refreshExact ? new Promise<Response>(resolve => { completeExact = resolve; }) : Promise.resolve(Response.json(oldContext)) : route(input, init)) as typeof fetch;
    await mount();
    const start = () => [...container!.querySelectorAll("button")].find(button => button.textContent === copy("form.start"));
    expect(start()?.disabled).toBe(false);
    refreshExact = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(start()?.disabled).toBe(true);
    await act(async () => completeExact(Response.json({ error: { code: "not_found" } }, { status })));
    expect(start()?.disabled).toBe(true);
    expect(container?.querySelector('[data-testid="visibility-input-panel"] [data-testid="visibility-source"]')).toBeNull();
    expect(text()).toContain(copy("workbench.sourceUnavailable"));
  });
  it("keeps refreshing until the newest overlapping source request finishes", async () => {
    await mount();
    const route = globalThis.fetch;
    const requests: Array<(value: Response) => void> = [];
    globalThis.fetch = vi.fn((input, init) => String(input) === "/api/tools/ai-visibility-check/context" ? new Promise<Response>(resolve => requests.push(resolve)) : route(input, init)) as typeof fetch;
    await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(requests).toHaveLength(2);
    await act(async () => requests[0]?.(Response.json(contextFixture())));
    const start = () => [...container!.querySelectorAll("button")].find(button => button.textContent === copy("form.start"));
    expect(start()?.disabled).toBe(true);
    await act(async () => requests[1]?.(Response.json(contextFixture())));
    expect(start()?.disabled).toBe(false);
  });
  it("ignores an older source response arriving after newer readiness warnings", async () => {
    await mount();
    const route = globalThis.fetch;
    const requests: Array<(value: Response) => void> = [];
    globalThis.fetch = vi.fn((input, init) => String(input) === "/api/tools/ai-visibility-check/context" ? new Promise<Response>(resolve => requests.push(resolve)) : route(input, init)) as typeof fetch;
    await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    const valid = contextFixture();
    const warned = { ...valid, websites: valid.websites.map((site, i) => i === 0 ? { ...site, preparation: { ...site.preparation, languageWarnings: ["category_terms_not_english"] } } : site) };
    await act(async () => requests[1]?.(Response.json(warned)));
    await act(async () => requests[0]?.(Response.json(valid)));
    const start = [...container!.querySelectorAll("button")].find(button => button.textContent === copy("form.start"));
    expect(start?.disabled).toBe(true);
    expect(text()).toContain(copy("source.warnings.category_terms_not_english"));
  });
  it("follows history URL changes and clears the selected report when the URL removes it", async () => {
    const first = visibilityReportFixtureV2();
    server = { ...server, historyRun: first };
    window.history.replaceState(null, "", `/?run=${first.manifest.runId}`);
    await mount();
    const next = visibilityReportFixtureV2({ runId: "11111111-1111-4111-8111-111111111119", finishedAt: "2026-08-31T00:03:00.000Z" });
    server = { ...server, historyRun: next };
    await act(async () => { window.history.pushState(null, "", `/?run=${next.manifest.runId}`); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(container?.querySelector('[data-section="metadata"]')?.textContent).toContain(next.manifest.runId);
    expect(container?.querySelector('[data-section="metadata"]')?.textContent).not.toContain(first.manifest.runId);
    await act(async () => { window.history.pushState(null, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(container?.querySelector('[data-visibility-report]')).toBeNull();
    expect(container?.querySelector('[data-testid="visibility-input-panel"]')).not.toBeNull();
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/tools/ai-visibility-check/run")).toHaveLength(0);
  });
  it("keeps the paid run's input version and estimate pinned when a newer freeze appears", async () => {
    await mount(); await startRun();
    const before = container!.querySelector<HTMLSelectElement>("#visibility-version")!.value;
    const current = contextFixture();
    const next = { ...CHOICE, snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3393", revision: 3, questionCount: 20 };
    server = { ...server, choices: [next], context: { ...current, websites: current.websites.map((site, i) => i === 0 ? { ...site, frozen: { ...site.frozen!, snapshotId: next.snapshotId, revision: next.revision, questionCount: 20, questions: Array.from({ length: 20 }, (_, index) => ({ ...site.frozen!.questions[0]!, id: `q${index}`, mode: index < CHOICE.retrievalCount ? "retrieval" : "demand" })) } } : site) } };
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container!.querySelector<HTMLSelectElement>("#visibility-version")!.value).toBe(before);
    expect(container!.querySelector('[data-testid="visibility-input-panel"]')?.textContent).toContain("15 questions, 13 with measured search wording");
    expect(text()).toContain("about $3.43 and roughly");
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/tools/ai-visibility-check/run")).toHaveLength(1);
  });
  it.each(["ready", "pending"])("publishes the completed live run after %s history navigation without a late overwrite", async mode => {
    const live = visibilityReportFixtureV2();
    const older = visibilityReportFixtureV2({ runId: "11111111-1111-4111-8111-111111111119" });
    server = { ...server, readRun: () => ({ kind: "completed", report: live }), historyRun: older };
    let finishHistory!: (value: Response) => void;
    const route = globalThis.fetch;
    if (mode === "pending") globalThis.fetch = vi.fn((input, init) => String(input).endsWith("/history/read") ? new Promise<Response>(resolve => { finishHistory = resolve; }) : route(input, init)) as typeof fetch;
    await mount(); await startRun();
    await act(async () => { window.history.pushState(null, "", `/?run=${older.manifest.runId}`); window.dispatchEvent(new PopStateEvent("popstate")); });
    await tick(2_000);
    expect(new URL(window.location.href).searchParams.get("run")).toBe(live.manifest.runId);
    expect(container?.querySelector('[data-section="metadata"]')?.textContent).toContain(live.manifest.runId);
    if (mode === "pending") await act(async () => finishHistory(Response.json({ data: { status: "completed", evidenceAvailability: "recorded", report: encodeVisibilityWire(older) } })));
    expect(container?.querySelector('[data-section="metadata"]')?.textContent).toContain(live.manifest.runId);
    expect(container?.querySelector('[data-section="metadata"]')?.textContent).not.toContain(older.manifest.runId);
    expect(new URL(window.location.href).searchParams.get("run")).toBe(live.manifest.runId);
  });
  it("shows an honest recovered-running state without guessing the paid inputs", async () => {
    await mount(); await startRun();
    await act(async () => root?.unmount()); root = null; container?.remove();
    await mount();
    expect(container?.querySelector('[data-testid="visibility-input-panel"]')).toBeNull();
    expect(container?.querySelector("#visibility-website, #visibility-samples, input[value='chatgpt']")).toBeNull();
    expect(container?.querySelector('[data-testid="visibility-recovered-running"]')).not.toBeNull();
    expect(text()).not.toContain("about $3.43 and roughly");
    expect(text()).not.toContain(CHOICE.host);
    expect(text()).toContain(copy("running.recoveredBody"));
  });
  it("keeps saved reports and local imports available when the current source store fails", async () => {
    const value = visibilityReportFixtureV2();
    server = { ...server, historyRun: value };
    const entry = { runId: value.manifest.runId, schemaVersion: value.manifest.schemaVersion, kbId: value.manifest.kbId, snapshotId: value.manifest.snapshotId, snapshotRevision: value.manifest.snapshotRevision, host: value.context.targetHost, finishedAt: value.manifest.finishedAt, createdAt: value.manifest.finishedAt, status: value.manifest.status, questionCount: value.manifest.questionCount, samplesPerQuestion: value.manifest.samplesPerQuestion, engines: ["chatgpt"], costUsd: value.manifest.costUsd, evidenceAvailability: "recorded" };
    const route = globalThis.fetch;
    globalThis.fetch = vi.fn((input, init) => String(input) === "/api/tools/ai-visibility-check/context" ? Promise.resolve(Response.json({ error: { code: "store_unavailable" } }, { status: 503 })) : String(input).endsWith("/history") ? Promise.resolve(Response.json({ data: { runs: [entry], hasMore: false } })) : route(input, init)) as typeof fetch;
    await mount();
    expect(container?.querySelector('[data-testid="visibility-history"]')).not.toBeNull();
    expect(container?.querySelectorAll('input[type="file"]')).toHaveLength(2);
    expect(container?.querySelector('[data-testid="visibility-input-panel"]')).toBeNull();
    const open = container!.querySelector<HTMLButtonElement>(`[data-run-id="${value.manifest.runId}"]`)!;
    expect(open.disabled).toBe(false);
    await act(async () => open.click());
    expect(container?.querySelector('[data-section="metadata"]')?.textContent).toContain(value.manifest.runId);
    expect(text()).toContain(copy("workbench.historicalSourceUnavailable"));
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/tools/ai-visibility-check/run")).toHaveLength(0);
  });
  it("distinguishes an accepted running job from starting", async () => {
    await mount();
    await startRun();
    expect(text()).not.toContain(copy("form.starting"));
    expect(text()).toContain(copy("running.title"));
  });

  it("opens the result view after completion and preserves it when returning to inputs", async () => {
    server = { readRun: () => ({ kind: "completed", report: report() }) };
    await mount();
    await startRun();
    await tick(2_000);
    const resultTab = container?.querySelector<HTMLButtonElement>('[role="tab"][data-view="result"]');
    expect(resultTab?.getAttribute("aria-selected")).toBe("true");
    expect(container?.querySelector('[data-testid="visibility-input-panel"]')).toBeNull();
    const inputTab = container?.querySelector<HTMLButtonElement>('[role="tab"][data-view="input"]');
    await act(async () => inputTab?.click());
    expect(container?.querySelector('[data-testid="visibility-input-panel"]')).not.toBeNull();
    await act(async () => resultTab?.click());
    expect(text()).toContain("gpt-5-test");
    const starts = vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/tools/ai-visibility-check/run");
    expect(starts).toHaveLength(1);
  });

  it("selects engines before spending and sends them in the real start request", async () => {
    await mount();
    const perplexity = container?.querySelector<HTMLInputElement>('input[value="perplexity"]');
    expect(perplexity).not.toBeNull();
    await act(async () => perplexity?.click());
    expect(text()).toContain("150");
    await startRun();
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const started = calls.find(([url]) => String(url) === "/api/tools/ai-visibility-check/run");
    expect(JSON.parse(String(started?.[1]?.body))).toMatchObject({ engines: ["chatgpt", "perplexity"] });
  });
  it("has two real local file inputs for portable comparison", async () => {
    await mount();
    expect(container?.querySelectorAll('input[type="file"]').length).toBe(2);
  });
  it("keeps offline file comparison available without a frozen version or configured provider", async () => {
    server = { choices: [], providerConfigured: false, readRun: () => ({ kind: "running" }) };
    await mount();
    expect(container?.querySelectorAll('input[type="file"]').length).toBe(2);
  });
  // This is the seam the adversarial review found broken: the component read
  // `data.versions`, both branches of the handler write `data.choices`, and
  // the cast to `readonly FrozenVersion[]` made `undefined` typecheck. Every
  // signed-in visitor saw one error line and never reached the form.
  it("renders the versions from the handler's own payload", async () => {
    await mount();

    const options = [...(container?.querySelectorAll("option") ?? [])].map(
      (option) => option.textContent ?? "",
    );
    expect(options.some((label) => label.includes(CHOICE.host))).toBe(true);
    expect(text()).toContain(literal("form.title"));
    expect(text()).not.toContain(copy("errors.unknown"));
    expect(text()).not.toContain(copy("errors.schema_mismatch"));
    expect(intlErrors).toEqual([]);
  });

  it("prints the question and retrieval counts the estimate is built from", async () => {
    await mount();
    expect(text()).toContain("15 questions, 13 with measured search wording");
  });

  // The estimate and the result both used to print a bare number.
  it("prints the estimate with a currency unit", async () => {
    await mount();
    // 15 questions x 5 samples x $0.0457, rounded by the contract.
    expect(text()).toContain("about $3.43 and roughly");
    expect(intlErrors).toEqual([]);
  });

  it("reports a payload it cannot read rather than rendering an empty form", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ data: { versions: [CHOICE] } }),
    ) as unknown as typeof fetch;
    await mount();
    expect(text()).toContain(copy("errors.schema_mismatch"));
  });

  it("disables the run when the server says the provider is unconfigured", async () => {
    server = {
      readRun: () => ({ kind: "running" }),
      providerConfigured: false,
    };
    await mount();
    const button = [...(container?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent === copy("form.start"),
    );
    expect(button?.disabled).toBe(true);
    expect(text()).toContain(copy("errors.provider_unconfigured"));
  });
});

describe("V2 result and portable-file consumers", () => {
  it("renders actual requested/observed engine identity and exports its validated bytes", async () => {
    const value = visibilityReportFixtureV2();
    server = { readRun: () => ({ kind: "completed", report: value }) };
    await mount(); await startRun(); await tick(2_000);
    expect(container?.querySelector('[data-section="engines"]')?.textContent).toContain("ChatGPT");
    expect(text()).toContain("Requested model: gpt-5-2025-08-07");
    expect(text()).toContain("Observed model(s): gpt-5");
    expect(container?.querySelector('[data-visibility-report] header')?.textContent).toContain("US / en");
    expect(container?.querySelector('[data-section="layers"]')?.textContent).toContain(copy("report.samples"));
    expect(container?.querySelector('[data-section="layers"]')?.textContent).toContain(copy("report.position"));
    expect(container?.querySelector('[data-metric="coverage"]')?.textContent).toContain("1 / 1");
    expect(intlErrors).toEqual([]);
    const jsonButton = [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent === copy("v2.exportJson"));
    expect(jsonButton).toBeDefined();
    let written: Blob | null = null;
    const createBefore = URL.createObjectURL, revokeBefore = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => { written = blob as Blob; return "blob:offline"; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      await act(async () => jsonButton?.click());
      expect(click).toHaveBeenCalledOnce();
      expect(written).not.toBeNull();
      const bytes = await (written as unknown as Blob).text();
      expect(JSON.parse(bytes)).toMatchObject({ wireSchema: "marketing-geo-visibility-file.v2" });
      expect(parseVisibilityImport(bytes)).toEqual({ ok: true, report: value, provenance: "imported_untrusted" });
    } finally { click.mockRestore(); URL.createObjectURL = createBefore; URL.revokeObjectURL = revokeBefore; }
  });
  it("compares two selected files locally without launching or trusting a server run", async () => {
    await mount();
    const base = visibilityReportFixtureV2();
    const current = visibilityReportFixtureV2({ runId: "11111111-1111-4111-8111-111111111119", startedAt: "2026-08-31T00:02:00.000Z", finishedAt: "2026-08-31T00:03:00.000Z" });
    const inputs = [...(container?.querySelectorAll<HTMLInputElement>('input[type="file"]') ?? [])];
    for (const [index, value] of [base, current].entries()) {
      const json = exportVisibilityJson(value);
      const file = new File([json], `run-${index}.json`, { type: "application/json" });
      Object.defineProperty(file, "text", { value: async () => json });
      Object.defineProperty(inputs[index], "files", { configurable: true, value: [file] });
      await act(async () => inputs[index]?.dispatchEvent(new Event("change", { bubbles: true })));
    }
    const compare = [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent === copy("v2.compare"));
    expect(compare?.disabled).toBe(false);
    await act(async () => compare?.click());
    expect(text()).toContain(copy("v2.imported"));
    expect(container?.querySelector('[data-section="comparison"]')).not.toBeNull();
    expect(text()).toContain(copy("comparison.metrics.shareOfVoice"));
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url) === "/api/tools/ai-visibility-check/run")).toHaveLength(0);
    expect(intlErrors).toEqual([]);
  });
});

describe("polling a run", () => {
  // Workflow reports `pending` before it reports `running`, and the handler
  // passes that through as `status: "queued"`. A client that counted queued as
  // unreadable declared a paid run dead about ten seconds in, while several
  // hundred provider calls were still being made and billed.
  it("keeps waiting through a queued run instead of declaring it dead", async () => {
    server = { readRun: () => ({ kind: "queued" }) };
    await mount();
    await startRun();

    // Well past MAX_STATUS_FAILURES: the first poll at 2s, then every 5s.
    await tick(2_000);
    for (let index = 0; index < 6; index += 1) await tick(5_000);

    expect(statusCalls).toBeGreaterThan(5);
    expect(text()).toContain(literal("running.title"));
    expect(text()).not.toContain(copy("errors.run_unavailable"));
    expect(intlErrors).toEqual([]);
  });

  // `Retry-After` is never set: `privateJson` writes only `Cache-Control`, and
  // the interval lives in the body. Read from the header it was always the
  // 2s floor, which is ~450 authenticated requests for one fifteen-minute run.
  it("takes its interval from the body, not from a missing header", async () => {
    await mount();
    await startRun();

    await tick(2_000);
    expect(statusCalls).toBe(1);
    await tick(4_999);
    expect(statusCalls).toBe(1);
    await tick(1);
    expect(statusCalls).toBe(2);
  });

  it("remembers the run so a reload can pick it up", async () => {
    await mount();
    await startRun();
    await tick(2_000);

    const raw = sessionStorage.getItem(VISIBILITY_RUN_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const pointer = JSON.parse(String(raw)) as VisibilityRunPointer;
    expect(typeof pointer.runToken).toBe("string");
    expect(pointer.runToken.length).toBeGreaterThan(0);
    expect(pointer.startedAt).toBeGreaterThan(0);
  });

  it("resumes a stored run on mount and clears the pointer when it finishes", async () => {
    // Start once to obtain a pointer the server will actually answer for, then
    // remount as a reload would.
    await mount();
    await startRun();
    await tick(2_000);
    const raw = String(sessionStorage.getItem(VISIBILITY_RUN_STORAGE_KEY));
    await act(async () => root?.unmount());
    root = null;
    container?.remove();

    sessionStorage.setItem(VISIBILITY_RUN_STORAGE_KEY, raw);
    server = { readRun: () => ({ kind: "completed", report: report() }) };
    await mount();
    expect(text()).toContain(literal("running.title"));
    await tick(2_000);

    expect(text()).toContain(literal("results.title"));
    expect(sessionStorage.getItem(VISIBILITY_RUN_STORAGE_KEY)).toBeNull();
  });

  it("drops a stored pointer the server will not answer for", async () => {
    const stale: VisibilityRunPointer = {
      runToken: "not-a-sealed-token",
      startedAt: Date.now(),
    };
    sessionStorage.setItem(VISIBILITY_RUN_STORAGE_KEY, JSON.stringify(stale));
    await mount();
    await tick(2_000);

    expect(sessionStorage.getItem(VISIBILITY_RUN_STORAGE_KEY)).toBeNull();
    expect(text()).toContain(literal("form.title"));
    expect(text()).not.toContain(literal("running.title"));
  });
});

describe("reading a finished run", () => {
  async function finish(value: VisibilityReport): Promise<void> {
    server = { readRun: () => ({ kind: "completed", report: value }) };
    await mount();
    await startRun();
    await tick(2_000);
  }

  it("draws no conclusions when too few samples came back", async () => {
    await finish(
      report({
        status: "insufficient",
        comparison: {
          baseRunId: "run-0",
          baseFinishedAt: "2026-08-20T10:00:00.000Z",
          aggregates: [
            {
              metric: "questionsMentioned",
              base: proportion(1, 4),
              current: proportion(3, 4),
              diff: 0.5,
              gained: 2,
              lost: 0,
              pairs: 4,
              lo: 0.6,
              hi: 0.99,
              changed: true,
              testable: true,
            },
          ],
          questions: [],
        },
      }),
    );

    expect(text()).toContain(literal("results.withheldTitle"));
    // The three blocks that state a conclusion.
    expect(container?.querySelector('[data-section="metrics"]')).toBeNull();
    expect(container?.querySelector('[data-section="layers"]')).toBeNull();
    expect(container?.querySelector('[data-section="comparison"]')).toBeNull();
    expect(text()).not.toContain(literal("comparison.changed"));
    // The evidence and the price stay. Pinned to the result line's own
    // wording: the estimate above the form prints the same figure.
    expect(text()).toContain("Which tools compare acme to its rivals?");
    expect(text()).toContain("Provider cost $3.43");
    expect(intlErrors).toEqual([]);
  });

  it("still draws them when enough samples came back", async () => {
    await finish(report());
    expect(container?.querySelector('[data-section="metrics"]')).not.toBeNull();
    expect(container?.querySelector('[data-section="layers"]')).not.toBeNull();
    expect(text()).not.toContain(literal("results.withheldTitle"));
  });

  // Seven questions asked five times each is thirty-five correlated samples.
  // A zero over thirty-five clears the "may be written 0.0%" bound; the same
  // zero over seven does not, so the headline has to be the question-level one.
  it("leads with the question-level rate and keeps the pooled one under it", async () => {
    await finish(report());

    const headline = container?.querySelector('[data-metric="questionsMentioned"]');
    expect(headline?.textContent).toContain("100%");
    expect(headline?.textContent).toContain("1 / 1 questions");
    expect(headline?.textContent).not.toContain("samples");
    expect(container?.querySelector('[data-metric="questionsCited"]')?.textContent).toContain("0 / 1 questions");
    const methods = [...container!.querySelectorAll("details")].find(node => node.querySelector("summary")?.textContent === copy("report.methodsTitle"));
    expect(methods?.textContent).toMatch(/25%[\s\S]*1 \/ 4 answers/u);
    expect(headline?.compareDocumentPosition(methods!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(intlErrors).toEqual([]);
  });

  it("keeps the technical schema out of the default report reading order", async () => {
    await finish(report());
    const metadata = container?.querySelector<HTMLDetailsElement>('details[data-section="metadata"]');
    expect(metadata?.open).toBe(false);
    expect(metadata?.textContent).toContain(GEO_VISIBILITY_SCHEMA_VERSION);
    expect(container?.querySelector('[data-visibility-report] header')?.textContent).not.toContain(GEO_VISIBILITY_SCHEMA_VERSION);
  });

  it("names the model and the API it was reached through separately", async () => {
    await finish(report());
    expect(container?.querySelector('[data-section="metadata"]')?.textContent).toContain("Requested model: gpt-5-test");
    expect(container?.querySelector('[data-visibility-report] header')?.textContent).toContain("us");
    expect(text()).toContain("Reached through dataforseo-chatgpt");
  });

  // Null is the third state: the answer came back but its citation list would
  // not parse. It is outside the rate above, so the count has to be visible.
  it("counts the answers whose citation list could not be read", async () => {
    await finish(report({ citationUnknown: 2 }));
    expect(text()).toContain(literal("questions.citationUnknown"));
    expect(text()).toContain("2 answers came back with a citation list");
  });

  it("marks a question that names the brand in its own words", async () => {
    await finish(report({ prompted: true }));
    expect(text()).toContain(copy("questions.promptedTag"));
  });

  it("says so when the run could not be archived", async () => {
    await finish(report({ limits: ["oneSurface", "notStored"] }));
    expect(text()).toContain(literal("limits.notStored"));
    expect(intlErrors).toEqual([]);
  });

  // The run-scoped limits are appended by the run, not by the tool, so nothing
  // else renders them until the day they occur. next-intl prints the key path
  // for a missing message instead of throwing, which is exactly how
  // `errors.unknown` shipped absent from both catalogs.
  it("has copy for every limit either list can append", async () => {
    await finish(
      report({ limits: [...VISIBILITY_LIMITS, ...VISIBILITY_RUN_LIMITS] }),
    );

    for (const limit of [...VISIBILITY_LIMITS, ...VISIBILITY_RUN_LIMITS]) {
      expect(text(), limit).toContain(literal(`limits.${limit}`));
    }
    expect(text()).not.toContain("limits.");
    expect(intlErrors).toEqual([]);
  });

  // The verdict is computed over paired questions, so it is reported in them:
  // "eight of fourteen improved, none got worse" is actionable where a
  // difference of two rates with unseen denominators is not.
  it("reports the comparison in questions, not in points", async () => {
    await finish(
      report({
        comparison: {
          baseRunId: "run-0",
          baseFinishedAt: "2026-08-20T10:00:00.000Z",
          aggregates: [
            {
              metric: "questionsCited",
              base: proportion(1, 14),
              current: proportion(9, 14),
              diff: 0.57,
              gained: 8,
              lost: 0,
              pairs: 14,
              lo: 0.63,
              hi: 0.99,
              changed: true,
              testable: true,
            },
          ],
          questions: [],
        },
      }),
    );

    expect(text()).toContain(copy("comparison.metrics.questionsCited"));
    expect(text()).toContain("8 improved, 0 got worse, of 14 comparable");
    expect(text()).toContain("63–99% of the questions that moved improved");
    expect(intlErrors).toEqual([]);
  });

  it("prints no interval when the run computed none", async () => {
    await finish(
      report({
        comparison: {
          baseRunId: "run-0",
          baseFinishedAt: "2026-08-20T10:00:00.000Z",
          aggregates: [
            {
              metric: "questionsMentioned",
              base: proportion(1, 14),
              current: proportion(9, 14),
              diff: 0.57,
              gained: 8,
              lost: 0,
              pairs: 14,
              lo: null,
              hi: null,
              changed: true,
              testable: true,
            },
          ],
          questions: [],
        },
      }),
    );

    expect(text()).toContain(literal("comparison.changedNoInterval"));
    // The bug this replaced: `lo ?? 0` printed an interval of zero to zero.
    expect(text()).not.toContain("0–0%");
    expect(intlErrors).toEqual([]);
  });

  // The aggregates already refuse to divide by nothing; the per-question line
  // used to print "Mentioned in 0 of 0 answers", which reads as a measured
  // absence rather than a question nothing came back for.
  it("does not print a question with no answers as 0 of 0", async () => {
    await finish(report({ answered: 0, status: "partial" }));

    expect(text()).toContain(copy("questions.noAnswers"));
    expect(text()).not.toContain("Mentioned in 0 of 0 answers");
    expect(text()).not.toContain(literal("questions.demandCitationNote"));
    expect(intlErrors).toEqual([]);
  });

  // The sample timed out, so there is no answer for a mention to be absent
  // from. "No mention in this answer" beside a "timed out" label is two
  // contradictory sentences about the same empty excerpt.
  it("does not call a timed-out sample an answer without a mention", async () => {
    await finish(report({ answered: 0, status: "partial" }));
    const question = container?.querySelector<HTMLDetailsElement>('[data-section="questions"] details');
    expect(question).not.toBeNull();
    await act(async () => question?.querySelector("summary")?.click());
    expect(question?.open).toBe(true);

    expect(text()).toContain(copy("questions.sampleStatus.timeout"));
    expect(text()).toContain(copy("questions.sampleNoAnswer"));
    expect(text()).not.toContain(copy("questions.noExcerpt"));
  });
});
