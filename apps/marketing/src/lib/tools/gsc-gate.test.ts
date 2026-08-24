import { describe, expect, it, vi } from "vitest";

import {
  GSC_IP_MAX,
  GSC_IP_WINDOW_SECONDS,
  gscIpBucket,
  openGscGate,
  type GscGateDependencies,
} from "./gsc-gate.ts";

const IP = "203.0.113.9";

function deps(over: Partial<GscGateDependencies> = {}): GscGateDependencies {
  return {
    acquireSlot: () => ({ acquired: true, release: () => {} }),
    quota: {
      callQuota: async () => ({
        allowed: true,
        hits: 1,
        reset_at: new Date().toISOString(),
      }),
    },
    ...over,
  };
}

describe("gscIpBucket", () => {
  it("keys on the IP under one namespace shared by every Search Console tool", () => {
    // Quota is counted per GCP project, not per visitor. A tool-scoped bucket
    // would let one caller spend twice the budget by using both tools.
    expect(gscIpBucket(IP)).toBe(`public-gsc:ip:${IP}`);
  });
});

describe("openGscGate", () => {
  it("admits a caller who clears both layers", async () => {
    const release = vi.fn();
    const result = await openGscGate(
      IP,
      deps({ acquireSlot: () => ({ acquired: true, release }) }),
    );

    expect(result).toMatchObject({ ok: true, remaining: 9, limit: 10 });
    if (!result.ok) return;
    result.release();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reports the remaining shared hourly budget on the allowed branch", async () => {
    const result = await openGscGate(
      IP,
      deps({
        quota: {
          callQuota: async () => ({
            allowed: true,
            hits: 2,
            reset_at: new Date().toISOString(),
          }),
        },
      }),
    );

    expect(result).toMatchObject({ ok: true, remaining: 8, limit: 10 });
  });

  it("never reports a negative remaining budget when allowed hits reach the cap", async () => {
    const result = await openGscGate(
      IP,
      deps({
        quota: {
          callQuota: async () => ({
            allowed: true,
            hits: GSC_IP_MAX + 2,
            reset_at: new Date().toISOString(),
          }),
        },
      }),
    );

    expect(result).toMatchObject({ ok: true, remaining: 0, limit: 10 });
  });

  it("refuses a second concurrent read with 409 before touching the quota", async () => {
    // The in-flight slot is the cheap check. Spending a durable quota call to
    // reject a double-submit would cost more than the submit.
    const callQuota = vi.fn();
    const result = await openGscGate(
      IP,
      deps({
        acquireSlot: () => ({ acquired: false }),
        quota: { callQuota: callQuota as never },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(409);
    expect(result.response.headers.get("Retry-After")).toBe("5");
    await expect(result.response.json()).resolves.toEqual({
      error: { code: "scan_in_progress" },
    });
    expect(callQuota).not.toHaveBeenCalled();
  });

  it("refuses with 429 when the hourly volume budget is spent", async () => {
    const result = await openGscGate(
      IP,
      deps({
        quota: {
          callQuota: async () => ({
            allowed: false,
            hits: GSC_IP_MAX + 1,
            reset_at: new Date(Date.now() + 600_000).toISOString(),
          }),
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(Number(result.response.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(result.response.json()).resolves.toEqual({
      error: { code: "rate_limited" },
    });
  });

  it("fails CLOSED with 503 when the quota store cannot answer", async () => {
    // An endpoint that spends a shared upstream budget with no working
    // limiter is worse than one that is briefly unavailable: the visitor
    // turned away can come back, exhausted project quota takes the tool down
    // for everyone.
    const result = await openGscGate(
      IP,
      deps({
        quota: {
          callQuota: async () => {
            throw new Error("store unreachable");
          },
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect(result.response.headers.get("Retry-After")).toBe("60");
    await expect(result.response.json()).resolves.toEqual({
      error: { code: "quota_unavailable" },
    });
  });

  it("releases the slot on every refusal path", async () => {
    // A latched slot would 409 that client until the isolate recycled.
    for (const quota of [
      {
        callQuota: async () => ({
          allowed: false,
          hits: 99,
          reset_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      },
      {
        callQuota: async () => {
          throw new Error("down");
        },
      },
    ]) {
      const release = vi.fn();
      const result = await openGscGate(
        IP,
        deps({ acquireSlot: () => ({ acquired: true, release }), quota }),
      );

      expect(result.ok).toBe(false);
      expect(release).toHaveBeenCalledTimes(1);
    }
  });

  it("never caches a gate response", async () => {
    const result = await openGscGate(
      IP,
      deps({ acquireSlot: () => ({ acquired: false }) }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.headers.get("Cache-Control")).toBe(
      "no-store, private",
    );
  });

  it("asks the quota store for this tool's own budget", async () => {
    const callQuota = vi.fn(async () => ({
      allowed: true,
      hits: 1,
      reset_at: new Date().toISOString(),
    }));

    await openGscGate(IP, deps({ quota: { callQuota } }));

    expect(callQuota).toHaveBeenCalledWith(
      gscIpBucket(IP),
      GSC_IP_MAX,
      GSC_IP_WINDOW_SECONDS,
    );
  });
});
