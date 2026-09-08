import { describe, expect, it, vi } from "vitest";
import { handleGeoKbRun, type GeoKbRunHandlerDependencies } from "./kb-run-handler.ts";
import type { GeoRunLedgerStore, GeoRunRecord } from "./kb-run-ledger.ts";

const USER = "6f3d1a04-77c5-8d31-9e60-0a1b2c3d4e5f";
const KB = "1f08f279-2b40-8c11-9a33-5d6e7f809a1b";
const RUN = "9c7b5e21-3a44-8f77-8d21-0b1c2d3e4f50";

const run: GeoRunRecord = {
  schemaVersion: "marketing-geo-kb-run.v1",
  runId: RUN,
  userId: USER,
  kbId: KB,
  idempotencyKey: "run-key-000001",
  state: "running",
  generationInputHash: null,
  leaseExpiresAt: "2026-09-07T12:06:00.000Z",
  createdAt: "2026-09-07T11:59:00.000Z",
};

function store(overrides: Partial<GeoRunLedgerStore> = {}): GeoRunLedgerStore {
  return {
    claimRun: async () => ({ kind: "claimed", run, operations: [], leaseToken: "1f08f279-2b40-8c11-9a33-5d6e7f809a1c" }),
    readRun: async () => ({ kind: "found", run, operations: [] }),
    appendOperations: async () => ({ kind: "found", run, operations: [] }),
    claimOperation: async () => ({ kind: "unavailable" }),
    dispatchOperation: async () => ({ kind: "unavailable" }),
    finishOperation: async () => ({ kind: "unavailable" }),
    probeOperation: async () => ({ kind: "unavailable" }),
    bindGenerationInput: async () => ({ kind: "unavailable" }),
    releaseRun: async () => ({ kind: "ok", run }),
    finishRun: async () => ({ kind: "ok", run: { ...run, state: "complete" } }),
    ...overrides,
  };
}

function dependencies(overrides: Partial<GeoKbRunHandlerDependencies> = {}): GeoKbRunHandlerDependencies {
  return {
    authenticate: async () => ({ status: "authenticated", userId: USER }) as never,
    plan: async () => ({ kind: "ready", seed: [], executor: { start: async () => ({ kind: "outcome_unknown" }), probe: async () => ({ kind: "unresolved" }) } }),
    store: store(),
    abandon: async () => "abandoned",
    now: () => new Date("2026-09-07T12:00:00.000Z"),
    ...overrides,
  };
}

const post = (body: unknown, origin = "https://gengrowth.ai") =>
  new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/v3/run", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });

describe("the single-run route", () => {
  it("refuses an unauthenticated caller before it reads the body", async () => {
    const plan = vi.fn();
    const response = await handleGeoKbRun(
      post({ kbId: KB, idempotencyKey: "run-key-000001" }),
      dependencies({ authenticate: async () => ({ status: "unauthenticated" }) as never, plan: plan as never }),
    );
    expect(response.status).toBe(401);
    expect(plan).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post", async () => {
    const response = await handleGeoKbRun(
      post({ kbId: KB, idempotencyKey: "run-key-000001" }, "https://evil.test"),
      dependencies(),
    );
    expect(response.status).toBe(403);
  });

  it("requires exactly one of a run id and an idempotency key", async () => {
    // Both would leave "which run is this" to whatever the store preferred;
    // neither would create a run with no name.
    for (const body of [
      { kbId: KB },
      { kbId: KB, runId: RUN, idempotencyKey: "run-key-000001" },
    ]) {
      const response = await handleGeoKbRun(post(body), dependencies());
      expect(response.status).toBe(400);
    }
  });

  it("never lets the caller name the work to be done", async () => {
    // A client-supplied URL would spend the account's crawl budget on a target
    // of the caller's choosing.
    const response = await handleGeoKbRun(
      post({ kbId: KB, idempotencyKey: "run-key-000001", seed: [{ key: "fetch:own:https://evil.test/", kind: "fetch" }] }),
      dependencies(),
    );
    expect(response.status).toBe(400);
  });

  it("returns the run state and never the lease token", async () => {
    const response = await handleGeoKbRun(post({ kbId: KB, idempotencyKey: "run-key-000001" }), dependencies());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data.status).toBe("complete");
    expect(JSON.stringify(body)).not.toContain("leaseToken");
    expect(JSON.stringify(body)).not.toContain("lease_token");
    // The count crosses as a string: this wire carries no JSON numbers.
    expect(body.data.remaining).toBe("0");
  });

  it("answers 409 when another run already owns this site", async () => {
    const response = await handleGeoKbRun(
      post({ kbId: KB, idempotencyKey: "run-key-000002" }),
      dependencies({ store: store({ claimRun: async () => ({ kind: "run_active", run, operations: [] }) }) }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).data.status).toBe("run_active");
  });

  it("reads a resumable run without claiming it", async () => {
    const claimRun = vi.fn();
    const response = await handleGeoKbRun(
      post({ kbId: KB, action: "read" }),
      dependencies({ store: store({ claimRun: claimRun as never }) }),
    );
    expect(claimRun).not.toHaveBeenCalled();
    expect((await response.json()).data.status).toBe("resumable");
  });

  it("refuses to abandon a run someone is still holding", async () => {
    const response = await handleGeoKbRun(
      post({ kbId: KB, runId: RUN, action: "abandon" }),
      dependencies({ abandon: async () => "busy" }),
    );
    expect(response.status).toBe(409);
  });
});
