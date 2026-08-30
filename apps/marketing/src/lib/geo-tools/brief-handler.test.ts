import { describe, expect, it, vi } from "vitest";

import {
  handleBriefLoad,
  handleBriefRun,
  type BriefAssemblyFailureEvent,
  type BriefFrozenChoice,
  type BriefHandlerDependencies,
} from "./brief-handler.ts";
import { DEFAULT_BRIEF_HANDLER_DEPENDENCIES } from "./brief-handler-deps.ts";
import {
  GEO_BRIEF_DAILY_WINDOW_SECONDS,
  GEO_BRIEF_RUNS_PER_DAY,
} from "./brief-contract.ts";
import { GEO_KB_SCHEMA_VERSION, type GeoKbPayload } from "./kb-contract.ts";

const KB_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const SNAPSHOT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const ASSEMBLY_USAGE = {
  inputTokens: 31,
  outputTokens: 4096,
  requestCount: 1,
  retryCount: 0,
} as const;
const ASSEMBLY_PROVIDER = {
  modelRequested: "gpt-test",
  modelObserved: "gpt-observed",
  authScheme: "bearer" as const,
  effectiveTemperature: 0.2,
  maxOutputTokens: 4096,
};

const CHOICE: BriefFrozenChoice = {
  kbId: KB_ID,
  host: "acme.test",
  snapshotId: SNAPSHOT_ID,
  revision: 3,
  frozenAt: "2026-08-29T09:00:00.000Z",
  questions: [
    {
      id: "q01-discovery",
      text: "best project trackers for mid-market ops",
      layer: "discovery",
      roleId: "role-1",
    },
  ],
};

const PAYLOAD: GeoKbPayload = {
  schemaVersion: GEO_KB_SCHEMA_VERSION,
  targetUrl: "https://www.acme.test/",
  officialName: "Acme",
  aliases: [],
  categoryTerms: ["project tracker"],
  market: { country: "US", language: "en" },
  roles: [
    {
      id: "role-1",
      label: "Head of Ops",
      segment: "mid-market",
      painPoints: ["manual handoffs"],
      decisionCriteria: ["audit trail"],
      vocabulary: ["runbook"],
    },
  ],
  competitors: [{ domain: "rival.test", brandName: "Rival", confirmed: true }],
  facts: [
    {
      key: "pricing",
      value: "$29 per seat",
      reason: "",
      sourceUrl: "https://acme.test/pricing",
      observedAt: "2026-08-29T00:00:00.000Z",
    },
  ],
  importedFrom: null,
};

function post(path: string, body: unknown): Request {
  return new Request(`https://gengrowth.ai${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://gengrowth.ai",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function deps(
  overrides: Partial<BriefHandlerDependencies> = {},
): BriefHandlerDependencies {
  return {
    authenticate: async () => ({ ok: true, userId: "user-1" }),
    listFrozen: async () => ({ kind: "ok", value: [CHOICE] }),
    readFrozen: async () => ({
      kind: "ok",
      value: {
        payload: PAYLOAD,
        snapshotId: SNAPSHOT_ID,
        revision: 3,
        questions: [],
      },
    }),
    consumeDailyRun: async () => true,
    providerConfigured: () => true,
    sample: async () => ({
      kind: "ok",
      answerText: "## Pricing\nper seat\n\n## Who it is for\nops teams",
      citedDomains: [],
    }),
    assemble: async () => ({
      ok: true,
      value: {
        leadAnswerRequirement: "Say what Acme is.",
        mustAnswer: [{ id: "Q1", text: "What does it cost?" }],
        outline: [{ heading: "Pricing", answers: ["Q1"] }],
      },
    }),
    reportAssemblyFailure: vi.fn(),
    now: () => Date.parse("2026-08-29T10:00:00.000Z"),
    ...overrides,
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function runBody(overrides: Record<string, unknown> = {}) {
  return {
    kbId: KB_ID,
    snapshotId: SNAPSHOT_ID,
    questionId: "q01-discovery",
    questionText: "best project trackers for mid-market ops",
    ...overrides,
  };
}

describe("authentication", () => {
  it("refuses both endpoints before anything is read or charged", async () => {
    const listFrozen = vi.fn();
    const sample = vi.fn();
    const unauth: Partial<BriefHandlerDependencies> = {
      authenticate: async () => ({
        ok: false,
        response: Response.json({ error: { code: "auth_required" } }, { status: 401 }),
      }),
      listFrozen,
      sample,
    };
    for (const [handler, path, payload] of [
      [handleBriefLoad, "/load", {}],
      [handleBriefRun, "/run", runBody()],
    ] as const) {
      expect((await handler(post(path, payload), deps(unauth))).status).toBe(401);
    }
    expect(listFrozen).not.toHaveBeenCalled();
    expect(sample).not.toHaveBeenCalled();
  });
});

describe("load", () => {
  it("returns the frozen versions with their questions", async () => {
    const response = await handleBriefLoad(post("/load", {}), deps());
    expect(response.status).toBe(200);
    const data = (await body(response)).data as {
      choices: BriefFrozenChoice[];
      runsPerDay: number;
      providerConfigured: boolean;
    };
    expect(data.choices[0]?.questions).toHaveLength(1);
    expect(data.runsPerDay).toBe(GEO_BRIEF_RUNS_PER_DAY);
    expect(data.providerConfigured).toBe(true);
  });

  it("keeps the same shape for an account with nothing frozen", async () => {
    const response = await handleBriefLoad(
      post("/load", {}),
      deps({ listFrozen: async () => ({ kind: "not_found" }) }),
    );
    const data = (await body(response)).data as {
      choices: unknown[];
      runsPerDay: number;
      providerConfigured: boolean;
    };
    expect(data.choices).toEqual([]);
    expect(data.runsPerDay).toBe(GEO_BRIEF_RUNS_PER_DAY);
    expect(data.providerConfigured).toBe(true);
  });

  it("tells a store outage apart from an empty account", async () => {
    const response = await handleBriefLoad(
      post("/load", {}),
      deps({ listFrozen: async () => ({ kind: "unavailable", reason: "x" }) }),
    );
    expect(response.status).toBe(503);
  });
});

describe("assembly diagnostics", () => {
  it("serializes only the stable event through the default warning sink", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const event: BriefAssemblyFailureEvent = {
      event: "geo_brief_assembly_unavailable",
      reason: "server_error",
      usage: ASSEMBLY_USAGE,
      provider: ASSEMBLY_PROVIDER,
    };

    try {
      DEFAULT_BRIEF_HANDLER_DEPENDENCIES.reportAssemblyFailure(event);
      expect(warn).toHaveBeenCalledWith(JSON.stringify(event));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("what a refusal must not cost", () => {
  it("refuses a frozen version this account does not own, free", async () => {
    const consumeDailyRun = vi.fn(async () => true);
    const sample = vi.fn();
    const response = await handleBriefRun(
      post("/run", runBody({ snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399" })),
      deps({ consumeDailyRun, sample }),
    );
    expect(response.status).toBe(404);
    expect(consumeDailyRun).not.toHaveBeenCalled();
    expect(sample).not.toHaveBeenCalled();
  });

  it("refuses a question that frozen version does not ask, free", async () => {
    // Otherwise the brief carries a question id its own question set never had,
    // and any observed counts attached to it describe something else.
    const consumeDailyRun = vi.fn(async () => true);
    const response = await handleBriefRun(
      post("/run", runBody({ questionId: "q99-invented" })),
      deps({ consumeDailyRun }),
    );
    expect(response.status).toBe(404);
    expect(consumeDailyRun).not.toHaveBeenCalled();
  });

  it("refuses before charging when the provider has no credentials", async () => {
    const consumeDailyRun = vi.fn(async () => true);
    const response = await handleBriefRun(
      post("/run", runBody()),
      deps({ providerConfigured: () => false, consumeDailyRun }),
    );
    expect(response.status).toBe(503);
    expect((await body(response)).error).toEqual({
      code: "provider_unconfigured",
    });
    expect(consumeDailyRun).not.toHaveBeenCalled();
  });

  it("stops at the day's limit and says the window as well as the size", async () => {
    const sample = vi.fn();
    const response = await handleBriefRun(
      post("/run", runBody()),
      deps({ consumeDailyRun: async () => false, sample }),
    );
    expect(response.status).toBe(429);
    const parsed = await body(response);
    expect(parsed.limit).toBe(GEO_BRIEF_RUNS_PER_DAY);
    expect(parsed.windowSeconds).toBe(GEO_BRIEF_DAILY_WINDOW_SECONDS);
    expect(sample).not.toHaveBeenCalled();
  });

  it("refuses a body carrying fields it does not know", async () => {
    const sample = vi.fn();
    const response = await handleBriefRun(
      post("/run", runBody({ revision: 9 })),
      deps({ sample }),
    );
    expect(response.status).toBe(400);
    expect(sample).not.toHaveBeenCalled();
  });

  it("refuses a typed question that is blank or too long", async () => {
    for (const questionText of ["   ", "x".repeat(301)]) {
      const response = await handleBriefRun(
        post("/run", runBody({ questionId: null, questionText })),
        deps(),
      );
      expect(response.status).toBe(400);
    }
  });
});

describe("the brief it returns", () => {
  it("reads the revision from the frozen row, never from the request", async () => {
    const readFrozen = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        payload: PAYLOAD,
        snapshotId: SNAPSHOT_ID,
        revision: 3,
        questions: [],
      },
    }));
    await handleBriefRun(post("/run", runBody()), deps({ readFrozen }));
    expect(readFrozen).toHaveBeenCalledWith({
      userId: "user-1",
      kbId: KB_ID,
      revision: 3,
    });
  });

  it("refuses when the frozen row is not the snapshot that was picked", async () => {
    const response = await handleBriefRun(
      post("/run", runBody()),
      deps({
        readFrozen: async () => ({
          kind: "ok",
          value: {
            payload: PAYLOAD,
            snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3388",
            revision: 3,
            questions: [],
          },
        }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("canonicalizes the target host the way the citation side does", async () => {
    // `https://www.acme.test/` must reach the sampler as `acme.test`. Comparing
    // a raw `URL.host` against a normalized one is how a www site ends up with
    // a permanent zero citation rate.
    const sample = vi.fn(async () => ({
      kind: "ok" as const,
      answerText: "## Pricing",
      citedDomains: [],
    }));
    await handleBriefRun(post("/run", runBody()), deps({ sample }));
    const call = (sample.mock.calls as readonly unknown[][])[0]?.[0] as {
      targetHost: string;
    };
    expect(call.targetHost).toBe("acme.test");
  });

  it("carries the observed subtopics and marks where each item came from", async () => {
    const response = await handleBriefRun(post("/run", runBody()), deps());
    expect(response.status).toBe(200);
    const brief = ((await body(response)).data as { brief: Record<string, unknown> })
      .brief;
    const mustAnswer = brief["mustAnswer"] as { id: string; source: string }[];
    expect(mustAnswer[0]?.source).toBe("ai_sample");
    expect(brief["origin"]).toMatchObject({ questionId: "q01-discovery" });
  });

  it("still returns a brief when the sample failed, and says so", async () => {
    const response = await handleBriefRun(
      post("/run", runBody()),
      deps({
        sample: async () => ({ kind: "unavailable" }),
        assemble: async () => ({ ok: false, reason: "nothing_to_assemble" }),
      }),
    );
    expect(response.status).toBe(200);
    const brief = ((await body(response)).data as { brief: Record<string, unknown> })
      .brief;
    expect(brief["limits"]).toContain("sampleUnavailable");
    expect(brief["limits"]).toContain("modelUnavailable");
    // The fact table survives both failures; it never depended on either.
    expect((brief["facts"] as unknown[]).length).toBe(1);
  });

  it("reports one fixed safe event when assembly degrades", async () => {
    const reportAssemblyFailure = vi.fn();
    const response = await handleBriefRun(
      post("/run", runBody()),
      deps({
        assemble: async () => ({
          ok: false,
          reason: "invalid_response",
          usage: ASSEMBLY_USAGE,
          provider: ASSEMBLY_PROVIDER,
        }),
        reportAssemblyFailure,
      }),
    );

    expect(response.status).toBe(200);
    const parsed = await body(response);
    const brief = (parsed.data as { brief: Record<string, unknown> }).brief;
    expect(brief["limits"]).toContain("modelUnavailable");
    expect(reportAssemblyFailure).toHaveBeenCalledOnce();
    expect(reportAssemblyFailure).toHaveBeenCalledWith({
      event: "geo_brief_assembly_unavailable",
      reason: "invalid_response",
      usage: ASSEMBLY_USAGE,
      provider: ASSEMBLY_PROVIDER,
    });

    const serializedEvent = JSON.stringify(reportAssemblyFailure.mock.calls[0]?.[0]);
    expect(serializedEvent).not.toContain(CHOICE.questions[0]?.text ?? "");
    expect(serializedEvent).not.toContain(PAYLOAD.officialName);
    expect(serializedEvent).not.toContain(PAYLOAD.facts[0]?.sourceUrl ?? "");
    expect(serializedEvent).not.toContain("user-1");
    expect(serializedEvent).not.toContain(KB_ID);
    expect(serializedEvent).not.toContain(SNAPSHOT_ID);
    expect(serializedEvent).not.toContain(PAYLOAD.targetUrl);
    expect(serializedEvent).not.toContain("per seat");
    // The internal cause stays out of the stable public brief contract.
    expect(JSON.stringify(parsed)).not.toContain("invalid_response");
  });

  it("forwards provider provenance without inventing an empty usage record", async () => {
    const reportAssemblyFailure = vi.fn();
    const response = await handleBriefRun(
      post("/run", runBody()),
      deps({
        assemble: async () => ({
          ok: false,
          reason: "server_error",
          provider: ASSEMBLY_PROVIDER,
        }),
        reportAssemblyFailure,
      }),
    );

    expect(response.status).toBe(200);
    expect(reportAssemblyFailure).toHaveBeenCalledWith({
      event: "geo_brief_assembly_unavailable",
      reason: "server_error",
      provider: ASSEMBLY_PROVIDER,
    });
    expect("usage" in (reportAssemblyFailure.mock.calls[0]?.[0] ?? {})).toBe(false);
  });

  it("keeps the honest degraded 200 response when the reporter throws", async () => {
    const reportAssemblyFailure = vi.fn(() => {
      throw new Error("observability unavailable");
    });
    const response = await handleBriefRun(
      post("/run", runBody()),
      deps({
        assemble: async () => ({
          ok: false,
          reason: "schema_invalid",
          usage: ASSEMBLY_USAGE,
          provider: ASSEMBLY_PROVIDER,
        }),
        reportAssemblyFailure,
      }),
    );

    expect(response.status).toBe(200);
    const brief = ((await body(response)).data as { brief: Record<string, unknown> })
      .brief;
    expect(brief["limits"]).toContain("modelUnavailable");
    expect(reportAssemblyFailure).toHaveBeenCalledOnce();
  });

  it("does not report a successful assembly", async () => {
    const reportAssemblyFailure = vi.fn();
    const response = await handleBriefRun(
      post("/run", runBody()),
      deps({ reportAssemblyFailure }),
    );

    expect(response.status).toBe(200);
    expect(reportAssemblyFailure).not.toHaveBeenCalled();
  });

  it("asks the frozen wording, not the wording the client sent", async () => {
    // Accepting the client's text for a frozen question would let a brief
    // record that question's id beside words it never asked, and any observed
    // counts later attached to the id would describe something else.
    const sample = vi.fn(async () => ({
      kind: "ok" as const,
      answerText: "## Pricing",
      citedDomains: [],
    }));
    const response = await handleBriefRun(
      post("/run", runBody({ questionText: "something else entirely" })),
      deps({ sample }),
    );
    const call = (sample.mock.calls as readonly unknown[][])[0]?.[0] as {
      question: string;
    };
    expect(call.question).toBe("best project trackers for mid-market ops");
    const brief = ((await body(response)).data as { brief: Record<string, unknown> })
      .brief;
    expect((brief["origin"] as { questionText: string }).questionText).toBe(
      "best project trackers for mid-market ops",
    );
  });

  it("uses the visitor's own wording when they typed the question", async () => {
    const sample = vi.fn(async () => ({
      kind: "ok" as const,
      answerText: "## Pricing",
      citedDomains: [],
    }));
    await handleBriefRun(
      post("/run", runBody({ questionId: null, questionText: "does Acme do audits?" })),
      deps({ sample }),
    );
    const call = (sample.mock.calls as readonly unknown[][])[0]?.[0] as {
      question: string;
    };
    expect(call.question).toBe("does Acme do audits?");
  });

  it("turns an unexpected throw into a sentence, not a bare 500", async () => {
    // Without the catch the browser gets a 500 with no body and the page has
    // no copy for it, so the visitor sees nothing at all.
    const response = await handleBriefRun(
      post("/run", runBody()),
      deps({
        sample: async () => {
          throw new TypeError("a bug in this file");
        },
      }),
    );
    expect(response.status).toBe(500);
    expect((await body(response)).error).toEqual({ code: "internal_error" });
  });

  it("marks a typed question as one that came from no frozen question", async () => {
    const response = await handleBriefRun(
      post("/run", runBody({ questionId: null, questionText: "does Acme do audits?" })),
      deps(),
    );
    const brief = ((await body(response)).data as { brief: Record<string, unknown> })
      .brief;
    expect(brief["limits"]).toContain("manualQuestion");
    expect((brief["origin"] as { questionId: unknown }).questionId).toBeNull();
  });
});
