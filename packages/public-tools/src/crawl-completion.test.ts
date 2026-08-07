import { describe, expect, it } from "vitest";
import {
  CRAWL_ABORTED_STOP_REASON,
  crawlRanToCompletion,
} from "./crawl-completion.ts";

describe("crawlRanToCompletion", () => {
  it("refuses a run the caller aborted", () => {
    expect(crawlRanToCompletion({ stopReason: "aborted" })).toBe(false);
    expect(
      crawlRanToCompletion({ stopReason: CRAWL_ABORTED_STOP_REASON }),
    ).toBe(false);
  });

  /**
   * A budget stop is not truncation. It is this profile's own documented
   * ceiling, the next visitor's crawl of the same site reaches the same place,
   * and every tool's payload states it.
   */
  it.each(["max_urls", "max_depth", "max_duration", "max_requests"] as const)(
    "accepts a run that stopped at the %s ceiling",
    (stopReason) => {
      expect(crawlRanToCompletion({ stopReason })).toBe(true);
    },
  );

  it("accepts a run that stopped for no reason at all", () => {
    expect(crawlRanToCompletion({ stopReason: null })).toBe(true);
  });
});
