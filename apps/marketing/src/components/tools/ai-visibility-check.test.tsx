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
function installFetch(): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
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

function cardFor(label: string): string {
  const card = [...(container?.querySelectorAll("div") ?? [])].find(
    (element) =>
      element.className.includes("rounded-lg") &&
      (element.firstElementChild?.textContent ?? "") === label,
  );
  return card?.textContent ?? "";
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
    expect(text()).toContain("Engine: ChatGPT");
    expect(text()).toContain("Requested model: gpt-5-2025-08-07");
    expect(text()).toContain("Observed models: gpt-5");
    expect(text()).toContain("Market: US");
    expect(text()).toContain("Language: en");
    expect(text()).toContain(copy("layers.column.samples"));
    expect(text()).toContain(copy("layers.column.meanPosition"));
    expect(text()).toContain("Valid-sample coverage: 1/1 frozen questions");
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
    expect(text()).toContain(literal("comparison.title"));
    expect(text()).toContain(copy("comparison.metrics.shareOfVoice"));
    expect(vi.mocked(globalThis.fetch).mock.calls.every(([url]) => String(url).endsWith("/load"))).toBe(true);
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
    expect(text()).not.toContain(copy("overview.title"));
    expect(text()).not.toContain(copy("layers.title"));
    expect(text()).not.toContain(copy("comparison.title"));
    expect(text()).not.toContain(literal("comparison.changed"));
    // The evidence and the price stay. Pinned to the result line's own
    // wording: the estimate above the form prints the same figure.
    expect(text()).toContain("Which tools compare acme to its rivals?");
    expect(text()).toContain("Provider cost $3.43");
    expect(intlErrors).toEqual([]);
  });

  it("still draws them when enough samples came back", async () => {
    await finish(report());
    expect(text()).toContain(copy("overview.title"));
    expect(text()).toContain(copy("layers.title"));
    expect(text()).not.toContain(literal("results.withheldTitle"));
  });

  // Seven questions asked five times each is thirty-five correlated samples.
  // A zero over thirty-five clears the "may be written 0.0%" bound; the same
  // zero over seven does not, so the headline has to be the question-level one.
  it("leads with the question-level rate and keeps the pooled one under it", async () => {
    await finish(report());

    expect(text()).toContain(copy("overview.questionsMentioned.label"));
    expect(text()).toContain(copy("overview.questionsCited.label"));
    expect(text()).toContain(copy("overview.acrossSamples"));
    // The denominator gap is on the page rather than divided away.
    expect(text()).toContain("1 of 1 questions produced an answer");
    // Order matters, not merely presence: the question-level figure (1 unit)
    // is the headline and the pooled one (4 correlated samples) sits under it.
    expect(cardFor(copy("overview.questionsMentioned.label"))).toMatch(
      /100% \(1 samples[\s\S]*Across every sample: 25% \(4 samples/u,
    );
    expect(intlErrors).toEqual([]);
  });

  // It was in an `sr-only` paragraph, so a screen reader announced
  // "marketing-geo-visibility.v1" and nothing else did.
  it("never reads the schema version out to anybody", async () => {
    await finish(report());
    expect(text()).not.toContain(GEO_VISIBILITY_SCHEMA_VERSION);
  });

  it("names the model and the API it was reached through separately", async () => {
    await finish(report());
    expect(text()).toContain("gpt-5-test, market us");
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
    const toggle = [...(container?.querySelectorAll("button") ?? [])].find(
      (element) => element.textContent === copy("questions.showSamples"),
    );
    if (toggle === undefined) throw new Error("no sample toggle rendered");
    await act(async () => {
      toggle.click();
    });

    expect(text()).toContain(copy("questions.sampleStatus.timeout"));
    expect(text()).toContain(copy("questions.sampleNoAnswer"));
    expect(text()).not.toContain(copy("questions.noExcerpt"));
  });
});
