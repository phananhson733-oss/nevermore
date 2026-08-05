import { describe, expect, it } from "vitest";
import { createGtag } from "./google-analytics-queue";

describe("createGtag", () => {
  it("queues the Arguments object required by the official gtag.js contract", () => {
    const dataLayer: unknown[] = [];
    const gtag = createGtag(dataLayer);

    gtag("config", "G-TEST", { send_page_view: true });

    expect(dataLayer).toHaveLength(1);
    expect(Array.isArray(dataLayer[0])).toBe(false);
    expect(Array.from(dataLayer[0] as ArrayLike<unknown>)).toEqual([
      "config",
      "G-TEST",
      { send_page_view: true },
    ]);
  });
});
