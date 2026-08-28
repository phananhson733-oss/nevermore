import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GEO_VISIBILITY_SCHEMA_VERSION,
  type VisibilityCitedDomain,
  type VisibilityMetrics,
  type VisibilityProportion,
  type VisibilityReport,
  type VisibilityRunManifest,
  type VisibilitySample,
} from "./visibility-contract.ts";
import {
  DEFAULT_VISIBILITY_STORE_DEPENDENCIES,
  readPreviousVisibilityRun,
  recordVisibilityRun,
  VISIBILITY_STORE_REASONS,
  type VisibilityQuestionCounts,
  type VisibilityStoreDependencies,
  type VisibilityTransportOutcome,
} from "./visibility-store.ts";

/**
 * A recording stand-in for the admin Supabase client.
 *
 * Hoisted because `vi.mock` runs before the module body, and shared so the
 * query-shape test can read back which filters the default adapter applied.
 */
const supabase = vi.hoisted(() => {
  const calls: { method: string; args: readonly unknown[] }[] = [];
  const response: { data: unknown; error: unknown } = {
    data: null,
    error: null,
  };
  const builder: Record<string, (...args: readonly unknown[]) => unknown> = {};
  for (const method of [
    "from",
    "select",
    "eq",
    "neq",
    "lt",
    "order",
    "limit",
  ]) {
    builder[method] = (...args: readonly unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder["maybeSingle"] = (...args: readonly unknown[]) => {
    calls.push({ method: "maybeSingle", args });
    return Promise.resolve(response);
  };
  return { calls, builder, response };
});

vi.mock("../supabase/admin.ts", () => ({
  createAdminSupabaseClient: () => supabase.builder,
}));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const USER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_USER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c33ff";
const KB_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const OTHER_KB_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c33fe";
const SNAPSHOT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3304";
const ANCHOR_RUN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3305";
const QUESTION_SET_HASH = "a".repeat(64);
const OTHER_QUESTION_SET_HASH = "b".repeat(64);

/** The answer prose that must never reach a column. */
const SENTINEL = "SENTINEL_ANSWER_PROSE_MUST_NOT_BE_STORED";

function proportion(successes: number, trials: number): VisibilityProportion {
  return { successes, trials, point: null, lo: null, hi: null };
}

function metrics(): VisibilityMetrics {
  return {
    unpromptedMention: proportion(2, 10),
    promptedMention: proportion(1, 5),
    citation: proportion(1, 8),
    questionsMentioned: proportion(1, 2),
    questionsCited: proportion(1, 2),
    questionsAsked: 2,
    questionsAnswered: 2,
    byLayer: [
      {
        layer: "discovery",
        mention: proportion(1, 5),
        citation: proportion(1, 4),
      },
    ],
  };
}

function manifest(
  overrides: Partial<VisibilityRunManifest> = {},
): VisibilityRunManifest {
  return {
    schemaVersion: GEO_VISIBILITY_SCHEMA_VERSION,
    kbId: KB_ID,
    snapshotId: SNAPSHOT_ID,
    snapshotRevision: 2,
    questionSetHash: QUESTION_SET_HASH,
    questionCount: 2,
    samplesPerQuestion: 5,
    marketCode: "US",
    model: "gpt-5-2025-08-07",
    surface: "dataforseo_chat_gpt_llm_responses_api",
    startedAt: "2026-08-29T09:00:00.000Z",
    finishedAt: "2026-08-29T09:30:00.000Z",
    calls: 10,
    answered: 10,
    successRatio: 1,
    costUsd: 0.457,
    status: "ok",
    ...overrides,
  };
}

function sample(questionId: string, sampleIndex: number): VisibilitySample {
  return {
    questionId,
    sampleIndex,
    status: "ok",
    webSearchPerformed: true,
    mentioned: true,
    cited: true,
    citedDomains: ["acme.com"],
    citedUrls: ["https://acme.com/p"],
    competitorsMentioned: ["Rival"],
    // The whole reason the projection exists.
    excerpt: `…${SENTINEL}…`,
    costUsd: 0.0457,
    observedAt: "2026-08-29T09:10:00.000Z",
  };
}

function citedDomains(): readonly VisibilityCitedDomain[] {
  return [
    {
      domain: "acme.com",
      answers: 3,
      isOwn: true,
      isCompetitor: false,
      sampleUrls: ["https://acme.com/p"],
    },
  ];
}

function report(overrides: Partial<VisibilityReport> = {}): VisibilityReport {
  return {
    manifest: manifest(),
    metrics: metrics(),
    questions: [
      {
        questionId: "q-1",
        text: "What are the best analytics tools?",
        layer: "discovery",
        mode: "retrieval",
        prompted: false,
        calibrated: true,
        samples: [sample("q-1", 1), sample("q-1", 2)],
        answered: 2,
        mentioned: 1,
        citationEvaluable: 2,
        cited: 1,
        citationUnknown: 0,
      },
      {
        questionId: "q-2",
        text: "Is Acme any good?",
        layer: "branded",
        mode: "demand",
        prompted: true,
        calibrated: false,
        samples: [sample("q-2", 1)],
        answered: 1,
        mentioned: 1,
        citationEvaluable: 0,
        cited: 0,
        citationUnknown: 1,
      },
    ],
    citedDomains: citedDomains(),
    limits: ["oneSurface"],
    comparison: null,
    ...overrides,
  };
}

function perQuestionRows(): readonly Record<string, unknown>[] {
  return report().questions.map((question) => ({
    questionId: question.questionId,
    text: question.text,
    layer: question.layer,
    mode: question.mode,
    prompted: question.prompted,
    answered: question.answered,
    mentioned: question.mentioned,
    citationEvaluable: question.citationEvaluable,
    cited: question.cited,
  }));
}

function runRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: RUN_ID,
    user_id: USER_ID,
    kb_id: KB_ID,
    snapshot_id: SNAPSHOT_ID,
    question_set_hash: QUESTION_SET_HASH,
    samples_per_question: 5,
    manifest: manifest(),
    metrics: metrics(),
    per_question: perQuestionRows(),
    cited_domains: citedDomains(),
    created_at: "2026-08-29T09:30:00.123456+00:00",
    ...overrides,
  };
}

function ok(data: unknown): VisibilityTransportOutcome {
  return { kind: "ok", data };
}

function deps(
  overrides: Partial<VisibilityStoreDependencies> = {},
): VisibilityStoreDependencies {
  return {
    readRunAnchor: async () => ok(null),
    readLatestRun: async () => ok(null),
    callRpc: async () =>
      ok([
        {
          outcome: "recorded",
          run_id: RUN_ID,
          recorded_at: "2026-08-29T09:30:00.123456+00:00",
        },
      ]),
    ...overrides,
  };
}

/** Every failure path logs; the suite asserts on the log rather than printing it. */
let logged: readonly unknown[][] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged = [...logged, args];
  });
  supabase.calls.length = 0;
  supabase.response.data = null;
  supabase.response.error = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* The projection                                                      */
/* ------------------------------------------------------------------ */

/**
 * Written as a mapped type so adding a field to `VisibilityQuestionCounts`
 * fails to compile here. A projection that silently grows a column is the one
 * change this test cannot notice on its own.
 */
const EXPECTED_COUNT_KEYS: {
  readonly [K in keyof VisibilityQuestionCounts]: true;
} = {
  questionId: true,
  text: true,
  layer: true,
  mode: true,
  prompted: true,
  answered: true,
  mentioned: true,
  citationEvaluable: true,
  cited: true,
};

describe("recordVisibilityRun projects the report", () => {
  it("sends counts only, with no path for answer text to reach a column", async () => {
    const callRpc = vi.fn(deps().callRpc);
    const result = await recordVisibilityRun(
      { userId: USER_ID, report: report() },
      deps({ callRpc }),
    );

    expect(result.kind).toBe("ok");
    expect(callRpc).toHaveBeenCalledTimes(1);
    const [name, params] = callRpc.mock.calls[0] ?? [];
    expect(name).toBe("marketing_geo_record_visibility_run");
    // The excerpt is in the report that was handed in; it must be nowhere in
    // what goes over the wire, whatever key someone might have put it under.
    expect(JSON.stringify(params)).not.toContain(SENTINEL);

    const perQuestion = (params as Record<string, unknown>)[
      "p_per_question"
    ] as readonly Record<string, unknown>[];
    expect(perQuestion).toHaveLength(2);
    for (const entry of perQuestion) {
      expect(Object.keys(entry).sort()).toEqual(
        Object.keys(EXPECTED_COUNT_KEYS).sort(),
      );
    }
    // `prompted` is what the paired comparison splits on; a projection that
    // drops it makes every stored question look unprompted.
    expect(perQuestion.map((entry) => entry["prompted"])).toEqual([
      false,
      true,
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Size ceilings                                                       */
/* ------------------------------------------------------------------ */

/**
 * Mirrors the module's unexported `COLUMN_BYTE_LIMITS.manifest`.
 *
 * Not importable, so it is restated. If the column budget moves, this test goes
 * red rather than quietly measuring the wrong boundary.
 */
const MANIFEST_BYTE_LIMIT = 8_192;

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** A manifest whose serialized size is exactly `target` bytes. */
function manifestOfSize(target: number): VisibilityRunManifest {
  const base = byteLength(manifest({ model: "" }));
  const padding = target - base;
  expect(padding).toBeGreaterThan(0);
  return manifest({ model: "x".repeat(padding) });
}

describe("oversized runs are refused before the write", () => {
  it("writes a run that lands exactly on the column budget", async () => {
    const oversized = manifestOfSize(MANIFEST_BYTE_LIMIT);
    expect(byteLength(oversized)).toBe(MANIFEST_BYTE_LIMIT);

    const callRpc = vi.fn(deps().callRpc);
    const result = await recordVisibilityRun(
      { userId: USER_ID, report: report({ manifest: oversized }) },
      deps({ callRpc }),
    );

    expect(result.kind).toBe("ok");
    expect(callRpc).toHaveBeenCalledTimes(1);
  });

  it("weighs the per-question column too, not only the manifest", async () => {
    // Every column carries its own budget. A check that only ever looked at the
    // manifest would let the widest payload through to an opaque constraint
    // violation instead of a code the page can render.
    const one = report().questions[0];
    if (one === undefined) throw new Error("fixture");
    const many = Array.from({ length: 4_000 }, (_unused, index) => ({
      ...one,
      questionId: `q-${index}`,
    }));

    const callRpc = vi.fn(deps().callRpc);
    const result = await recordVisibilityRun(
      { userId: USER_ID, report: report({ questions: many }) },
      deps({ callRpc }),
    );

    expect(result).toEqual({ kind: "invalid", code: "run_too_large" });
    expect(callRpc).not.toHaveBeenCalled();
  });

  it("refuses one byte more, and does not call the database", async () => {
    const oversized = manifestOfSize(MANIFEST_BYTE_LIMIT + 1);
    expect(byteLength(oversized)).toBe(MANIFEST_BYTE_LIMIT + 1);

    const callRpc = vi.fn(deps().callRpc);
    const result = await recordVisibilityRun(
      { userId: USER_ID, report: report({ manifest: oversized }) },
      deps({ callRpc }),
    );

    expect(result).toEqual({ kind: "invalid", code: "run_too_large" });
    expect(callRpc).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* RPC outcomes                                                        */
/* ------------------------------------------------------------------ */

describe("the record RPC's answer", () => {
  async function record(data: unknown) {
    return recordVisibilityRun(
      { userId: USER_ID, report: report() },
      deps({ callRpc: async () => ok(data) }),
    );
  }

  it("reads a recorded row as the stored run", async () => {
    const result = await record([
      {
        outcome: "recorded",
        run_id: RUN_ID,
        recorded_at: "2026-08-29T09:30:00.123456+00:00",
      },
    ]);

    expect(result).toEqual({
      kind: "ok",
      value: {
        runId: RUN_ID,
        kbId: KB_ID,
        snapshotId: SNAPSHOT_ID,
        questionSetHash: QUESTION_SET_HASH,
        samplesPerQuestion: 5,
        createdAt: "2026-08-29T09:30:00.123Z",
      },
    });
  });

  it("reads not_found as a missing knowledge base", async () => {
    expect(await record([{ outcome: "not_found" }])).toEqual({
      kind: "missing",
    });
  });

  it("reads question_set_mismatch as an invalid request", async () => {
    expect(await record([{ outcome: "question_set_mismatch" }])).toEqual({
      kind: "invalid",
      code: "question_set_mismatch",
    });
  });

  it.each([
    ["an empty table", []],
    ["a non-table value", {}],
    [
      "an outcome this build does not know",
      // Complete apart from the outcome, so a build that stopped checking the
      // outcome would happily report this as a stored run.
      [
        {
          outcome: "weird",
          run_id: RUN_ID,
          recorded_at: "2026-08-29T09:30:00.123456+00:00",
        },
      ],
    ],
  ])("refuses to guess at %s", async (_label, data) => {
    expect(await record(data)).toEqual({
      kind: "unavailable",
      reason: VISIBILITY_STORE_REASONS.malformedResponse,
    });
  });

  it("carries no provider error text into the result or the log", async () => {
    const secret = "PROVIDER_STACK_password=hunter2";
    const result = await recordVisibilityRun(
      { userId: USER_ID, report: report() },
      deps({
        callRpc: async () => {
          throw new Error(secret);
        },
      }),
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: VISIBILITY_STORE_REASONS.unavailable,
    });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(logged)).not.toContain("hunter2");
  });
});

/* ------------------------------------------------------------------ */
/* The baseline cursor                                                 */
/* ------------------------------------------------------------------ */

describe("the anchor's timestamp", () => {
  it("is passed on in the database's own spelling", async () => {
    const anchoredAt = "2026-08-29T10:00:00.123456+00:00";
    const readLatestRun = vi.fn(deps().readLatestRun);
    await readPreviousVisibilityRun(
      {
        userId: USER_ID,
        kbId: KB_ID,
        questionSetHash: QUESTION_SET_HASH,
        beforeRunId: ANCHOR_RUN_ID,
      },
      deps({
        readRunAnchor: async () =>
          ok({
            id: ANCHOR_RUN_ID,
            user_id: USER_ID,
            kb_id: KB_ID,
            question_set_hash: QUESTION_SET_HASH,
            created_at: anchoredAt,
          }),
        readLatestRun,
      }),
    );

    const passed = readLatestRun.mock.calls[0]?.[0];
    // Byte for byte. `new Date(anchoredAt).toISOString()` rounds the
    // microseconds away, and a cursor rounded down excludes runs that really
    // are earlier than the anchor.
    expect(passed?.before).toBe(anchoredAt);
    expect(passed?.before).not.toBe(new Date(anchoredAt).toISOString());
  });

  it("asks for the newest run when no anchor was named", async () => {
    const readLatestRun = vi.fn(deps().readLatestRun);
    await readPreviousVisibilityRun(
      { userId: USER_ID, kbId: KB_ID, questionSetHash: QUESTION_SET_HASH },
      deps({ readLatestRun }),
    );

    expect(readLatestRun.mock.calls[0]?.[0]?.before).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Rows that are not this account's                                    */
/* ------------------------------------------------------------------ */

describe("a baseline row that does not match the request", () => {
  async function read(row: Record<string, unknown>) {
    return readPreviousVisibilityRun(
      { userId: USER_ID, kbId: KB_ID, questionSetHash: QUESTION_SET_HASH },
      deps({ readLatestRun: async () => ok(row) }),
    );
  }

  it.each([
    ["another account", { user_id: OTHER_USER_ID }],
    ["another knowledge base", { kb_id: OTHER_KB_ID }],
    [
      "another frozen question set",
      {
        question_set_hash: OTHER_QUESTION_SET_HASH,
      },
    ],
  ])("is refused when it belongs to %s", async (_label, override) => {
    const result = await read(runRow(override));

    // Never `ok`: a scoping failure that reaches the page is one account's
    // numbers rendered as another's.
    expect(result).toEqual({
      kind: "unavailable",
      reason: VISIBILITY_STORE_REASONS.malformedResponse,
    });
  });

  it("accepts the row when every scope matches", async () => {
    const result = await read(runRow());

    expect(result.kind).toBe("ok");
  });
});

/* ------------------------------------------------------------------ */
/* Schema drift versus corruption                                      */
/* ------------------------------------------------------------------ */

describe("a baseline this build cannot read", () => {
  async function read(row: Record<string, unknown>) {
    return readPreviousVisibilityRun(
      { userId: USER_ID, kbId: KB_ID, questionSetHash: QUESTION_SET_HASH },
      deps({ readLatestRun: async () => ok(row) }),
    );
  }

  it("reports no baseline when the manifest speaks an older schema", async () => {
    const result = await read(
      runRow({
        manifest: {
          ...manifest(),
          schemaVersion: "marketing-geo-visibility.v0",
        },
      }),
    );

    // Not an outage: the numbers simply mean something else now, and the run
    // still reports without a comparison.
    expect(result).toEqual({ kind: "missing" });
  });

  it("reports an outage when a field of the current schema is malformed", async () => {
    const result = await read(
      runRow({ manifest: { ...manifest(), status: "weird" } }),
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: VISIBILITY_STORE_REASONS.malformedRun,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Counts that cannot be a proportion                                  */
/* ------------------------------------------------------------------ */

describe("counts that would render as more than all of them", () => {
  async function read(row: Record<string, unknown>) {
    return readPreviousVisibilityRun(
      { userId: USER_ID, kbId: KB_ID, questionSetHash: QUESTION_SET_HASH },
      deps({ readLatestRun: async () => ok(row) }),
    );
  }

  function perQuestionWith(
    index: number,
    override: Record<string, unknown>,
  ): readonly Record<string, unknown>[] {
    return perQuestionRows().map((entry, at) =>
      at === index ? { ...entry, ...override } : entry,
    );
  }

  it("refuses more mentions than answers", async () => {
    const result = await read(
      runRow({
        per_question: perQuestionWith(0, { mentioned: 3, answered: 2 }),
      }),
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: VISIBILITY_STORE_REASONS.malformedRun,
    });
  });

  it("refuses more citations than evaluable answers", async () => {
    const result = await read(
      runRow({
        per_question: perQuestionWith(0, { cited: 2, citationEvaluable: 1 }),
      }),
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: VISIBILITY_STORE_REASONS.malformedRun,
    });
  });

  it("refuses two rows for one question", async () => {
    const rows = perQuestionRows();
    const result = await read(
      runRow({ per_question: [rows[0], { ...rows[1], questionId: "q-1" }] }),
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: VISIBILITY_STORE_REASONS.malformedRun,
    });
  });

  it("refuses a metric whose successes exceed its trials", async () => {
    const result = await read(
      runRow({
        metrics: { ...metrics(), unpromptedMention: proportion(11, 10) },
      }),
    );

    expect(result).toEqual({
      kind: "unavailable",
      reason: VISIBILITY_STORE_REASONS.malformedRun,
    });
  });
});

/* ------------------------------------------------------------------ */
/* The query the default adapter builds                                */
/* ------------------------------------------------------------------ */

describe("the baseline query", () => {
  it("excludes runs that drew no conclusions about themselves", async () => {
    await DEFAULT_VISIBILITY_STORE_DEPENDENCIES.readLatestRun({
      userId: USER_ID,
      kbId: KB_ID,
      questionSetHash: QUESTION_SET_HASH,
      before: "2026-08-29T10:00:00.123456+00:00",
    });

    const filters = supabase.calls.map(
      (call) => `${call.method}(${JSON.stringify(call.args)})`,
    );
    // The page promises that a bad night at the provider costs the visitor
    // nothing: an insufficient latest run yields the next comparable one
    // instead of "no baseline". Filtered in the query, not after the read.
    expect(filters).toContain('neq(["manifest->>status","insufficient"])');
    expect(filters).toContain(`eq(["user_id","${USER_ID}"])`);
    expect(filters).toContain(`eq(["kb_id","${KB_ID}"])`);
    expect(filters).toContain(
      `eq(["question_set_hash","${QUESTION_SET_HASH}"])`,
    );
    expect(filters).toContain(
      'lt(["created_at","2026-08-29T10:00:00.123456+00:00"])',
    );
    expect(filters).toContain("limit([1])");
  });

  it("omits the cursor when there is no anchor", async () => {
    await DEFAULT_VISIBILITY_STORE_DEPENDENCIES.readLatestRun({
      userId: USER_ID,
      kbId: KB_ID,
      questionSetHash: QUESTION_SET_HASH,
      before: null,
    });

    expect(supabase.calls.map((call) => call.method)).not.toContain("lt");
    expect(
      supabase.calls.map(
        (call) => `${call.method}(${JSON.stringify(call.args)})`,
      ),
    ).toContain('neq(["manifest->>status","insufficient"])');
  });
});
