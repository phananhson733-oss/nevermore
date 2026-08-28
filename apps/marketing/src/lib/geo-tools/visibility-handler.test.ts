import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  handleVisibilityLoad,
  handleVisibilityStart,
  handleVisibilityStatus,
  type VisibilityFrozenChoice,
  type VisibilityHandlerDependencies,
} from "./visibility-handler.ts";
import { seal } from "../auth/sealed-cookie.ts";
import { VISIBILITY_RUNS_PER_DAY } from "./visibility-contract.ts";

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
    expect(((await body(response)).data as { choices: unknown[] }).choices).toEqual(
      [],
    );
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
