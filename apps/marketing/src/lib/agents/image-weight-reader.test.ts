// @input  -- a stubbed per-image weigher, succeeding and failing
// @output -- proof the reader bounds what it fetches and never fakes a pass
// @pos    -- unit coverage for the only subresource fetch this product makes

import { describe, expect, it } from "vitest";

import { createImageWeightReader } from "./image-weight-reader.ts";

const url = (i: number) => `https://acme.test/img/${i}.webp`;

describe("image weight reader", () => {
  it("weighs the images it was given", async () => {
    const read = createImageWeightReader({
      weighImage: async (u) => ({
        url: u,
        transferredBytes: 1_000,
        complete: true,
      }),
    });
    const result = await read({ sources: [url(1), url(2)] });

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.images).toHaveLength(2);
  });

  it("stops at the measured ceiling however many the page declares", async () => {
    // A page can declare three hundred. Fetching all of them would spend more
    // requests on one page's decoration than the crawl spends on the site, for
    // a check whose published severity is a Tip.
    const seen: string[] = [];
    const read = createImageWeightReader({
      weighImage: async (u) => {
        seen.push(u);
        return { url: u, transferredBytes: 10, complete: true };
      },
    });
    await read({
      sources: Array.from({ length: 300 }, (_, i) => url(i)),
    });

    expect(seen.length).toBeLessThanOrEqual(25);
  });

  it("says nothing was fetched rather than reporting a clean page", async () => {
    // Every fetch failing means we learned nothing. An empty affected list
    // would read as "no image is over budget", which is a claim about files
    // that never arrived.
    const read = createImageWeightReader({ weighImage: async () => null });
    const result = await read({ sources: [url(1)] });

    expect(result).toEqual({
      status: "unavailable",
      reason: "no_image_could_be_fetched",
    });
  });

  it("separates a page with no images from a page whose images failed", async () => {
    const read = createImageWeightReader({ weighImage: async () => null });

    expect(await read({ sources: [] })).toEqual({
      status: "unavailable",
      reason: "no_images_declared",
    });
  });
});
