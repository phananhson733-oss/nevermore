import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _internalStoreSize,
  checkRateLimit,
  resetRateLimitStore,
} from "./rate-limit.ts";

describe("in-memory rate-limit storage", () => {
  afterEach(() => {
    resetRateLimitStore();
    vi.useRealTimers();
  });

  it("fails closed at 5,000 active keys and admits a new key after expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T08:00:00.000Z"));

    for (let index = 0; index < 5_000; index += 1) {
      expect(checkRateLimit(`ip:${index}`, 5, 600_000).allowed).toBe(true);
    }

    expect(checkRateLimit("ip:overflow", 5, 600_000)).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 600,
    });
    expect(_internalStoreSize()).toBe(5_000);
    expect(checkRateLimit("ip:0", 5, 600_000)).toMatchObject({
      allowed: true,
      remaining: 3,
    });
    expect(_internalStoreSize()).toBe(5_000);

    vi.advanceTimersByTime(600_000);
    expect(checkRateLimit("ip:after-expiry", 5, 600_000).allowed).toBe(true);
    expect(_internalStoreSize()).toBe(1);
  });
});
