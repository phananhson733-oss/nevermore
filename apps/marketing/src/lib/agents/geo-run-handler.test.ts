// @input  -- authenticated requests, scripted providers, and controlled budgets
// @output -- auth-order, validation, budget, and fail-closed API assertions
// @pos    -- focused tests for the GEO Agent run boundary

import { describe, expect, it, vi } from "vitest";
import {
  isGeoReportSuccessEnvelope,
  AGENT_GEO_REPORT_SCHEMA_VERSION,
} from "./geo-report-contract.ts";
import { GeoProviderError } from "./geo-provider.ts";
import {
  handleGeoRunRequest,
  parseGeoRunInput,
  type GeoRunHandlerDependencies,
} from "./geo-run-handler.ts";

const BODY = {
  schemaVersion: AGENT_GEO_REPORT_SCHEMA_VERSION,
  targetUrl: "https://acme.test/",
  marketCode: "US",
  languageCode: "en",
  brandTokens: ["Acme Analytics"],
  competitorHosts: ["rival.test", "https://www.other.test/x"],
  questions: [
    { questionId: "q-1", question: "Which tools track AI answer visibility?" },
    { questionId: "q-2", question: "Best AI visibility tools for SaaS?" },
  ],
};

function request(body: unknown = BODY): Request {
  return new Request("https://gengrowth.ai/api/agents/geo/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function answer(
  overrides: {
    readonly citedUrls?: readonly string[];
    readonly answerText?: string;
    readonly webSearchPerformed?: boolean;
  } = {},
) {
  return {
    observedAt: "2026-08-17T09:21:39.000Z",
    webSearchPerformed: overrides.webSearchPerformed ?? true,
    answerText: overrides.answerText ?? "A general answer.",
    citedUrls: overrides.citedUrls ?? ["https://acme.test/pricing"],
    costUsd: 0.0457,
    model: "gpt-5-2025-08-07",
  };
}

function dependencies(
  overrides: Partial<GeoRunHandlerDependencies> = {},
): GeoRunHandlerDependencies {
  return {
    authenticate: vi.fn(async () => Promise.resolve("authenticated" as const)),
    claimDailyBudget: vi.fn(async () =>
      Promise.resolve({ kind: "allowed" as const, runsToday: 1 }),
    ),
    createProvider: () => ({ observe: vi.fn(async () => answer()) }),
    now: () => Date.parse("2026-08-17T09:00:00.000Z"),
    ...overrides,
  };
}

describe("parseGeoRunInput", () => {
  it("normalizes the target, the competitors and the brand tokens", () => {
    const input = parseGeoRunInput(BODY);

    expect(input?.targetHost).toBe("acme.test");
    expect(input?.competitorHosts).toEqual(["rival.test", "other.test"]);
    // The host's own label is always a brand token, so a site named in prose
    // is caught even when the client sends no tokens at all.
    expect(input?.brandTokens).toContain("acme");
  });

  it.each([
    ["acme.com.au", "acme"],
    ["acme.co.uk", "acme"],
    ["acme.com", "acme"],
    ["shop.acme.co.jp", "acme"],
  ] as const)(
    "derives the brand token of %s as %s, not its public suffix",
    (host, token) => {
      // Taking the penultimate DNS label yields "com" for acme.com.au, which
      // then matches any answer naming some other .com site, and "co" for
      // acme.co.uk, which is dropped as too short so a real mention is missed.
      const input = parseGeoRunInput({
        ...BODY,
        targetUrl: `https://${host}/`,
        brandTokens: [],
      });

      expect(input?.brandTokens).toContain(token);
      expect(input?.brandTokens).not.toContain("com");
      expect(input?.brandTokens).not.toContain("co");
    },
  );

  it("never lets the target host masquerade as its own competitor", () => {
    const input = parseGeoRunInput({
      ...BODY,
      competitorHosts: ["acme.test", "rival.test"],
    });

    expect(input?.competitorHosts).toEqual(["rival.test"]);
  });

  it.each([
    ["a missing url", { ...BODY, targetUrl: undefined }],
    ["a private host", { ...BODY, targetUrl: "http://localhost/" }],
    ["an unmapped market", { ...BODY, marketCode: "usa" }],
    ["no questions", { ...BODY, questions: [] }],
    [
      "nine questions",
      {
        ...BODY,
        questions: Array.from({ length: 9 }, (_v, i) => ({
          questionId: `q-${i}`,
          question: "A question?",
        })),
      },
    ],
    [
      "an over-long question",
      {
        ...BODY,
        questions: [{ questionId: "q-1", question: "a".repeat(501) }],
      },
    ],
    [
      "duplicate question ids",
      {
        ...BODY,
        questions: [
          { questionId: "q-1", question: "One?" },
          { questionId: "q-1", question: "Two?" },
        ],
      },
    ],
    ["a non-object", "nope"],
  ] as const)("refuses %s", (_label, body) => {
    expect(parseGeoRunInput(body)).toBeNull();
  });
});

describe("handleGeoRunRequest", () => {
  it("checks authentication before reading the request body", async () => {
    const deps = dependencies({
      authenticate: vi.fn(async () =>
        Promise.resolve("unauthenticated" as const),
      ),
    });
    const incoming = request();

    const response = await handleGeoRunRequest(incoming, deps);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "auth_required" },
    });
    expect(incoming.bodyUsed).toBe(false);
  });

  it.each([
    ["unavailable", 503, "auth_unavailable"],
    ["unauthenticated", 401, "auth_required"],
  ] as const)("maps %s auth to %i", async (status, expected, code) => {
    const response = await handleGeoRunRequest(
      request(),
      dependencies({
        authenticate: vi.fn(async () => Promise.resolve(status)),
      }),
    );

    expect(response.status).toBe(expected);
    await expect(response.json()).resolves.toEqual({ error: { code } });
  });

  it("treats a thrown auth probe as unavailable, never as signed out", async () => {
    const response = await handleGeoRunRequest(
      request(),
      dependencies({
        authenticate: vi.fn(async () => {
          throw new Error("supabase down");
        }),
      }),
    );

    expect(response.status).toBe(503);
  });

  /**
   * A tab opened before a deploy runs the previous bundle, whose guard
   * recomputes the previous contract and refuses this server's response. The
   * cost of finding that out late is 24 billed provider calls and an error the
   * visitor cannot act on, so the mismatch is caught on the request instead.
   */
  it.each([
    ["no version at all — what a pre-deploy client sends", undefined],
    ["a superseded version", "agent_geo_report.v1"],
    ["a version from the future", "agent_geo_report.v3"],
  ] as const)(
    "refuses %s before the budget or the provider is touched",
    async (_label, schemaVersion) => {
      const claimDailyBudget = vi.fn(async () =>
        Promise.resolve({ kind: "allowed" as const, runsToday: 1 }),
      );
      const observe = vi.fn(async () => answer());
      const body: Record<string, unknown> = { ...BODY };
      if (schemaVersion === undefined) delete body["schemaVersion"];
      else body["schemaVersion"] = schemaVersion;

      const response = await handleGeoRunRequest(
        request(body),
        dependencies({ claimDailyBudget, createProvider: () => ({ observe }) }),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: "geo_client_outdated" },
      });
      expect(claimDailyBudget).not.toHaveBeenCalled();
      expect(observe).not.toHaveBeenCalled();
    },
  );

  it("refuses an invalid body without claiming the budget", async () => {
    const claimDailyBudget = vi.fn(async () =>
      Promise.resolve({ kind: "allowed" as const, runsToday: 1 }),
    );
    const response = await handleGeoRunRequest(
      request({ ...BODY, targetUrl: "nope" }),
      dependencies({ claimDailyBudget }),
    );

    expect(response.status).toBe(400);
    expect(claimDailyBudget).not.toHaveBeenCalled();
  });

  it("claims the daily budget before the first paid call", async () => {
    const observe = vi.fn(async () => answer());
    const claimDailyBudget = vi.fn(async () =>
      Promise.resolve({ kind: "exhausted" as const, retryAfterSeconds: 60 }),
    );

    const response = await handleGeoRunRequest(
      request(),
      dependencies({ claimDailyBudget, createProvider: () => ({ observe }) }),
    );

    expect(response.status).toBe(429);
    expect(observe).not.toHaveBeenCalled();
  });

  it("reports an unavailable budget store as 503", async () => {
    const response = await handleGeoRunRequest(
      request(),
      dependencies({
        claimDailyBudget: vi.fn(async () =>
          Promise.resolve({ kind: "unavailable" as const, reason: "db down" }),
        ),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "geo_budget_unavailable" },
    });
  });

  it("returns a contract-valid report the client guard accepts", async () => {
    const response = await handleGeoRunRequest(request(), dependencies());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    const envelope: unknown = await response.json();
    expect(isGeoReportSuccessEnvelope(envelope)).toBe(true);
  });

  it("samples every confirmed question three times and books the cost", async () => {
    const observe = vi.fn(async () => answer());
    const response = await handleGeoRunRequest(
      request(),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const body = (await response.json()) as {
      data: {
        run: { provider: { costUsd: number }; persistence: string };
        coverage: { samplesAttempted: number; availability: string };
      };
    };

    expect(observe).toHaveBeenCalledTimes(6);
    expect(body.data.coverage.samplesAttempted).toBe(6);
    expect(body.data.coverage.availability).toBe("available");
    expect(body.data.run.provider.costUsd).toBeCloseTo(0.2742, 4);
    // No storage exists yet, so the payload must not advertise an expiry.
    expect(body.data.run.persistence).toBe("none");
  });

  it("degrades to a partial report when some samples fail", async () => {
    let call = 0;
    const observe = vi.fn(async () => {
      call += 1;
      if (call % 2 === 0) {
        throw new GeoProviderError("rate_limited", "internal", 0.01);
      }
      return answer();
    });

    const response = await handleGeoRunRequest(
      request(),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const body = (await response.json()) as {
      data: { coverage: { availability: string; samplesUnavailable: number } };
    };

    expect(response.status).toBe(200);
    expect(body.data.coverage.availability).toBe("partial");
    expect(body.data.coverage.samplesUnavailable).toBe(3);
    expect(isGeoReportSuccessEnvelope(body)).toBe(true);
  });

  it("still returns a readable report when every sample failed", async () => {
    const observe = vi.fn(async () => {
      throw new GeoProviderError("server_error", "internal", 0);
    });

    const response = await handleGeoRunRequest(
      request(),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const body = (await response.json()) as {
      data: {
        coverage: { availability: string };
        questions: ReadonlyArray<{ aggregate: { verdict: string } }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.coverage.availability).toBe("unavailable");
    for (const question of body.data.questions) {
      // Never "not_observed": nothing was observed, which is a different claim.
      expect(question.aggregate.verdict).toBe("inconclusive");
    }
  });

  it("stops sampling once the run's cost ceiling is reached", async () => {
    // A full-size run: 8 questions x 3 samples. The ceiling can only bind once
    // more calls remain than fit in one concurrent batch, which is why this
    // uses the real question count rather than the two-question fixture.
    const observe = vi.fn(async () => ({ ...answer(), costUsd: 1.0 }));
    const fullRun = {
      ...BODY,
      questions: Array.from({ length: 8 }, (_value, index) => ({
        questionId: `q-${index + 1}`,
        question: `Question number ${index + 1}?`,
      })),
    };

    const response = await handleGeoRunRequest(
      request(fullRun),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const body = (await response.json()) as {
      data: { coverage: { samplesUnavailable: number } };
    };

    expect(observe.mock.calls.length).toBeLessThan(24);
    expect(body.data.coverage.samplesUnavailable).toBeGreaterThan(0);
    expect(isGeoReportSuccessEnvelope(body)).toBe(true);
  });

  it("stops sampling once the wall-clock budget is spent", async () => {
    let clock = Date.parse("2026-08-17T09:00:00.000Z");
    const observe = vi.fn(async () => {
      clock += 60_000;
      return answer();
    });

    const response = await handleGeoRunRequest(
      request(),
      dependencies({ createProvider: () => ({ observe }), now: () => clock }),
    );
    const body = (await response.json()) as {
      data: { coverage: { samplesUnavailable: number } };
    };

    expect(body.data.coverage.samplesUnavailable).toBeGreaterThan(0);
    expect(isGeoReportSuccessEnvelope(body)).toBe(true);
  });
});
