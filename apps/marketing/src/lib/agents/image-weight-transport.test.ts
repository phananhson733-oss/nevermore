// @input  -- stubbed `fetchPublicResource` responses
// @output -- proof the branch production actually takes handles status,
//            content type and byte accounting the way its comments claim
// @pos    -- the only coverage of `weigh` itself

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublicResource = vi.fn();
vi.mock("@sf/sources/public-http", () => ({ fetchPublicResource }));

const { createImageWeightReader } = await import("./image-weight-reader.ts");
const { IMAGE_TRANSFER_BUDGET_BYTES } = await import(
  "@sf/public-tools/seo-audit/page-performance"
);

/**
 * Every other test in this folder injects a transport, and the handler
 * constructs this reader with no arguments — so until this file existed the
 * entire production branch was unexecuted. Mutation-checked before it was
 * written: throwing on the first line of the batching loop left the suite
 * green.
 */
const ok = (over: Record<string, unknown> = {}) => ({
  kind: "ok" as const,
  finalStatus: 200,
  contentType: "image/jpeg",
  bytes: 40 * 1024,
  bodyComplete: true,
  ...over,
});

const read = (sources: readonly string[]) =>
  createImageWeightReader()({ sources });

beforeEach(() => {
  fetchPublicResource.mockReset();
});

describe("weigh, as production calls it", () => {
  it("measures an image the origin actually served", async () => {
    fetchPublicResource.mockResolvedValue(ok());
    const result = await read(["https://cdn.test/a.jpg"]);

    expect(result).toEqual({
      status: "ok",
      images: [
        {
          url: "https://cdn.test/a.jpg",
          transferredBytes: 40 * 1024,
          complete: true,
        },
      ],
      complete: true,
    });
  });

  it("reads a body that filled the cap as over budget, not as its exact size", async () => {
    fetchPublicResource.mockResolvedValue(
      ok({ bytes: IMAGE_TRANSFER_BUDGET_BYTES, bodyComplete: false }),
    );
    const result = await read(["https://cdn.test/huge.jpg"]);

    expect(result.status === "ok" && result.images[0]?.complete).toBe(false);
  });

  it("refuses a 200 that is not an image", async () => {
    // A page can declare `<img src="/missing">` at an origin that answers 200
    // with a two-kilobyte HTML error. Measured as an image it is a healthy
    // small one, and if every declared image does it the set reads complete
    // and 5.2 passes a page on which no image was ever served.
    fetchPublicResource.mockResolvedValue(
      ok({ contentType: "text/html; charset=utf-8", bytes: 2 * 1024 }),
    );

    expect(await read(["https://acme.test/missing"])).toEqual({
      status: "unavailable",
      reason: "no_image_could_be_fetched",
    });
  });

  it("refuses a response that never said it was an image", async () => {
    // This test previously asserted the opposite, on the argument that plenty
    // of origins omit the header. That locked in the hole beside it: a missing
    // image route answering 200 with a small HTML fallback and no type was
    // measured as a healthy image. Nothing here can read the bytes, so an
    // unstated type is "could not establish that this is an image".
    fetchPublicResource.mockResolvedValue(ok({ contentType: null }));

    expect(await read(["https://cdn.test/a.jpg"])).toEqual({
      status: "unavailable",
      reason: "no_image_could_be_fetched",
    });
  });

  it("refuses a non-2xx even when it arrived with a body", async () => {
    fetchPublicResource.mockResolvedValue(ok({ finalStatus: 404 }));

    expect((await read(["https://cdn.test/gone.jpg"])).status).toBe(
      "unavailable",
    );
  });

  it("charges the bytes an error response cost, so the ceiling sees them", async () => {
    // Twenty-five 200 KB error bodies is five megabytes against a
    // three-megabyte run ceiling. Charging only successes made every one of
    // those bytes invisible to the cap installed to bound them.
    fetchPublicResource.mockResolvedValue(
      ok({ finalStatus: 500, bytes: 200 * 1024 }),
    );
    await read(
      Array.from({ length: 25 }, (_, i) => `https://cdn.test/e${i}.jpg`),
    );

    expect(fetchPublicResource.mock.calls.length).toBeLessThan(25);
  });

  it("survives a transport that throws, and charges what it may have cost", async () => {
    fetchPublicResource.mockRejectedValue(new Error("socket hang up"));
    const sources = Array.from(
      { length: 25 },
      (_, i) => `https://cdn.test/x${i}.jpg`,
    );

    expect((await read(sources)).status).toBe("unavailable");
    // A throw carries no byte count, and the body prefix it may already have
    // pulled is real. Charging zero is how error bodies used to pass the cap
    // without it seeing a byte.
    expect(fetchPublicResource.mock.calls.length).toBeLessThan(25);
  });

  it("keeps the whole run under the ceiling it states, in-flight reads included", async () => {
    // Checking only what has already been spent let a run just under the
    // ceiling launch a full concurrent batch and finish above it.
    fetchPublicResource.mockResolvedValue(ok({ bytes: 200 * 1024 }));
    const sources = Array.from(
      { length: 25 },
      (_, i) => `https://cdn.test/i${i}.jpg`,
    );
    await read(sources);

    const transferred = fetchPublicResource.mock.calls.length * 200 * 1024;
    expect(transferred).toBeLessThanOrEqual(3 * 1024 * 1024);
  });

  it("asks for no more of a body than the published budget", async () => {
    fetchPublicResource.mockResolvedValue(ok());
    await read(["https://cdn.test/a.jpg"]);

    expect(fetchPublicResource).toHaveBeenCalledWith(
      "https://cdn.test/a.jpg",
      expect.objectContaining({ maxBodyBytes: IMAGE_TRANSFER_BUDGET_BYTES }),
    );
  });
});
