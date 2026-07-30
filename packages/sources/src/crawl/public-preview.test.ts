import { describe, expect, it } from "vitest";
import {
  PUBLIC_PREVIEW_CRAWL_BUDGET,
  PUBLIC_PREVIEW_MAX_REQUESTS,
  PUBLIC_PREVIEW_CRAWL_USER_AGENT,
} from "./public-preview.ts";

describe("public preview crawl profile", () => {
  it("keeps anonymous crawl resources below the full product profile", () => {
    expect(PUBLIC_PREVIEW_CRAWL_BUDGET).toEqual({
      maxUrls: 25,
      maxDepth: 4,
      maxWallClockMs: 40_000,
      maxRedirects: 5,
      maxBodyBytes: 1 * 1024 * 1024,
      maxTotalBytes: 12 * 1024 * 1024,
      perHostConcurrency: 2,
      minHostDelayMs: 300,
    });
    expect(PUBLIC_PREVIEW_CRAWL_USER_AGENT).toContain("GenGrowth-Internal-Link-Audit");
    expect(PUBLIC_PREVIEW_MAX_REQUESTS).toBe(60);
  });
});
