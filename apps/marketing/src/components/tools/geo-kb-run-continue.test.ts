import { describe, expect, it, vi } from "vitest";
import {
  abandonGeoKbRun,
  driveGeoKbRun,
  GEO_KB_RUN_STALL_LIMIT,
  parseGeoKbRunView,
  readGeoKbRunState,
  type GeoKbRunPost,
} from "./geo-kb-run-continue.ts";

const KB = "1f08f279-2b40-8c11-9a33-5d6e7f809a1b";
const RUN = "9c7b5e21-3a44-8f77-8d21-0b1c2d3e4f50";

function view(overrides: Record<string, unknown> = {}) {
  return {
    status: "in_progress",
    run: {
      runId: RUN,
      kbId: KB,
      state: "running",
      generationInputHash: null,
      createdAt: "2026-09-07T12:00:00.000Z",
    },
    operations: [],
    waiting: [],
    skipped: [],
    remaining: "2",
    acted: null,
    ...overrides,
  };
}

const posting = (
  responses: readonly unknown[],
): { post: GeoKbRunPost; bodies: Record<string, unknown>[] } => {
  const bodies: Record<string, unknown>[] = [];
  let call = 0;
  return {
    bodies,
    post: async (body) => {
      bodies.push(body);
      const next = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return { ok: true, data: next };
    },
  };
};

describe("driving a run from the tab", () => {
  it("keeps calling until the plan reports complete", async () => {
    const { post, bodies } = posting([
      view({ remaining: "2" }),
      view({ remaining: "1" }),
      view({ status: "complete", remaining: "0" }),
    ]);
    const result = await driveGeoKbRun(
      { kbId: KB, idempotencyKey: "run-key-000001" },
      { post, wait: async () => undefined },
    );
    expect(result.status).toBe("complete");
    expect(bodies).toHaveLength(3);
    // The first call names the gesture; every later one names the run, so the
    // auto-continue cannot create a second run for one press.
    expect(bodies[0]).toEqual({ kbId: KB, idempotencyKey: "run-key-000001" });
    expect(bodies[1]).toEqual({ kbId: KB, runId: RUN });
    expect(bodies[2]).toEqual({ kbId: KB, runId: RUN });
  });

  it("stops when everything left belongs to another executor", async () => {
    const { post, bodies } = posting([
      view({ status: "blocked", waiting: ["model:knowledge"], remaining: "1" }),
    ]);
    const result = await driveGeoKbRun(
      { kbId: KB, runId: RUN },
      { post, wait: async () => undefined },
    );
    expect(result.status).toBe("blocked");
    expect(result.waiting).toEqual(["model:knowledge"]);
    expect(bodies).toHaveLength(1);
  });

  it("backs off rather than forcing its way past a live lease", async () => {
    const wait = vi.fn(async () => undefined);
    let call = 0;
    const post: GeoKbRunPost = async () => {
      call += 1;
      return call === 1
        ? {
            ok: false,
            code: "run_busy",
            data: view({ status: "busy", remaining: "1" }),
          }
        : { ok: true, data: view({ status: "complete", remaining: "0" }) };
    };
    const result = await driveGeoKbRun(
      { kbId: KB, runId: RUN },
      { post, wait },
    );
    expect(wait).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("complete");
  });

  it("stops instead of spinning when the server stops making progress", async () => {
    // `in_progress` forever with the same count left is what a server that
    // cannot move looks like. The run is still there to continue later.
    const { post, bodies } = posting([view({ remaining: "2" })]);
    const result = await driveGeoKbRun(
      { kbId: KB, runId: RUN },
      { post, wait: async () => undefined },
    );
    expect(result.status).toBe("stalled");
    expect(result.errorCode).toBe("no_progress");
    expect(bodies.length).toBeLessThanOrEqual(GEO_KB_RUN_STALL_LIMIT + 1);
  });

  it("counts an unreadable remaining count as no progress at all", async () => {
    // A JSON number is not this wire's shape. Reading it as 0 would look like
    // one step forward on the first call and buy a stuck server an extra round
    // trip, so the call count -- not just the ending status -- is the assertion.
    const { post, bodies } = posting([view({ remaining: 2 })]);
    const result = await driveGeoKbRun(
      { kbId: KB, runId: RUN },
      { post, wait: async () => undefined },
    );
    expect(result.status).toBe("stalled");
    expect(bodies).toHaveLength(GEO_KB_RUN_STALL_LIMIT);
  });

  it("does not continue after a refusal it cannot poll past", async () => {
    let call = 0;
    const post: GeoKbRunPost = async () => {
      call += 1;
      return { ok: false, code: "auth_required", data: view() };
    };
    const result = await driveGeoKbRun(
      { kbId: KB, runId: RUN },
      { post, wait: async () => undefined },
    );
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("auth_required");
    expect(call).toBe(1);
  });

  it("stops when a different run is already open on this site", async () => {
    const post: GeoKbRunPost = async () => ({
      ok: false,
      code: "run_busy",
      data: view({ status: "run_active" }),
    });
    const result = await driveGeoKbRun(
      { kbId: KB, idempotencyKey: "run-key-000001" },
      { post, wait: async () => undefined },
    );
    expect(result.status).toBe("run_active");
    expect(result.runId).toBe(RUN);
  });

  it("gives up cooperatively when the caller aborts", async () => {
    const signal = { aborted: false };
    const post: GeoKbRunPost = async () => {
      signal.aborted = true;
      return { ok: true, data: view({ remaining: "1" }) };
    };
    const result = await driveGeoKbRun(
      { kbId: KB, runId: RUN },
      { post, wait: async () => undefined, signal },
    );
    expect(result.errorCode).toBe("aborted");
    expect(result.status).toBe("in_progress");
  });

  it("reads the resumable run without asking for any work", async () => {
    const bodies: Record<string, unknown>[] = [];
    const post: GeoKbRunPost = async (body) => {
      bodies.push(body);
      return {
        ok: true,
        data: {
          status: "resumable",
          run: { runId: RUN },
          operations: [
            {
              key: "model:roles",
              kind: "model",
              state: "dispatched",
              reason: null,
            },
          ],
        },
      };
    };
    const state = await readGeoKbRunState(KB, { post });
    expect(bodies[0]).toEqual({ kbId: KB, action: "read" });
    expect(state).toEqual({
      status: "resumable",
      runId: RUN,
      operations: [
        {
          key: "model:roles",
          kind: "model",
          state: "dispatched",
          reason: null,
        },
      ],
    });
  });
});

describe("reading one response", () => {
  it("refuses a body that is not a run view", () => {
    expect(parseGeoKbRunView(null)).toBeNull();
    expect(parseGeoKbRunView({ run: null })).toBeNull();
  });
});

/**
 * Dropping a stopped run is the only thing that frees the single-active index
 * for a run nothing is driving, so these pin what the request says and what
 * each answer is allowed to be read as. Nothing here re-reads the ledger: the
 * outcome the route names is the only evidence the browser has.
 */
describe("abandoning a stopped run", () => {
  /** One post stub that records the body and answers whatever it is handed. */
  const answering = (
    reply:
      | { readonly ok: true; readonly data: unknown }
      | { readonly ok: false; readonly code: string; readonly data: unknown },
  ): { post: GeoKbRunPost; bodies: Record<string, unknown>[] } => {
    const bodies: Record<string, unknown>[] = [];
    return { bodies, post: async (body) => { bodies.push(body); return reply; } };
  };

  it("names the run to drop and asks for nothing else", async () => {
    const { post, bodies } = answering({ ok: true, data: { status: "abandoned" } });

    await abandonGeoKbRun({ kbId: KB, runId: RUN }, { post });

    // `action` decides everything: without it the route defaults to `advance`,
    // and the call that was meant to end this run would drive it instead --
    // spending against the very run the owner asked to stop.
    expect(bodies).toEqual([{ kbId: KB, runId: RUN, action: "abandon" }]);
  });

  it.each([
    ["abandoned", "abandoned"],
    ["finished", "finished"],
  ] as const)("reports the ledger's own %s outcome", async (status, expected) => {
    const { post } = answering({ ok: true, data: { status } });

    expect(await abandonGeoKbRun({ kbId: KB, runId: RUN }, { post })).toEqual({ outcome: expected });
  });

  it.each([
    ["a run that is still going", { status: "running" }],
    ["a body with no status at all", { run: null }],
    ["a body that is not an object", "abandoned"],
  ])("refuses to read %s as a run that was dropped", async (_, data) => {
    const { post } = answering({ ok: true, data });

    // A 200 is not a statement that anything was abandoned. Reading one as
    // success would tell an owner their update was dropped while the ledger
    // still holds it, and every later start would answer `run_active`.
    expect(await abandonGeoKbRun({ kbId: KB, runId: RUN }, { post })).toEqual({
      outcome: "failed",
      code: "bad_response",
    });
  });

  it("keeps a live lease apart from every other refusal", async () => {
    const busy = answering({ ok: false, code: "run_busy", data: { error: { code: "run_busy" } } });
    const gone = answering({ ok: false, code: "not_found", data: null });
    const outage = answering({ ok: false, code: "store_unavailable", data: null });
    const signedOut = answering({ ok: false, code: "auth_required", data: null });

    // Waiting fixes exactly one of these. The other three are not fixed by
    // waiting, and two of them are not fixed by the owner at all -- so they
    // keep their own code rather than being flattened into "try again".
    expect(await abandonGeoKbRun({ kbId: KB, runId: RUN }, busy)).toEqual({ outcome: "busy" });
    expect(await abandonGeoKbRun({ kbId: KB, runId: RUN }, gone)).toEqual({ outcome: "not_found" });
    expect(await abandonGeoKbRun({ kbId: KB, runId: RUN }, outage)).toEqual({ outcome: "failed", code: "store_unavailable" });
    expect(await abandonGeoKbRun({ kbId: KB, runId: RUN }, signedOut)).toEqual({ outcome: "failed", code: "auth_required" });
  });
});
