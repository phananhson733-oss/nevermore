import { describe, expect, it } from "vitest";
import {
  COLLECT_CRAWL_JOB_EXPIRY_SECONDS,
  QUEUE_CONFIG,
} from "@sf/db/queue";
import {
  CRAWL_BUDGET,
  CRAWL_FINALIZATION_HEADROOM_MS,
  CRAWL_JOB_WALL_CLOCK_CAP_MS,
} from "@sf/sources";

describe("crawl queue and engine wall-clock contract", () => {
  it("finishes provider work before pg-boss expiry with fixed finalization headroom", () => {
    const queueWindowMs =
      QUEUE_CONFIG["collect.crawl"].expireInSeconds * 1_000;

    expect(queueWindowMs).toBe(COLLECT_CRAWL_JOB_EXPIRY_SECONDS * 1_000);
    expect(queueWindowMs).toBe(CRAWL_JOB_WALL_CLOCK_CAP_MS);
    expect(CRAWL_BUDGET.maxWallClockMs).toBeLessThan(queueWindowMs);
    expect(queueWindowMs - CRAWL_BUDGET.maxWallClockMs).toBe(
      CRAWL_FINALIZATION_HEADROOM_MS,
    );
  });
});
