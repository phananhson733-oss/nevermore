import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  handleVisibilityLoad,
  handleVisibilityStart,
  handleVisibilityStatus,
  type VisibilityFrozenChoice,
  type VisibilityHandlerDependencies,
} from "./visibility-handler.ts";
import { open, seal } from "../auth/sealed-cookie.ts";
import {
  VISIBILITY_DAILY_WINDOW_SECONDS,
  VISIBILITY_RUNS_PER_DAY,
} from "./visibility-contract.ts";

/**
 * The sealing key this suite runs under.
 *
 * Set here rather than assumed: the run pointer is a sealed value, and a suite
 * that depended on the deployment's key would pass on one machine and fail on
 * another.
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
  overrides: Partial<VisibilityHandlerDependencies> = {},
): VisibilityHandlerDependencies {
  return {
    authenticate: async () => ({ ok: true, userId: "user-1" }),
    listFrozen: async () => ({ kind: "ok", value: [CHOICE] }),
    consumeDailyRun: async () => true,
    providerConfigured: () => true,
    startRun: async () => ({ runId: "run-1" }),
    readRun: async () => ({ kind: "running" }),
    now: () => Date.parse("2026-08-29T10:00:00.000Z"),
    ...overrides,
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function startBody(overrides: Record<string, unknown> = {}) {
  return {
    kbId: CHOICE.kbId,
    snapshotId: CHOICE.snapshotId,
    samplesPerQuestion: 5,
    ...overrides,
  };
}

describe("authentication", () => {
  it("refuses each endpoint before anything is read or charged", async () => {
    const listFrozen = vi.fn();
    const startRun = vi.fn();
    const unauth: Partial<VisibilityHandlerDependencies> = {
      authenticate: async () => ({
        ok: false,
        response: Response.json(
          { error: { code: "auth_required" } },
          { status: 401 },
        ),
      }),
      listFrozen,
      startRun,
    };
    for (const [handler, path, payload] of [
      [handleVisibilityLoad, "/load", {}],
      [handleVisibilityStart, "/run", startBody()],
      [handleVisibilityStatus, "/run/status", { runToken: "x" }],
    ] as const) {
      const response = await handler(post(path, payload), deps(unauth));
      expect(response.status).toBe(401);
    }
    expect(listFrozen).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });
});

describe("load", () => {
  it("returns the frozen versions with the counts the estimate is built from", async () => {
    const response = await handleVisibilityLoad(post("/load", {}), deps());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const data = (await body(response)).data as {
      choices: VisibilityFrozenChoice[];
      runsPerDay: number;
      providerConfigured: boolean;
    };
    expect(data.choices[0]?.questionCount).toBe(15);
    expect(data.runsPerDay).toBe(VISIBILITY_RUNS_PER_DAY);
    expect(data.providerConfigured).toBe(true);
  });

  it("says the provider is unconfigured before a click spends anything", async () => {
    const response = await handleVisibilityLoad(
      post("/load", {}),
      deps({ providerConfigured: () => false }),
    );
    const data = (await body(response)).data as { providerConfigured: boolean };
    expect(data.providerConfigured).toBe(false);
  });

  it("returns an empty list rather than an error when nothing is frozen", async () => {
    const response = await handleVisibilityLoad(
      post("/load", {}),
      deps({ listFrozen: async () => ({ kind: "ok", value: [] }) }),
    );
    expect(response.status).toBe(200);
    const data = (await body(response)).data as {
      choices: unknown[];
      runsPerDay: number;
      providerConfigured: boolean;
    };
    expect(data.choices).toEqual([]);
    // Same shape as the populated case. An empty account is not a different
    // contract, and a page that reads these fields must not find them missing
    // on one branch out of two.
    expect(data.runsPerDay).toBe(VISIBILITY_RUNS_PER_DAY);
    expect(data.providerConfigured).toBe(true);
  });
});

describe("start", () => {
  it("refuses a sample count that is not one of the offered ones", async () => {
    const startRun = vi.fn();
    const response = await handleVisibilityStart(
      post("/run", startBody({ samplesPerQuestion: 7 })),
      deps({ startRun }),
    );
    expect(response.status).toBe(400);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses a frozen version this account does not own", async () => {
    const startRun = vi.fn();
    const consumeDailyRun = vi.fn(async () => true);
    const response = await handleVisibilityStart(
      post("/run", startBody({ snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399" })),
      deps({ startRun, consumeDailyRun }),
    );
    expect(response.status).toBe(404);
    // Ownership is settled before the day's allowance is spent; otherwise a
    // wrong id would cost the visitor one of five runs.
    expect(consumeDailyRun).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses before charging when the provider has no credentials", async () => {
    const startRun = vi.fn();
    const response = await handleVisibilityStart(
      post("/run", startBody()),
      deps({ providerConfigured: () => false, startRun }),
    );
    expect(response.status).toBe(503);
    expect((await body(response)).error).toEqual({
      code: "provider_unconfigured",
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("stops at the day's limit and says what the limit is", async () => {
    const startRun = vi.fn();
    const response = await handleVisibilityStart(
      post("/run", startBody()),
      deps({ consumeDailyRun: async () => false, startRun }),
    );
    expect(response.status).toBe(429);
    const parsed = await body(response);
    expect(parsed.error).toEqual({ code: "daily_limit" });
    expect(parsed.limit).toBe(VISIBILITY_RUNS_PER_DAY);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("hands the workflow a sealed request and the browser a sealed pointer", async () => {
    const startRun = vi.fn(async () => ({ runId: "run-9" }));
    const response = await handleVisibilityStart(
      post("/run", startBody()),
      deps({ startRun }),
    );
    expect(response.status).toBe(200);
    const token = (startRun.mock.calls as readonly unknown[][])[0]?.[0];
    expect(typeof token).toBe("string");
    // The identity travels sealed rather than as a field the client could set.
    expect(String(token)).not.toContain("user-1");
    const data = (await body(response)).data as {
      runToken: string;
      questionCount: number;
    };
    expect(data.questionCount).toBe(15);
    expect(data.runToken).not.toContain("run-9");
  });
});

describe("status", () => {
  const runToken = (sub: string) =>
    seal(
      "gg_geo_visibility_run",
      { sub, runId: "run-1" },
      3_600,
      () => Date.parse("2026-08-29T10:00:00.000Z"),
    );

  it("refuses a pointer that belongs to someone else the same way as a missing one", async () => {
    const readRun = vi.fn();
    const response = await handleVisibilityStatus(
      post("/run/status", { runToken: runToken("someone-else") }),
      deps({ readRun }),
    );
    expect(response.status).toBe(404);
    expect(readRun).not.toHaveBeenCalled();
  });

  it("reports running with a polling hint", async () => {
    const response = await handleVisibilityStatus(
      post("/run/status", { runToken: runToken("user-1") }),
      deps(),
    );
    expect(response.status).toBe(200);
    const data = (await body(response)).data as {
      status: string;
      retryAfterSeconds: number;
    };
    expect(data.status).toBe("running");
    expect(data.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("passes a typed workflow failure through as its own code", async () => {
    const response = await handleVisibilityStatus(
      post("/run/status", { runToken: runToken("user-1") }),
      deps({
        readRun: async () => ({ kind: "failed", code: "store_unavailable" }),
      }),
    );
    expect(response.status).toBe(502);
    expect((await body(response)).error).toEqual({ code: "store_unavailable" });
  });

  it("refuses a token that is not a token without calling the run store", async () => {
    const readRun = vi.fn();
    const response = await handleVisibilityStatus(
      post("/run/status", { runToken: "not-a-sealed-token" }),
      deps({ readRun }),
    );
    expect(response.status).toBe(404);
    expect(readRun).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* What travels sealed                                                 */
/* ------------------------------------------------------------------ */

interface SealedRunRequest {
  readonly sub: string;
  readonly kbId: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly samplesPerQuestion: number;
  readonly startedAt: string;
}

describe("the sealed run request", () => {
  async function sealedFrom(
    body: Record<string, unknown>,
  ): Promise<SealedRunRequest> {
    const startRun = vi.fn(async () => ({ runId: "run-9" }));
    await handleVisibilityStart(post("/run", body), deps({ startRun }));
    const token = (startRun.mock.calls as readonly unknown[][])[0]?.[0];
    const opened = open<SealedRunRequest>(
      "gg_geo_visibility_input",
      String(token),
      () => Date.parse("2026-08-29T10:00:00.000Z"),
    );
    if (opened === null) throw new Error("the workflow was handed no request");
    return opened;
  }

  // Opening the token is the only way to see what the workflow was actually
  // told. Asserting that the string does not contain "user-1" proves the value
  // is opaque and nothing else - every wrong payload is opaque too.
  it("carries the identity the request authenticated as", async () => {
    expect((await sealedFrom(startBody())).sub).toBe("user-1");
  });

  it("carries the sample count that was asked for, not a default", async () => {
    // A visitor who chose ten and was charged for five, or chose three and was
    // charged for ten, would see nothing wrong on the page.
    expect((await sealedFrom(startBody({ samplesPerQuestion: 10 }))).samplesPerQuestion).toBe(10);
    expect((await sealedFrom(startBody({ samplesPerQuestion: 3 }))).samplesPerQuestion).toBe(3);
  });

  it("carries the frozen version the visitor picked", async () => {
    const request = await sealedFrom(startBody());
    expect(request.kbId).toBe(CHOICE.kbId);
    expect(request.snapshotId).toBe(CHOICE.snapshotId);
    // Both identifiers travel: the workflow re-reads by revision and asserts
    // the row it got back is the snapshot named here.
    expect(request.revision).toBe(CHOICE.revision);
  });

  it("stamps the start time from the injected clock", async () => {
    expect((await sealedFrom(startBody())).startedAt).toBe(
      "2026-08-29T10:00:00.000Z",
    );
  });
});

describe("the run pointer handed back", () => {
  it("names the run the workflow started", async () => {
    const startRun = vi.fn(async () => ({ runId: "run-9" }));
    const response = await handleVisibilityStart(
      post("/run", startBody()),
      deps({ startRun }),
    );
    const data = (await body(response)).data as { runToken: string };
    const pointer = open<{ sub: string; runId: string }>(
      "gg_geo_visibility_run",
      data.runToken,
      () => Date.parse("2026-08-29T10:00:00.000Z"),
    );
    expect(pointer).toEqual({ sub: "user-1", runId: "run-9" });
  });

  it("is the id the status route reads with", async () => {
    const startRun = vi.fn(async () => ({ runId: "run-9" }));
    const started = await handleVisibilityStart(
      post("/run", startBody()),
      deps({ startRun }),
    );
    const { runToken } = (await body(started)).data as { runToken: string };

    const readRun = vi.fn(async () => ({ kind: "running" }) as const);
    await handleVisibilityStatus(post("/run/status", { runToken }), deps({ readRun }));
    expect(readRun).toHaveBeenCalledWith("run-9");
  });
});

describe("outcomes the visitor paid for", () => {
  const runToken = () =>
    seal(
      "gg_geo_visibility_run",
      { sub: "user-1", runId: "run-1" },
      3_600,
      () => Date.parse("2026-08-29T10:00:00.000Z"),
    );

  it("returns the finished report unchanged", async () => {
    // The one thing the visitor spent money on. Compared by identity so a
    // handler that rebuilt or trimmed the report would fail here.
    const report = { manifest: { calls: 75 }, questions: [] } as never;
    const response = await handleVisibilityStatus(
      post("/run/status", { runToken: runToken() }),
      deps({ readRun: async () => ({ kind: "completed", report }) }),
    );
    expect(response.status).toBe(200);
    const data = (await body(response)).data as {
      status: string;
      report: unknown;
    };
    expect(data.status).toBe("completed");
    expect(data.report).toEqual(report);
  });

  it("reports a run the store has never heard of as missing", async () => {
    const response = await handleVisibilityStatus(
      post("/run/status", { runToken: runToken() }),
      deps({ readRun: async () => ({ kind: "missing" }) }),
    );
    expect(response.status).toBe(404);
  });

  it("says how long to wait, in the units the client polls in", async () => {
    for (const kind of ["queued", "running"] as const) {
      const response = await handleVisibilityStatus(
        post("/run/status", { runToken: runToken() }),
        deps({ readRun: async () => ({ kind }) }),
      );
      const data = (await body(response)).data as {
        status: string;
        retryAfterSeconds: number;
      };
      // Both states are progress, not failure: a client that cannot read
      // `queued` counts it as an error and kills a run that is about to start.
      expect(data.status).toBe(kind);
      expect(data.retryAfterSeconds).toBe(5);
    }
  });
});

describe("what a refusal must not cost", () => {
  it("does not spend a run when the provider has no credentials", async () => {
    const consumeDailyRun = vi.fn(async () => true);
    const response = await handleVisibilityStart(
      post("/run", startBody()),
      deps({ providerConfigured: () => false, consumeDailyRun }),
    );
    expect(response.status).toBe(503);
    // An unconfigured deployment would otherwise burn all five of the day's
    // runs before the visitor learned the key was missing.
    expect(consumeDailyRun).not.toHaveBeenCalled();
  });

  it("says the day's window as well as its size", async () => {
    const response = await handleVisibilityStart(
      post("/run", startBody()),
      deps({ consumeDailyRun: async () => false }),
    );
    const parsed = await body(response);
    expect(parsed.limit).toBe(VISIBILITY_RUNS_PER_DAY);
    expect(parsed.windowSeconds).toBe(VISIBILITY_DAILY_WINDOW_SECONDS);
  });

  it("tells a store outage apart from an empty account", async () => {
    // "You own nothing" and "the database is down" lead to opposite actions.
    const unavailable = { kind: "unavailable", reason: "transport" } as const;
    const load = await handleVisibilityLoad(
      post("/load", {}),
      deps({ listFrozen: async () => unavailable }),
    );
    expect(load.status).toBe(503);
    const start = await handleVisibilityStart(
      post("/run", startBody()),
      deps({ listFrozen: async () => unavailable }),
    );
    expect(start.status).toBe(503);
  });

  it("refuses a body carrying fields it does not know", async () => {
    const startRun = vi.fn();
    const response = await handleVisibilityStart(
      post("/run", startBody({ userId: "someone-else" })),
      deps({ startRun }),
    );
    expect(response.status).toBe(400);
    expect(startRun).not.toHaveBeenCalled();
  });
});
